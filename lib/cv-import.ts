import {parseCdlDataFile,suggestedCdlMappings,type CdlImportTable,type CdlColumnMapping} from '@/lib/cdl-import';
import {pointsFor} from './lsv-import';
import {type CurrentUnit} from './lsv-math';
import {createCvGroup,CV_LIMIT,CV_POINT_LIMIT,cvNumber,cvFinite,type CvGroup,type CvSeries} from './cv-data';

export type CvImportItem={id:string;table:CdlImportTable;pair:CdlColumnMapping;group:string;rate:string;unit:CurrentUnit|'';source:string;metadata:Record<string,unknown>};
export function inferCvRate(source:string):string {
  const name=source.replaceAll('\\','/').split('/').at(-1)??source;
  const match=/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(m?V)(?:\s*[/_·]\s*s|\s*s[-−]?1)?(?=[^A-Za-z]|$)/i.exec(name);
  return match?String(Number(match[1])*(match[2].toLowerCase()==='mv'?1:1000)):'';
}
export async function readCvFiles(files:File[]):Promise<{items:CvImportItem[];warnings:string[]}> {
  if(files.length>CV_LIMIT)throw Error(`每次最多导入 ${CV_LIMIT} 个文件。`);
  const items:CvImportItem[]=[],warnings:string[]=[];let total=0;
  for(const file of files){
    const source=(file as File&{measurementSourcePath?:string}).measurementSourcePath||file.webkitRelativePath||file.name;
    if(!/\.(txt|csv|tsv|dat|xlsx|bin)$/i.test(file.name))continue;
    if(/(?:^|[\\/])(?:node_modules|\.git|分析结果[^\\/]*|取峰结果[^\\/]*)(?:[\\/]|$)/i.test(source)){warnings.push(`跳过结果目录：${source}`);continue;}
    if(/activation|活化/i.test(file.name)){warnings.push(`跳过活化文件：${file.name}`);continue;}
    try{
      const tables=await parseCdlDataFile(file);
      for(const table of tables){
        const pairs=suggestedCdlMappings(table);
        if(!pairs.length){warnings.push(`${table.name}：请导入电位与电流原始列。`);continue;}
        if(table.notice)warnings.push(`${file.name}：${table.notice}`);
        if(table.rateWarning&&!table.notice?.includes(table.rateWarning))warnings.push(`${file.name}：${table.rateWarning}`);
        for(const pair of pairs){
          total+=table.rows.length;if(total>CV_POINT_LIMIT)throw Error(`本次导入超过 ${CV_POINT_LIMIT.toLocaleString()} 个原始点，请分批处理。`);
          const header=table.headers[pair.current],recognized=/(?:^|[\s/(])(?:[munμµ]?A)(?:\b|\/)|电流.*(?:安培|毫安|微安)/i.test(header);
          const unit=table.currentUnitHint??table.unitSuggested??(recognized?(/mA/i.test(header)?/cm/.test(header)?'mA/cm2':'mA':/[uμµ]A/i.test(header)?/cm/.test(header)?'uA/cm2':'uA':/nA/.test(header)?'nA':/cm/.test(header)?'A/cm2':'A'):'');
          const rate=table.headerRateMV!==undefined&&pairs.length===1?String(table.headerRateMV):pair.rateMV||inferCvRate(file.name);
          const group=source.replaceAll('\\','/').split('/').filter(Boolean).at(-2)??'样品1';
          items.push({id:crypto.randomUUID(),table,pair,group,rate,unit,source,metadata:{...table.metadata,headers:table.headers,table:table.name,lastModified:file.lastModified,rateSource:table.headerRateMV!==undefined?'acquisition-header':pair.rateMV?'column-or-filename':'filename-suggestion',headerRateMV:table.headerRateMV??null,fileNameRateMV:table.fileNameRateMV??(inferCvRate(file.name)?Number(inferCvRate(file.name)):null),rateWarning:table.rateWarning??'',notice:table.notice??''}});
        }
      }
    }catch(error){const message=(error as Error).message;if(message.includes('本次导入超过'))throw error;warnings.push(`${file.name}：${message}`);}
  }
  if(!items.length)throw Error(warnings.join('\n')||'请选择包含电位与电流的 CV 文件。');
  return {items,warnings};
}
export function nextCvSampleName(groups:CvGroup[]):string {
  const numbers=groups.map(g=>/^样品\s*(\d+)$/.exec(g.name)?.[1]).filter(Boolean).map(Number);
  let n=Math.max(groups.length,...numbers)+1;while(groups.some(g=>g.name===`样品${n}`))n++;
  return `样品${n}`;
}
/** A confirmed batch belongs to the selected sample. Every file is independently retained. */
export function appendCvFilesToSample(existing:CvGroup[],items:CvImportItem[],area='1',targetId?:string|null):{groups:CvGroup[];groupId:string}{
  if(!items.length)throw Error('请选择需要添加的 CV 文件。');
  if(!(cvFinite(cvNumber(area))&&cvNumber(area)>0))throw Error('请填写大于 0 的有效面积（cm²）。');
  if(existing.reduce((n,g)=>n+g.series.length,0)+items.length>CV_LIMIT)throw Error(`本项目最多支持 ${CV_LIMIT} 条 CV 曲线。`);
  if(existing.reduce((n,g)=>n+g.series.reduce((sum,s)=>sum+s.points.length,0),0)+items.reduce((sum,item)=>sum+item.table.rows.length,0)>CV_POINT_LIMIT)throw Error('项目超过 500,000 个原始点，请分组处理。');
  const groups=existing.map(g=>({...g,series:[...g.series]}));
  let target=targetId?groups.find(g=>g.id===targetId):groups[0];
  if(targetId&&!target)throw Error('所选样品已移除，请重新选择。');
  if(!target){if(groups.length>=12)throw Error('最多支持 12 个样品组。');target=createCvGroup(nextCvSampleName(groups),groups.length);groups.push(target);}
  for(const item of items){
    if(!item.unit)throw Error('请确认每份 CV 的原始电流单位。');
    if(!Number.isInteger(item.pair.e)||!Number.isInteger(item.pair.current)||item.pair.e<0||item.pair.current<0||item.pair.e>=item.table.headers.length||item.pair.current>=item.table.headers.length)throw Error('请确认有效的电位列和电流列。');
    const pair={...item.pair,name:item.table.name,unit:item.unit||'A' as CurrentUnit},{points,skipped}=pointsFor(item.table,pair);
    const series:CvSeries={id:crypto.randomUUID(),name:item.table.name,source:item.source,rate:item.rate,area,unit:item.unit,included:true,cycle:'',anodic:'',cathodic:'',anodicQuality:'peak',cathodicQuality:'peak',points,metadata:{...item.metadata,inferredPathGroup:item.group,eColumn:pair.e,currentColumn:pair.current,missingRows:skipped}};
    target.series.push(series);
  }
  return {groups,groupId:target.id};
}
