import type { CurrentUnit, Point } from './lsv-math';
import { scanSegments } from './scan-branches';
import { tQuantile } from './tafel-auto';

export type PhSeries = {
  id:string; name:string; source:string; ph:string; phMeasured:boolean; area:string;
  unit:CurrentUnit|''; included:boolean; compensation:'raw'|'corrected'|'unknown'; rs:string;
  scan:'global'|'up'|'down'; cycle:string; points:Point[]; metadata:Record<string,unknown>;
};
export type PhGroup = {id:string; name:string; color:string; visible:boolean; series:PhSeries[]};
export type PhSettings = {
  potential:string; mode:'raw'|'rhe'; inputScale:'reference'|'rhe'; scan:'up'|'down'; cycle:string;
  outputUnit:'mA/cm2'|'uA/cm2'; absolute:boolean; applyIr:boolean; fraction:string;
  reference:string; filling:string; offset:string; temperature:string; referenceConfirmed:boolean;
  fitGrouping?:'auto'|'groups'|'combined';
};
export const DEFAULT_PH_SETTINGS:PhSettings = {
  potential:'',mode:'raw',inputScale:'reference',scan:'up',cycle:'1',outputUnit:'uA/cm2',
  absolute:false,applyIr:false,fraction:'100',reference:'',filling:'',offset:'',temperature:'25',referenceConfirmed:false,fitGrouping:'groups',
};
export const PH_LIMIT = 120;
export const PH_POINT_LIMIT = 500_000;
export const phNumber = (text:string):number => text.trim()?Number(text):NaN;
export const phFinite = (value:unknown):value is number => typeof value==='number'&&Number.isFinite(value);
export type PhTracePoint = {x:number; j:number; rawE:number; rawCurrent:number; index:number};
export type PhTrace = {series:PhSeries; groupId:string; groupName:string; color:string; visible:boolean;
  ph:number; points:(PhTracePoint|null)[]; start:number; end:number; cycles:number; selectedCycle:number;
  min?:number; max?:number; error?:string; warnings:string[]};
export type PhPoint = {trace:PhTrace; ph:number; j?:number; logJ?:number; rawE?:number; rawCurrent?:number;
  indices?:number[]; interpolated?:boolean; included:boolean; error?:string; warning?:string};
export type PhFit = {slope:number; intercept:number; r2:number|null; n:number; slopeSE:number;
  low:number; high:number; min:number; max:number; residuals:number[]};
export type PhGroupResult = {group:PhGroup; points:PhPoint[]; fit?:PhFit; allFit?:PhFit; error?:string; combined?:boolean};
export type PhAnalysis = {groups:PhGroupResult[]; potential:number; common?:[number,number]; error?:string};

export function phFitEquation(fit:PhFit):string {
  const value=(n:number)=>Number(n.toPrecision(6)).toString();
  return `y = ${value(fit.slope)} × pH ${fit.intercept<0?'−':'+'} ${value(Math.abs(fit.intercept))}`;
}

export function phAxisLabel(settings:PhSettings):string {
  return settings.mode==='rhe'?'Potential vs. RHE (V)':settings.inputScale==='rhe'?'Recorded potential vs. RHE (V)':settings.applyIr?'iR-corrected recorded potential (V)':'Recorded potential (V)';
}
export function phLogLabel(settings:PhSettings):string {
  return `log₁₀(${settings.absolute?'|j|':'j'} / ${settings.outputUnit==='uA/cm2'?'μA':'mA'} cm⁻²)`;
}
export function phDefinition(settings:PhSettings):string {
  return `${settings.mode==='rhe'?'固定 RHE 电位下的 pH 依赖斜率 ρRHE':'固定原始电位下的表观 pH 依赖斜率 k'}；${settings.absolute?'取绝对值复现':'仅正电流'}；${settings.applyIr?'按各文件 Rs 校正 iR':'未额外扣除 iR'}。`;
}
export function phCurrent(raw:number,unit:CurrentUnit|'',area:number):{j:number; amps?:number} {
  if(!unit)throw Error('请确认原始电流单位。');
  const multiplier=unit.startsWith('mA')?1e-3:unit.startsWith('uA')?1e-6:unit==='nA'?1e-9:1;
  const value=raw*multiplier,density=unit.includes('/cm2');
  if(!density&&!(area>0))throw Error('总电流换算需要大于 0 的有效面积（cm²）。');
  const j=density?value:value/area,amps=density?(area>0?value*area:undefined):value;
  if(!Number.isFinite(j)||amps!==undefined&&!Number.isFinite(amps))throw Error('单位换算结果超出数值范围。');
  return {j,amps}; // j in A/cm², amps in A: density data are never divided by area twice.
}

/** Choose the acquisition branch before applying iR. Missing source rows remain gaps. */
export function preparePhTraces(groups:PhGroup[],settings:PhSettings):PhTrace[] {
  return groups.flatMap(group=>group.series.map(series=>{
    const trace:PhTrace={series,groupId:group.id,groupName:group.name,color:group.color,visible:group.visible,
      ph:phNumber(series.ph),points:[],start:0,end:0,cycles:0,selectedCycle:0,warnings:[]};
    try {
      if(!phFinite(trace.ph)||trace.ph<0||trace.ph>16)throw Error('请填写 0–16 范围内的 pH；文件名识别值需核对。');
      const area=phNumber(series.area),rs=phNumber(series.rs),fraction=phNumber(settings.fraction)/100;
      phCurrent(0,series.unit,area);
      if(series.area.trim()&&!(area>0))throw Error('有效面积必须大于 0。');
      if(settings.applyIr){
        if(series.compensation!=='raw')throw Error(series.compensation==='corrected'?'原数据已补偿，请关闭额外 iR，避免重复扣除。':'原数据补偿状态未知，请先确认是否未补偿。');
        if(!(rs>=0)||!phFinite(rs)||!phFinite(fraction)||fraction<0||fraction>1)throw Error('请填写每个文件的 Rs ≥ 0，补偿比例为 0–100%。');
        if(series.unit.includes('/cm2')&&!(area>0))throw Error('电流密度进行 iR 校正仍需面积，以还原总电流。');
      }else if(series.compensation==='unknown')trace.warnings.push('原数据补偿状态待确认');
      let shift=0;
      if(settings.mode==='rhe'){
        if(!settings.referenceConfirmed)throw Error('请先确认输入电位标度／参比校准信息，再启用固定 RHE 模式。');
        if(settings.inputScale==='reference'){
          const offset=phNumber(settings.offset),temperature=phNumber(settings.temperature);
          if(!settings.reference.trim()||!settings.filling.trim()||!phFinite(offset)||!phFinite(temperature)||temperature<=-273.15||temperature>100)throw Error('RHE 换算需要参比、填充液、该温度下相对 SHE 的电位及温度。');
          shift=offset+2.302585092994046*8.31446261815324*(temperature+273.15)/96485.33212*trace.ph;
        }
      }
      if(!series.phMeasured)trace.warnings.push('pH 为标称／待核对值');
      // Retain missing-current rows with their measured E. Fill only missing E for
      // branch identification; their transformed coordinates still remain null.
      const original=series.points;let first=original.find(p=>phFinite(p.e))?.e;
      if(first===undefined)throw Error('没有有效电位。');
      const potentials=original.map(p=>{if(phFinite(p.e))first=p.e;return {e:first!,current:0};});
      const direction=series.scan==='global'?settings.scan:series.scan;
      const segments=scanSegments(potentials).filter(segment=>segment.direction===direction);
      trace.cycles=segments.length;
      const requested=series.cycle.trim()||settings.cycle;
      const cycle=requested==='last'?segments.length:phNumber(requested);
      if(!Number.isInteger(cycle)||cycle<1||cycle>segments.length)throw Error(`没有所选${direction==='up'?'正向':'反向'}第 ${requested==='last'?'末':requested} 段（找到 ${segments.length} 段）。`);
      const segment=segments[cycle-1];trace.start=segment.start;trace.end=segment.end;trace.selectedCycle=cycle;
      trace.points=original.slice(segment.start,segment.end+1).map((p,n)=>{
        if(!phFinite(p.e)||!phFinite(p.current))return null;
        const {j,amps}=phCurrent(p.current,series.unit,area);
        const x=p.e+shift-(settings.applyIr?amps!*rs*fraction:0);
        if(!phFinite(x))return null;
        return {x,j:j*(settings.outputUnit==='uA/cm2'?1e6:1e3),rawE:p.e,rawCurrent:p.current,index:segment.start+n};
      });
      let min=Infinity,max=-Infinity;for(const p of trace.points)if(p){min=Math.min(min,p.x);max=Math.max(max,p.x);}
      if(!(min<max)||!phFinite(min)||!phFinite(max))throw Error('所选分支没有有效的电位范围。');
      trace.min=min;trace.max=max;
      if(settings.mode==='raw'&&settings.inputScale==='reference')trace.warnings.push('未换算 RHE');
    }catch(error){trace.error=(error as Error).message;trace.points=[];}
    return trace;
  }));
}

export function extractPhPoint(trace:PhTrace,potential:number,absolute=false):PhPoint {
  const result:PhPoint={trace,ph:trace.ph,included:trace.series.included};
  if(trace.error)return {...result,error:trace.error};
  if(!phFinite(potential))return {...result,error:'请输入共同取点电位。'};
  const tolerance=Math.max(1,Math.abs(potential))*1e-10;
  const exact=trace.points.filter((p):p is PhTracePoint=>!!p&&Math.abs(p.x-potential)<=tolerance);
  const crossings:{a:PhTracePoint;b:PhTracePoint}[]=[];
  for(let i=1;i<trace.points.length;i++){
    const a=trace.points[i-1],b=trace.points[i];
    if(a&&b&&Math.abs(a.x-potential)>tolerance&&Math.abs(b.x-potential)>tolerance&&(a.x-potential)*(b.x-potential)<0)crossings.push({a,b});
  }
  let point:PhTracePoint|undefined,indices:number[]|undefined;
  if(exact.length>1||exact.length+crossings.length>1)return {...result,error:'所选电位有多个交点，分支可能回折；请更换电位或检查数据。'};
  if(exact.length){point=exact[0];indices=[point.index];}
  else {
    if(!crossings.length)return {...result,error:'电位超出所选分支或位于缺口；未外推。'};
    if(crossings.length!==1)return {...result,error:'校正后的分支在该电位多次相交；不自动挑选交点。'};
    const {a,b}=crossings[0],t=(potential-a.x)/(b.x-a.x);
    point={x:potential,j:a.j+t*(b.j-a.j),rawE:a.rawE+t*(b.rawE-a.rawE),rawCurrent:a.rawCurrent+t*(b.rawCurrent-a.rawCurrent),index:a.index};
    indices=[a.index,b.index];result.interpolated=true;
  }
  Object.assign(result,{j:point.j,rawE:point.rawE,rawCurrent:point.rawCurrent,indices});
  if(!phFinite(point.j)||point.j===0)return {...result,error:'零电流或无效电流不能取对数。'};
  if(point.j<0&&!absolute)return {...result,error:'负电流：未取绝对值，不纳入 OER 正电流拟合。'};
  const logJ=Math.log10(absolute?Math.abs(point.j):point.j);
  if(!phFinite(logJ))return {...result,error:'对数结果无效。'};
  return {...result,logJ,warning:point.j<0?'负电流取绝对值复现；不作为 OER 正向电流证据':undefined};
}

export function fitPh(points:PhPoint[]):{fit?:PhFit;error?:string} {
  const selected=points.filter(p=>p.included);
  if(selected.some(p=>p.error))return {error:'纳入的文件有无效取值，请展开文件查看；没有自动删除无效点。'};
  if(selected.length<3)return {error:'至少需要 3 个不同 pH 的有效点才能拟合。'};
  if(new Set(selected.map(p=>p.ph)).size!==selected.length)return {error:'同一组存在重复 pH；第一版请将重复测量分组，或明确只纳入一条。'};
  const n=selected.length,mx=selected.reduce((s,p)=>s+p.ph/n,0),my=selected.reduce((s,p)=>s+p.logJ!/n,0);
  let xx=0,xy=0,yy=0;for(const p of selected){const x=p.ph-mx,y=p.logJ!-my;xx+=x*x;xy+=x*y;yy+=y*y;}
  if(!(xx>0))return {error:'pH 范围不足。'};
  const slope=xy/xx,intercept=my-slope*mx,residuals=selected.map(p=>p.logJ!-(slope*p.ph+intercept));
  const sse=residuals.reduce((s,r)=>s+r*r,0),slopeSE=Math.sqrt(sse/(n-2)/xx),margin=tQuantile(.95,n-2)*slopeSE;
  const values=[slope,intercept,slopeSE,margin];if(!values.every(phFinite))return {error:'数值范围无法可靠拟合。'};
  return {fit:{slope,intercept,r2:yy>Number.EPSILON?Math.max(0,Math.min(1,1-sse/yy)):null,n,slopeSE,low:slope-margin,high:slope+margin,min:Math.min(...selected.map(p=>p.ph)),max:Math.max(...selected.map(p=>p.ph)),residuals}};
}
export function analyzePh(groups:PhGroup[],traces:PhTrace[],settings:PhSettings):PhAnalysis {
  const potential=phNumber(settings.potential),active=traces.filter(t=>t.series.included),valid=active.filter(t=>!t.error);
  let common:PhAnalysis['common'];
  if(active.length&&valid.length===active.length){const lo=Math.max(...valid.map(t=>t.min!)),hi=Math.min(...valid.map(t=>t.max!));if(lo<=hi)common=[lo,hi];}
  return {potential,common,error:!phFinite(potential)?'请先设置共同取点电位。':undefined,groups:groups.map(group=>{
    const points=traces.filter(t=>t.groupId===group.id).map(trace=>extractPhPoint(trace,potential,settings.absolute));
    return {group,points,...fitPh(points),allFit:fitPh(points.map(p=>({...p,included:true}))).fit};
  })};
}
