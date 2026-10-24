"use client";
import {cleanFigureSvg} from "@/lib/figure-export";
import {useEffect as useProjectEffect} from "react";
import {useProjectState,useProjectEpoch} from "@/lib/project-state";

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Download, ExternalLink, Eye, EyeOff, Trash2, Upload, X } from "lucide-react";
import LsvPlot from "@/components/lsv-plot";
import FigureExportDialog from "@/components/figure-export-dialog";
import RamanContour from "@/components/raman-contour";
import RamanImportDialog from "@/components/raman-import-dialog";
import { OptionSelect, type FileImportRequest } from "@/components/lsv-import-dialog";
import { ramanCsv, ramanGrid, ramanLines, RAMAN_LIMIT, type RamanCurve, type RamanYAxis } from "@/lib/raman-data";
import type { RamanOriginOptions } from "@/lib/raman-origin-export";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./raman-workspace.css";

function download(data:string,type:string,name:string){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function RamanWorkspace({onExportOrigin}:{onExportOrigin?:(options:RamanOriginOptions)=>Promise<{message:string}>}={}){
  const [curves,setCurves]=useProjectState<RamanCurve[]>('raman','curves',[]),[open,setOpen]=useState(false),[message,setMessage]=useState("");
  const [fileRequest,setFileRequest]=useState<FileImportRequest>(),[mode,setMode]=useProjectState<"stack"|"contour">('raman','mode',"stack"),[group,setGroup]=useProjectState('raman','group',"");
  const [exportBusy,setExportBusy]=useState(false),[exportStatus,setExportStatus]=useState(""),[exportError,setExportError]=useState("");
  const exportLock=useRef(false);
  const [normalize,setNormalize]=useProjectState('raman','normalize',false),[offset,setOffset]=useProjectState('raman','offset',"500"),[axis,setAxis]=useProjectState<RamanYAxis>('raman','axis',"sequence");
  const [xMin,setXMin]=useProjectState('raman','xMin',""),[xMax,setXMax]=useProjectState('raman','xMax',""),[bands,setBands]=useProjectState('raman','bands',"24"),[palette,setPalette]=useProjectState('raman','palette',"viridis");
  const [xLabel,setXLabel]=useProjectState('raman','xLabel',"Raman shift / cm⁻¹"),[lineLabel,setLineLabel]=useProjectState('raman','lineLabel',"Intensity / a.u."),[contourLabel,setContourLabel]=useProjectState('raman','contourLabel',"Spectrum index");
  const projectEpoch=useProjectEpoch();useProjectEffect(()=>{if(projectEpoch){setMessage('');setExportStatus('');setExportError('');setOpen(false);setFileRequest(undefined);}},[projectEpoch]);
  const plot=useRef<HTMLDivElement>(null);
  const groups=useMemo(()=>Array.from(new Set(curves.map(c=>c.group))),[curves]);
  const selectedGroup=groups.includes(group)?group:groups[0]??"";
  const selected=useMemo(()=>curves.filter(c=>c.group===selectedGroup),[curves,selectedGroup]);
  const rangeError=(xMin.trim()&&!Number.isFinite(Number(xMin)))||(xMax.trim()&&!Number.isFinite(Number(xMax)))?"位移范围必须为有效数值。":xMin.trim()&&xMax.trim()&&Number(xMin)>=Number(xMax)?"位移下限必须小于上限。":undefined;
  const offsetError=mode==="stack"&&(!offset.trim()||!Number.isFinite(Number(offset))||Number(offset)<0)?"堆叠间距需为大于或等于 0 的数值。":undefined;
  const lines=useMemo(()=>ramanLines(selected,normalize,mode==="stack",Number(offset)||0),[selected,normalize,mode,offset]);
  const displayed=useMemo(()=>lines.map(c=>({...c,plotted:c.plotted.map(p=>p&&(xMin.trim()&&p.x<Number(xMin)||xMax.trim()&&p.x>Number(xMax))?null:p)})),[lines,xMin,xMax]);
  const grid=useMemo(()=>ramanGrid(selected,normalize,axis,{min:xMin.trim()?Number(xMin):undefined,max:xMax.trim()?Number(xMax):undefined}),[selected,normalize,axis,xMin,xMax]);
  function change(id:string,patch:Partial<RamanCurve>){setCurves(list=>list.map(c=>c.id===id?{...c,...patch}:c));}
  function move(id:string,step:number){setCurves(list=>{const indexes=list.map((c,i)=>c.group===selectedGroup?i:-1).filter(i=>i>=0),n=indexes.findIndex(i=>list[i].id===id);if(n+step<0||n+step>=indexes.length)return list;const copy=[...list];[copy[indexes[n]],copy[indexes[n+step]]]=[copy[indexes[n+step]],copy[indexes[n]]];return copy;});}
  function drop(files: File[]){if(!files.length)return;setFileRequest(last=>({id:(last?.id??0)+1,files}));setOpen(true);}
  function exportSvg(){const svg=plot.current?.querySelector(mode==="contour"?'svg[data-testid="raman-contour"]':'svg[data-testid="lsv-chart"]');if(!svg)return;const {svg:clone}=cleanFigureSvg(svg as SVGSVGElement);download(new XMLSerializer().serializeToString(clone),"image/svg+xml",`Raman-${mode}.svg`);}
  const error=rangeError||offsetError;
  async function exportOrigin(){
    if(!onExportOrigin||exportLock.current)return;
    exportLock.current=true;setExportBusy(true);setExportError("");setExportStatus("正在打开 Origin，写入并核对本组完整数据…");
    try{const result=await onExportOrigin({curves:selected,mode,normalize,offset:mode==="stack"?Number(offset):0,axis,xLabel,intensityLabel:lineLabel,xMin,xMax});setExportStatus(result.message);}
    catch(cause){setExportStatus("");setExportError(cause instanceof Error?cause.message:"导出至 Origin 失败。");}
    finally{exportLock.current=false;setExportBusy(false);}
  }
  const exportActions=<div className="studio-plot-export-group"><strong>Raman {mode==="contour"?"等高线图":"堆叠图"}</strong><DropdownMenu><DropdownMenuTrigger asChild><button className="lsv-button secondary" disabled={!selected.length||exportBusy}><Download size={16}/>{exportBusy?"正在导出…":"导出数据"}<ChevronDown size={14}/></button></DropdownMenuTrigger><DropdownMenuContent className="lsv-data-export-menu" align="end"><DropdownMenuItem onSelect={()=>download(ramanCsv(selected,normalize,mode==="stack",Number(offset)||0),"text/csv;charset=utf-8","Raman-data.csv")}>导出本组 CSV 数据</DropdownMenuItem>{onExportOrigin&&<DropdownMenuItem disabled={!!offsetError} onSelect={()=>void exportOrigin()}><ExternalLink size={15}/>导出数据至 Origin</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
      <button className="lsv-button secondary" onClick={exportSvg} disabled={!selected.some(c=>c.visible)||!!error||(mode==="contour"&&!!grid.error)}><Download size={16}/>导出图形 SVG</button>{mode==="contour"&&<FigureExportDialog getSvg={()=>plot.current?.querySelector('svg[data-testid="raman-contour"]') as SVGSVGElement|null || null} defaultName="Raman-等高线" disabled={!selected.length||!!grid.error} compact/>}</div>;
  const dataRangeSettings=<section className="lsv-control-section"><h3>光谱截取范围 / cm⁻¹</h3><div className="raman-range"><label className="lsv-field">下限 / cm⁻¹<input type="number" step="any" aria-label="Raman 位移下限" value={xMin} onChange={e=>setXMin(e.target.value)} placeholder="自动"/></label><label className="lsv-field">上限 / cm⁻¹<input type="number" step="any" aria-label="Raman 位移上限" value={xMax} onChange={e=>setXMax(e.target.value)} placeholder="自动"/></label></div><button className="lsv-add-pair" onClick={()=>{setXMin("");setXMax("");}}>恢复完整范围</button></section>;
  return <div className="lsv-workspace lsv-raised-workspace raman-workspace">
    <div className="lsv-layout lsv-compact-layout"><aside className="lsv-controls">
      <div className="lsv-heading"><div><div className="lsv-eyebrow">SPECTROSCOPY / RAMAN</div><h1>Raman 谱图绘制</h1></div><div className="lsv-heading-actions"><button className="lsv-button primary" disabled={curves.length>=RAMAN_LIMIT} onClick={()=>setOpen(true)}><Upload size={17}/>导入数据</button></div><p>导入原位拉曼光谱，切换堆叠图与等高线图。</p></div>
      <section className="lsv-control-section"><div className="lsv-section-title"><span className="lsv-section-number">01</span><h2>图形设置</h2></div>
        <div className="raman-mode-switch" role="group" aria-label="Raman 图形类型"><button aria-pressed={mode==="stack"} onClick={()=>setMode("stack")}>堆叠图</button><button aria-pressed={mode==="contour"} onClick={()=>setMode("contour")}>等高线图</button></div>
        <label className="lsv-field">数据组<OptionSelect label="Raman 数据组" value={selectedGroup||"empty"} onChange={setGroup} options={groups.length?groups.map(g=>({value:g,label:g})):[{value:"empty",label:"请先导入数据"}]}/></label>
        <label className="lsv-field">强度处理<OptionSelect label="Raman 强度处理" value={normalize?"normalize":"raw"} onChange={v=>{const n=v==="normalize";setNormalize(n);setOffset(n?"1.2":"500");setLineLabel(n?"Normalized intensity / a.u.":"Intensity / a.u.");}} options={[{value:"raw",label:"保留导入列的强度"},{value:"normalize",label:"各谱按最大绝对值归一化"}]}/></label>
        {mode==="stack"?<label className="lsv-field">堆叠间距<input type="number" step="any" min="0" aria-label="Raman 堆叠间距" value={offset} onChange={e=>setOffset(e.target.value)}/><small>仅平移显示；0 为叠加。</small></label>:<>
          <label className="lsv-field">纵轴<OptionSelect label="Raman 等高线纵轴" value={axis} onChange={v=>{setAxis(v as RamanYAxis);setContourLabel(v==="potential"?"Potential / V (reference unverified)":"Spectrum index");}} options={[{value:"sequence",label:"光谱序号（按列表顺序）"},{value:"potential",label:"电位 / V（核对后使用）"}]}/></label>
          <label className="lsv-field">色阶数量<OptionSelect label="Raman 色阶数量" value={bands} onChange={setBands} options={[{value:"12",label:"12"},{value:"24",label:"24"},{value:"40",label:"40"}]}/></label>
          <label className="lsv-field">配色<OptionSelect label="Raman 等高线配色" value={palette} onChange={setPalette} options={[{value:"viridis",label:"紫 · 绿 · 黄"},{value:"warm",label:"蓝 · 青 · 黄 · 红"}]}/></label>
          <p className="lsv-subtle">电位来自文件名建议；参比未核实。相同电位的重复测量需手动择一。序号轴可保留 dry / wet 光谱。</p>
        </>}
      </section>
      <details className="raman-axis-settings"><summary>坐标标题</summary><label className="lsv-field">X 轴标题<input aria-label="Raman X 轴标题" value={xLabel} onChange={e=>setXLabel(e.target.value)}/></label><label className="lsv-field">Y 轴标题<input aria-label="Raman Y 轴标题" value={mode==="contour"?contourLabel:lineLabel} onChange={e=>(mode==="contour"?setContourLabel:setLineLabel)(e.target.value)}/></label></details>
    </aside><div className="lsv-results">
      {message&&<div className="lsv-import-message" role="status">{message}</div>}
      <div ref={plot}><div hidden={mode!=="contour"}><RamanContour toolbar={exportActions} settingsContent={dataRangeSettings} grid={error?{...grid,error}:grid} axis={axis} bands={Number(bands)} palette={palette} normalize={normalize} xLabel={xLabel} yLabel={contourLabel} onFilesDrop={drop}/></div><div hidden={mode!=="stack"}><LsvPlot projectScope="raman.plot" compactToolbar axisControls summary={exportActions} settingsContent={dataRangeSettings} curves={displayed} xLabel={xLabel} yLabel={lineLabel} error={error} title="Raman 堆叠图" legendInside legendAbove onFilesDrop={drop} emptyText="选择 Raman 数据文件或文件夹，也可把多个 TXT 文件拖入这里。"/></div></div>
      <section className="lsv-curves-panel"><div className="lsv-curves-heading"><h2>光谱管理 <span>本组 {selected.length} · 共 {curves.length} / {RAMAN_LIMIT}</span></h2><div className="raman-list-actions"><button className="lsv-add-pair" onClick={()=>setCurves(list=>list.map(c=>c.group===selectedGroup?{...c,visible:true}:c))}>全部显示</button><button className="lsv-add-pair" onClick={()=>setCurves(list=>list.map(c=>c.group===selectedGroup?{...c,visible:false}:c))}>全部隐藏</button></div></div>
        {selected.length?selected.map((c,i)=><div className={`lsv-managed-curve ${c.visible?"":"hidden-curve"}`} key={c.id}>
          <div className="lsv-curve-row"><button aria-label={`${c.visible?"隐藏":"显示"} ${c.name}`} onClick={()=>change(c.id,{visible:!c.visible})}>{c.visible?<Eye size={17}/>:<EyeOff size={17}/>}</button><input className="lsv-color-input" type="color" aria-label={`${c.name}颜色`} value={c.color} onChange={e=>change(c.id,{color:e.target.value})}/><input aria-label={`${c.name}名称`} value={c.name} onChange={e=>change(c.id,{name:e.target.value})}/><button disabled={i===0} aria-label={`上移 ${c.name}`} onClick={()=>move(c.id,-1)}><ArrowUp size={15}/></button><button disabled={i===selected.length-1} aria-label={`下移 ${c.name}`} onClick={()=>move(c.id,1)}><ArrowDown size={15}/></button><button aria-label={`删除 ${c.name}`} onClick={()=>setCurves(list=>list.filter(v=>v.id!==c.id))}><Trash2 size={16}/></button></div>
          <div className="raman-curve-meta"><span>{i+1} · {c.points.length.toLocaleString()} 点 · {c.yColumn}</span><label>电位 / V<input type="number" step="any" aria-label={`${c.name}电位`} value={c.potential} onChange={e=>change(c.id,{potential:e.target.value})} placeholder="未知"/></label></div>
          <details className="lsv-curve-details"><summary>数据来源与分组</summary><p className="raman-source">{c.source} · X: {c.xColumn} · Y: {c.yColumn}</p><label className="lsv-field">数据组<input aria-label={`${c.name}数据组`} value={c.group} onChange={e=>change(c.id,{group:e.target.value})}/></label>{c.metadata&&<p className="lsv-subtle">{Object.entries(c.metadata).map(([k,v])=>`${k}: ${v}`).join(" · ")}</p>}</details>
        </div>):<p className="lsv-subtle">导入后可调整光谱顺序、名称和电位。不同文件夹的数据分别管理。</p>}
      </section>
    </div></div>
    {(exportStatus||exportError)&&<div className="lsv-origin-toast" role={exportError?"alert":"status"}>{!exportBusy&&<button aria-label="关闭导出提示" onClick={()=>{setExportStatus("");setExportError("");}}><X size={16}/></button>}<div>{exportError||exportStatus}</div>{!exportError&&!exportBusy&&<small>已新建可编辑的 Origin 工作表，请在 Origin 中保存项目。</small>}</div>}
    <footer className="lsv-footer"><span>Friday · Raman</span><span>切换页面保留数据；刷新前请导出或保留原始文件。</span></footer>
    <RamanImportDialog open={open} onOpenChange={setOpen} existingCount={curves.length} fileRequest={fileRequest} onAdd={(added,note)=>{setCurves(list=>[...list,...added]);if(!curves.length)setGroup(added[0]?.group??"");setMessage(note);}}/>
  </div>;
}
