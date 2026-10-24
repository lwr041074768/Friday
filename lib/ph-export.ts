import {strToU8,zipSync} from 'fflate';
import {COLORS} from './lsv-math';
import {analyzePh,preparePhTraces,phAxisLabel,phLogLabel,phDefinition,phFitEquation,type PhGroup,type PhSettings,type PhAnalysis,type PhTrace} from './ph-data';
import type {CdlOriginColumn,CdlOriginSheet,CdlOriginPlot} from './cdl-origin-export';

export type PhCell=number|string|null;
export type PhTable={name:string;label:string;headers:string[];rows:PhCell[][]};
export type PhOriginPacket={schema:'ph-origin/v1';requestId:string;createdAt:string;label:string;
  settings:PhSettings;sheets:CdlOriginSheet[];rawPlots:CdlOriginPlot[];fitPlots:CdlOriginPlot[]};
const clean=(value:unknown):PhCell=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'?value:null;
export function phTables(groups:PhGroup[],settings:PhSettings,traces=preparePhTraces(groups,settings),analysis=analyzePh(groups,traces,settings)):PhTable[] {
  const points:PhTable={name:'FitPoints',label:'实际取点',headers:['样品','pH','纳入','电位标度','目标电位 / V',`j / ${settings.outputUnit}`,'log10 j','原始电位 / V','原始电流（原单位）','原始单位','插值','原始行（从1计）','状态','源文件'],rows:[]};
  const fits:PhTable={name:'Fits',label:'拟合结果',headers:['样品','方案','pH 范围','n','斜率','截距','R2','斜率 SE','斜率95%下限','斜率95%上限','说明','拟合方程（y 为所选单位的 log10 j）'],rows:[]};
  const fitted:PhTable={name:'FittedValues',label:'逐点拟合值与残差',headers:['样品','pH','纳入','观测 log10 j','拟合 log10 j','残差（观测−拟合）',`${settings.absolute?'拟合 |j|':'拟合 j'} / ${settings.outputUnit}`,'拟合状态','k','b','R2','n','目标电位 / V','电位模式','j 单位','源文件'],rows:[]};
  for(const result of analysis.groups){
    for(const p of result.points)points.rows.push([result.group.name,clean(p.ph),p.included?'yes':'no',settings.mode,clean(analysis.potential),clean(p.j),clean(p.logJ),clean(p.rawE),clean(p.rawCurrent),p.trace.series.unit,p.interpolated?'yes':'no',p.indices?.map(i=>i+1).join(';')??'',p.error??p.warning??'有效',p.trace.series.source]);
    for(const all of [false,true]){const fit=all?result.allFit:result.fit;fits.rows.push([result.group.name,all?'全部 pH':'当前纳入',result.points.filter(p=>all||p.included).map(p=>p.ph).join(';'),fit?.n??null,fit?.slope??null,fit?.intercept??null,fit?.r2??null,fit?.slopeSE??null,fit?.low??null,fit?.high??null,all?'':result.error??'',fit?phFitEquation(fit):'']);}
    for(const p of result.points){
      const fit=result.fit,predicted=fit&&Number.isFinite(p.ph)?fit.slope*p.ph+fit.intercept:undefined;
      const residual=predicted!==undefined&&p.logJ!==undefined?p.logJ-predicted:undefined;
      const status=!fit?result.error??'尚未拟合':p.included?'参与拟合':p.ph<fit.min||p.ph>fit.max?'排除点（拟合范围外预测）':'排除点（拟合范围内预测）';
      fitted.rows.push([result.group.name,clean(p.ph),p.included?'yes':'no',clean(p.logJ),clean(predicted),clean(residual),predicted===undefined?null:clean(10**predicted),status,fit?.slope??null,fit?.intercept??null,fit?.r2??null,fit?.n??null,clean(analysis.potential),settings.mode,settings.outputUnit,p.trace.series.source]);
    }
  }
  const metadata:PhTable={name:'Metadata',label:'计算条件与来源',headers:['记录','样品','文件','值'],rows:[
    ['settings','','',JSON.stringify(settings)],['definition','','',phDefinition(settings)],
    ['fit_grouping','','',JSON.stringify({mode:'automatic-per-sample',sourceGroups:groups.map(g=>g.name),fittedGroups:analysis.groups.map(g=>g.group.name)})],
    ['statistics','','','Unweighted OLS with intercept. 95% CI is conditional on regression assumptions, not replicate uncertainty.'],
    ['scope','','','All source rows, signs, gaps and excluded files retained. Export never uses screen decimation. Indices refer to original source order.'],
    ['interpretation','','','Positive current alone does not establish OER current. No mechanism/performance ranking is inferred.'],
  ]};
  const raw:PhTable[]=traces.map((trace,index)=>{
    const {points:original,...attributes}=trace.series;
    metadata.rows.push(['series',trace.groupName,trace.series.source,JSON.stringify({...attributes,metadata:trace.series.metadata,selectedCycle:trace.selectedCycle,cycles:trace.cycles,start:trace.start,end:trace.end,error:trace.error,warnings:trace.warnings})]);
    const transformed=new Map(trace.points.filter(p=>p!==null).map(p=>[p.index,p]));
    return {name:`Raw${index+1}`,label:`${trace.groupName} · pH ${trace.series.ph||'?'} · ${trace.series.name}`,headers:['原始行（从1计）','原始电位 / V',`原始电流 / ${trace.series.unit||'未确认'}`,phAxisLabel(settings),`j / ${settings.outputUnit}`],rows:original.map((p,i)=>[i+1,clean(p.e),clean(p.current),clean(transformed.get(i)?.x),clean(transformed.get(i)?.j)])};
  });
  // Origin COM and Excel impose different per-cell text limits. Ordered chunks
  // retain all acquisition headers and metadata in both destinations.
  metadata.rows=metadata.rows.flatMap(row=>{const chars=Array.from(String(row[3]??'')),count=Math.ceil(chars.length/110);return count<=1?[row]:Array.from({length:count},(_,i)=>[`${row[0]} part ${i+1}/${count}`,row[1],row[2],chars.slice(i*110,(i+1)*110).join('')]);});
  return [points,fits,metadata,fitted,...raw];
}
function csvCell(value:PhCell):string {if(value===null)return '';if(typeof value==='number')return String(value);const safe=/^[\s]*[=+\-@]/.test(value)?`'${value}`:value;return /[",\n\r]/.test(safe)?`"${safe.replaceAll('"','""')}"`:safe;}
export function phCsv(table:PhTable):string {return '\uFEFF'+[table.headers,...table.rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function phRawCsv(groups:PhGroup[],settings:PhSettings):string {
  const tables=phTables(groups,settings),meta=tables.find(t=>t.name==='Metadata')!;
  const lines=[['record','sample_or_sheet','source_or_label','value_or_row','raw_E_V','raw_current','selected_X_V','selected_j']];
  for(const row of meta.rows)lines.push(['metadata',String(row[1]??''),String(row[2]??''),String(row[0])+': '+String(row[3]),'','','','']);
  let text='\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  for(const table of tables.filter(t=>t.name.startsWith('Raw'))){text+=[['columns',table.name,table.label,...table.headers],...table.rows.map(row=>['raw',table.name,table.label,...row])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
  return text;
}
const xml=(value:string)=>value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function columnName(index:number){let result='';for(let i=index+1;i;i=Math.floor((i-1)/26))result=String.fromCharCode(65+(i-1)%26)+result;return result;}
export function phXlsx(tables:PhTable[]):Uint8Array {
  if(tables.reduce((n,t)=>n+(t.rows.length+1)*t.headers.length,0)>3_000_000)throw Error('Excel 超过 3,000,000 个单元格；请分组导出，完整 CSV 不抽稀。');
  const header='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rels='http://schemas.openxmlformats.org/package/2006/relationships';
  const entries:Record<string,Uint8Array>={
    '[Content_Types].xml':strToU8(header+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'),
    '_rels/.rels':strToU8(header+`<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml':strToU8(header+`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`+tables.map((t,i)=>`<sheet name="${xml(t.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels':strToU8(header+`<Relationships xmlns="${rels}">`+tables.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+'</Relationships>'),
  };
  tables.forEach((table,index)=>{
    const rows=[table.headers,...table.rows].map((row,r)=>'<row r="'+(r+1)+'">'+row.map((value,c)=>{
      if(value===null||typeof value==='number'&&!Number.isFinite(value))return '';
      const ref=columnName(c)+(r+1);
      if(typeof value==='number')return `<c r="${ref}"><v>${value}</v></c>`;
      if(value.length>32767)throw Error('单元格文本超过 Excel 限制。');
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')+'</row>').join('');
    entries[`xl/worksheets/sheet${index+1}.xml`]=strToU8(header+`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData></worksheet>`);
  });
  return zipSync(entries,{level:6});
}
export function buildPhOrigin(groups:PhGroup[],settings:PhSettings):PhOriginPacket {
  if(!groups.some(g=>g.series.length))throw Error('请先导入数据。');
  const traces=preparePhTraces(groups,settings),analysis=analyzePh(groups,traces,settings);
  if(analysis.error)throw Error(analysis.error);
  const tables=phTables(groups,settings,traces,analysis),rawPlots:CdlOriginPlot[]=[],fitPlots:CdlOriginPlot[]=[];
  const sheets:CdlOriginSheet[]=tables.map(table=>({name:table.name,label:table.label.slice(0,1024),columns:table.headers.map((label,c):CdlOriginColumn=>({label,unit:'',kind:table.rows.some(row=>typeof row[c]==='number')?'number':'text',designation:'none',values:table.rows.map(row=>clean(row[c]))}))}));
  // Raw sheets retain every source row; graph pairs are the complete selected branch.
  const phValues=[...new Set(traces.map(t=>t.ph))].sort((a,b)=>a-b);
  traces.forEach((trace,i)=>{const sheet=sheets.find(s=>s.name===`Raw${i+1}`)!;[0,1,2,3,4].forEach(c=>sheet.columns[c].kind='number');sheet.columns[1].unit='V';sheet.columns[2].unit=trace.series.unit;sheet.columns[3].designation='X';sheet.columns[3].unit='V';sheet.columns[4].designation='Y';sheet.columns[4].label=`${trace.groupName} · pH ${trace.series.ph}`;sheet.columns[4].unit=settings.outputUnit;if(!trace.error&&trace.visible)rawPlots.push({sheet:sheet.name,x:4,y:5,kind:'line',color:COLORS[phValues.indexOf(trace.ph)%COLORS.length]||trace.color});});
  const fitColumns:CdlOriginColumn[]=[];
  for(const result of analysis.groups){
    const selected=result.points.filter(p=>p.included&&!p.error&&p.logJ!==undefined);
    const add=(label:string,x:number[],y:number[],kind:'line'|'scatter')=>{const c=fitColumns.length+1;fitColumns.push({label:`${result.group.name} pH`,unit:'',kind:'number',designation:'X',values:x},{label:`${result.group.name} · ${label}`,unit:'',kind:'number',designation:'Y',values:y});if(result.group.visible)fitPlots.push({sheet:'PlotData',x:c,y:c+1,kind,color:result.group.color});};
    if(selected.length)add('纳入点',selected.map(p=>p.ph),selected.map(p=>p.logJ!),'scatter');
    if(result.fit){const f=result.fit,x=[f.min,f.max];add(`k=${f.slope.toFixed(4)} R2=${f.r2?.toFixed(4)??'undefined'}`,x,x.map(v=>f.slope*v+f.intercept),'line');}
  }
  if(fitColumns.length)sheets.push({name:'PlotData',label:'当前拟合图数据；排除点完整保留于 FitPoints',columns:fitColumns});
  if(sheets.reduce((n,s)=>n+s.columns.reduce((sum,c)=>sum+c.values.length,0),0)>3_000_000)throw Error('Origin 导出超过 3,000,000 个单元格，请分组导出。');
  return {schema:'ph-origin/v1',requestId:crypto.randomUUID(),createdAt:new Date().toISOString(),label:'pH 依赖性',settings,sheets,rawPlots,fitPlots};
}
