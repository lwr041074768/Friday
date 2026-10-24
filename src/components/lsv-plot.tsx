"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import type { PlotCurve, PlotPoint } from "@/lib/lsv-math";
import { axisTicks, DEFAULT_TICKS, formatTick, type AxisTicks, type PlotTickSettings } from "@/lib/plot-ticks";
import PlotTickSettingsPanel from "./plot-tick-settings";
type Bounds = { x0: number; x1: number; y0: number; y1: number };
function padded(values: number[]): [number, number] { if (!values.length) return [0, 1]; let min = Infinity, max = -Infinity; for (const v of values) { min = Math.min(v, min); max = Math.max(v, max); } const padding = (max - min || Math.abs(max) || 1) * .065; return [min - padding, max + padding]; }
function fmt(value: number) { if (value === 0) return "0"; if (Math.abs(value) < .0001 || Math.abs(value) >= 1e5) return value.toExponential(2); return Number(value.toPrecision(6)).toString(); }
function displayPoints(points: (PlotPoint | null)[]) { if (points.length <= 6000) return points; const stride = Math.ceil(points.length / 1500); const result: (PlotPoint | null)[] = []; for (let offset = 0; offset < points.length; offset += stride) { const bucket = points.slice(offset, offset + stride); const valid = bucket.filter((p): p is PlotPoint => p !== null); if (valid.length !== bucket.length) { result.push(...bucket); continue; } const chosen = new Set([0, bucket.length - 1]); let min = 0, max = 0, minX = 0, maxX = 0; for (let n = 1; n < valid.length; n++) { if (valid[n].y < valid[min].y) min = n; if (valid[n].y > valid[max].y) max = n; if (valid[n].x < valid[minX].x) minX = n; if (valid[n].x > valid[maxX].x) maxX = n; } chosen.add(min); chosen.add(max); chosen.add(minX); chosen.add(maxX); [...chosen].sort((a,b) => a-b).forEach(n => result.push(bucket[n])); } return result; }
export default function LsvPlot({ curves, xLabel, yLabel, error, title="LSV 曲线", toolbar, summary, compactToolbar=false, style="line", emptyText, legendInside=false, legendAbove=false, axisControls=false, equalUnits=false, squarePlot=false, fillCanvas=false, onFilesDrop, showFooter=true, notice }: { curves: PlotCurve[]; xLabel: string; yLabel: string; error?: string; title?:string; toolbar?:React.ReactNode; summary?:React.ReactNode; compactToolbar?:boolean; style?:"line"|"scatter"; emptyText?:string; legendInside?:boolean; legendAbove?:boolean; axisControls?:boolean; equalUnits?:boolean; squarePlot?:boolean; fillCanvas?:boolean; onFilesDrop?:(files:File[])=>void; showFooter?:boolean; notice?:string }) {
  const host = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const dragDepth=useRef(0),[fileOver,setFileOver]=useState(false);
  function fileDrag(event:React.DragEvent){return !!onFilesDrop&&Array.from(event.dataTransfer.types).includes("Files");}
  const [size, setSize] = useState({ width: 940, height: axisControls?940*4301/5419:560 });
  const [view, setView] = useState<Bounds | null>(null), [hover, setHover] = useState<{ point: PlotPoint; curve: PlotCurve; px: number; py: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [manual,setManual]=useState<{x?:[number,number];y?:[number,number]}>({});
  const [ranges,setRanges]=useState({x0:"",x1:"",y0:"",y1:""}),[rangeError,setRangeError]=useState("");
  const [tickSettings,setTickSettings]=useState<PlotTickSettings>(DEFAULT_TICKS);
  const clip = useId().replace(/:/g, "");
  useEffect(() => {
    const target=host.current;if(!target)return;
    const measure=()=>{
      if(target.clientWidth<=0||target.clientHeight<=0)return;
      const width=target.clientWidth,height=target.clientHeight;
      const fullscreen=document.fullscreenElement===target.parentElement;
      const viewportFit=compactToolbar&&window.matchMedia("(min-width:1101px) and (min-height:600px)").matches;
      if(axisControls&&!fillCanvas&&!viewportFit&&!fullscreen){const fitted=Math.min(width,height*5419/4301);setSize({width:fitted,height:fitted*4301/5419});}
      else setSize({width,height});
    };
    const observer=new ResizeObserver(measure);observer.observe(target);
    window.addEventListener("resize",measure);document.addEventListener("fullscreenchange",measure);
    return()=>{observer.disconnect();window.removeEventListener("resize",measure);document.removeEventListener("fullscreenchange",measure);};
  }, [axisControls,fillCanvas,compactToolbar]);
  const active = curves.filter(c => c.visible && !c.error), points = active.flatMap(c => c.plotted.filter((p): p is PlotPoint => p !== null));
  const full = useMemo(() => { const [x0, x1] = padded(points.map(p => p.x)), [y0, y1] = padded(points.map(p => p.y)); return { x0, x1, y0, y1 }; }, [curves]); // recompute from original data after any edit
  useEffect(() => { setHover(null); setView(null); }, [curves]);
  const base={x0:manual.x?.[0]??full.x0,x1:manual.x?.[1]??full.x1,y0:manual.y?.[0]??full.y0,y1:manual.y?.[1]??full.y1};
  const bounds = view ?? base;
  const tickWarnings:string[]=[];
  function ticksFor(axis:"x"|"y"):AxisTicks {
    try{return axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],tickSettings[axis]);}
    catch(error){
      tickWarnings.push(`${axis.toUpperCase()} 轴：${(error as Error).message}；当前范围暂用自动刻度。`);
      try{return axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],DEFAULT_TICKS[axis]);}catch{return {major:[],minor:[],step:1};}
    }
  }
  const xTicks=ticksFor("x"),yTicks=ticksFor("y");
  function applyTicks(settings:PlotTickSettings):string|undefined {
    for(const axis of ["x","y"] as const){try{axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],settings[axis]);}catch(error){return `${axis.toUpperCase()} 轴：${(error as Error).message}`;}}
    setTickSettings(settings);return;
  }
  const shortCanvas=compactToolbar&&(size.height<280||(squarePlot&&size.height<400));
  const tickSize=axisControls?(shortCanvas?14:size.width<420?16:18):14;
  const tickWidth=Math.max(...yTicks.major.map(value=>formatTick(value,yTicks.step).length),1)*tickSize*.6;
  const margin = axisControls?{left:Math.max(size.width<500?92:104,Math.min(154,Math.ceil(tickWidth+60))),right:36,top:shortCanvas?22:30,bottom:shortCanvas?64:88}:{ left: size.width < 500 ? 68 : 88, right: 26, top: 28, bottom: 68 };
  const legendLeft=margin.left,aboveColumns=size.width>=650?2:1;
  if(legendAbove&&active.length)margin.top=Math.max(margin.top,Math.ceil(active.length/aboveColumns)*23+26);
  const titleLeft=margin.left,titleBottom=margin.bottom;
  let w = size.width - margin.left - margin.right, h = size.height - margin.top - margin.bottom;
  if(equalUnits){const scale=Math.min(w/(bounds.x1-bounds.x0),h/(bounds.y1-bounds.y0)),equalW=(bounds.x1-bounds.x0)*scale,equalH=(bounds.y1-bounds.y0)*scale;margin.left+=(w-equalW)/2;margin.top+=(h-equalH)/2;w=equalW;h=equalH;}
  else if(squarePlot){const side=Math.max(1,Math.min(w,h));margin.left+=(w-side)/2;margin.top+=(h-side)/2;w=side;h=side;}
  const xTitleSize=axisControls?Math.min(shortCanvas?18:24,Math.max(squarePlot?10:16,(squarePlot?w:size.width-margin.left+margin.right-24)/Math.max(1,xLabel.length*.56))):16;
  const yTitleSize=axisControls?Math.min(24,Math.max(shortCanvas||squarePlot?10:16,(squarePlot?h:size.height-26)/Math.max(1,yLabel.length*.56))):16;
  const xTitleY=squarePlot?margin.top+h+titleBottom-(shortCanvas?14:22):size.height-(axisControls?22:14);
  const yTitleX=squarePlot?margin.left-titleLeft+28:axisControls?28:22;
  const yTitleY=squarePlot?margin.top+h/2:axisControls?size.height/2:margin.top+h/2;
  const sx = (x: number) => margin.left + (x - bounds.x0) / (bounds.x1 - bounds.x0) * w, sy = (y: number) => margin.top + h - (y - bounds.y0) / (bounds.y1 - bounds.y0) * h;
  const ix = (px: number) => bounds.x0 + (px - margin.left) / w * (bounds.x1 - bounds.x0), iy = (py: number) => bounds.y1 - (py - margin.top) / h * (bounds.y1 - bounds.y0);
  const clamp = (x: number, y: number) => ({ x: Math.min(margin.left+w, Math.max(margin.left, x)), y: Math.min(margin.top+h, Math.max(margin.top, y)) });
  function reset(){setView(null);setManual({});setRanges({x0:"",x1:"",y0:"",y1:""});setRangeError("");}
  function applyRanges(){
    const next:{x?:[number,number];y?:[number,number]}={};
    for(const axis of ["x","y"] as const){const lower=ranges[`${axis}0`].trim(),upper=ranges[`${axis}1`].trim();if(!lower&&!upper)continue;const min=lower?Number(lower):NaN,max=upper?Number(upper):NaN;if(!Number.isFinite(min)||!Number.isFinite(max)||min>=max||max-min<=1e-12||!Number.isFinite(max-min)){setRangeError(`${axis.toUpperCase()} 轴需填写有效的最小值和最大值，且最小值小于最大值。`);return;}next[axis]=[min,max];}
    setManual(next);setView(null);setHover(null);setRangeError("");
  }
  const legendColumns=legendAbove?aboveColumns:w>430||active.length*23+14>h-20?2:1,legendColumnWidth=legendAbove?Math.min(420,(size.width-legendLeft-36)/legendColumns):Math.min(250,(w-28)/legendColumns);
  const legendRows=Math.ceil(active.length/legendColumns),legendRowHeight=legendAbove?23:Math.min(23,Math.max(14,(h-24)/Math.max(1,legendRows))),legendHeight=legendRows*legendRowHeight+14;
  function legendName(name:string){let text="",length=0;for(const char of name){length+=char.charCodeAt(0)>255?14:7;if(length>legendColumnWidth-52)return text+"…";text+=char;}return text;}
  function coordinates(event: React.PointerEvent | React.WheelEvent) { const rect = svg.current!.getBoundingClientRect(); return { x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height }; }
  function zoom(factor: number, cx = (bounds.x0+bounds.x1)/2, cy = (bounds.y0+bounds.y1)/2) { const candidate = { x0: cx+(bounds.x0-cx)*factor, x1: cx+(bounds.x1-cx)*factor, y0: cy+(bounds.y0-cy)*factor, y1: cy+(bounds.y1-cy)*factor }; if (candidate.x1-candidate.x0 > 1e-12 && candidate.y1-candidate.y0 > 1e-12 && Object.values(candidate).every(Number.isFinite)) setView(candidate); }
  function move(event: React.PointerEvent) { const p = coordinates(event); if (drag) { const end = clamp(p.x,p.y); setDrag({ ...drag, x1: end.x, y1: end.y }); return; } if (p.x < margin.left || p.x > margin.left+w || p.y < margin.top || p.y > margin.top+h) { setHover(null); return; } let nearest: { point: PlotPoint; curve: PlotCurve; px: number; py: number } | null = null, distance = 24 ** 2; for (const curve of active) { for (const point of curve.plotted) { if (!point || point.x < bounds.x0 || point.x > bounds.x1 || point.y < bounds.y0 || point.y > bounds.y1) continue; const px = sx(point.x), py = sy(point.y), d = (p.x-px)**2+(p.y-py)**2; if (d < distance) { distance = d; nearest = { point, curve, px, py }; } } } setHover(nearest); }
  function finish(event: React.PointerEvent) { if (!drag) return; if (Math.abs(drag.x1-drag.x0) > 12 && Math.abs(drag.y1-drag.y0) > 12) { setView({ x0: ix(Math.min(drag.x0,drag.x1)), x1: ix(Math.max(drag.x0,drag.x1)), y0: iy(Math.max(drag.y0,drag.y1)), y1: iy(Math.min(drag.y0,drag.y1)) }); } setDrag(null); if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId); }
  return <div className={`lsv-plot-panel ${axisControls?"lsv-custom-plot":""} ${compactToolbar?"lsv-compact-toolbar":""}`}>
    <div className="lsv-plot-toolbar">{!compactToolbar&&<div className="lsv-chart-heading"><span className="lsv-small-label">交互画布</span><strong>{title}</strong></div>}{summary}{compactToolbar&&<PlotTickSettingsPanel onApply={applyTicks} settings={tickSettings} floating/>}{toolbar}<div className="lsv-plot-actions"><button title="缩小" aria-label="缩小图形" onClick={() => zoom(1.4)}><Minus size={17}/></button><button title="放大" aria-label="放大图形" onClick={() => zoom(1/1.4)}><Plus size={17}/></button><span/><button onClick={reset} title="恢复完整范围"><RotateCcw size={16}/><span>复位</span></button><button title="全屏显示图形" aria-label="全屏显示图形" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void host.current?.parentElement?.requestFullscreen(); }}><Maximize2 size={17}/></button></div></div>
    {notice&&<div className="lsv-plot-notice" role="status">{notice}</div>}
    {axisControls&&<div className="lsv-axis-controls"><div className="lsv-axis-range" role="group" aria-label="X 轴范围"><strong>X 轴范围</strong><input type="number" step="any" aria-label="X 轴最小值" placeholder={`最小 ${fmt(full.x0)}`} value={ranges.x0} onChange={e=>setRanges(r=>({...r,x0:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/><span>至</span><input type="number" step="any" aria-label="X 轴最大值" placeholder={`最大 ${fmt(full.x1)}`} value={ranges.x1} onChange={e=>setRanges(r=>({...r,x1:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/></div><div className="lsv-axis-range" role="group" aria-label="Y 轴范围"><strong>Y 轴范围</strong><input type="number" step="any" aria-label="Y 轴最小值" placeholder={`最小 ${fmt(full.y0)}`} value={ranges.y0} onChange={e=>setRanges(r=>({...r,y0:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/><span>至</span><input type="number" step="any" aria-label="Y 轴最大值" placeholder={`最大 ${fmt(full.y1)}`} value={ranges.y1} onChange={e=>setRanges(r=>({...r,y1:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/></div><button className="lsv-button secondary" onClick={applyRanges}>应用范围</button>{rangeError&&<div role="alert" className="lsv-error">{rangeError}</div>}</div>}
    {!compactToolbar&&<PlotTickSettingsPanel onApply={applyTicks} settings={tickSettings}/>}
    {tickWarnings.length>0&&<div className="lsv-tick-warning" role="status">{tickWarnings.join(" ")}</div>}
    {!legendInside&&active.length>0&&<div className="lsv-plot-legend">{active.map(c=><span key={c.id}><i style={{background:c.color}}/>{c.name}</span>)}</div>}
    <div className={`lsv-plot-host ${fileOver?"lsv-file-over":""}`} ref={host} data-file-drop={!!onFilesDrop} onDragEnter={event=>{if(!fileDrag(event))return;event.preventDefault();dragDepth.current++;setFileOver(true);}} onDragOver={event=>{if(!fileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect="copy";}} onDragLeave={event=>{if(!fileDrag(event))return;event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setFileOver(false);}} onDrop={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth.current=0;setFileOver(false);setDrag(null);setHover(null);onFilesDrop?.(Array.from(event.dataTransfer.files));}}>
      <div className="lsv-plot-canvas" style={{width:axisControls?size.width:"100%",height:axisControls?size.height:"100%"}}>
      <svg ref={svg} width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`${title}交互图，${active.length}条曲线，横轴${xLabel}，纵轴${yLabel}`} data-testid="lsv-chart" data-equal-units={equalUnits} data-x-min={bounds.x0} data-x-max={bounds.x1} data-y-min={bounds.y0} data-y-max={bounds.y1} onPointerMove={move} onPointerLeave={() => !drag && setHover(null)} onPointerDown={event => { if (event.button !== 0 || !points.length) return; const p = coordinates(event); if (p.x < margin.left || p.x > margin.left+w || p.y < margin.top || p.y > margin.top+h) return; svg.current?.setPointerCapture(event.pointerId); setDrag({ x0:p.x,y0:p.y,x1:p.x,y1:p.y }); setHover(null); }} onPointerUp={finish} onPointerCancel={() => setDrag(null)} onDoubleClick={reset} onWheel={event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); const p = clamp(coordinates(event).x,coordinates(event).y); zoom(event.deltaY > 0 ? 1.12 : 1/1.12, ix(p.x),iy(p.y)); }}>
        <defs><clipPath id={clip}><rect x={margin.left} y={margin.top} width={w} height={h}/></clipPath></defs>
        <rect width={size.width} height={size.height} fill="white"/>
        {xTicks.major.map(v => <g key={`x-${v}`} data-tick-kind="major" data-axis="x" data-tick-value={v}><line x1={sx(v)} x2={sx(v)} y1={margin.top} y2={margin.top+h} stroke="#edf1f5"/><line x1={sx(v)} x2={sx(v)} y1={margin.top+h} y2={margin.top+h+7} stroke="#26384b"/><text x={sx(v)} y={margin.top+h+(axisControls?shortCanvas?24:34:27)} textAnchor="middle" className="lsv-axis-tick" style={{fontSize:tickSize}}>{formatTick(v,xTicks.step)}</text></g>)}
        {yTicks.major.map(v => <g key={`y-${v}`} data-tick-kind="major" data-axis="y" data-tick-value={v}><line x1={margin.left} x2={margin.left+w} y1={sy(v)} y2={sy(v)} stroke="#edf1f5"/><line x1={margin.left-7} x2={margin.left} y1={sy(v)} y2={sy(v)} stroke="#26384b"/><text x={margin.left-(axisControls?16:13)} y={sy(v)+tickSize*.35} textAnchor="end" className="lsv-axis-tick" style={{fontSize:tickSize}}>{formatTick(v,yTicks.step)}</text></g>)}
        {xTicks.minor.map(v=><line key={`xm-${v}`} data-tick-kind="minor" data-axis="x" data-tick-value={v} x1={sx(v)} x2={sx(v)} y1={margin.top+h} y2={margin.top+h+3.5} stroke="#26384b" strokeWidth=".8"/>)}
        {yTicks.minor.map(v=><line key={`ym-${v}`} data-tick-kind="minor" data-axis="y" data-tick-value={v} x1={margin.left-3.5} x2={margin.left} y1={sy(v)} y2={sy(v)} stroke="#26384b" strokeWidth=".8"/>)}
        <rect x={margin.left} y={margin.top} width={w} height={h} fill="none" stroke="#24394e" strokeWidth="1.25"/>
        <g clipPath={`url(#${clip})`}>{active.map(curve => { const rendered=displayPoints(curve.plotted); if(style==="scatter")return <g key={curve.id} data-curve={curve.id} data-first-x={curve.plotted.find(p=>p)?.x}>{rendered.map((p,n)=>p&&<circle key={n} cx={sx(p.x)} cy={sy(p.y)} r="4" fill="white" stroke={curve.color} strokeWidth="1.8" data-x={p.x} data-y={p.y}/>)}</g>; let newSegment = true; const commands: string[] = []; for (const p of rendered) { if (!p) { newSegment = true; continue; } commands.push(`${newSegment ? "M" : "L"}${sx(p.x).toFixed(3)},${sy(p.y).toFixed(3)}`); newSegment = false; } return <path key={curve.id} data-curve={curve.id} data-first-x={curve.plotted.find(p=>p)?.x} data-first-y={curve.plotted.find(p=>p)?.y} data-point-count={curve.plotted.filter(Boolean).length} d={commands.join(" ")} fill="none" stroke={curve.color} strokeWidth="2.3" strokeLinejoin="round"/>; })}</g>
        <text x={margin.left+w/2} y={xTitleY} textAnchor="middle" className="lsv-axis-title" style={{fontSize:xTitleSize}}>{xLabel}</text><text transform={`translate(${yTitleX},${yTitleY}) rotate(-90)`} textAnchor="middle" className="lsv-axis-title" style={{fontSize:yTitleSize}}>{yLabel}</text>
        {legendInside&&active.length>0&&<g className="lsv-svg-legend" aria-label="样品图例" transform={`translate(${legendAbove?legendLeft:margin.left+10},${legendAbove?10:margin.top+10})`}><rect width={legendColumnWidth*legendColumns} height={legendHeight} fill="white" fillOpacity=".92" rx="4"/>{active.map((curve,index)=><g key={curve.id} data-legend-curve={curve.id} transform={`translate(${(index%legendColumns)*legendColumnWidth+9},${Math.floor(index/legendColumns)*legendRowHeight+19})`}><title>{curve.name}</title>{style==="scatter"?<circle cx="11" cy="-4" r="4" fill="white" stroke={curve.color} strokeWidth="1.8"/>:<line x1="0" x2="22" y1="-4" y2="-4" stroke={curve.color} strokeWidth="2.3"/>}<text x="30" fontSize="14" fill="#35516d">{legendName(curve.name)}</text></g>)}</g>}
        {hover && <g pointerEvents="none" data-plot-transient><line x1={hover.px} x2={hover.px} y1={margin.top} y2={margin.top+h} stroke="#9bacbc" strokeDasharray="4 4"/><circle cx={hover.px} cy={hover.py} r={5} stroke="white" strokeWidth={2} fill={hover.curve.color}/></g>}
        {drag && <rect data-plot-transient x={Math.min(drag.x0,drag.x1)} y={Math.min(drag.y0,drag.y1)} width={Math.abs(drag.x1-drag.x0)} height={Math.abs(drag.y1-drag.y0)} fill="#2374d520" stroke="#2374d5" strokeDasharray="5 3"/>}
      </svg>
      {(!points.length || error) && <div className="lsv-chart-empty"><span className="lsv-empty-mark">∿</span><strong>{error ? "暂时无法绘图" : "把你的数据放到这里"}</strong><p>{error || emptyText || (onFilesDrop?"直接拖入 TXT、BIN（辰华）、Excel（XLSX）、CSV、DAT 或 TSV 文件。":`上传文件或粘贴数据，即可生成可交互的${title}。`)}</p></div>}
      {fileOver&&<div className="lsv-drop-overlay" role="status"><strong>松开文件，导入数据</strong><span>可同时拖入多个文件</span></div>}
      {hover && <div className="lsv-tooltip" style={{ left: Math.max(8,Math.min(size.width-230,hover.px+18)), top: Math.max(8,Math.min(size.height-135,hover.py-88)) }}><strong style={{ color: hover.curve.color }}>{hover.curve.name}</strong><div>X <b>{fmt(hover.point.x)}</b></div><div>Y <b>{fmt(hover.point.y)}</b></div><small>原始第 {hover.point.index+1} 个数据点</small></div>}
      </div>
    </div>
    {showFooter&&<div className="lsv-plot-foot"><span>{onFilesDrop?"拖入文件导入 · ":""}拖动框选放大 · 双击复位 · 悬停读取数据</span><span>{points.length.toLocaleString()} 个有效点{view ? " · 已缩放" : ""}</span></div>}
  </div>;
}
