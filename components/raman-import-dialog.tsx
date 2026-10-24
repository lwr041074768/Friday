"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionSelect, type FileImportRequest } from "./lsv-import-dialog";
import { parseDataFile, parseText, rawPairs, type ColumnPair, type DataTable } from "@/lib/lsv-import";
import { COLORS } from "@/lib/lsv-math";
import { makeRamanCurve, ramanIdentity, RAMAN_LIMIT, type RamanCurve } from "@/lib/raman-data";
import { preventStaticTextCaret } from "@/lib/plot-ui";

type Pending={table:DataTable; pairs:ColumnPair[]; group:string; potential:string};
export default function RamanImportDialog({open,onOpenChange,onAdd,existingCount,fileRequest}:{open:boolean;onOpenChange:(v:boolean)=>void;onAdd:(curves:RamanCurve[],message:string)=>void;existingCount:number;fileRequest?:FileImportRequest}) {
  const input=useRef<HTMLInputElement>(null),folder=useRef<HTMLInputElement>(null),reading=useRef(false),lastRequest=useRef<number|undefined>(undefined);
  const [pending,setPending]=useState<Pending[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [paste,setPaste]=useState(""),[pasteName,setPasteName]=useState("Raman 光谱");
  const add=useCallback((tables:DataTable[])=>setPending(list=>[...list,...tables.map(table=>({table,pairs:rawPairs(table,"raman"),...ramanIdentity(table.name,table.source)}))]),[]);
  const read=useCallback(async(files:FileList|File[]|null)=>{
    if(!files||reading.current)return;
    const accepted=Array.from(files).filter(f=>/\.(txt|csv|tsv|dat|xlsx)$/i.test(f.name));
    if(!accepted.length){setError("请选择 TXT、CSV、TSV、DAT 或 XLSX 数据文件。");return;}
    if(accepted.length>RAMAN_LIMIT){setError(`一次最多读取 ${RAMAN_LIMIT} 个文件，请分批导入。`);return;}
    if(accepted.reduce((sum,f)=>sum+f.size,0)>60*1024*1024){setError("本次文件总计超过 60 MB，请分批导入。");return;}
    reading.current=true;setBusy(true);setError("");
    const tables:DataTable[]=[],failures:string[]=[];
    try {
      for(const file of accepted)try {
        const parsed=await parseDataFile(file,"raman");
        tables.push(...parsed.map(table=>({...table,source:file.webkitRelativePath||file.name})));
      }catch(e){failures.push(`${file.name}：${(e as Error).message}`);}
      if(tables.length)add(tables);setError(failures.join("；"));
    }finally{setBusy(false);reading.current=false;if(input.current)input.current.value="";if(folder.current)folder.current.value="";}
  },[add]);
  useEffect(()=>{if(!open||!fileRequest||lastRequest.current===fileRequest.id)return;lastRequest.current=fileRequest.id;void read(fileRequest.files);},[open,fileRequest,read]);
  const total=pending.reduce((n,item)=>n+item.pairs.length,0);
  function change(i:number,patch:Partial<Pending>){setPending(list=>list.map((item,j)=>j===i?{...item,...patch}:item));}
  function pairChange(i:number,n:number,patch:Partial<ColumnPair>){setPending(list=>list.map((item,j)=>j===i?{...item,pairs:item.pairs.map((p,m)=>m===n?{...p,...patch}:p)}:item));}
  function confirm(){try {
    if(!total)throw new Error("请添加数据并选择位移、强度列。");
    if(existingCount+total>RAMAN_LIMIT)throw new Error(`最多保留 ${RAMAN_LIMIT} 条光谱，目前还可添加 ${RAMAN_LIMIT-existingCount} 条。`);
    if(pending.reduce((n,item)=>n+item.table.rows.length*item.pairs.length,0)>1500000)throw new Error("本次数据超过 1,500,000 点，请分批导入。");
    let index=existingCount;
    const curves=pending.flatMap(item=>item.pairs.map(pair=>makeRamanCurve(item.table,pair,item.group,item.potential,COLORS[index++%COLORS.length])));
    onAdd(curves,`已导入 ${curves.length} 条光谱，共 ${curves.reduce((n,c)=>n+c.points.length,0).toLocaleString()} 个点；电位建议取自文件名，请核对。`);
    setPending([]);setPaste("");onOpenChange(false);
  }catch(e){setError((e as Error).message);}}
  return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent className="lsv-import-modal raman-import-modal" onMouseDownCapture={preventStaticTextCaret}>
    <DialogHeader><DialogTitle>导入 Raman 数据</DialogTitle><DialogDescription>支持 Optosky 六列文本，自动选取 Raman Shift 和 BaseLine Subtracted。数据仅在浏览器中读取。</DialogDescription></DialogHeader>
    <div className="lsv-upload-zone" role="button" tabIndex={0} aria-label="选择 Raman 数据文件" onClick={()=>!busy&&input.current?.click()} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();if(!busy)input.current?.click();}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void read(e.dataTransfer.files);}}><Upload size={27}/><strong>{busy?"正在读取…":"选择多个文件，或拖放到这里"}</strong><span>TXT / CSV / TSV / DAT / XLSX · 最多 {RAMAN_LIMIT} 条光谱</span></div>
    <input ref={input} type="file" multiple hidden aria-label="Raman 数据文件" accept=".txt,.csv,.tsv,.dat,.xlsx" onChange={e=>void read(e.target.files)}/>
    <input ref={folder} type="file" multiple hidden aria-label="Raman 数据文件夹" {...{webkitdirectory:"",directory:""}} onChange={e=>void read(e.target.files)}/>
    <button className="lsv-button secondary" disabled={busy} onClick={()=>folder.current?.click()}><FolderOpen size={16}/>选择文件夹（保留子文件夹分组）</button>
    <details className="lsv-paste"><summary>粘贴数据</summary><label>光谱名称<input aria-label="粘贴 Raman 名称" value={pasteName} onChange={e=>setPasteName(e.target.value)}/></label><textarea aria-label="粘贴 Raman 数据" value={paste} onChange={e=>setPaste(e.target.value)} placeholder={"Raman Shift\tIntensity\n200\t42\n201\t48"}/><button className="lsv-button secondary" onClick={()=>{try{add([parseText(paste,pasteName,"粘贴数据","raman")]);setPaste("");setError("");}catch(e){setError((e as Error).message);}}}>解析粘贴数据</button></details>
    {pending.length>0&&<><label className="lsv-field">批量选择 Optosky 强度列<OptionSelect label="批量 Raman 强度列" value="choose" onChange={header=>setPending(list=>list.map(item=>{const y=item.table.headers.findIndex(h=>h.toLowerCase()===header.toLowerCase());return y<0?item:{...item,pairs:item.pairs.map(p=>({...p,current:y}))};}))} options={[{value:"choose",label:"按下方各文件设置"},{value:"BaseLine Subtracted",label:"BaseLine Subtracted · 仪器已扣基线"},{value:"Dark Subtracted",label:"Dark Subtracted · 仪器已扣暗电流"},{value:"Raw",label:"Raw · 原始探测器强度"}]}/></label><p className="lsv-subtle">01 → 0.1、035 → 0.35 等仅为文件名推测，请核对电位及参比。dry / wet 保留为独立光谱，电位留空。文件夹和 NEW 子文件夹分别分组，可修改。</p></>}
    <div className="raman-pending-list">{pending.map((item,i)=><details className="lsv-table-mapping" key={item.table.id} open={pending.length===1}>
      <summary><strong>{item.table.name}</strong><span>{item.table.rows.length.toLocaleString()} 行 · {item.pairs.length?item.pairs.map(p=>item.table.headers[p.current]).join(", "):"待选择列"}</span></summary>
      <div className="raman-import-meta"><label className="lsv-field">数据组<input aria-label={`文件${i+1}数据组`} value={item.group} onChange={e=>change(i,{group:e.target.value})}/></label><label className="lsv-field">电位建议 / V（请核对）<input aria-label={`文件${i+1}电位`} type="number" step="any" value={item.potential} onChange={e=>change(i,{potential:e.target.value})} placeholder="未知 / dry / wet 留空"/></label><button aria-label={`移除 ${item.table.name}`} onClick={()=>setPending(list=>list.filter((_,j)=>j!==i))}><Trash2 size={16}/></button></div>
      <p className="lsv-subtle">{item.table.source}</p>
      <div className="lsv-preview-table"><table><thead><tr>{item.table.headers.map((h,n)=><th key={n}>{n+1} · {h}</th>)}</tr></thead><tbody>{item.table.rows.slice(0,2).map((row,n)=><tr key={n}>{item.table.headers.map((_,c)=><td key={c}>{row[c]??"—"}</td>)}</tr>)}</tbody></table></div>
      {item.pairs.map((pair,n)=><div className="raman-pair" key={n}><label className="lsv-field">名称<input aria-label={`文件${i+1}光谱${n+1}名称`} value={pair.name} onChange={e=>pairChange(i,n,{name:e.target.value})}/></label><label className="lsv-field">位移列<OptionSelect label={`文件${i+1}光谱${n+1}位移列`} value={String(pair.e)} onChange={v=>pairChange(i,n,{e:Number(v)})} options={item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))}/></label><label className="lsv-field">强度列<OptionSelect label={`文件${i+1}光谱${n+1}强度列`} value={String(pair.current)} onChange={v=>pairChange(i,n,{current:Number(v)})} options={item.table.headers.map((h,c)=>({value:String(c),label:`${c+1} · ${h}`}))}/></label><button aria-label={`移除文件${i+1}光谱${n+1}`} onClick={()=>change(i,{pairs:item.pairs.filter((_,m)=>m!==n)})}><Trash2 size={15}/></button></div>)}
      <button className="lsv-add-pair" onClick={()=>change(i,{pairs:[...item.pairs,{e:0,current:Math.min(1,item.table.headers.length-1),unit:"A",name:item.table.name}]})}>添加一组位移 / 强度列</button>
    </details>)}</div>
    {error&&<div className="lsv-error" role="alert">{error}</div>}
    <div className="lsv-import-bottom"><span>已有 {existingCount} 条 · 本次 {total} 条</span><button className="lsv-button primary" disabled={busy||!total} onClick={confirm}>导入 {total||""} 条光谱</button></div>
  </DialogContent></Dialog>;
}
