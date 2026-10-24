"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, X } from "lucide-react";
import { DEFAULT_TICKS, type PlotTickSettings } from "@/lib/plot-ticks";

type Draft = { step: string; anchor: string; minorCount: string };
const initial = (): Record<"x" | "y", Draft> => ({ x: { step: "", anchor: "0", minorCount: "1" }, y: { step: "", anchor: "0", minorCount: "1" } });
export default function PlotTickSettingsPanel({ onApply, floating=false, settings=DEFAULT_TICKS }: { onApply: (settings: PlotTickSettings) => string | undefined; floating?:boolean; settings?:PlotTickSettings }) {
  const [draft, setDraft] = useState(initial), [error, setError] = useState("");
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
      const fields = draft[axis], step = fields.step.trim() ? Number(fields.step) : undefined;
      if (step !== undefined && (!Number.isFinite(step) || step <= 0)) { setError(`${axis.toUpperCase()} 轴主刻度间隔需大于 0，留空为自动。`); return; }
      const anchor = fields.anchor.trim() ? Number(fields.anchor) : NaN, minorCount = fields.minorCount.trim() ? Number(fields.minorCount) : NaN;
      next[axis] = { step, anchor, minorCount };
    }
    setError(onApply(next) ?? "");
  }
  const fields=<div className="lsv-tick-settings-body">
    <div className="lsv-tick-fields">{(["x", "y"] as const).map(axis => <fieldset key={axis}><legend>{axis.toUpperCase()} 轴</legend>
      {([{ key: "step", label: "主刻度间隔", placeholder: "自动", step: "any" }, { key: "anchor", label: "锚点", step: "any" }, { key: "minorCount", label: "次刻度数量", step: "1" }] as const).map(field => <label key={field.key}>{field.label}<input type="number" step={field.step} min={field.key === "minorCount" ? 0 : undefined} max={field.key === "minorCount" ? 20 : undefined} aria-label={`${axis.toUpperCase()} 轴${field.label}`} placeholder={field.key === "step" ? "自动" : undefined} value={draft[axis][field.key]} onChange={event => setDraft(old => ({ ...old, [axis]: { ...old[axis], [field.key]: event.target.value } }))} onKeyDown={event => { if (event.key === "Enter") apply(); }}/></label>)}
    </fieldset>)}</div>
    <div className="lsv-tick-actions"><small>次刻度数量为每两个主刻度之间的短刻线数；主刻度间隔留空为自动。</small><button className="lsv-button secondary" onClick={() => { const issue = onApply(DEFAULT_TICKS); if (!issue) setDraft(initial()); setError(issue ?? ""); }}>恢复自动刻度</button><button className="lsv-button primary" onClick={apply}>应用刻度</button></div>
    {error && <div className="lsv-error" role="alert">{error}</div>}
  </div>;
  if(!floating)return <details className="lsv-tick-settings"><summary>主 / 次刻度</summary>{fields}</details>;
  return <div className="lsv-tick-control">
    <div className="lsv-tick-control-heading"><strong>主刻度 / 次刻度</strong><button ref={trigger} className="lsv-button secondary" aria-expanded={open} aria-controls={id} onClick={()=>open?close():setOpen(true)}>修改刻度</button></div>
    <div className="lsv-tick-overview">{(['x','y'] as const).map(axis=><div key={axis}><b>{axis.toUpperCase()} 轴</b><span>主刻度：{settings[axis].step??'自动'}</span><span>次刻度：{settings[axis].minorCount}</span></div>)}</div>
    {open&&<div ref={windowRef} id={id} className="lsv-tick-window" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={{left:position?.x??8,top:position?.y??8}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
      <div className="lsv-tick-window-header"><div className="lsv-tick-window-grip" role="button" tabIndex={0} aria-label="移动刻度设置窗口" title="拖动标题栏移动窗口" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();const point=localPoint(event),element=windowRef.current!;drag.current={pointer:event.pointerId,dx:point.x-element.offsetLeft,dy:point.y-element.offsetTop};event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.focus({preventScroll:true});}} onPointerMove={event=>{if(drag.current?.pointer!==event.pointerId)return;const point=localPoint(event);setPosition(constrain(point.x-drag.current.dx,point.y-drag.current.dy));}} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={event=>{const moves:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const move=moves[event.key];if(move){event.preventDefault();const step=event.shiftKey?30:10;setPosition(old=>constrain((old?.x??8)+move[0]*step,(old?.y??8)+move[1]*step));}}}><GripHorizontal size={17}/><strong id={`${id}-title`}>主刻度 / 次刻度</strong></div><button className="lsv-tick-window-close" aria-label="关闭刻度设置" onClick={close}><X size={18}/></button></div>
      <div className="lsv-tick-window-content">{fields}</div>
    </div>}
  </div>;
}
