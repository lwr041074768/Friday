"use client";
import {cleanFigureSvg} from "@/lib/figure-export";
import {useProjectState,useProjectEpoch} from "@/lib/project-state";


import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, BarChart3, ChevronDown, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import OverpotentialOriginExport from "@/components/overpotential-origin-export";
import FigureExportDialog from "@/components/figure-export-dialog";
import OverpotentialFigure from "@/components/overpotential-figure";
import OverpotentialStyleGallery from "@/components/overpotential-style-gallery";
import PlotSettingsDialog from "@/components/plot-settings-dialog";
import { buildOverpotentialRows, type OverpotentialRow, type OverpotentialSnapshot } from "@/lib/overpotential-data";
import { defaultOverpotentialAxisSettings, resolveOverpotentialAxes, type OverpotentialAxisSettings } from "@/lib/overpotential-axes";
import { getOverpotentialStyle, OVERPOTENTIAL_STYLE_SOURCES } from "@/lib/overpotential-styles";
import { formatTick } from "@/lib/plot-ticks";
import "./overpotential-workspace.css";

export type OverpotentialSaveTextFile=(text:string,filename:string,mime:string)=>Promise<boolean>;
const browserSaveTextFile:OverpotentialSaveTextFile=async(contents,filename,mime)=>{const url=URL.createObjectURL(new Blob([contents],{type:mime})),link=document.createElement("a");link.href=url;link.download=filename;document.body.appendChild(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}return true;};
function readingStatus(row:OverpotentialRow){if(row.reading.etaMV===undefined)return "待核对";if(row.reading.etaMV<0)return "负值 · 请核对";return row.reading.candidate?"候选读数":"已读取";}
function axisNumber(value:number,step=1){return formatTick(value,step);}
function csvCell(value:string|number|undefined){if(value===undefined)return "";if(typeof value==="number")return String(value);const text=/^[\s\uFEFF]*[=+\-@]/.test(value)?"'"+value:value;return /[,"\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}
const rangeKeys=["xMin","xMax","yMin","yMax"] as const,tickKeys=["xMajor","yMajor","xMinor","yMinor"] as const;

export default function OverpotentialWorkspace({snapshot,saveTextFile=browserSaveTextFile}:{snapshot:OverpotentialSnapshot;saveTextFile?:OverpotentialSaveTextFile}){
  const rows=useMemo(()=>buildOverpotentialRows(snapshot),[snapshot]);
  const [draft,setDraft]=useProjectState<OverpotentialAxisSettings>('overpotential','draft',()=>({...defaultOverpotentialAxisSettings})),[applied,setApplied]=useProjectState<OverpotentialAxisSettings>('overpotential','applied',()=>({...defaultOverpotentialAxisSettings})),[axisError,setAxisError]=useState("");
  const [styleId,setStyleId]=useProjectState('overpotential','styleId',()=>{try{return getOverpotentialStyle(localStorage.getItem("eta-chart-style")).id;}catch{return getOverpotentialStyle(undefined).id;}});
  const [errors,setErrors]=useProjectState<Record<string,string>>('overpotential','errors',{});
  const errorValues=useMemo(()=>Object.fromEntries(rows.flatMap(row=>{const raw=errors[row.curve.id];if(raw===undefined||raw.trim()==="")return[];const value=Number(raw);return Number.isFinite(value)&&value>=0?[[row.curve.id,value]]:[];})) as Record<string,number>,[rows,errors]);
  const style=getOverpotentialStyle(styleId);
  useEffect(()=>{try{localStorage.setItem("eta-chart-style",style.id);}catch{/* Preferences are optional. */}},[style.id]);
  const resolved=useMemo(()=>{try{return {axes:resolveOverpotentialAxes(rows,applied),error:""};}catch(error){return {axes:resolveOverpotentialAxes(rows,defaultOverpotentialAxisSettings),error:(error as Error).message};}},[rows,applied]);
  const axes=resolved.axes,exportSettings=resolved.error?defaultOverpotentialAxisSettings:applied;
  const svg=useRef<SVGSVGElement>(null),[exportMessage,setExportMessage]=useState(""),[saving,setSaving]=useState(false);
  const projectEpoch=useProjectEpoch();useEffect(()=>{if(projectEpoch){setAxisError('');setExportMessage('');}},[projectEpoch]);
  const validCount=rows.filter(row=>row.reading.etaMV!==undefined).length,scanLabel=snapshot.scan==="down"?"反扫":"正扫";
  function field(key:keyof OverpotentialAxisSettings,value:string){setDraft(previous=>({...previous,[key]:value}));setAxisError("");}
  function apply(kind:"range"|"ticks",reset=false){
    const keys=kind==="range"?rangeKeys:tickKeys,next={...applied};for(const key of keys)next[key]=reset?defaultOverpotentialAxisSettings[key]:draft[key];
    try{let resetTicks=false;try{resolveOverpotentialAxes(rows,next);}catch(error){if(!reset||kind!=="range")throw error;for(const key of tickKeys)next[key]=defaultOverpotentialAxisSettings[key];resolveOverpotentialAxes(rows,next);resetTicks=true;}setApplied(next);setAxisError("");if(reset)setDraft(previous=>{const values={...previous};for(const key of keys)values[key]=next[key];if(resetTicks)for(const key of tickKeys)values[key]=next[key];return values;});}catch(error){setAxisError((error as Error).message);}
  }
  async function exportCsv(){
    if(saving)return;setSaving(true);try{
      const data:(string|number|undefined)[][]=[
        ["样品名称","η₁₀ (mV，按已应用 IR)","误差 ± (mV)","交点 X (V，按已应用 IR)","原始交点电位 (V)","读数状态","候选读数","读取扫描方向","LSV 中显示","模拟数据","来源文件","备注","计算依据"],
        ...rows.map(({curve,reading})=>[curve.name,reading.etaMV,errors[curve.id]?.trim()??"",reading.x,reading.e,reading.status,reading.candidate?"是":"否",scanLabel,curve.visible?"是":"否",snapshot.demo||curve.demo?"是":"否",curve.source,reading.note,"η₁₀ =（当前 LSV 曲线 Y=10 交点 X − 1.23 V）×1000；X 已包含已应用 IR，不重复校正"]),
      ];
      const saved=await saveTextFile("\uFEFF"+data.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n",snapshot.demo?"overpotential-demo.csv":"overpotential.csv","text/csv;charset=utf-8");setExportMessage(saved?"已保存 CSV 数据。":"已取消保存。");
    }catch(error){setExportMessage((error as Error).message);}finally{setSaving(false);}
  }
  async function exportSvg(){
    if(!svg.current||saving)return;setSaving(true);try{
      const {svg:clone}=cleanFigureSvg(svg.current);
      const metadata=document.createElementNS("http://www.w3.org/2000/svg","metadata");metadata.textContent=JSON.stringify({schema:"overpotential-svg/v1",styleId:style.id,styleName:style.name,sources:style.sourceIds.map(id=>OVERPOTENTIAL_STYLE_SOURCES.find(source=>source.id===id)?.url),axisSettings:exportSettings,scan:snapshot.scan,demo:snapshot.demo});clone.insertBefore(metadata,clone.firstChild);
      const saved=await saveTextFile('<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone),snapshot.demo?"overpotential-demo.svg":"overpotential.svg","image/svg+xml;charset=utf-8");setExportMessage(saved?`已保存 SVG，包含“${style.name}”样式。`:"已取消保存。");
    }catch(error){setExportMessage((error as Error).message);}finally{setSaving(false);}
  }
  const barColor=(row:OverpotentialRow,index:number)=>style.paletteMode==="source"?row.curve.color:style.palette[style.paletteMode==="single"?0:index%style.palette.length]??"#4477AA";
  const rangeControls=<div className="eta-settings-controls"><div className="eta-axis-row">{(["x","y"] as const).map(axis=><div key={axis} className="eta-axis-range" role="group" aria-label={`${axis.toUpperCase()} 轴范围`}><strong>{axis==="x"?"X 轴 · 样品":"Y 轴 · η"}</strong><input type="number" step="any" aria-label={`${axis.toUpperCase()} 轴最小值`} value={draft[axis==="x"?"xMin":"yMin"]} placeholder={axisNumber(axes[axis].min,axes[axis].major)} onChange={e=>field(axis==="x"?"xMin":"yMin",e.target.value)} onKeyDown={e=>{if(e.key==="Enter")apply("range");}}/><span>至</span><input type="number" step="any" aria-label={`${axis.toUpperCase()} 轴最大值`} value={draft[axis==="x"?"xMax":"yMax"]} placeholder={axisNumber(axes[axis].max,axes[axis].major)} onChange={e=>field(axis==="x"?"xMax":"yMax",e.target.value)} onKeyDown={e=>{if(e.key==="Enter")apply("range");}}/></div>)}</div><div className="eta-axis-actions"><button className="lsv-button secondary" onClick={()=>apply("range")}>应用范围</button><button className="eta-reset" onClick={()=>apply("range",true)}>自动范围</button></div><p className="eta-axis-note">留空时使用自动范围；范围调整不会改变样品读数。横向样式中，样品轴与 η 轴随图形方向转置。</p></div>;
  const tickControls=<div className="eta-settings-controls"><div className="eta-axis-row">{(["x","y"] as const).map(axis=><div className="eta-tick-pair" key={axis}><label>{axis==="x"?"X 轴":"Y 轴"} 主刻度<input type="number" min={0} step={axis==="x"?"1":"any"} aria-label={`${axis.toUpperCase()} 轴主刻度间隔`} value={draft[axis==="x"?"xMajor":"yMajor"]} placeholder={`当前 ${axisNumber(axes[axis].major,axes[axis].major)}`} onChange={e=>field(axis==="x"?"xMajor":"yMajor",e.target.value)}/></label><label>{axis==="x"?"X 轴":"Y 轴"} 次刻度<input type="number" min={0} max={10} step="1" title="相邻主刻度之间的次刻度数量" aria-label={`${axis.toUpperCase()} 轴次刻度数量`} value={draft[axis==="x"?"xMinor":"yMinor"]} onChange={e=>field(axis==="x"?"xMinor":"yMinor",e.target.value)}/></label></div>)}</div><div className="eta-axis-actions"><button className="lsv-button secondary" onClick={()=>apply("ticks")}>应用刻度</button><button className="eta-reset" onClick={()=>apply("ticks",true)}>自动刻度</button></div></div>;
  return <div className="eta-workspace" data-overpotential-demo={snapshot.demo?"true":"false"} data-overpotential-style={style.id}>
    <div className="eta-layout"><aside className="eta-left-panel">
      <div className="eta-heading"><div><div className="lsv-eyebrow">ELECTROCHEMISTRY / η₁₀</div><h1>过电位对比</h1></div><a className="lsv-button secondary" href="#lsv"><ArrowLeft size={15}/>返回 LSV</a><p>η₁₀ 跟随 LSV 已应用的 IR 更新。选择样式后，右侧图形即时切换。</p></div>
      <OverpotentialStyleGallery selected={style} onSelect={setStyleId}/>
      {!!rows.length&&<section className="eta-table-panel" aria-label="全部样品过电位数据"><div className="eta-panel-heading"><h2>样品读数</h2><span>{rows.length} / 10 · 已应用 IR</span></div><div className="eta-table-scroll"><table><thead><tr><th scope="col">样品名称</th><th scope="col">η₁₀ / mV</th><th scope="col">误差 ± / mV</th><th scope="col">状态</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.curve.id} data-eta-table-curve-id={row.curve.id} data-eta-status={row.reading.status}><th scope="row"><span className="eta-sample-name"><i style={{background:barColor(row,index)}} aria-hidden="true"/>{row.curve.name}</span>{!row.curve.visible&&<small>LSV 中隐藏</small>}</th><td className="eta-value">{row.reading.etaMV===undefined?"—":row.reading.etaMV.toFixed(1)}</td><td className="eta-error"><input type="number" min="0" step="any" aria-label={`${row.curve.name} 过电位误差`} placeholder="—" value={errors[row.curve.id]??""} onChange={event=>setErrors(old=>({...old,[row.curve.id]:event.target.value}))}/></td><td><span title={row.reading.note} className={`eta-status ${row.reading.etaMV===undefined||row.reading.etaMV<0?"eta-status-review":row.reading.candidate?"eta-status-candidate":""}`}>{readingStatus(row)}</span>{(row.reading.etaMV===undefined||row.reading.etaMV<0)&&<small>{row.reading.note}</small>}</td></tr>)}</tbody></table></div></section>}
    </aside><div className="eta-results">
      {snapshot.demo&&<div className="lsv-demo-notice"><Activity size={16}/>当前为 LSV 示例数据，仅用于体验操作。</div>}
      <div className="eta-overview" aria-live="polite"><span><b>{rows.length}</b> 个样品</span><span><b>{validCount}</b> 个读数</span><span className={rows.length>validCount?"eta-pending-count":""}><b>{rows.length-validCount}</b> 个待核对</span><span className="eta-scan-label">{scanLabel} · 跟随 LSV{snapshot.scan==="all"&&"（全部模式取正扫）"}</span></div>
      <section className="eta-chart-panel" aria-label="过电位柱状图"><div className="eta-chart-toolbar"><div className="eta-chart-title"><h2>η₁₀ · {style.name}</h2><span>{style.orientation==="horizontal"?"横向条形":"柱状比较"} · mV</span></div><div className="eta-chart-actions"><DropdownMenu><DropdownMenuTrigger asChild><button className="lsv-button secondary" disabled={!rows.length||saving}><Download size={16}/>{saving?"正在保存…":"导出"}<ChevronDown size={14}/></button></DropdownMenuTrigger><DropdownMenuContent className="lsv-data-export-menu" align="end"><DropdownMenuItem onSelect={()=>void exportCsv()}>CSV（.csv）</DropdownMenuItem><DropdownMenuItem onSelect={()=>void exportSvg()}>SVG（.svg）</DropdownMenuItem></DropdownMenuContent></DropdownMenu><FigureExportDialog getSvg={()=>svg.current} defaultName={snapshot.demo?"overpotential-demo":"overpotential"} disabled={!rows.length} compact/><OverpotentialOriginExport snapshot={snapshot} axisSettings={exportSettings}/><PlotSettingsDialog rangeControls={rangeControls} tickControls={tickControls}>{(axisError||resolved.error)&&<div className="lsv-error" role="alert">{axisError||`${resolved.error}；当前数据暂用自动范围。`}</div>}</PlotSettingsDialog></div></div>
      {!rows.length?<div className="eta-empty"><BarChart3 size={42}/><h2>导入 LSV 后，自动生成柱状图</h2><p>先选喜欢的样式，再导入最多 20 个样品。样品名称与过电位会随 LSV 更新。</p><a className="lsv-button primary" href="#lsv">前往 LSV 导入数据</a></div>:<div className="eta-chart-scroll"><OverpotentialFigure rows={rows} axes={axes} style={style} scanLabel={scanLabel} demo={snapshot.demo} svgRef={svg} errors={errorValues}/></div>}
      </section>{exportMessage&&<p className="eta-export-message" role="status">{exportMessage}</p>}
    </div></div>
  </div>;
}
