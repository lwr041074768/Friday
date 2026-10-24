"use client";
import { useMemo, useState } from "react";
import { Check, Palette } from "lucide-react";
import { OptionSelect } from "./lsv-import-dialog";
import OverpotentialFigure from "./overpotential-figure";
import { OVERPOTENTIAL_STYLES, OVERPOTENTIAL_STYLE_SOURCES, type OverpotentialStyle } from "@/lib/overpotential-styles";
import { defaultOverpotentialAxisSettings, resolveOverpotentialAxes } from "@/lib/overpotential-axes";
import type { OverpotentialRow } from "@/lib/overpotential-data";

const examples:OverpotentialRow[]=[240,320,280,370].map((etaMV,index)=>({
  curve:{id:`style-demo-${index}`,name:String.fromCharCode(65+index),color:["#2374d5","#e56a41","#179d83","#8961c6"][index],visible:true,unit:"A",resistance:"",area:"",compensation:"unknown",source:"样式缩略图示意",demo:true,points:[],plotted:[],invalid:0},
  reading:{status:"forward_crossing",etaMV,x:1.23+etaMV/1000,e:1.23+etaMV/1000,note:"样式示意",candidate:false},
}));
const exampleAxes=resolveOverpotentialAxes(examples,defaultOverpotentialAxisSettings);
export default function OverpotentialStyleGallery({selected,onSelect}:{selected:OverpotentialStyle;onSelect:(id:string)=>void}){
  const [group,setGroup]=useState("all"),groups=useMemo(()=>[...new Set(OVERPOTENTIAL_STYLES.map(style=>style.group))],[]);
  const styles=OVERPOTENTIAL_STYLES.filter(style=>group==="all"||style.group===group);
  return <section className="eta-style-panel" aria-label="柱状图样式">
    <div className="eta-panel-heading"><h2><Palette size={16}/>柱状图样式 <span>{OVERPOTENTIAL_STYLES.length}</span></h2><span>点击即应用</span></div>
    <div className="eta-style-filter"><OptionSelect label="柱状图样式分类" value={group} onChange={setGroup} options={[{value:"all",label:"全部样式"},...groups.map(value=>({value,label:value}))]}/><small>缩略图为示意</small></div>
    <div className="eta-style-grid" role="group" aria-label="选择柱状图样式">{styles.map(style=><button key={style.id} className="eta-style-tile" data-eta-style-option={style.id} aria-label={`应用样式：${style.name}`} aria-pressed={selected.id===style.id} title={style.description} onClick={()=>onSelect(style.id)}><span className="eta-style-thumbnail" aria-hidden="true"><OverpotentialFigure rows={examples} axes={exampleAxes} style={style} compact demo/></span><span className="eta-style-name">{style.name}{selected.id===style.id&&<Check size={13}/>}</span></button>)}</div>
    <div className="eta-style-description"><strong>{selected.name}</strong><p>{selected.description}</p><small>SVG 保留所选样式；Origin 导出可编辑标准柱图。</small><details><summary>设计来源</summary><div>{selected.sourceIds.map(id=>OVERPOTENTIAL_STYLE_SOURCES.find(source=>source.id===id)).filter(source=>!!source).map(source=><a key={source!.id} href={source!.url} target="_blank" rel="noreferrer">{source!.title}</a>)}<p>参考公开绘图库的填充、配色与坐标轴设计。</p></div></details></div>
  </section>;
}
