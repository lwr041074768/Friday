"use client";
import { preventStaticTextCaret } from "@/lib/plot-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionSelect, type FileImportRequest } from "./lsv-import-dialog";
import { eisImaginaryConvention, isBodeColumn, parseDataFile, parseText, rawPairs, rawPointsFor, type ColumnPair, type DataTable, type ImportProfile } from "@/lib/lsv-import";
import { COLORS, type Curve } from "@/lib/lsv-math";
type Pair=ColumnPair&{xUnit:string;yUnit:string;imaginary:"raw"|"negative"};
type Pending={table:DataTable;pairs:Pair[]};
const units=[{value:"1",label:"Ω"},{value:"1000",label:"kΩ"},{value:"0.001",label:"mΩ"},{value:"1000000",label:"MΩ"}];
function inferredUnit(h:string){const match=/([kKmM])\s*(?:[ΩΩ]|[oO][hH][mM])/.exec(h);return match?.[1]==="k"||match?.[1]==="K"?"1000":match?.[1]==="m"?"0.001":match?.[1]==="M"?"1000000":"1";}
function pairDefaults(pair:ColumnPair,table:DataTable):Pair{return {...pair,xUnit:inferredUnit(table.headers[pair.e]),yUnit:inferredUnit(table.headers[pair.current]),imaginary:eisImaginaryConvention(table.headers[pair.current])};}
export default function XyImportDialog({open,onOpenChange,onAdd,existingCount,kind,fileRequest}:{open:boolean;onOpenChange:(v:boolean)=>void;onAdd:(curves:Curve[],message:string)=>void;existingCount:number;kind:Exclude<ImportProfile,"lsv">;fileRequest?:FileImportRequest}) {
  const input=useRef<HTMLInputElement>(null),[pending,setPending]=useState<Pending[]>([]),[paste,setPaste]=useState(""),[name,setName]=useState("样品 1"),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const title=kind.toUpperCase(),xName=kind==="eis"?"实部 Z′":kind==="xrd"?"2θ（°）":"Raman shift（cm⁻¹）",yName=kind==="eis"?"虚部列":"强度列";
  const lastRequest=useRef<number|null>(null);
  const add=useCallback((tables:DataTable[])=>{setPending(list=>[...list,...tables.map(table=>({table,pairs:rawPairs(table,kind).map(p=>pairDefaults(p,table))}))]);setError("");},[kind]);
  function update(i:number,n:number,patch:Partial<Pair>){setPending(list=>list.map((item,j)=>j===i?{...item,pairs:item.pairs.map((p,m)=>m===n?{...p,...patch}:p)}:item));}
  const read=useCallback(async(files:FileList|File[]|null)=>{if(!files)return;setBusy(true);const tables:DataTable[]=[],failures:string[]=[];try{for(const file of Array.from(files)){try{tables.push(...await parseDataFile(file,kind));}catch(e){failures.push(`${file.name}：${(e as Error).message}`);}}if(tables.length)add(tables);setError(failures.join("；"));}finally{setBusy(false);if(input.current)input.current.value="";}},[add,kind]);
  useEffect(()=>{if(!open||!fileRequest||lastRequest.current===fileRequest.id)return;lastRequest.current=fileRequest.id;void read(fileRequest.files);},[open,fileRequest,read]);
  const total=pending.reduce((n,t)=>n+t.pairs.length,0);
  function confirm(){try{
    if(!total)throw new Error("请先添加数据并选择 X、Y 列");
    if(existingCount+total>10)throw new Error(`已有 ${existingCount} 条，还可添加 ${10-existingCount} 条。请减少本次曲线数量。`);
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
      const isHz=(h:string)=>/(?:\bfreq(?:uency)?\b|频率)/i.test(h)&&/(?:\/\s*Hz|\(\s*Hz\s*\)|\bHz\b)/i.test(h)&&!/[kKmM]\s*Hz/.test(h);
      const frequencyColumns=item.table.headers.map((h,n)=>isHz(h)?n:-1).filter(n=>n>=0);
      const frequencyIndex=frequencyColumns.length===1?frequencyColumns[0]:isHz(item.table.headers[pair.e+3]??"")?pair.e+3:-1;
      const points=kind==="eis"?item.table.rows.flatMap(row=>{const e=row[pair.e],current=row[pair.current];if(e==null||current==null)return [];const frequency=row[frequencyIndex];return [{e:e*Number(pair.xUnit),current:current*Number(pair.yUnit),...(frequency!=null&&frequency>0?{frequency}:{})}];}):result.points;
      if(points.some(p=>!Number.isFinite(p.e)||!Number.isFinite(p.current)))throw new Error("单位换算后的数值超出范围，请核对数据和单位。");
      return {id:crypto.randomUUID(),name:pair.name.trim(),points,color:"",visible:true,unit:"A",resistance:"",area:"",compensation:"unknown",source:item.table.source,imaginary:pair.imaginary} as Curve;
    }));
    curves.forEach((c,n)=>c.color=COLORS[(existingCount+n)%COLORS.length]);
    onAdd(curves,`已导入 ${curves.length} 条 ${title} 曲线${skipped?`；跳过 ${skipped} 行缺失数据`:""}。`);setPending([]);setPaste("");onOpenChange(false);
  }catch(e){setError((e as Error).message);}}
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onMouseDownCapture={preventStaticTextCaret} className="lsv-import-modal"><DialogHeader><DialogTitle>导入 {title} 数据</DialogTitle><DialogDescription>选择当前图形的 X、Y 列。文件仅在浏览器中读取。</DialogDescription></DialogHeader>
    <div className="lsv-upload-zone" role="button" tabIndex={0} aria-label={`选择 ${title} 数据文件`} onClick={()=>input.current?.click()} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();input.current?.click();}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void read(e.dataTransfer.files);}}><Upload size={28}/><strong>{busy?"正在读取…":"点击选择文件，或拖放到这里"}</strong><span>TXT / {kind==="eis"?"兼容 EIS BIN / ":""}CSV / TSV / DAT / XLSX · 单个文件 ≤ 20 MB</span></div><input ref={input} type="file" multiple hidden accept={kind==="eis"?".txt,.bin,.csv,.tsv,.dat,.xlsx":".txt,.csv,.tsv,.dat,.xlsx"} onChange={e=>void read(e.target.files)}/>
    <details className="lsv-paste"><summary>或者直接粘贴数据</summary><label>曲线名称<input aria-label={`粘贴 ${title} 数据名称`} value={name} onChange={e=>setName(e.target.value)}/></label><textarea aria-label={`粘贴 ${title} 数据`} value={paste} onChange={e=>setPaste(e.target.value)} placeholder={kind==="eis"?"Zreal/Ω\tZimag/Ω\n1\t-0.2\n2\t-0.5":"X\tIntensity\n100\t25\n101\t32"}/><button className="lsv-button secondary" onClick={()=>{try{add([parseText(paste,name,"粘贴数据",kind)]);setPaste("");}catch(e){setError((e as Error).message);}}}>解析粘贴数据</button></details>
    {pending.map((item,i)=><section key={item.table.id} className="lsv-table-mapping"><div className="lsv-mapping-heading"><strong>{item.table.name}</strong><span>{item.table.rows.length} 行</span><button aria-label={`移除 ${item.table.name}`} onClick={()=>setPending(list=>list.filter((_,n)=>n!==i))}><Trash2 size={16}/></button></div><div className="lsv-preview-table"><table><thead><tr>{item.table.headers.map((h,n)=><th key={n}>{n+1} · {h}</th>)}</tr></thead><tbody>{item.table.rows.slice(0,3).map((row,n)=><tr key={n}>{item.table.headers.map((_,c)=><td key={c}>{row[c]??"—"}</td>)}</tr>)}</tbody></table></div>
      {!item.pairs.length&&<p className="lsv-map-note">无法唯一确定坐标列，请添加曲线并手动选择。</p>}
      {item.pairs.map((p,n)=><div className="lsv-xy-mapping" key={n}><label>名称<input aria-label={`表${i+1}曲线${n+1}名称`} value={p.name} onChange={e=>update(i,n,{name:e.target.value})}/></label><label>{xName}<OptionSelect label={`表${i+1}曲线${n+1}X列`} value={String(p.e)} onChange={v=>update(i,n,{e:Number(v),xUnit:inferredUnit(item.table.headers[Number(v)])})} options={item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))}/></label><label>{yName}<OptionSelect label={`表${i+1}曲线${n+1}Y列`} value={String(p.current)} onChange={v=>update(i,n,{current:Number(v),imaginary:eisImaginaryConvention(item.table.headers[Number(v)]),yUnit:inferredUnit(item.table.headers[Number(v)])})} options={item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))}/></label><button aria-label={`删除第${n+1}组列映射`} onClick={()=>setPending(list=>list.map((t,j)=>j===i?{...t,pairs:t.pairs.filter((_,m)=>m!==n)}:t))}><Trash2 size={16}/></button>
        {kind==="eis"&&<><label>虚部符号<OptionSelect label={`表${i+1}曲线${n+1}虚部符号`} value={p.imaginary} onChange={v=>update(i,n,{imaginary:v as Pair["imaginary"]})} options={[{value:"raw",label:"原始 Z″（绘图取负）"},{value:"negative",label:"已经是 −Z″（保留）"}]}/></label><label>X 原始单位<OptionSelect label={`表${i+1}曲线${n+1}X单位`} value={p.xUnit} onChange={v=>update(i,n,{xUnit:v})} options={units}/></label><label>Y 原始单位<OptionSelect label={`表${i+1}曲线${n+1}Y单位`} value={p.yUnit} onChange={v=>update(i,n,{yUnit:v})} options={units}/></label></>}
      </div>)}<button className="lsv-add-pair" onClick={()=>setPending(list=>list.map((t,j)=>j===i?{...t,pairs:[...t.pairs,pairDefaults({e:0,current:Math.min(1,t.table.headers.length-1),unit:"A",name:`${t.table.name} · ${t.pairs.length+1}`},t.table)]}:t))}><Plus size={15}/>添加一条曲线 / 一组列</button>
    </section>)}
    {error&&<div className="lsv-error" role="alert">{error}</div>}<div className="lsv-import-bottom"><span>已有 {existingCount} 条 · 本次 {total} 条 · 最多 10 条</span><button className="lsv-button primary" onClick={confirm} disabled={busy||!total}>绘制 {total||""} 条曲线</button></div>
  </DialogContent></Dialog>;
}
