import {parseDataFile,suggestedPairs,pointsFor,type DataTable,type ColumnPair} from '@/lib/lsv-import';
import {COLORS,type CurrentUnit} from './lsv-math';
import {PH_LIMIT,PH_POINT_LIMIT,phNumber,phFinite,type PhSeries,type PhGroup,type PhSettings} from './ph-data';

export type PhImportItem = {id:string;table:DataTable;pair:ColumnPair;group:string;ph:string;unit:CurrentUnit|'';source:string;metadata:Record<string,unknown>};
export function inferPhPath(source:string):{group:string;ph:string} {
  const parts=source.replaceAll('\\','/').split('/').filter(Boolean),base=parts.at(-1)?.replace(/\.[^.]+$/,'')??'';
  const named=/(?:pH|酸碱度)\s*[_=:\-]?\s*(\d{1,2}(?:\.\d+)?)/i.exec(parts.join('/'));
  const phFolder=parts.findLastIndex((p,i)=>i<parts.length-1&&/^\d{1,2}(?:\.\d+)?$/.test(p)&&Number(p)<=16);
  const ph=named?.[1]??(phFolder>=0?parts[phFolder]:'');
  let group=phFolder>0?parts[phFolder-1]:parts.length>1?parts.at(-2)!:base.replace(/(?:pH|酸碱度)\s*[_=:\-]?\s*\d{1,2}(?:\.\d+)?/i,'').replace(/[_\-\s]+$/,'');
  if(!group||/^(?:lsv|cv|data|数据|pH依赖性)$/i.test(group)||parts.length===1&&/^\d+(?:\.\d+)?$/.test(group))group='样品 1';
  return {group,ph};
}
export async function readPhFiles(files:File[]):Promise<{items:PhImportItem[];warnings:string[]}> {
  if(files.length>PH_LIMIT)throw Error(`每次最多导入 ${PH_LIMIT} 个文件。`);
  const items:PhImportItem[]=[],warnings:string[]=[];
  let total=0;
  for(const file of files){
    const relative=file.webkitRelativePath||file.name;
    if(/(?:^|\/)(?:分析结果[^/]*|参照方法[^/]*|完整数据|node_modules|\.git)(?:\/|$)/i.test(relative)){warnings.push(`跳过结果目录：${relative}`);continue;}
    if(!/\.(txt|csv|tsv|dat|xlsx|bin)$/i.test(file.name))continue;
    const source=(file as File&{measurementSourcePath?:string}).measurementSourcePath||relative;
    try {
      const tables=await parseDataFile(file,'lsv');
      let header='';if(/\.(txt|csv|tsv|dat)$/i.test(file.name)){const bytes=new Uint8Array(await file.slice(0,9000).arrayBuffer());header=new TextDecoder('utf-8').decode(bytes);if(header.includes('�'))header=new TextDecoder('gb18030').decode(bytes);header=header.split(/\r?\n/).slice(0,70).join('\n');}
      if(/(?:activation|活化)/i.test(file.name)){warnings.push(`跳过活化文件：${relative}`);continue;}
      for(const table of tables){
        const candidates=suggestedPairs(table),pairs=candidates.length?candidates:[{e:0,current:1,name:table.name,unit:'A' as const}];
        for(const pair of pairs){
          total+=table.rows.length;if(total>PH_POINT_LIMIT)throw Error(`本次数据超过 ${PH_POINT_LIMIT.toLocaleString()} 个原始点，请分批。`);
          const recognized=/(?:^|[\s/(])(?:[munμµ]?A)(?:\b|\/)/i.test(table.headers[pair.current])||/电流.*(?:安培|毫安|微安)/.test(table.headers[pair.current]);
          items.push({id:crypto.randomUUID(),table,pair,source,...inferPhPath(source),unit:recognized?pair.unit:'',metadata:{headers:table.headers,header,table:table.name,lastModified:file.lastModified,...table.metadata}});
        }
      }
    }catch(error){if((error as Error).message.includes('本次数据超过'))throw error;warnings.push(`${relative}：${(error as Error).message}`);}
  }
  if(!items.length)throw Error(warnings.join('\n')||'没有找到可读取的曲线文件。');
  return {items,warnings};
}
export function appendPhImport(existing:PhGroup[],items:PhImportItem[],area:string,compensation:PhSeries['compensation']):PhGroup[] {
  if(existing.reduce((n,g)=>n+g.series.length,0)+items.length>PH_LIMIT)throw Error(`本项目最多 ${PH_LIMIT} 条 pH 曲线。`);
  if(existing.reduce((n,g)=>n+g.series.reduce((s,c)=>s+c.points.length,0),0)+items.reduce((n,i)=>n+i.table.rows.length,0)>PH_POINT_LIMIT)throw Error('项目超过 500,000 个原始点，请新建项目或分组处理。');
  const groups=existing.map(g=>({...g,series:[...g.series]}));
  for(const item of items){
    if(!item.group.trim())throw Error('请填写每个文件的样品组名称。');
    if(item.pair.e===item.pair.current)throw Error('电位列和电流列不能相同。');
    const pair={...item.pair,unit:item.unit||item.pair.unit};
    const {points}=pointsFor(item.table,pair);
    let group=groups.find(g=>g.name===item.group.trim());
    if(!group){if(groups.length>=12)throw Error('第一版最多支持 12 个样品组。');group={id:crypto.randomUUID(),name:item.group.trim(),color:COLORS[groups.length%COLORS.length],visible:true,series:[]};groups.push(group);}
    // Each confirmed import is independent, even when the original is selected again.
    group.series.push({id:crypto.randomUUID(),name:item.table.name,source:item.source,ph:item.ph,phMeasured:false,unit:item.unit,area,included:true,compensation,rs:'',scan:'global',cycle:'',points,metadata:{...item.metadata,eColumn:pair.e,currentColumn:pair.current}});
  }
  return groups;
}

export function nextPhSampleName(groups:PhGroup[]):string {
  const numbers=groups.map(g=>/^样品\s*(\d+)$/.exec(g.name)?.[1]).filter(Boolean).map(Number);
  let n=Math.max(groups.length,...numbers)+1;while(groups.some(g=>g.name===`样品${n}`))n++;
  return `样品${n}`;
}

/** All files in an import belong to the explicitly selected sample. Path
 * suggestions remain metadata and never create or choose material identities. */
export function appendPhFilesToSample(existing:PhGroup[],items:PhImportItem[],area:string,compensation:PhSeries['compensation'],targetId?:string|null):{groups:PhGroup[];groupId:string} {
  if(!items.length)throw Error('没有可添加的文件。');
  if(existing.reduce((n,g)=>n+g.series.length,0)+items.length>PH_LIMIT)throw Error(`本项目最多 ${PH_LIMIT} 条 pH 曲线。`);
  if(existing.reduce((n,g)=>n+g.series.reduce((s,c)=>s+c.points.length,0),0)+items.reduce((n,i)=>n+i.table.rows.length,0)>PH_POINT_LIMIT)throw Error('项目超过 500,000 个原始点，请分批处理。');
  const groups=existing.map(g=>({...g,series:[...g.series]}));
  let target=targetId?groups.find(g=>g.id===targetId):groups[0];
  if(targetId&&!target)throw Error('所选样品已不存在，请重新选择样品后导入。');
  if(!target){target={id:crypto.randomUUID(),name:nextPhSampleName(groups),color:COLORS[groups.length%COLORS.length],visible:true,series:[]};groups.push(target);}
  for(const item of items){
    const pair={...item.pair,unit:item.unit||item.pair.unit},{points}=pointsFor(item.table,pair);
    target.series.push({id:crypto.randomUUID(),name:item.table.name,source:item.source,ph:item.ph,phMeasured:false,unit:item.unit,area,included:true,compensation,rs:'',scan:'global',cycle:'',points,metadata:{...item.metadata,inferredPathGroup:item.group,eColumn:pair.e,currentColumn:pair.current}});
  }
  return {groups,groupId:target.id};
}

/** Preserve an old project's explicit combined fit as one real sample when
 * moving to the sample/files model. Original group labels stay with each file. */
export function normalizePhSamples(groups:PhGroup[],settings:PhSettings):{groups:PhGroup[];settings:PhSettings} {
  if(settings.fitGrouping==='groups')return {groups,settings};
  const populated=groups.filter(g=>g.series.length);
  const numbered=populated.length>=3&&populated.every(g=>/^\s*(?:(?:样品|sample)\s*)?\d+\s*$/i.test(g.name)&&g.series.length===1)&&populated.every(g=>phFinite(phNumber(g.series[0].ph)))&&new Set(populated.map(g=>phNumber(g.series[0].ph))).size===populated.length;
  const combine=populated.length>1&&(settings.fitGrouping==='combined'||numbered);
  const empty=groups.filter(g=>!g.series.length);
  const converted=combine?[{id:populated[0].id,name:nextPhSampleName(empty),color:populated[0].color,visible:populated.some(g=>g.visible),series:populated.flatMap(g=>g.series.map(s=>({...s,metadata:{...s.metadata,previousSampleGroup:g.name}})))},...empty]:groups;
  return {groups:converted,settings:{...settings,fitGrouping:'groups'}};
}
