export type ProjectDocument={schema:"electrocatalysis-project/v1";application:"Scientific Plot Studio";version:string;name:string;savedAt:string;states:Record<string,unknown>};
import {compileFormula} from "./lsv-math";
import { ZSIMP_MODELS } from "./eis-zsimp-models";
const forbidden=new Set(["__proto__","prototype","constructor"]);
export function validateProjectValue(value:unknown,depth=0,budget={nodes:0}){
  if(++budget.nodes>12_000_000||depth>40)throw Error("项目数据量或嵌套层级超出限制。");
  if(value===null||typeof value==="boolean"||typeof value==="number"||value===undefined)return;
  if(typeof value==="string"){if(value.length>2_000_000)throw Error("项目文本过长。");return;}
  if(Array.isArray(value)){if(value.length>2_000_000)throw Error("项目单个数据表过大。");for(const item of value)validateProjectValue(item,depth+1,budget);return;}
  if(typeof value!=="object"||Object.getPrototypeOf(value)!==Object.prototype)throw Error("项目包含不支持的数据类型。");
  for(const [key,item] of Object.entries(value)){if(forbidden.has(key))throw Error("项目包含不允许的字段。");validateProjectValue(item,depth+1,budget);}
}
export function encodeProject(document:ProjectDocument){validateProjectValue(document);return JSON.stringify(document,(_key,value)=>typeof value==="number"&&!Number.isFinite(value)?{__ec_number__:Number.isNaN(value)?"NaN":value>0?"Infinity":"-Infinity"}:value);}
export function decodeProject(text:string):ProjectDocument{
  if(typeof text!=="string"||text.length>256*1024*1024)throw Error("项目文件超过 256 MB 限制。");
  let data:unknown;try{data=JSON.parse(text.replace(/^\uFEFF/,""),(_key,value)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===1&&typeof value.__ec_number__==="string"?value.__ec_number__==="NaN"?NaN:value.__ec_number__==="Infinity"?Infinity:value.__ec_number__==="-Infinity"?-Infinity:value:value);}catch{throw Error("项目文件不是有效的Friday项目。");}
  validateProjectValue(data);
  const item=data as ProjectDocument;
  if(item?.schema!=="electrocatalysis-project/v1"||item.application!=="Scientific Plot Studio"||typeof item.name!=="string"||!item.name.trim()||item.name.length>120||typeof item.version!=="string"||typeof item.savedAt!=="string"||!item.states||Array.isArray(item.states)||typeof item.states!=="object")throw Error("项目格式或版本标识无效。");
  for(const key of Object.keys(item.states))if(!/^(?:shell|lsv|tafel|eis|cdl|cv|xrd|raman|overpotential|ph)\.[A-Za-z0-9.-]+$/.test(key))throw Error(`项目包含不支持的模块：${key}`);
  if(Object.keys(item.states).length>300)throw Error("项目状态字段过多。");
  // Existing projects selected a specific circuit before automatic selection
  // was introduced. Preserve that selection when the new field is absent.
  if(typeof item.states['eis.analysis.kind']==='string'&&!Object.hasOwn(item.states,'eis.analysis.selectionMode'))item.states['eis.analysis.selectionMode']='manual';
  return item;
}

export function validateStateShape(key:string,value:unknown,initial:unknown){
  const fail=()=>{const name:Record<string,string>={lsv:'LSV',tafel:'Tafel',eis:'EIS',xrd:'XRD',raman:'Raman',cdl:'Cdl',cv:'CV',overpotential:'过电位',shell:'工作台'};throw Error(`项目中的 ${name[key.split('.')[0]]??'模块'} 数据格式无效，当前项目未被替换。`);};
  const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
  const point=(v:unknown)=>record(v)&&typeof v.e==="number"&&typeof v.current==="number";
  if(key==='cv.groups'){
    if(!Array.isArray(value)||value.length>12)fail();let count=0,total=0;const ids=new Set<string>();
    const string=(v:unknown,max=2048)=>typeof v==='string'&&v.length<=max;
    for(const raw of value as unknown[]){
      if(!record(raw))fail();const group=raw as Record<string,unknown>;
      if(!string(group.id,200)||ids.has(group.id as string)||!string(group.name,120)||typeof group.color!=='string'||!/^#[a-f0-9]{6}$/i.test(group.color)||typeof group.visible!=='boolean'||!Array.isArray(group.series))fail();
      ids.add(group.id as string);
      for(const rawSeries of group.series as unknown[]){
        if(!record(rawSeries))fail();const s=rawSeries as Record<string,unknown>;
        if(!['id','name','source','rate','area','unit','cycle','anodic','cathodic'].every(k=>string(s[k],k==='source'?8192:2048))||ids.has(s.id as string)||!['','A','mA','uA','nA','A/cm2','mA/cm2','uA/cm2'].includes(s.unit as string)||typeof s.included!=='boolean'||!['peak','shoulder'].includes(s.anodicQuality as string)||!['peak','shoulder'].includes(s.cathodicQuality as string)||!Array.isArray(s.points)||!s.points.every(point)||!record(s.metadata))fail();
        ids.add(s.id as string);count++;total+=(s.points as unknown[]).length;
      }
    }
    if(count>120||total>500000)fail();return;
  }
  if(key==='cv.settings'){
    if(!record(value))fail();const s=value as Record<string,unknown>;
    if(!['temperature','n','cycle','anodicMin','anodicMax','cathodicMin','cathodicMax','threshold'].every(k=>typeof s[k]==='string'&&(s[k] as string).length<=2048)||!['qualified','trial'].includes(s.calculationMode as string))fail();return;
  }
  if(key==='cv.active'&&(typeof value!=='string'||value.length>200))fail();
  if(key==='cv.view'&&!['cv','fit'].includes(value as string))fail();
  if(key==='ph.groups'){
    if(!Array.isArray(value)||value.length>12)fail();let count=0,total=0;const ids=new Set<string>();
    for(const raw of value as unknown[]){if(!record(raw))fail();const group=raw as Record<string,unknown>;
      if(typeof group.id!=='string'||ids.has(group.id)||typeof group.name!=='string'||group.name.length>60||typeof group.color!=='string'||!/^#[a-f0-9]{6}$/i.test(group.color)||typeof group.visible!=='boolean'||!Array.isArray(group.series))fail();ids.add(group.id as string);
      for(const rawSeries of group.series as unknown[]){if(!record(rawSeries))fail();const s=rawSeries as Record<string,unknown>;
        if(!['id','name','source','ph','area','unit','rs','scan','cycle'].every(k=>typeof s[k]==='string')||ids.has(s.id as string)||!['','A','mA','uA','nA','A/cm2','mA/cm2','uA/cm2'].includes(s.unit as string)||!['raw','corrected','unknown'].includes(s.compensation as string)||!['global','up','down'].includes(s.scan as string)||typeof s.included!=='boolean'||typeof s.phMeasured!=='boolean'||!Array.isArray(s.points)||!s.points.every(point)||!record(s.metadata))fail();ids.add(s.id as string);count++;total+=(s.points as unknown[]).length;
      }
    }
    if(count>120||total>500000)fail();return;
  }
  if(key==='ph.settings'){
    if(!record(value))fail();const s=value as Record<string,unknown>;
    if(!['potential','cycle','fraction','reference','filling','offset','temperature'].every(k=>typeof s[k]==='string'&&(s[k] as string).length<=2048)||!['absolute','applyIr','referenceConfirmed'].every(k=>typeof s[k]==='boolean')||!['raw','rhe'].includes(s.mode as string)||!['reference','rhe'].includes(s.inputScale as string)||!['up','down'].includes(s.scan as string)||!['mA/cm2','uA/cm2'].includes(s.outputUnit as string)||s.fitGrouping!==undefined&&!['auto','groups','combined'].includes(s.fitGrouping as string))fail();return;
  }
  const curve=(v:unknown)=>record(v)&&typeof v.id==="string"&&v.id.length<200&&typeof v.name==="string"&&typeof v.source==="string"&&typeof v.color==="string"&&typeof v.visible==="boolean"&&["A","mA","uA","nA","A/cm2","mA/cm2","uA/cm2"].includes(v.unit as string)&&typeof v.area==="string"&&typeof v.resistance==="string"&&["raw","corrected","unknown"].includes(v.compensation as string)&&Array.isArray(v.points)&&v.points.every(point);
  if(/\.(curves|samples)$/.test(key)&&!key.startsWith("cdl.")){if(!Array.isArray(value)||value.length>(key.startsWith("raman")||key.startsWith("eis")?80:20)||!value.every(curve))fail();if(key.startsWith("raman")&&(value as Record<string,unknown>[]).some(v=>["group","potential","xColumn","yColumn"].some(k=>typeof v[k]!=="string")))fail();if(key.startsWith('eis')&&(value as Record<string,unknown>[]).some(v=>['eisGroup','eisPotential'].some(k=>v[k]!==undefined&&(typeof v[k]!=='string'||(v[k] as string).length>8192))))fail();return;}
  if(key==='xrd.referenceCards'){if(!Array.isArray(value)||value.length>20)fail();for(const card of value as Record<string,unknown>[]){if(!record(card)||!["id","name","color"].every(k=>typeof card[k]==='string')||!["cod","jade"].includes(card.source as string)||typeof card.visible!=='boolean'||!Number.isFinite(card.wavelength)||!Array.isArray(card.peaks)||!Array.isArray(card.warnings))fail();for(const peak of card.peaks as Record<string,unknown>[])if(!record(peak)||!["twoTheta","d","intensity"].every(k=>typeof peak[k]==='number'&&Number.isFinite(peak[k])))fail();}return;}
  if(key==="cdl.slots"){
    if(!Array.isArray(value)||value.length!==10)fail();
    for(const slot of value as Record<string,unknown>[]){if(!record(slot)||typeof slot.id!=="string"||typeof slot.label!=="string"||!Array.isArray(slot.samples)||!Array.isArray(slot.files)||!record(slot.options)||!Array.isArray(slot.warnings)||typeof slot.notice!=="string")fail();const options=slot.options as Record<string,unknown>;if(!['e0','area','unit','cycle','preset','sampleId'].every(k=>typeof options[k]==='string')||typeof options.half!=='boolean'||typeof options.origin!=='boolean')fail();for(const file of slot.files as Record<string,unknown>[])if(!record(file)||typeof file.name!=='string'||typeof file.source!=='string')fail();for(const sample of slot.samples as Record<string,unknown>[]){if(!record(sample)||typeof sample.id!=="string"||typeof sample.name!=="string"||typeof sample.color!=="string"||!Array.isArray(sample.series)||typeof sample.visible!=="boolean")fail();for(const series of sample.series as Record<string,unknown>[]){if(!record(series)||typeof series.id!=="string"||typeof series.rateMV!=="number"||!Array.isArray(series.points)||!series.points.every(point))fail();}}}return;
  }
  if(key.endsWith(".books")){
    if(!Array.isArray(value)||value.length>200)fail();const ids=new Set<string>(),numbers=new Set<string>();
    for(const raw of value as unknown[]){
      if(!record(raw))fail();const columns=(raw as Record<string,unknown>).columns;
      if(columns===undefined)continue;
      if(!Array.isArray(columns)||columns.length>4)fail();const columnIds=new Set<string>();
      for(const column of columns as unknown[]){
        if(!record(column)||typeof column.id!=='string'||!column.id||column.id.length>200||columnIds.has(column.id)||typeof column.name!=='string'||column.name.length>200||typeof column.unit!=='string'||column.unit.length>100||typeof column.formula!=='string'||!column.formula.trim()||column.formula.length>400)fail();
        const item=column as {id:string;formula:string};columnIds.add(item.id);try{compileFormula(item.formula);}catch{fail();}
      }
    }
    for(const book of value as Record<string,unknown>[]){if(!record(book)||typeof book.id!=="string"||typeof book.curveId!=="string"||typeof book.datasetKey!=="string"||!Number.isInteger(book.number)||Number(book.number)<1||Number(book.number)>10||ids.has(book.id))fail();ids.add(book.id as string);const number=`${book.datasetKey}:${book.curveId}:${book.number}`;if(numbers.has(number))fail();numbers.add(number);for(const field of ["x","y","width","height","scrollTop","scrollLeft","z"])if(typeof book[field]!=="number"||!Number.isFinite(book[field]))fail();for(const field of ["open","minimized","maximized"])if(typeof book[field]!=="boolean")fail();if(book.restore!==null&&(!record(book.restore)||!['x','y','width','height'].every(k=>Number.isFinite((book.restore as Record<string,unknown>)[k]))))fail();}return;
  }
  if(key.endsWith(".masks")){if(!record(value)||Object.values(value).some(v=>!Array.isArray(v)||v.some(i=>!Number.isInteger(i)||i<0)))fail();return;}
  if(key==='tafel.analysis.history'){if(!Array.isArray(value)||value.some(item=>!record(item)||typeof item.key!=='string'||!Array.isArray(item.indices)||item.indices.some(i=>!Number.isInteger(i)||i<0)))fail();return;}
  if(key==="cdl.selected"&&(!Number.isInteger(value)||Number(value)<0||Number(value)>9))fail();
  const orderedPair=(pair:unknown)=>Array.isArray(pair)&&pair.length===2&&pair.every(v=>typeof v==='number'&&Number.isFinite(v))&&pair[0]<pair[1]&&Number.isFinite(pair[1]-pair[0]);
  const validBreak=(b:unknown)=>b===undefined||record(b)&&Number.isFinite(b.from)&&Number.isFinite(b.to)&&Number(b.to)>Number(b.from);
  const ticks=(settings:unknown)=>record(settings)&&['x','y'].every(axis=>{const item=settings[axis];return record(item)&&(item.scale===undefined||item.scale==='linear'||item.scale==='log10'||item.scale==='reciprocal')&&(item.step===undefined||typeof item.step==='number'&&Number.isFinite(item.step)&&item.step>0)&&typeof item.anchor==='number'&&Number.isFinite(item.anchor)&&Number.isInteger(item.minorCount)&&Number(item.minorCount)>=0&&Number(item.minorCount)<=20&&validBreak(item.break);});
  if(key.endsWith('.tickSettings')&&!ticks(value))fail();
  if(key.endsWith('.axisAssignments')&&(!record(value)||Object.values(value).some(axis=>axis!=='left'&&axis!=='right')))fail();
  if(key.endsWith('.titleSettings')){
    if(!record(value)||!['x','y'].every(axis=>{const item=(value as Record<string,unknown>)[axis];return record(item)&&(item.text===null||typeof item.text==='string'&&item.text.length<=200)&&(item.size===null||typeof item.size==='number'&&Number.isFinite(item.size)&&item.size>=8&&item.size<=48)&&typeof item.bold==='boolean';}))fail();
  }
  if(key.endsWith('.annotations')){
    const list=value as unknown[];
    if(!Array.isArray(value)||list.length>200)fail();
    for(const raw of list){
      if(!record(raw))fail();
      const item=raw as Record<string,unknown>;
      if(typeof item.id!=='string'||item.id.length>80||!['text','arrow','hline','vline'].includes(String(item.kind))||!Number.isFinite(item.x)||!Number.isFinite(item.y))fail();
      if(item.text!==undefined&&(typeof item.text!=='string'||item.text.length>500))fail();
      if(item.border!==undefined&&typeof item.border!=='boolean')fail();
      if(item.width!==undefined&&(typeof item.width!=='number'||!Number.isFinite(item.width)||item.width<.5||item.width>20))fail();
      if(item.head!==undefined&&(typeof item.head!=='number'||!Number.isFinite(item.head)||item.head<2||item.head>60))fail();
      if(item.kind==='arrow'&&(!Number.isFinite(item.x2)||!Number.isFinite(item.y2)))fail();
    }
  }
  if(key.endsWith('.manual')&&(!record(value)||Object.keys(value).some(axis=>!['x','y'].includes(axis)||!orderedPair(value[axis]))))fail();
  if(key==='eis.bode.manual'&&record(value)&&Array.isArray(value.x)&&Number(value.x[0])<=0)fail();
  if(key==='eis.bode.magnitude.manual'&&record(value)&&Array.isArray(value.y)&&Number(value.y[0])<=0)fail();
  if(/^cdl\.(cvplot|fitplot)\.options$/.test(key)){
    if(!record(value)||!ticks(value.ticks)||value.bounds!==null&&(!record(value.bounds)||!orderedPair([value.bounds.x0,value.bounds.x1])||!orderedPair([value.bounds.y0,value.bounds.y1])))fail();
  }
  const enums:Record<string,string[]>={"eis.analysis.kind":["r-cpe","r-cpe-w","rq-rq",...ZSIMP_MODELS.map(model=>model.value)],"eis.analysis.selectionMode":["auto","manual"],"eis.analysis.weighting":["modulus","unit"],"shell.tab":["lsv","overpotential","eis","cdl","cv","tafel","xrd","raman","ph"],"lsv.scan":["all","up","down"],"tafel.scan":["all","up","down"],"tafel.analysis.mode":["zoom","mask","range"],"eis.style":["line","scatter"],"eis.mode":["nyquist","contour","bode"],"eis.bodeView":["both","phase","magnitude"],"eis.bodePhaseSign":["negative","signed"],"eis.contourQuantity":["log-imag","log-modulus"],"eis.contourPalette":["viridis","warm"],"raman.mode":["stack","contour"],"raman.axis":["sequence","potential"]};
  if(enums[key]&&!enums[key].includes(value as string))fail();
  if(['eis.bode.manualPhaseSign','eis.bode.rangesPhaseSign'].includes(key)&&!['negative','signed'].includes(value as string))fail();
  if(key==='eis.contourBands'&&![16,24,32,48].includes(value as number))fail();
  const shape=(v:unknown,t:unknown,level=0):boolean=>{if(level>12)return true;if(t===null||t===undefined)return true;if(Array.isArray(t))return Array.isArray(v);if(typeof t==="object"){if(!record(v))return false;return Object.entries(t).every(([k,item])=>item===undefined||shape(v[k],item,level+1));}return typeof v===typeof t&&(typeof v!=="number"||Number.isFinite(v));};
  if(!shape(value,initial))fail();
  if(key.endsWith(".range")&&value!==null&&(!record(value)||!Number.isFinite(value.min)||!Number.isFinite(value.max)||Number(value.min)>=Number(value.max)))fail();
  if(key.endsWith(".view")&&value!==null&&key.includes("plot")&&(!record(value)||!["x0","x1","y0","y1"].every(k=>typeof value[k]==="number"&&Number.isFinite(value[k]))))fail();
}
