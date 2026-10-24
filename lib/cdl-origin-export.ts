import { buildCdlOriginTables, calculateCdl, selectedCdlCvCurves, type CdlResult, type CdlSample, type CdlSettings, type CdlOriginTable } from './cdl-math';

export type CdlOriginColumn = { label:string; unit:string; kind:'number'|'text'; designation:'X'|'Y'|'none'; values:(number|string|null)[] };
export type CdlOriginSheet = { name:string; label:string; columns:CdlOriginColumn[] };
export type CdlOriginPlot = { sheet:string; x:number; y:number; kind:'line'|'scatter'; color:string };
export type CdlOriginPacket = { schema:'cdl-origin/v1'; requestId:string; createdAt:string; label:string; settings:CdlSettings; sheets:CdlOriginSheet[]; cvPlots:CdlOriginPlot[]; fitPlots:CdlOriginPlot[]; currentUnit:'mA'|'mA/cm2'|'mixed'; electrodeCount:number };
const finite = (value:unknown):value is number => typeof value==='number' && Number.isFinite(value);
const clean = (value:unknown):number|string|null => finite(value)?value:typeof value==='string'?value:null;
const CV_COLORS=['#2374d5','#e56a3d','#10a58e','#8c62c5','#c9a121','#d95383','#4384a3','#a57a54','#6b7891','#53a338'];

/** Uses the same selected loops, signed currents and independent-electrode fits as the UI. */
export function prepareCdlOriginExport(samples:CdlSample[],settings:CdlSettings,calculated:CdlResult|undefined,label:string):CdlOriginPacket {
  if (!samples.length) throw Error('请先导入本组 Cdl 数据。');
  if (samples.length>60) throw Error('每次最多导出 60 片电极，请分组导出。');
  const result=calculateCdl(samples,settings);
  if (result.error) throw Error(result.error);
  if (calculated && JSON.stringify(calculated)!==JSON.stringify(result)) throw Error('计算设置刚刚发生变化，请等待页面更新后重试。');
  const tables=buildCdlOriginTables(samples,settings,result),sheets:CdlOriginSheet[]=[],cvPlots:CdlOriginPlot[]=[],fitPlots:CdlOriginPlot[]=[];
  const table=(name:string,source:CdlOriginTable,numericColumns?:Set<number>)=>{
    const columns=source.columns.map((label,index):CdlOriginColumn=>({label,unit:'',kind:numericColumns?.has(index)||source.rows.some(row=>finite(row[index]))?'number':'text',designation:'none',values:source.rows.map(row=>clean(row[index]))}));
    sheets.push({name,label:source.name,columns});
    return columns;
  };
  const points=table('FitPoints',tables.replicatePoints,new Set(tables.replicatePoints.columns.map((_,i)=>i)));
  points[0].designation='X';points[0].unit='mV/s';
  table('MeanPoints',tables.meanPoints,new Set(tables.meanPoints.columns.map((_,i)=>i)));
  table('GroupStatistics',tables.summary);
  table('ElectrodeFits',tables.electrodeFits,new Set([3,5,6,7,8,9]));
  const electrodeSamples=samples.filter(sample=>sample.role!=='meanCurve');
  const references=samples.filter(sample=>sample.role==='meanCurve');
  let referencePoints:CdlOriginColumn[]=[];
  if(references.length){
    const rates=[...new Set(references.flatMap(sample=>result.samples.find(item=>item.id===sample.id)?.extracted.filter(point=>point.included).map(point=>point.rateMV)??[]))].sort((a,b)=>a-b);
    referencePoints=table('ReferenceFitPoints',{name:'已有均值参考曲线取点（不计入独立电极 n）',columns:['Scan rate',...references.map(sample=>sample.name)],rows:rates.map(rate=>[rate,...references.map(sample=>{const matches=result.samples.find(item=>item.id===sample.id)?.extracted.filter(point=>point.included&&point.rateMV===rate)??[];return matches.length===1?matches[0].y:undefined;})])},new Set(Array.from({length:references.length+1},(_,i)=>i)));
    referencePoints[0].designation='X';referencePoints[0].unit='mV/s';
    table('ReferenceFits',{name:'已有均值参考拟合（不计入独立电极统计）',columns:['Reference','Role','Cdl','Cdl_unit','Slope_per_V_s','Intercept','R_squared','n_rates'],rows:references.map(sample=>{const fit=result.samples.find(item=>item.id===sample.id)?.fit;return[sample.name,'meanCurve',fit?.cdl,fit?.cdlUnit,fit?.slope,fit?.intercept,fit?.r2,fit?.n];})},new Set([2,4,5,6,7]));
  }
  const fitLines:CdlOriginColumn[]=[];
  for(const [index,sample] of samples.entries()){
    const electrode=result.samples.find(item=>item.id===sample.id),fit=electrode?.fit;
    const reference=sample.role==='meanCurve',pointColumns=reference?referencePoints:points,pointIndex=(reference?references:electrodeSamples).findIndex(item=>item.id===sample.id)+1;
    const pointSheet=reference?'ReferenceFitPoints':'FitPoints';
    pointColumns[pointIndex].label=`${sample.name} · ${reference?'均值参考':'数据点'}`;pointColumns[pointIndex].designation='Y';pointColumns[pointIndex].unit=electrode?.outputUnit??'';
    const fitColor=CV_COLORS[index%CV_COLORS.length];
    if(electrode?.extracted.some(point=>point.included))fitPlots.push({sheet:pointSheet,x:1,y:pointIndex+1,kind:'scatter',color:fitColor});
    if(!fit)continue;
    const rates=electrode.extracted.filter(point=>point.included).map(point=>point.rateMV),x=[Math.min(...rates),Math.max(...rates)];
    const column=fitLines.length+1;
    fitLines.push({label:`${sample.name} scan rate`,unit:'mV/s',kind:'number',designation:'X',values:x},{label:`${sample.name} · ${reference?'均值参考拟合':'拟合线'}`,unit:electrode.outputUnit,kind:'number',designation:'Y',values:x.map(rate=>fit.slope*rate/1000+fit.intercept)});
    fitPlots.push({sheet:'FitLines',x:column,y:column+1,kind:'line',color:fitColor});
  }
  if(fitLines.length)sheets.push({name:'FitLines',label:'逐电极拟合直线（使用软件同一斜率与截距）',columns:fitLines});
  const curves=selectedCdlCvCurves(samples,settings);
  for(const [sampleIndex,sample] of samples.entries()){
    const chosen=curves.filter(curve=>curve.sampleId===sample.id && curve.included && !curve.error && curve.cycle!==undefined).sort((a,b)=>a.rateMV-b.rateMV);
    if(!chosen.length)continue;
    const name=`CV${sampleIndex+1}`,length=Math.max(...chosen.map(curve=>curve.plotted.length));
    const source:CdlOriginTable={name:`${sample.name} · 当前所选完整 CV 圈`,columns:chosen.flatMap(curve=>[`${curve.rateMV} mV/s E (cycle ${curve.cycle})`,`${sample.name} · ${curve.rateMV} mV/s · cycle ${curve.cycle}`]),rows:Array.from({length},(_,index)=>chosen.flatMap(curve=>[curve.plotted[index]?.x,curve.plotted[index]?.y]))};
    const columns=table(name,source,new Set(source.columns.map((_,i)=>i)));
    chosen.forEach((curve,index)=>{
      columns[index*2].designation='X';columns[index*2].unit='V';columns[index*2+1].designation='Y';columns[index*2+1].unit=curve.outputUnit;
      const rateIndex=[...new Set(curves.map(item=>item.rateMV))].sort((a,b)=>a-b).indexOf(curve.rateMV);
      cvPlots.push({sheet:name,x:index*2+1,y:index*2+2,kind:'line',color:CV_COLORS[rateIndex%CV_COLORS.length]});
    });
  }
  // Keep source text out of LabTalk commands. Every field is literal worksheet data.
  const metadata:CdlOriginTable={name:'计算设置与来源',columns:['Record','Electrode','Series','Value'],rows:[
    ['group',undefined,undefined,label],['settings',undefined,undefined,JSON.stringify(settings)],
    ['definition',undefined,undefined,settings.halfDelta?'Y=(Ia-Ic)/2; slope is per V/s; Cdl=slope':'Y=Ia-Ic; slope is per V/s; Cdl=slope/2'],
    ['statistics',undefined,undefined,'Each electrode is fitted independently; group SD uses n-1; n=1 has no sample SD; meanCurve is excluded from electrode n.'],
    ['export_scope',undefined,undefined,'Complete selected CV cycles and included fit points; gaps and signs retained. All raw cycles and excluded source rows remain available through full CSV export.'],
  ]};
  for(const sample of samples){
    const electrode=result.samples.find(item=>item.id===sample.id);
    metadata.rows.push(['electrode',sample.name,undefined,JSON.stringify({...sample,series:undefined,summary:undefined,settingsCurrentUnit:settings.currentUnit,outputUnit:electrode?.outputUnit,errors:electrode?.errors,warnings:electrode?.warnings,fit:electrode?.fit,cycles:electrode?.cycles})]);
    for(const series of sample.series){const {points:raw,...attributes}=series;const curve=curves.find(item=>item.sampleId===sample.id&&item.seriesId===series.id);metadata.rows.push(['series',sample.name,series.id,JSON.stringify({...attributes,rawPointCount:raw.length,selectedPointCount:curve?.plotted.length,selectedCycle:curve?.cycle,originalStart:curve?.originalStart,originalEnd:curve?.originalEnd})]);}
    for(const point of electrode?.extracted??[])metadata.rows.push(['extracted',sample.name,point.seriesId,JSON.stringify(point)]);
    for(const point of sample.summary??[])metadata.rows.push(['raw_summary',sample.name,undefined,JSON.stringify(point)]);
  }
  // Origin's COM text cells truncate long strings on supported installations.
  // Ordered chunks preserve the complete metadata instead of silently losing it.
  metadata.rows=metadata.rows.flatMap(row=>{
    const characters=Array.from(String(row[3]??''));
    if(characters.length<=120)return [row];
    const count=Math.ceil(characters.length/120);
    return Array.from({length:count},(_,index)=>[`${row[0]} part ${index+1}/${count}`,row[1],row[2],characters.slice(index*120,(index+1)*120).join('')]);
  });
  table('Metadata',metadata);
  const units=[...new Set(result.samples.map(item=>item.outputUnit))];
  if(units.length>1)throw Error('本组电极的电流单位不同，请先统一面积归一化设置后导出至 Origin。');
  const packet:CdlOriginPacket={schema:'cdl-origin/v1',requestId:crypto.randomUUID(),createdAt:new Date().toISOString(),label,settings:{...settings},sheets,cvPlots,fitPlots,currentUnit:units.length===1?units[0]:'mixed',electrodeCount:electrodeSamples.length};
  if(sheets.reduce((count,sheet)=>count+sheet.columns.reduce((n,column)=>n+column.values.length,0),0)>2_000_000)throw Error('Origin 导出超过 2,000,000 个单元格，请分组导出；不会删点或抽稀。');
  return packet;
}
