import {COLORS, type CurrentUnit, type Point} from './lsv-math';
import {scanSegments, type ScanSegment} from './scan-branches';

export type CvQuality = 'peak'|'shoulder';
export type CvSeries = {
  id:string; name:string; source:string; rate:string; area:string; unit:CurrentUnit|'';
  included:boolean; cycle:string; anodic:string; cathodic:string;
  anodicQuality:CvQuality; cathodicQuality:CvQuality;
  points:Point[]; metadata:Record<string,unknown>;
};
export type CvGroup = {id:string;name:string;color:string;visible:boolean;series:CvSeries[]};
export type CvSettings = {
  temperature:string;n:string;cycle:string;anodicMin:string;anodicMax:string;
  cathodicMin:string;cathodicMax:string;threshold:string;calculationMode:'qualified'|'trial';
};
export const DEFAULT_CV_SETTINGS:CvSettings={temperature:'25',n:'1',cycle:'4',anodicMin:'',anodicMax:'',cathodicMin:'',cathodicMax:'',threshold:'0.2',calculationMode:'qualified'};
export const CV_LIMIT=120, CV_POINT_LIMIT=500_000;
export const cvNumber=(text:string):number=>text.trim()?Number(text):NaN;
export const cvFinite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export type CvPeak={e:number;current:number;j:number;index:number;manual:boolean;quality:CvQuality};
export type CvTracePoint={x:number;j:number;rawE:number;rawCurrent:number;index:number;direction:'up'|'down'};
export type CvTrace={series:CvSeries;groupId:string;groupName:string;color:string;visible:boolean;points:(CvTracePoint|null)[];cycles:number;selectedCycle:number;anodic?:CvPeak;cathodic?:CvPeak;error?:string;warnings:string[]};
export type CvFit={slope:number;intercept:number;r2:number|null;n:number;min:number;max:number;residuals:number[]};
export type CvRow={trace:CvTrace;rate:number;lnRate:number;epa?:number;epc?:number;delta?:number;halfDelta?:number;included:boolean;qualified:boolean;usedForKs:boolean;ks?:number;status:string;error?:string;warnings:string[]};
export type CvGroupResult={group:CvGroup;rows:CvRow[];fit?:CvFit;anodicFit?:CvFit;cathodicFit?:CvFit;alpha?:number;slopeN?:number;ksGeomean?:number;ksMin?:number;ksMax?:number;ksCount:number;error?:string;warnings:string[]};
export type CvAnalysis={groups:CvGroupResult[];traces:CvTrace[];error?:string};
export function createCvGroup(name='样品1',index=0):CvGroup{return {id:crypto.randomUUID(),name,color:COLORS[index%COLORS.length],visible:true,series:[]};}
export function cvFitEquation(fit:CvFit):string {const f=(n:number)=>Number(n.toPrecision(6)).toString();return `y = ${f(fit.slope)} × ln(v / mV s⁻¹) ${fit.intercept<0?'−':'+'} ${f(Math.abs(fit.intercept))}`;}

/** Positive scaling changes plot height, while peak E and signed source I stay intact. */
export function cvCurrent(raw:number,unit:CurrentUnit|'',area:number):number {
  const scales:Record<CurrentUnit,number>={A:1000,mA:1,uA:.001,nA:.000001,'A/cm2':1000,'mA/cm2':1,'uA/cm2':.001};
  if(!unit||!Object.hasOwn(scales,unit))throw Error('请确认原始电流单位。');
  if(!unit.includes('/cm2')&&!(cvFinite(area)&&area>0))throw Error('电流密度换算需要大于 0 的有效面积。');
  const result=raw*scales[unit]/(unit.includes('/cm2')?1:area);
  if(!cvFinite(result))throw Error('电流换算超出数值范围。');
  return result;
}

type CvCycle={anodic:ScanSegment;cathodic:ScanSegment;number:number};
/** Acquisition-anchored paired branches. A partial leading pair is skipped together. */
export function cvCycles(points:Point[]):{cycles:CvCycle[];partial:boolean;warnings:string[]} {
  const valid=points.filter(p=>cvFinite(p.e));
  if(valid.length<3)return {cycles:[],partial:points.length>0,warnings:[]};
  let minimum=Infinity,maximum=-Infinity;
  for(const p of valid){minimum=Math.min(minimum,p.e);maximum=Math.max(maximum,p.e);}
  if(!(maximum>minimum))return {cycles:[],partial:true,warnings:[]};
  let e=valid[0].e;
  // E gaps are filled solely to retain branch identity. Source gaps stay null below.
  const coordinates=points.map(p=>{if(cvFinite(p.e))e=p.e;return {e,current:0};});
  const branches=scanSegments(coordinates);
  const steps:number[]=[];
  for(let i=1;i<points.length;i++)if(cvFinite(points[i].e)&&cvFinite(points[i-1].e)){const d=Math.abs(points[i].e-points[i-1].e);if(d>1e-10)steps.push(d);}
  steps.sort((a,b)=>a-b);const step=steps[Math.floor(steps.length/2)]??0;
  const epsilon=Math.max(1e-9,(maximum-minimum)*1e-6),tolerance=Math.max(epsilon,Math.min(step*(1+1e-6),(maximum-minimum)*.05));
  const complete=(branch:ScanSegment)=>Math.min(coordinates[branch.start].e,coordinates[branch.end].e)<=minimum+tolerance&&Math.max(coordinates[branch.start].e,coordinates[branch.end].e)>=maximum-tolerance;
  let start=0;
  if(branches[0]&&branches[1]&&!complete(branches[0])&&complete(branches[1])&&branches[0].end-branches[0].start<=2&&Math.abs(coordinates[branches[0].end].e-coordinates[branches[0].start].e)<=Math.min(step*2,(maximum-minimum)*.05)+epsilon)start=1;
  const anchor=branches[start]?.direction,cycles:CvCycle[]=[],warnings:string[]=[];
  let paired=0,number=0;
  for(let cursor=start;cursor<branches.length-1;cursor++){
    const a=branches[cursor],b=branches[cursor+1];
    if(a.direction!==anchor||a.direction===b.direction)continue;
    number++;
    if(complete(a)&&complete(b)){cycles.push({anodic:a.direction==='up'?a:b,cathodic:a.direction==='down'?a:b,number});paired+=2;}
    cursor++;
  }
  const partial=paired!==branches.length-start;
  if(partial)warnings.push('存在未配成完整往返扫描的分支，已保留原始数据。');
  if(start)warnings.push('起始的微小反向片段已单独标记。');
  if(points.some(p=>!cvFinite(p.e)||!cvFinite(p.current)))warnings.push('原始数据含缺口；取峰仅使用相邻有效点。');
  return {cycles,partial,warnings};
}

function peakFor(points:(CvTracePoint|null)[],direction:'up'|'down',manual:string,quality:CvQuality,minText:string,maxText:string):{peak?:CvPeak;error?:string;warnings:string[]} {
  const warnings:string[]=[],raw=points.filter((p):p is CvTracePoint=>!!p&&p.direction===direction);
  const lo=minText.trim()?cvNumber(minText):-Infinity,hi=maxText.trim()?cvNumber(maxText):Infinity;
  if(Number.isNaN(lo)||Number.isNaN(hi)||!(lo<hi))return {error:'取峰电位范围需要有效的下限和上限。',warnings};
  const rows=raw.filter(p=>p.x>=lo&&p.x<=hi);
  if(rows.length<5)return {error:`${direction==='up'?'氧化':'还原'}分支有效点不足，请调整取峰范围。`,warnings};
  if(manual.trim()){
    const wanted=cvNumber(manual);
    let minimum=Infinity,maximum=-Infinity;for(const p of rows){minimum=Math.min(minimum,p.x);maximum=Math.max(maximum,p.x);}
    if(!cvFinite(wanted)||wanted<minimum||wanted>maximum)return {error:'手动峰位超出当前分支或取峰范围。',warnings};
    const candidate=rows.reduce((best,p)=>Math.abs(p.x-wanted)<Math.abs(best.x-wanted)?p:best);
    // Use a measured coordinate, never synthesize current at a missing source row.
    if(Math.abs(candidate.x-wanted)>1e-9)warnings.push(`手动位置已对应到最近原始点 ${candidate.x.toPrecision(6)} V。`);
    return {peak:{e:candidate.x,current:candidate.rawCurrent,j:candidate.j,index:candidate.index,manual:true,quality},warnings};
  }
  const sign=direction==='up'?1:-1,ys=rows.map(p=>sign*p.j);
  let minimum=Infinity,maximum=-Infinity,magnitude=1;for(const y of ys){minimum=Math.min(minimum,y);maximum=Math.max(maximum,y);magnitude=Math.max(magnitude,Math.abs(y));}
  const range=maximum-minimum;
  if(!(range>0))return {error:'当前分支为恒定电流平台，请指定取点位置。',warnings};
  const equalTolerance=Math.max(Number.EPSILON*64*magnitude,range*1e-8),candidates:{peak:CvPeak;prominence:number}[]=[];
  // Linear-time prominence in each contiguous measured run, without crossing gaps.
  const prefix:number[]=[],suffix:number[]=[];
  for(let i=0;i<rows.length;i++)prefix[i]=i>0&&Math.abs(rows[i].index-rows[i-1].index)===1?Math.min(prefix[i-1],ys[i]):ys[i];
  for(let i=rows.length-1;i>=0;i--)suffix[i]=i+1<rows.length&&Math.abs(rows[i+1].index-rows[i].index)===1?Math.min(suffix[i+1],ys[i]):ys[i];
  for(let i=2;i<rows.length-2;i++){
    let end=i;while(end+1<rows.length&&Math.abs(ys[end+1]-ys[i])<=equalTolerance&&Math.abs(rows[end+1].index-rows[end].index)===1)end++;
    if(end>=rows.length-2){i=end;continue;}
    const support=[i-2,i-1,end+1,end+2];
    const contiguous=Math.abs(rows[i].index-rows[i-1].index)===1&&Math.abs(rows[i-1].index-rows[i-2].index)===1&&Math.abs(rows[end+1].index-rows[end].index)===1&&Math.abs(rows[end+2].index-rows[end+1].index)===1;
    if(!contiguous||!(ys[i]>ys[i-1]+equalTolerance&&ys[end]>ys[end+1]+equalTolerance)){i=end;continue;}
    if(end-i+1>Math.max(7,Math.floor(rows.length*.03))){i=end;continue;}
    const prominence=Math.min(ys[i]-prefix[i-1],ys[i]-suffix[end+1]);
    if(prominence>range*1e-4&&support.every(j=>cvFinite(ys[j]))){const p=rows[Math.floor((i+end)/2)];candidates.push({peak:{e:p.x,current:p.rawCurrent,j:p.j,index:p.index,manual:false,quality},prominence});}
    i=end;
  }
  candidates.sort((a,b)=>b.prominence-a.prominence);
  if(!candidates.length)return {error:`${direction==='up'?'氧化':'还原'}分支待确认峰位，可在原始 CV 图上手动取点。`,warnings};
  if(candidates.length>1&&candidates[1].prominence>candidates[0].prominence*.75)warnings.push('存在多个相近的局部峰，请核对所需氧化还原过程。');
  return {peak:candidates[0].peak,warnings};
}

export function prepareCvTraces(groups:CvGroup[],settings:CvSettings):CvTrace[]{
  return groups.flatMap(group=>group.series.map(series=>{
    const trace:CvTrace={series,groupId:group.id,groupName:group.name,color:group.color,visible:group.visible,points:[],cycles:0,selectedCycle:0,warnings:[]};
    try{
      const area=cvNumber(series.area);cvCurrent(0,series.unit,area);
      if(series.area.trim()&&!(area>0))throw Error('有效面积需要大于 0。');
      const split=cvCycles(series.points);trace.cycles=split.cycles.length;trace.warnings.push(...split.warnings);
      const requested=series.cycle.trim()||settings.cycle;
      const cycle=requested==='last'?split.cycles.at(-1):split.cycles.find(c=>c.number===cvNumber(requested));
      if(!cycle)throw Error(`所选第 ${requested==='last'?'末':requested} 圈未记录完整往返扫描（找到 ${split.cycles.length} 个完整圈）。`);
      trace.selectedCycle=cycle.number;
      const a=cycle.anodic,b=cycle.cathodic,start=Math.min(a.start,b.start),end=Math.max(a.end,b.end);
      trace.points=series.points.slice(start,end+1).map((p,n)=>{
        if(!cvFinite(p.e)||!cvFinite(p.current))return null;
        const index=start+n,direction=index>=a.start&&index<=a.end?'up':'down';
        return {x:p.e,j:cvCurrent(p.current,series.unit,area),rawE:p.e,rawCurrent:p.current,index,direction};
      });
      // Turning vertices belong to both branches in peak searches, but are excluded by support tests.
      const peaks:[keyof Pick<CvTrace,'anodic'|'cathodic'>,'up'|'down',string,CvQuality,string,string][]=[['anodic','up',series.anodic,series.anodicQuality,settings.anodicMin,settings.anodicMax],['cathodic','down',series.cathodic,series.cathodicQuality,settings.cathodicMin,settings.cathodicMax]];
      const errors:string[]=[];
      for(const [key,direction,manual,quality,lo,hi] of peaks){const found=peakFor(trace.points,direction,manual,quality,lo,hi);trace[key]=found.peak;trace.warnings.push(...found.warnings);if(found.error)errors.push(found.error);}
      if(errors.length)trace.error=errors.join(' ');
      if(trace.anodic&&trace.cathodic&&!(trace.anodic.e>trace.cathodic.e))trace.error='氧化峰电位需要高于对应还原峰，请核对取峰过程。';
    }catch(error){trace.error=(error as Error).message;}
    return trace;
  }));
}

export function fitCv(x:number[],y:number[]):CvFit|undefined{
  if(x.length!==y.length||x.length<3||!x.every(cvFinite)||!y.every(cvFinite)||new Set(x).size!==x.length)return;
  const n=x.length,mx=x.reduce((s,v)=>s+v/n,0),my=y.reduce((s,v)=>s+v/n,0);
  let xx=0,xy=0,yy=0;for(let i=0;i<n;i++){xx+=(x[i]-mx)**2;xy+=(x[i]-mx)*(y[i]-my);yy+=(y[i]-my)**2;}
  if(!(xx>0))return;
  const slope=xy/xx,intercept=my-slope*mx,residuals=x.map((v,i)=>y[i]-slope*v-intercept),sse=residuals.reduce((s,v)=>s+v*v,0);
  if(![slope,intercept,...residuals].every(cvFinite))return;
  return {slope,intercept,r2:yy>Number.EPSILON?Math.max(0,Math.min(1,1-sse/yy)):null,n,min:Math.min(...x),max:Math.max(...x),residuals};
}
const R=8.31446261815324,F=96485.33212;
/** Natural-log form; scan rate is explicitly V/s and delta is V. */
export function cvKs(alpha:number,rateV:number,delta:number,n:number,temperatureK:number):number{
  if(!(alpha>0&&alpha<1&&rateV>0&&delta>0&&n>0&&temperatureK>0)||![alpha,rateV,delta,n,temperatureK].every(cvFinite))return NaN;
  const log=alpha*Math.log(1-alpha)+(1-alpha)*Math.log(alpha)+Math.log(n*F*rateV/(R*temperatureK))-alpha*(1-alpha)*n*F*delta/(R*temperatureK);
  const result=Math.exp(log);return result>0&&cvFinite(result)?result:NaN;
}
export function analyzeCv(groups:CvGroup[],settings:CvSettings):CvAnalysis{
  const traces=prepareCvTraces(groups,settings),temperature=cvNumber(settings.temperature)+273.15,n=cvNumber(settings.n),threshold=cvNumber(settings.threshold);
  const settingError=!(temperature>0&&cvFinite(temperature))?'请输入有效实验温度。':!(n>0&&cvFinite(n))?'电子数 n 需要大于 0。':!(threshold>0&&cvFinite(threshold))?'峰间距阈值系数需要大于 0。':undefined;
  const results=groups.map((group):CvGroupResult=>{
    const rows=traces.filter(t=>t.groupId===group.id).map((trace):CvRow=>{
      const rate=cvNumber(trace.series.rate),epa=trace.anodic?.e,epc=trace.cathodic?.e,delta=epa!==undefined&&epc!==undefined?epa-epc:undefined;
      const error=trace.error??(!(rate>0&&cvFinite(rate))?'请填写大于 0 的扫速（mV/s）。':undefined);
      const qualified=!error&&delta!==undefined&&delta>threshold/n&&trace.anodic?.quality==='peak'&&trace.cathodic?.quality==='peak';
      const warnings=[...trace.warnings];
      if(delta!==undefined&&delta<=threshold/n)warnings.push(`峰间距 ${delta.toPrecision(5)} V；当前近似筛选阈值为 ${(threshold/n).toPrecision(5)} V。`);
      if(trace.anodic?.quality==='shoulder'||trace.cathodic?.quality==='shoulder')warnings.push('含手动肩部估计点。');
      return {trace,rate,lnRate:rate>0?Math.log(rate):NaN,epa,epc,delta,halfDelta:delta!==undefined?delta/2:undefined,included:trace.series.included,qualified,usedForKs:false,status:error??(!trace.series.included?'已排除':qualified?'峰间距筛选通过':'条件试算候选'),error,warnings};
    });
    const result:CvGroupResult={group,rows,ksCount:0,warnings:[]},selected=rows.filter(row=>row.included);
    if(cvFinite(threshold)&&Math.abs(threshold-.2)>1e-12)result.warnings.push(`当前使用自定义阈值系数 ${threshold} V，实际筛选 ΔEp > ${Number((threshold/n).toPrecision(6))} V（系数 / n）；参考系数为 0.2 V。`);
    if(settingError){result.error=settingError;return result;}
    if(selected.some(row=>row.error)){result.error='纳入的文件有待确认峰位或扫速，请展开文件核对。';return result;}
    if(selected.length<3){result.error='请选择至少 3 个不同扫速的有效峰对。';return result;}
    if(new Set(selected.map(row=>row.rate)).size!==selected.length){result.error='当前样品含重复扫速，请明确勾选其中一份，或按独立测量建立样品。';return result;}
    result.fit=fitCv(selected.map(row=>row.lnRate),selected.map(row=>row.halfDelta!));
    const used=settings.calculationMode==='trial'?selected:selected.filter(row=>row.qualified);
    if(used.length<3){result.error='Ks 近似筛选至少需要 3 个不同扫速的峰对；可调整取点或查看条件试算。';return result;}
    result.anodicFit=fitCv(used.map(row=>row.lnRate),used.map(row=>row.epa!));result.cathodicFit=fitCv(used.map(row=>row.lnRate),used.map(row=>row.epc!));
    if(!result.anodicFit||!result.cathodicFit){result.error='分支拟合数值无效，请核对扫速和峰位。';return result;}
    const ma=result.anodicFit.slope,mc=result.cathodicFit.slope;
    if(!(ma>0&&mc<0)){result.error='分支方向待核对：氧化峰需随 ln(v) 正移，还原峰需负移。';return result;}
    const alpha=ma/(ma-mc);result.alpha=alpha;
    result.slopeN=R*temperature/F*(1/ma+1/-mc);
    for(const row of used){const ks=cvKs(alpha,row.rate/1000,row.delta!,n,temperature);if(!cvFinite(ks)){result.error='Ks 计算超出数值范围，请核对条件。';return result;}row.ks=ks;row.usedForKs=true;row.status=settings.calculationMode==='trial'?'条件试算':'峰间距筛选条件估算';}
    const values=used.map(row=>row.ks!);result.ksCount=values.length;result.ksGeomean=Math.exp(values.reduce((sum,v)=>sum+Math.log(v)/values.length,0));result.ksMin=Math.min(...values);result.ksMax=Math.max(...values);
    if(settings.calculationMode==='trial')result.warnings.push('条件试算包含当前勾选的峰对，请结合取峰和近似条件查看。');
    if(Math.abs(result.slopeN/n-1)>.25)result.warnings.push(`分支斜率对应的 n≈${result.slopeN.toPrecision(4)}，输入 n=${n}；请核对模型及峰归属。`);
    if(result.ksMax/result.ksMin>2)result.warnings.push('逐扫速 Ks 的最大值超过最小值的 2 倍，请查看取峰敏感性。');
    if((result.anodicFit.r2??0)<.95||(result.cathodicFit.r2??0)<.95)result.warnings.push('分支拟合线性需进一步核对。');
    return result;
  });
  return {groups:results,traces,error:settingError};
}
