"use client";

import {useEffect,useState} from "react";
import {axisTicks,DEFAULT_TICKS,type PlotTickSettings} from "@/lib/plot-ticks";

export type CdlPlotBounds={x0:number;x1:number;y0:number;y1:number};
export type CdlFigureSettings={bounds:CdlPlotBounds|null;ticks:PlotTickSettings};
export const DEFAULT_CDL_FIGURE_SETTINGS:CdlFigureSettings={bounds:null,ticks:DEFAULT_TICKS};

export function CdlRangeControls({label,settings,onChange}:{label:string;settings:CdlFigureSettings;onChange:(settings:CdlFigureSettings)=>void}){
  const [draft,setDraft]=useState({x0:"",x1:"",y0:"",y1:""}),[error,setError]=useState("");
  useEffect(()=>{setDraft({x0:settings.bounds?.x0.toString()??"",x1:settings.bounds?.x1.toString()??"",y0:settings.bounds?.y0.toString()??"",y1:settings.bounds?.y1.toString()??""});},[settings.bounds]);
  function apply(){
    const next={} as CdlPlotBounds;
    for(const key of ["x0","x1","y0","y1"] as const){if(!draft[key].trim()){setError("请填写两轴的完整范围，或点击恢复自动范围。");return;}next[key]=Number(draft[key]);}
    if(!Object.values(next).every(Number.isFinite)||next.x0>=next.x1||next.y0>=next.y1){setError("每个坐标轴的最大值必须大于最小值，且均为有限数值。");return;}
    try{axisTicks(next.x0,next.x1,settings.ticks.x);axisTicks(next.y0,next.y1,settings.ticks.y);}catch(issue){setError((issue as Error).message);return;}
    onChange({...settings,bounds:next});setError("");
  }
  return <div className="cdl-axis-setting-group"><h4>{label}</h4><div className="cdl-axis-range-grid">{(["x","y"] as const).map(axis=><fieldset key={axis}><legend>{axis.toUpperCase()} 轴</legend>{(["0","1"] as const).map((side,index)=>{const key=`${axis}${side}` as keyof CdlPlotBounds;return <label key={key}>{index?"最大值":"最小值"}<input type="number" step="any" placeholder="自动" aria-label={`${label} ${axis.toUpperCase()} 轴${index?"最大值":"最小值"}`} value={draft[key]} onChange={event=>setDraft(old=>({...old,[key]:event.target.value}))} onKeyDown={event=>{if(event.key==="Enter")apply();}}/></label>;})}</fieldset>)}</div><div className="cdl-axis-setting-actions"><button type="button" className="lsv-button secondary" onClick={()=>{onChange({...settings,bounds:null});setDraft({x0:"",x1:"",y0:"",y1:""});setError("");}}>恢复自动范围</button><button type="button" className="lsv-button primary" onClick={apply}>应用{label}范围</button></div>{error&&<p className="lsv-error" role="alert">{error}</p>}</div>;
}

export function CdlTickControls({label,settings,onChange}:{label:string;settings:CdlFigureSettings;onChange:(settings:CdlFigureSettings)=>void}){
  const fromSettings=()=>({x:{step:settings.ticks.x.step?.toString()??"",anchor:String(settings.ticks.x.anchor),minorCount:String(settings.ticks.x.minorCount)},y:{step:settings.ticks.y.step?.toString()??"",anchor:String(settings.ticks.y.anchor),minorCount:String(settings.ticks.y.minorCount)}});
  const [draft,setDraft]=useState(fromSettings),[error,setError]=useState("");
  useEffect(()=>{setDraft(fromSettings());},[settings.ticks]);
  function apply(){
    const ticks={} as PlotTickSettings;
    for(const axis of ["x","y"] as const){
      const values=draft[axis],step=values.step.trim()?Number(values.step):undefined,anchor=values.anchor.trim()?Number(values.anchor):NaN,minorCount=values.minorCount.trim()?Number(values.minorCount):NaN;
      if(step!==undefined&&(!Number.isFinite(step)||step<=0)){setError(`${axis.toUpperCase()} 轴主刻度间隔需大于 0；留空为自动。`);return;}
      if(!Number.isFinite(anchor)||!Number.isInteger(minorCount)||minorCount<0||minorCount>20){setError("锚点需为有限数值，次刻度数量需为 0～20 的整数。");return;}
      ticks[axis]={step,anchor,minorCount};
      if(settings.bounds)try{axisTicks(settings.bounds[`${axis}0`],settings.bounds[`${axis}1`],ticks[axis]);}catch(issue){setError((issue as Error).message);return;}
    }
    onChange({...settings,ticks});setError("");
  }
  return <div className="cdl-axis-setting-group"><h4>{label}</h4><div className="cdl-axis-tick-grid">{(["x","y"] as const).map(axis=><fieldset key={axis}><legend>{axis.toUpperCase()} 轴</legend>{([{key:"step",label:"主刻度间隔"},{key:"anchor",label:"锚点"},{key:"minorCount",label:"次刻度数量"}] as const).map(field=><label key={field.key}>{field.label}<input type="number" step={field.key==="minorCount"?1:"any"} min={field.key==="minorCount"?0:undefined} max={field.key==="minorCount"?20:undefined} aria-label={`${label} ${axis.toUpperCase()} 轴${field.label}`} placeholder={field.key==="step"?"自动":undefined} value={draft[axis][field.key]} onChange={event=>setDraft(old=>({...old,[axis]:{...old[axis],[field.key]:event.target.value}}))} onKeyDown={event=>{if(event.key==="Enter")apply();}}/></label>)}</fieldset>)}</div><div className="cdl-axis-setting-actions"><button type="button" className="lsv-button secondary" onClick={()=>{onChange({...settings,ticks:DEFAULT_TICKS});setError("");}}>恢复自动刻度</button><button type="button" className="lsv-button primary" onClick={apply}>应用{label}刻度</button></div>{error&&<p className="lsv-error" role="alert">{error}</p>}</div>;
}
