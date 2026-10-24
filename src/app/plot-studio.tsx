"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, FlaskConical } from "lucide-react";
import ElectrochemWorkspace from "./electrochem-workspace";
import XyWorkspace from "./xy-workspace";
import EisWorkspace from "./eis-workspace";
import { preventStaticTextCaret } from "@/lib/plot-ui";
const tabs=[{id:"lsv",label:"LSV"},{id:"eis",label:"EIS"},{id:"tafel",label:"Tafel"},{id:"xrd",label:"XRD"},{id:"raman",label:"Raman"}] as const;
const SOFTWARE_VERSION="1.0.0";
type Tab=typeof tabs[number]["id"];
type Transition={from:Tab;to:Tab;token:number;dx:number;dy:number;scale:number};
export default function PlotStudio(){
  const [tab,setTab]=useState<Tab>("lsv");
  const [transition,setTransition]=useState<Transition|null>(null),current=useRef<Tab>("lsv");
  const panels=useRef<Partial<Record<Tab,HTMLElement>>>({}),animation=useRef<Animation|null>(null),serial=useRef(0),visits=useRef<Record<string,number>>({});
  const changeTab=useCallback((next:Tab,animate=true)=>{
    if(current.current===next)return;
    const from=current.current;current.current=next;animation.current?.cancel();animation.current=null;
    const token=++serial.current,motion=animate&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(motion){
      const route=`${from}>${next}`,visit=visits.current[route]=(visits.current[route]??0)+1;
      const a=tabs.findIndex(t=>t.id===from),b=tabs.findIndex(t=>t.id===next);
      // Difference and sum give every directed route a distinct trajectory.
      // A nonperiodic phase varies revisits within a restrained scale range.
      const phase=(visit*.6180339887498949)%1;
      setTransition({from,to:next,token,dx:8*(b-a),dy:4*(a+b-4),scale:.984+.028*phase});
    }else setTransition(null);
    setTab(next);
  },[]);
  useLayoutEffect(()=>{
    if(!transition)return;
    const panel=panels.current[transition.to];if(!panel)return;
    const {dx,dy,scale,token}=transition;
    const running=panel.animate([
      {opacity:.2,transform:`translate(${dx}px,${dy}px) scale(${scale})`,offset:0},
      {opacity:.9,transform:`translate(${dx*.12}px,${dy*.12}px) scale(${1+(scale-1)*.12})`,offset:.6},
      {opacity:1,transform:"none",offset:1},
    ],{duration:1000,easing:"cubic-bezier(.2,.65,.25,1)",fill:"both"});
    animation.current=running;let active=true;
    void running.finished.then(()=>{if(active&&serial.current===token){animation.current=null;setTransition(null);}}).catch(()=>{});
    return()=>{active=false;running.cancel();if(animation.current===running)animation.current=null;};
  },[transition]);
  useEffect(()=>{const sync=(animate=true)=>{const value=location.hash.slice(1).toLowerCase();changeTab(tabs.some(t=>t.id===value)?value as Tab:"lsv",animate);};sync(false);const onHash=()=>sync();window.addEventListener("hashchange",onHash);const motion=window.matchMedia("(prefers-reduced-motion: reduce)");const onMotion=()=>{if(motion.matches){animation.current?.cancel();setTransition(null);}};motion.addEventListener("change",onMotion);return()=>{window.removeEventListener("hashchange",onHash);motion.removeEventListener("change",onMotion);animation.current?.cancel();};},[changeTab]);
  return <main className="lsv-app" onMouseDownCapture={preventStaticTextCaret}><header className="lsv-header"><a className="lsv-brand" href="#lsv" aria-label="科研绘图台首页"><span><Activity size={24}/></span><div>科研绘图台<span data-software-version={SOFTWARE_VERSION} style={{marginLeft:8,fontSize:11,fontWeight:500,letterSpacing:0,color:"#778697",whiteSpace:"nowrap"}}>v{SOFTWARE_VERSION}</span><small>SCIENTIFIC PLOT STUDIO</small></div></a><nav className="lsv-tabs" aria-label="绘图类型">{tabs.map(t=><a key={t.id} href={`#${t.id}`} className={tab===t.id?"active":""} aria-current={tab===t.id?"page":undefined} onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey)changeTab(t.id);}}>{t.label}<span>工作台</span></a>)}</nav><div className="lsv-header-note"><FlaskConical size={17}/>数据在你的浏览器中计算</div></header>
    {tabs.map(t=><section key={t.id} ref={node=>{if(node)panels.current[t.id]=node;else delete panels.current[t.id];}} id={`panel-${t.id}`} className={transition?.to===t.id?"studio-panel-entering":undefined} data-transition={transition?.to===t.id?`${transition.from}>${transition.to}`:undefined} data-transition-token={transition?.to===t.id?transition.token:undefined} aria-label={`${t.label} 工作台`} hidden={tab!==t.id}>{t.id==="lsv"||t.id==="tafel"?<ElectrochemWorkspace kind={t.id}/>:t.id==="eis"?<EisWorkspace/>:<XyWorkspace kind={t.id}/>}</section>)}
  </main>;
}
