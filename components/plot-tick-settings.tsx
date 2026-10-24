"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, Settings2, X } from "lucide-react";
import { DEFAULT_TICKS, type AxisScale, type PlotTickSettings } from "@/lib/plot-ticks";

type Draft = { step: string; anchor: string; minorCount: string; scale: AxisScale; breakFrom: string; breakTo: string };
const initial = (): Record<"x" | "y", Draft> => ({ x: { step: "", anchor: "0", minorCount: "1", scale: "linear", breakFrom: "", breakTo: "" }, y: { step: "", anchor: "0", minorCount: "1", scale: "linear", breakFrom: "", breakTo: "" } });
export default function PlotTickSettingsPanel({ onApply, floating=false, sidebar=false, embedded=false, settings=DEFAULT_TICKS }: { onApply: (settings: PlotTickSettings) => string | undefined; floating?:boolean; sidebar?:boolean; embedded?:boolean; settings?:PlotTickSettings }) {
  const fromSettings=()=>Object.fromEntries((["x","y"] as const).map(axis=>[axis,{step:settings[axis].step===undefined?"":String(settings[axis].step),anchor:String(settings[axis].anchor),minorCount:String(settings[axis].minorCount),scale:(settings[axis].scale==="log10"?"log10":settings[axis].scale==="reciprocal"?"reciprocal":"linear") as AxisScale,breakFrom:settings[axis].break?String(settings[axis].break.from):"",breakTo:settings[axis].break?String(settings[axis].break.to):""}])) as Record<"x"|"y",Draft>;
  const [draft, setDraft] = useState(fromSettings), [error, setError] = useState("");
  useEffect(()=>{setDraft(fromSettings());setError("");},[settings]);
  const [open,setOpen]=useState(false),[position,setPosition]=useState<{x:number;y:number}|null>(null);
  const trigger=useRef<HTMLButtonElement>(null),windowRef=useRef<HTMLDivElement>(null),drag=useRef<{pointer:number;dx:number;dy:number}|null>(null);
  const id=useId();
  function constrain(x:number,y:number) {
    const element=windowRef.current,parent=element?.offsetParent as HTMLElement|null;
    if(!element||!parent||parent.clientWidth<=0||parent.clientHeight<=0)return {x,y};
    const rect=parent.getBoundingClientRect(),scaleX=rect.width/parent.offsetWidth,scaleY=rect.height/parent.offsetHeight;
    const maxX=Math.max(8,parent.clientWidth-element.offsetWidth-8),maxY=Math.max(8,parent.clientHeight-element.offsetHeight-8);
    const left=Math.max(8,(8-rect.left)/scaleX),right=Math.min(maxX,(window.innerWidth-8-rect.left)/scaleX-element.offsetWidth);
    const top=Math.max(8,(8-rect.top)/scaleY),bottom=Math.min(maxY,(window.innerHeight-8-rect.top)/scaleY-element.offsetHeight);
    return {x:Math.max(right>=left?left:8,Math.min(x,right>=left?right:maxX)),y:Math.max(bottom>=top?top:8,Math.min(y,bottom>=top?bottom:maxY))};
  }
  function localPoint(event:React.PointerEvent) {
    const parent=windowRef.current?.offsetParent as HTMLElement|null;
    if(!parent)return {x:event.clientX,y:event.clientY};
    const rect=parent.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*parent.offsetWidth/rect.width,y:(event.clientY-rect.top)*parent.offsetHeight/rect.height};
  }
  function close(){drag.current=null;setOpen(false);trigger.current?.focus({preventScroll:true});}
  useLayoutEffect(()=>{
    if(!open||!floating)return;
    const element=windowRef.current,parent=element?.offsetParent as HTMLElement|null;
    if(!element||!parent)return;
    const button=trigger.current?.getBoundingClientRect(),rect=parent.getBoundingClientRect();
    setPosition(old=>constrain(old?.x??((button?.left??rect.left)-rect.left),old?.y??((button?.bottom??rect.top)-rect.top+10)));
    element.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});
    const resize=()=>{if(parent.clientHeight>0)element.style.maxHeight=`${Math.min(520,parent.clientHeight-16,window.innerHeight-24)}px`;setPosition(old=>old?constrain(old.x,old.y):old);};
    resize();
    const observer=new ResizeObserver(resize);observer.observe(parent);observer.observe(element);
    window.addEventListener('resize',resize);document.addEventListener('fullscreenchange',resize);
    return()=>{observer.disconnect();window.removeEventListener('resize',resize);document.removeEventListener('fullscreenchange',resize);drag.current=null;};
  },[open,floating]);
  function apply() {
    const next = {} as PlotTickSettings;
    for (const axis of ["x", "y"] as const) {
      const fields = draft[axis], scale: AxisScale = fields.scale === "log10" ? "log10" : fields.scale === "reciprocal" ? "reciprocal" : "linear";
      const step = fields.step.trim() ? Number(fields.step) : undefined;
      if (scale === "linear" && step !== undefined && (!Number.isFinite(step) || step <= 0)) { setError(`${axis.toUpperCase()} 轴主刻度间隔需大于 0，留空为自动。`); return; }
      const anchor = fields.anchor.trim() ? Number(fields.anchor) : scale === "log10" ? 0 : NaN;
      const minorCount = fields.minorCount.trim() ? Number(fields.minorCount) : scale === "log10" ? 1 : NaN;
      const breakFrom = fields.breakFrom.trim(), breakTo = fields.breakTo.trim();
      let axisBreak: { from: number; to: number } | undefined;
      if (axis === "y" && (breakFrom || breakTo)) {
        if (!breakFrom || !breakTo) { setError("Y 轴断轴需同时填写起点和终点。"); return; }
        if (scale !== "linear") { setError("断轴目前只支持线性 Y 轴。"); return; }
        const from = Number(breakFrom), to = Number(breakTo);
        if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) { setError("断轴终点需大于起点。"); return; }
        axisBreak = { from, to };
      }
      next[axis] = { step, anchor, minorCount, scale, ...(axisBreak ? { break: axisBreak } : {}) };
    }
    setError(onApply(next) ?? "");
  }
  const fields=<div className="lsv-tick-settings-body">
    <div className="lsv-tick-fields">{(["x", "y"] as const).map(axis => { const log = draft[axis].scale === "log10"; return <fieldset key={axis}><legend>{axis.toUpperCase()} 轴</legend>
      <label>轴类型<select className="lsv-select" aria-label={`${axis.toUpperCase()} 轴类型`} value={draft[axis].scale} onChange={event => { const scale: AxisScale = event.target.value === "log10" ? "log10" : event.target.value === "reciprocal" ? "reciprocal" : "linear"; setDraft(old => ({ ...old, [axis]: { ...old[axis], scale } })); }}><option value="linear">线性</option>{draft[axis].scale === "log10" && <option value="log10">对数（旧项目，建议改回线性）</option>}<option value="reciprocal">倒数（1/x）</option></select></label>
      {([{ key: "step", label: "主刻度间隔", placeholder: "自动", step: "any" }, { key: "anchor", label: "锚点", step: "any" }, { key: "minorCount", label: "次刻度数量", step: "1" }] as const).map(field => <label key={field.key}>{field.label}<input type="number" step={field.step} min={field.key === "minorCount" ? 0 : undefined} max={field.key === "minorCount" ? 20 : undefined} disabled={log} aria-label={`${axis.toUpperCase()} 轴${field.label}`} placeholder={field.key === "step" ? "自动" : undefined} value={draft[axis][field.key]} onChange={event => setDraft(old => ({ ...old, [axis]: { ...old[axis], [field.key]: event.target.value } }))} onKeyDown={event => { if (event.key === "Enter") apply(); }}/></label>)}
      {log && <small className="lsv-tick-scale-note">对数轴按 10 的整数次幂生成主刻度，次刻度为 2–9；间隔、锚点与次刻度数量不适用。</small>}
      {draft[axis].scale === "reciprocal" && <small className="lsv-tick-scale-note">倒数轴按数据值生成刻度，位置按 1/x 变换；坐标范围不能跨 0。</small>}
      {axis === "y" && <div className="lsv-tick-break"><strong>Y 轴断轴</strong><label>起点<input type="number" step="any" disabled={log} aria-label="Y 轴断轴起点" placeholder="留空不断开" value={draft[axis].breakFrom} onChange={event => setDraft(old => ({ ...old, [axis]: { ...old[axis], breakFrom: event.target.value } }))}/></label><label>终点<input type="number" step="any" disabled={log} aria-label="Y 轴断轴终点" placeholder="留空不断开" value={draft[axis].breakTo} onChange={event => setDraft(old => ({ ...old, [axis]: { ...old[axis], breakTo: event.target.value } }))}/></label><small>只压缩中间区间，两侧刻度各自生成；仅支持线性 Y 轴，且不能与双 Y 轴同时使用。</small></div>}
    </fieldset>; })}</div>
    <div className="lsv-tick-actions"><small>次刻度数量为每两个主刻度之间的短刻线数；主刻度间隔留空为自动。</small><button className="lsv-button secondary" onClick={() => { const issue = onApply(DEFAULT_TICKS); if (!issue) setDraft(initial()); setError(issue ?? ""); }}>恢复自动刻度</button><button className="lsv-button primary" onClick={apply}>应用刻度</button></div>
    {error && <div className="lsv-error" role="alert">{error}</div>}
  </div>;
  if(embedded)return fields;
  if(!floating)return <details className={`lsv-tick-settings${sidebar?" xrd-settings xrd-tick-settings":""}`}><summary>{sidebar&&<Settings2 size={16}/>}主 / 次刻度</summary>{fields}</details>;
  return <div className="lsv-tick-control">
    <div className="lsv-tick-control-heading"><strong>主刻度 / 次刻度</strong><button ref={trigger} className="lsv-button secondary" aria-expanded={open} aria-controls={id} onClick={()=>open?close():setOpen(true)}>修改刻度</button></div>
    <div className="lsv-tick-overview">{(['x','y'] as const).map(axis=><div key={axis}><b>{axis.toUpperCase()} 轴</b><span>主刻度：{settings[axis].step??'自动'}</span><span>次刻度：{settings[axis].minorCount}</span></div>)}</div>
    {open&&<div ref={windowRef} id={id} className="lsv-tick-window" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={{left:position?.x??8,top:position?.y??8}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
      <div className="lsv-tick-window-header"><div className="lsv-tick-window-grip" role="button" tabIndex={0} aria-label="移动刻度设置窗口" title="拖动标题栏移动窗口" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();const point=localPoint(event),element=windowRef.current!;drag.current={pointer:event.pointerId,dx:point.x-element.offsetLeft,dy:point.y-element.offsetTop};event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.focus({preventScroll:true});}} onPointerMove={event=>{if(drag.current?.pointer!==event.pointerId)return;const point=localPoint(event);setPosition(constrain(point.x-drag.current.dx,point.y-drag.current.dy));}} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={event=>{const moves:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const move=moves[event.key];if(move){event.preventDefault();const step=event.shiftKey?30:10;setPosition(old=>constrain((old?.x??8)+move[0]*step,(old?.y??8)+move[1]*step));}}}><GripHorizontal size={17}/><strong id={`${id}-title`}>主刻度 / 次刻度</strong></div><button className="lsv-tick-window-close" aria-label="关闭刻度设置" onClick={close}><X size={18}/></button></div>
      <div className="lsv-tick-window-content">{fields}</div>
    </div>}
  </div>;
}
