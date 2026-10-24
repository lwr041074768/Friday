"use client";
import { preventStaticTextCaret } from "@/lib/plot-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionSelect, type FileImportRequest } from "./lsv-import-dialog";
import { eisImaginaryConvention, isBodeColumn, parseDataFile, parseText, rawPairs, rawPointsFor, type ColumnPair, type DataTable, type ImportProfile } from "@/lib/lsv-import";
import { COLORS, type Curve } from "@/lib/lsv-math";
type Pair=ColumnPair&{xUnit:string;yUnit:string;imaginary:"raw"|"negative";frequencyIndex:number;frequencyUnit:string};
type Pending={table:DataTable;pairs:Pair[]};
const units=[{value:"1",label:"Ω"},{value:"1000",label:"kΩ"},{value:"0.001",label:"mΩ"},{value:"1000000",label:"MΩ"}];
const frequencyUnits=[{value:"1",label:"Hz"},{value:"1000",label:"kHz"},{value:"0.001",label:"mHz"},{value:"1000000",label:"MHz"}];
function inferredUnit(h:string){const match=/([kKmM])\s*(?:[ΩΩ]|[oO][hH][mM])/.exec(h);return match?.[1]==="k"||match?.[1]==="K"?"1000":match?.[1]==="m"?"0.001":match?.[1]==="M"?"1000000":"1";}
function inferredFrequencyUnit(header:string){const prefix=/([kKmM])\s*Hz\b/.exec(header)?.[1];return prefix==="k"||prefix==="K"?"1000":prefix==="m"?"0.001":prefix==="M"?"1000000":"1";}
function isFrequencyColumn(header:string){return /freq(?:uency)?|频率/i.test(header)||/^\s*f\d*\s*(?:[/([]|$)/i.test(header)||/^\s*[kKmM]?\s*Hz\s*$/i.test(header);}
function inferredFrequencyIndex(pair:ColumnPair,table:DataTable){const columns=table.headers.map((h,n)=>isFrequencyColumn(h)?n:-1).filter(n=>n>=0&&n!==pair.e&&n!==pair.current);return columns.length===1?columns[0]:columns.includes(pair.e+3)?pair.e+3:columns.includes(pair.e-1)?pair.e-1:-1;}
function pairDefaults(pair:ColumnPair,table:DataTable):Pair{const frequencyIndex=inferredFrequencyIndex(pair,table);return {...pair,xUnit:inferredUnit(table.headers[pair.e]),yUnit:inferredUnit(table.headers[pair.current]),imaginary:eisImaginaryConvention(table.headers[pair.current]),frequencyIndex,frequencyUnit:inferredFrequencyUnit(table.headers[frequencyIndex]??"")};}
async function eisFolderFiles(files:File[]){
  const selected:File[]=[],pathFor=(file:File)=>file.webkitRelativePath||file.name;
  const supported=files.filter(file=>/\.(?:txt|bin|csv|tsv|dat|xlsx)$/i.test(file.name)&&!/(?:^|[\\/])(?:\.|node_modules|__pycache__|分析结果|参照方法|完整数据|活化|activation)|拟合结果|拟合数据|残差|(?:^|[\s_.-])(?:fitted|fit-results?|residuals?|export)(?:[\s_.-]|$)/i.test(pathFor(file)));
  for(const file of supported){
    if(/(?:^|[^a-z])(?:lsv|cv|cdl)(?=$|[^a-z])|循环伏安|双电层|线性扫描/i.test(file.name.replace(/\.[^.]+$/,"")))continue;
    let matches=/(?:^|[^a-z])(?:eis|imp)(?=$|[^a-z])|impedance|阻抗/i.test(pathFor(file));
    if(!matches&&/\.(?:txt|bin)$/i.test(file.name)){
      const bytes=new Uint8Array(await file.slice(0,8192).arrayBuffer());
      matches=/\.bin$/i.test(file.name)?new TextDecoder("ascii").decode(bytes.subarray(8,11))==="IMP"&&new TextDecoder("ascii").decode(bytes.subarray(15,29))==="A.C. Impedance":/A\.C\.\s*Impedance|Electrochemical\s+Impedance/i.test(new TextDecoder().decode(bytes));
    }
    if(matches)selected.push(file);
  }
  const byPath=new Map(supported.map(file=>[pathFor(file).toLowerCase(),file]));
  for(const file of [...selected])if(/\.bin$/i.test(file.name)){const text=byPath.get(pathFor(file).replace(/\.bin$/i,".txt").toLowerCase());if(text&&!selected.includes(text))selected.push(text);}
  if(!selected.length)throw new Error("文件夹中未找到 EIS / IMP 原始数据，请确认所选文件夹。");
  return selected;
}
export default function XyImportDialog({open,onOpenChange,onAdd,existingCount,kind,fileRequest}:{open:boolean;onOpenChange:(v:boolean)=>void;onAdd:(curves:Curve[],message:string)=>void;existingCount:number;kind:Exclude<ImportProfile,"lsv">;fileRequest?:FileImportRequest}) {
  const input=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),[pending,setPending]=useState<Pending[]>([]),[paste,setPaste]=useState(""),[name,setName]=useState("样品 1"),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const fileLimit=kind==="eis"?80:10,curveLimit=kind==="eis"?80:20;
  const title=kind.toUpperCase(),xName=kind==="eis"?"实部 Z′":kind==="xrd"?"2θ（°）":"Raman shift（cm⁻¹）",yName=kind==="eis"?"虚部列":"强度列";
  const lastRequest=useRef<number|null>(null);
  const add=useCallback((tables:DataTable[])=>{setPending(list=>[...list,...tables.map(table=>({table,pairs:rawPairs(table,kind).map(p=>pairDefaults(p,table))}))]);setError("");},[kind]);
  function update(i:number,n:number,patch:Partial<Pair>){setPending(list=>list.map((item,j)=>j===i?{...item,pairs:item.pairs.map((p,m)=>m===n?{...p,...patch}:p)}:item));}
  const read=useCallback(async(files:FileList|File[]|null)=>{if(!files)return;let chosen=Array.from(files);if(kind==="eis"){const pathFor=(file:File)=>(file as File&{measurementSourcePath?:string}).measurementSourcePath||file.webkitRelativePath;const text=new Set(chosen.filter(file=>/\.txt$/i.test(file.name)&&pathFor(file)).map(file=>pathFor(file).replace(/\.txt$/i,"").toLowerCase()));chosen=chosen.filter(file=>!/\.bin$/i.test(file.name)||!pathFor(file)||!text.has(pathFor(file).replace(/\.bin$/i,"").toLowerCase()));}if(chosen.length>fileLimit){setError(`一次最多选择 ${fileLimit} 个文件，请分批导入。`);return;}if(chosen.reduce((n,f)=>n+f.size,0)>100*1024*1024){setError("本次文件总大小超过 100 MB，请分批导入。");return;}setBusy(true);const tables:DataTable[]=[],failures:string[]=[];try{for(const file of chosen){try{const sourcePath=(file as File&{measurementSourcePath?:string}).measurementSourcePath,relativePath=file.webkitRelativePath;tables.push(...(await parseDataFile(file,kind)).map(table=>({...table,source:sourcePath||relativePath||table.source,metadata:{...table.metadata,...(sourcePath?{sourcePath}:{}),...(relativePath?{relativePath}:{})}})));}catch(e){failures.push(`${file.name}：${(e as Error).message}`);}}if(tables.length)add(tables);setError(failures.join("；"));}finally{setBusy(false);if(input.current)input.current.value="";if(folderInput.current)folderInput.current.value="";}},[add,kind,fileLimit]);
  async function readFolder(files:FileList|null){if(!files)return;setBusy(true);setError("");try{await read(await eisFolderFiles(Array.from(files)));}catch(cause){setError((cause as Error).message);}finally{setBusy(false);if(folderInput.current)folderInput.current.value="";}}
  useEffect(()=>{if(!open||!fileRequest||lastRequest.current===fileRequest.id)return;lastRequest.current=fileRequest.id;void read(fileRequest.files);},[open,fileRequest,read]);
  const total=pending.reduce((n,t)=>n+t.pairs.length,0);
  function confirm(){try{
    if(!total)throw new Error("请先添加数据并选择 X、Y 列");
    if(existingCount+total>curveLimit)throw new Error(`已有 ${existingCount} 条，还可添加 ${Math.max(0,curveLimit-existingCount)} 条。请减少本次曲线数量。`);
    let skipped=0;
    const curves=pending.flatMap(item=>item.pairs.map(pair=>{
      if(!pair.name.trim())throw new Error("请填写曲线名称");
      const xHeader=item.table.headers[pair.e],yHeader=item.table.headers[pair.current];
      if(kind==="eis"&&[xHeader,yHeader].some(isBodeColumn))throw new Error("Nyquist 图需要实部 Z′ 和虚部 Z″，频率、|Z|、相位不能代替这两列。");
      if(kind==="eis"&&/cm|厘米/i.test(xHeader+yHeader))throw new Error("这两列可能已做面积归一化。当前 EIS 接收阻抗 Ω，请先确认并换算单位。");
      if(kind==="xrd"&&/rad(?:ian)?/i.test(xHeader))throw new Error("XRD 横轴需为 2θ（°），请先将弧度换算成度。");
      if(kind==="xrd"&&/^\s*(?:theta\b|θ(?:\s|[(/]))/i.test(xHeader))throw new Error("这列标为 θ；当前 XRD 使用 2θ，请确认并换算后导入。");
      if(kind==="raman"&&/wavelength|波长|\bnm\b/i.test(xHeader))throw new Error("Raman 横轴需为 Raman shift（cm⁻¹）；波长不能直接作为位移使用。");
      if(kind==="raman"&&/\b(?:eV|THz|GHz|Hz)\b/.test(xHeader))throw new Error("Raman 横轴需为 cm⁻¹，请先换算所选列的单位。");
      if(kind==="raman"&&/(?:^|[/(\s\[])m\s*(?:\^?-1|⁻¹)/.test(xHeader))throw new Error("Raman 横轴当前标为 cm⁻¹；这列是 m⁻¹，请先除以 100 换算。");
      const result=rawPointsFor(item.table,pair);skipped+=result.skipped;
      if(kind==="eis"&&pair.frequencyIndex>=0&&[pair.e,pair.current].includes(pair.frequencyIndex))throw new Error("请为频率选择独立的数据列。");
      const points=kind==="eis"?item.table.rows.map(row=>{const e=row[pair.e],current=row[pair.current],rawFrequency=row[pair.frequencyIndex],frequency=rawFrequency==null?NaN:rawFrequency*Number(pair.frequencyUnit);const x=e==null?NaN:e*Number(pair.xUnit),y=current==null?NaN:current*Number(pair.yUnit);if(e!=null&&!Number.isFinite(x)||current!=null&&!Number.isFinite(y))throw new Error("单位换算后的数值超出范围，请核对数据和单位。");if(rawFrequency!=null&&!Number.isFinite(frequency))throw new Error("频率换算后的数值超出范围，请核对频率列和单位。");return {e:x,current:y,...(Number.isFinite(frequency)&&frequency>0?{frequency}:{})};}):result.points;
      return {id:crypto.randomUUID(),name:pair.name.trim(),points,color:"",visible:true,unit:"A",resistance:"",area:"",compensation:"unknown",source:item.table.source,sourcePath:item.table.metadata?.sourcePath,relativePath:item.table.metadata?.relativePath,imaginary:pair.imaginary} as Curve;
    }));
    curves.forEach((c,n)=>c.color=COLORS[(existingCount+n)%COLORS.length]);
    onAdd(curves,`已导入 ${curves.length} 条 ${title} 曲线${skipped?`；检测到 ${skipped} 行缺失数据，内部曲线缺口已保留`:""}。`);setPending([]);setPaste("");onOpenChange(false);
  }catch(e){setError((e as Error).message);}}
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onMouseDownCapture={preventStaticTextCaret} className="lsv-import-modal"><DialogHeader><DialogTitle>导入 {title} 数据</DialogTitle><DialogDescription>选择当前图形的 X、Y 列。文件仅在浏览器中读取。</DialogDescription></DialogHeader>
    <div className="lsv-upload-zone" role="button" tabIndex={0} aria-label={`选择 ${title} 数据文件`} onClick={()=>input.current?.click()} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();input.current?.click();}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void read(e.dataTransfer.files);}}><Upload size={28}/><strong>{busy?"正在读取…":"点击选择文件，或拖放到这里"}</strong><span>{kind==="xrd"?"MDI / ":""}TXT / {kind==="eis"?"兼容 EIS BIN / ":""}CSV / TSV / DAT / XLSX · 单个文件 ≤ 20 MB</span></div><input ref={input} type="file" multiple hidden accept={kind==="eis"?".txt,.bin,.csv,.tsv,.dat,.xlsx":kind==="xrd"?".mdi,.txt,.csv,.tsv,.dat,.xlsx":".txt,.csv,.tsv,.dat,.xlsx"} onChange={e=>void read(e.target.files)}/>
    {kind==="eis"&&<><button className="lsv-button secondary" disabled={busy} onClick={()=>folderInput.current?.click()}><FolderOpen size={16}/>导入文件夹</button><input ref={folderInput} type="file" multiple hidden aria-label="EIS 数据文件夹" {...{webkitdirectory:"",directory:""}} onChange={e=>void readFolder(e.target.files)}/><p className="lsv-map-note">每批最多 {fileLimit} 个文件；原位等高线使用频率列及文件路径中的样品与电位。</p></>}
    <details className="lsv-paste"><summary>或者直接粘贴数据</summary><label>曲线名称<input aria-label={`粘贴 ${title} 数据名称`} value={name} onChange={e=>setName(e.target.value)}/></label><textarea aria-label={`粘贴 ${title} 数据`} value={paste} onChange={e=>setPaste(e.target.value)} placeholder={kind==="eis"?"Zreal/Ω\tZimag/Ω\n1\t-0.2\n2\t-0.5":"X\tIntensity\n100\t25\n101\t32"}/><button className="lsv-button secondary" onClick={()=>{try{add([parseText(paste,name,"粘贴数据",kind)]);setPaste("");}catch(e){setError((e as Error).message);}}}>解析粘贴数据</button></details>
    {pending.map((item,i)=><section key={item.table.id} className="lsv-table-mapping"><div className="lsv-mapping-heading"><strong>{item.table.name}</strong><span>{item.table.rows.length} 行</span><button aria-label={`移除 ${item.table.name}`} onClick={()=>setPending(list=>list.filter((_,n)=>n!==i))}><Trash2 size={16}/></button></div><div className="lsv-preview-table"><table><thead><tr>{item.table.headers.map((h,n)=><th key={n}>{n+1} · {h}</th>)}</tr></thead><tbody>{item.table.rows.slice(0,3).map((row,n)=><tr key={n}>{item.table.headers.map((_,c)=><td key={c}>{row[c]??"—"}</td>)}</tr>)}</tbody></table></div>
      {!item.pairs.length&&<p className="lsv-map-note">无法唯一确定坐标列，请添加曲线并手动选择。</p>}
      {item.pairs.map((p,n)=><div className="lsv-xy-mapping" key={n}><label>名称<input aria-label={`表${i+1}曲线${n+1}名称`} value={p.name} onChange={e=>update(i,n,{name:e.target.value})}/></label><label>{xName}<OptionSelect label={`表${i+1}曲线${n+1}X列`} value={String(p.e)} onChange={v=>update(i,n,{e:Number(v),xUnit:inferredUnit(item.table.headers[Number(v)])})} options={item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))}/></label><label>{yName}<OptionSelect label={`表${i+1}曲线${n+1}Y列`} value={String(p.current)} onChange={v=>update(i,n,{current:Number(v),imaginary:eisImaginaryConvention(item.table.headers[Number(v)]),yUnit:inferredUnit(item.table.headers[Number(v)])})} options={item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))}/></label><button aria-label={`删除第${n+1}组列映射`} onClick={()=>setPending(list=>list.map((t,j)=>j===i?{...t,pairs:t.pairs.filter((_,m)=>m!==n)}:t))}><Trash2 size={16}/></button>
        {kind==="eis"&&<><label>虚部符号<OptionSelect label={`表${i+1}曲线${n+1}虚部符号`} value={p.imaginary} onChange={v=>update(i,n,{imaginary:v as Pair["imaginary"]})} options={[{value:"raw",label:"原始 Z″（绘图取负）"},{value:"negative",label:"已经是 −Z″（保留）"}]}/></label><label>X 原始单位<OptionSelect label={`表${i+1}曲线${n+1}X单位`} value={p.xUnit} onChange={v=>update(i,n,{xUnit:v})} options={units}/></label><label>Y 原始单位<OptionSelect label={`表${i+1}曲线${n+1}Y单位`} value={p.yUnit} onChange={v=>update(i,n,{yUnit:v})} options={units}/></label><label>频率列<OptionSelect label={`表${i+1}曲线${n+1}频率列`} value={String(p.frequencyIndex)} onChange={v=>update(i,n,{frequencyIndex:Number(v),frequencyUnit:inferredFrequencyUnit(item.table.headers[Number(v)]??"")})} options={[{value:"-1",label:"留空"},...item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))]}/></label>{p.frequencyIndex>=0&&<label>频率原始单位<OptionSelect label={`表${i+1}曲线${n+1}频率单位`} value={p.frequencyUnit} onChange={v=>update(i,n,{frequencyUnit:v})} options={frequencyUnits}/></label>}</>}
      </div>)}<button className="lsv-add-pair" onClick={()=>setPending(list=>list.map((t,j)=>j===i?{...t,pairs:[...t.pairs,pairDefaults({e:0,current:Math.min(1,t.table.headers.length-1),unit:"A",name:`${t.table.name} · ${t.pairs.length+1}`},t.table)]}:t))}><Plus size={15}/>添加一条曲线 / 一组列</button>
    </section>)}
    {error&&<div className="lsv-error" role="alert">{error}</div>}<div className="lsv-import-bottom"><span>已有 {existingCount} 条 · 本次 {total} 条 · 最多 {curveLimit} 条</span><button className="lsv-button primary" onClick={confirm} disabled={busy||!total}>绘制 {total||""} 条曲线</button></div>
  </DialogContent></Dialog>;
}
