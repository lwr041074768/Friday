import {phXlsx} from './ph-export';
import {analyzeCv,cvCurrent,cvNumber,cvFinite,cvFitEquation,type CvGroup,type CvSettings,type CvAnalysis} from './cv-data';

export type CvCell=number|string|null;
export type CvTable={name:string;label:string;headers:string[];rows:CvCell[][]};
const clean=(value:unknown):CvCell=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'?value:null;
export function cvTables(groups:CvGroup[],settings:CvSettings,analysis:CvAnalysis=analyzeCv(groups,settings)):CvTable[]{
  const points:CvTable={name:'FitPoints',label:'峰位与逐扫速Ks',headers:['样品','扫速 / mV s-1','ln(v / mV s-1)','Epa / V','Epc / V','ΔEp / V','(Epa−Epc)/2 / V','纳入拟合','峰间距筛选通过','纳入Ks','Ks条件估算 / s-1','状态','源文件','循环','氧化峰原始行（从1计）','还原峰原始行（从1计）','氧化峰取法','还原峰取法','氧化峰类型','还原峰类型','有效面积 / cm2','原始电流单位','提示','样品可见'],rows:[]};
  const fits:CvTable={name:'Fits',label:'拟合参数与Ks汇总',headers:['样品','主图斜率 / V','主图截距 / V','主图R2','主图点数','氧化分支斜率 / V','氧化分支截距 / V','氧化分支R2','还原分支斜率 / V','还原分支截距 / V','还原分支R2','α','Ks几何平均 / s-1','Ks最小值 / s-1','Ks最大值 / s-1','Ks扫速数','分支斜率对应n（诊断）','计算模式','温度 / °C','输入电子数n','实际峰间距阈值 / V','拟合方程','状态与提示'],rows:[]};
  const fitted:CvTable={name:'FittedValues',label:'主图散点与拟合线',headers:[],rows:[]};
  const metadata:CvTable={name:'Metadata',label:'条件与文件来源',headers:['记录','样品','源文件','值'],rows:[
    ['settings','','',JSON.stringify(settings)],
    ['axis','','','X=ln(v/(1 mV/s)); Y=(Epa−Epc)/2 in V. Ks is calculated separately from the peak separation equation.'],
    ['formula','','','ln(ks)=alpha*ln(1-alpha)+(1-alpha)*ln(alpha)+ln(n*F*v/(R*T))-alpha*(1-alpha)*n*F*DeltaEp/(R*T); v in V/s; T in K.'],
    ['alpha','','','ma=dEpa/dln(v)>0; mc=dEpc/dln(v)<0; alpha=ma/(ma-mc). Qualified mode re-fits both branches using only selected qualified peak pairs.'],
    ['summary','','','Ks summary is the geometric mean of the used scan-rate estimates. Min/max describe variation between scan rates.'],
    ['reference','','','Laviron (1979), DOI:10.1016/S0022-0728(79)80075-3'],
    ['reference','','','https://www.sciencedirect.com/science/article/abs/pii/S0928493113004268 (peak-separation form and DeltaEp>200/n mV)'],
    ['reference','','','https://pubs.rsc.org/en/content/articlehtml/2023/ra/d3ra01136d (natural-log peak-separation equation)'],
    ['data','','','Every imported file, original source row, signed current and missing row is retained. Current density is in mA/cm2. Raw recorded potentials are used without an extra reference conversion or iR correction.'],
  ]};
  for(const result of analysis.groups){
    for(const row of result.rows){const {trace}=row;points.rows.push([result.group.name,clean(row.rate),clean(row.lnRate),clean(row.epa),clean(row.epc),clean(row.delta),clean(row.halfDelta),row.included?'yes':'no',row.qualified?'yes':'no',row.usedForKs?'yes':'no',clean(row.ks),row.status,trace.series.source,trace.selectedCycle||null,trace.anodic?trace.anodic.index+1:null,trace.cathodic?trace.cathodic.index+1:null,trace.anodic?.manual?'manual':'automatic',trace.cathodic?.manual?'manual':'automatic',trace.anodic?.quality??'',trace.cathodic?.quality??'',clean(cvNumber(trace.series.area)),trace.series.unit,row.warnings.join(' | '),result.group.visible?'yes':'no']);}
    fits.rows.push([result.group.name,result.fit?.slope??null,result.fit?.intercept??null,result.fit?.r2??null,result.fit?.n??null,result.anodicFit?.slope??null,result.anodicFit?.intercept??null,result.anodicFit?.r2??null,result.cathodicFit?.slope??null,result.cathodicFit?.intercept??null,result.cathodicFit?.r2??null,result.alpha??null,result.ksGeomean??null,result.ksMin??null,result.ksMax??null,result.ksCount,result.slopeN??null,settings.calculationMode,clean(cvNumber(settings.temperature)),clean(cvNumber(settings.n)),clean(cvNumber(settings.threshold)/cvNumber(settings.n)),result.fit?cvFitEquation(result.fit):'',[result.error,...result.warnings].filter(Boolean).join(' | ')]);
    const start=fitted.headers.length;
    fitted.headers.push(`${result.group.name} X ln(v / mV s-1)`,`${result.group.name} Y (Epa-Epc)/2 / V`,`${result.group.name} Y fit / V`,`${result.group.name} included`,`${result.group.name} source`);
    result.rows.forEach((row,index)=>{
      if(!fitted.rows[index])fitted.rows[index]=[];
      const fit=result.fit,predicted=fit&&row.lnRate>=fit.min-1e-10&&row.lnRate<=fit.max+1e-10?fit.slope*row.lnRate+fit.intercept:null;
      while(fitted.rows[index].length<start)fitted.rows[index].push(null);
      fitted.rows[index].push(clean(row.lnRate),clean(row.halfDelta),clean(predicted),row.included?'yes':'no',row.trace.series.source);
    });
    metadata.rows.push(['group',result.group.name,'',JSON.stringify({id:result.group.id,color:result.group.color,visible:result.group.visible,sourceIds:result.group.series.map(s=>s.id)})]);
  }
  for(const row of fitted.rows)while(row.length<fitted.headers.length)row.push(null);
  const raw:CvTable[]=analysis.traces.map((trace,index)=>{
    const {points:original,...attributes}=trace.series;
    metadata.rows.push(['series',trace.groupName,trace.series.source,JSON.stringify({...attributes,cycles:trace.cycles,selectedCycle:trace.selectedCycle,anodic:trace.anodic,cathodic:trace.cathodic,error:trace.error,warnings:trace.warnings})]);
    const selected=new Map(trace.points.filter((p)=>p!==null).map(p=>[p.index,p]));
    const rows=original.map((p,i):CvCell[]=>{let j:number|null=null;try{if(cvFinite(p.current))j=cvCurrent(p.current,trace.series.unit,cvNumber(trace.series.area));}catch{/* Conditions remain in Metadata and the analysis status. */}return [i+1,clean(p.e),clean(p.current),clean(j),clean(selected.get(i)?.x),clean(selected.get(i)?.j),selected.get(i)?.direction??''];});
    return {name:`Raw${index+1}`,label:`${trace.groupName} · ${trace.series.rate||'?'} mV/s · ${trace.series.name}`,headers:['原始行（从1计）','原始电位 / V',`原始电流 / ${trace.series.unit||'待确认'}`,'原始电流密度 / mA cm-2','所选圈原始电位 / V','所选圈电流密度 / mA cm-2','所选分支'],rows};
  });
  // Ordered chunks retain long acquisition headers within workbook cell limits.
  metadata.rows=metadata.rows.flatMap(row=>{const chars=Array.from(String(row[3]??'')),parts=Math.ceil(chars.length/16000);return parts<=1?[row]:Array.from({length:parts},(_,i)=>[`${row[0]} part ${i+1}/${parts}`,row[1],row[2],chars.slice(i*16000,(i+1)*16000).join('')]);});
  return [points,fits,fitted,metadata,...raw];
}
function csvCell(value:CvCell,delimiter:string):string{if(value===null)return '';if(typeof value==='number')return Number.isFinite(value)?String(value):'';const safe=/^[\s]*[=+\-@]/.test(value)?`'${value}`:value;return safe.includes(delimiter)||/["\n\r]/.test(safe)?`"${safe.replaceAll('"','""')}"`:safe;}
export function cvCsv(table:CvTable,delimiter=","):string{return '\uFEFF'+[table.headers,...table.rows].map(row=>row.map(value=>csvCell(value,delimiter)).join(delimiter)).join('\r\n')+'\r\n';}
export function cvRawCsv(groups:CvGroup[],settings:CvSettings):string{
  const tables=cvTables(groups,settings),rows:CvCell[][]=[['record','sample_or_sheet','source_or_label','value_or_row','raw_E_V','raw_current','raw_j_mA_cm2','selected_E_V','selected_j_mA_cm2','direction']];
  for(const row of tables.find(t=>t.name==='Metadata')!.rows)rows.push(['metadata',row[1],row[2],String(row[0])+': '+String(row[3]),null,null,null,null,null,null]);
  for(const table of tables.filter(t=>t.name.startsWith('Raw'))){rows.push(['columns',table.name,table.label,...table.headers]);for(const row of table.rows)rows.push(['raw',table.name,table.label,...row]);}
  return '\uFEFF'+rows.map(row=>row.map(value=>csvCell(value,',')).join(',')).join('\r\n')+'\r\n';
}
export function cvXlsx(tables:CvTable[]):Uint8Array{return phXlsx(tables);}
