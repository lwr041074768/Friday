"use client";
import { useMemo, useState } from "react";
import { Activity, Eye, EyeOff, LockKeyhole, Plus, Trash2, Upload } from "lucide-react";
import XyImportDialog from "@/components/xy-import-dialog";
import LsvPlot from "@/components/lsv-plot";
import { OptionSelect } from "@/components/lsv-import-dialog";
import { COLORS, type Curve, type PlotCurve } from "@/lib/lsv-math";
type Kind="eis"|"xrd"|"raman";
function examples(kind:Kind):Curve[]{return [0,1,2].map(n=>({id:`${kind}-demo-${n}`,name:`模拟样品 ${String.fromCharCode(65+n)}`,color:COLORS[n],visible:true,unit:"A",resistance:"",area:"",compensation:"raw",source:"模拟数据 · 用于体验操作",demo:true,imaginary:"raw",points:Array.from({length:161},(_,i)=>{
  if(kind==="eis"){const t=.025+(Math.PI-.05)*i/160,r=2+n*.65;return {e:1+r*(1-Math.cos(t)),current:-r*Math.sin(t)};}
  const e=kind==="xrd"?10+i*.5:100+i*7,centers=kind==="xrd"?[30,36,44,58,64]:[220,330,475,620,790];
  return {e,current:25+centers.reduce((s,c,k)=>s+(200+(k%2)*100+n*50)*Math.exp(-(((e-c-n*.6)/(kind==="xrd"?1.2:15))**2)),0)};
})}));}
export default function XyWorkspace({kind}:{kind:Kind}) {
  const title=kind==="raman"?"Raman":kind.toUpperCase(),eis=kind==="eis";
  const [curves,setCurves]=useState<Curve[]>([]),[samples,setSamples]=useState<Curve[]>(()=>examples(kind)),[demo,setDemo]=useState(false),[open,setOpen]=useState(false),[message,setMessage]=useState("");
  const [stack,setStack]=useState(false),[offset,setOffset]=useState("500"),[normalize,setNormalize]=useState(false),[style,setStyle]=useState<"scatter"|"line">("scatter");
  const [xLabel,setXLabel]=useState(eis?"Z′ / Ω":kind==="xrd"?"2θ / °":"Raman shift / cm⁻¹"),[yLabel,setYLabel]=useState(eis?"−Z″ / Ω":"Intensity / a.u.");
  const displayed=demo?samples:curves;
  const result=useMemo(()=>{
    if(!eis&&stack&&(!offset.trim()||!Number.isFinite(Number(offset))||Number(offset)<0))return {curves:[] as PlotCurve[],error:"堆叠间距需为大于或等于 0 的数值。"};
    let visibleIndex=0;
    return {curves:displayed.map((c):PlotCurve=>{
      let magnitude=0;for(const p of c.points)magnitude=Math.max(magnitude,Math.abs(p.current));
      const shift=stack&&c.visible?visibleIndex*Number(offset):0;if(c.visible)visibleIndex++;
      return {...c,invalid:0,plotted:c.points.map((p,index)=>({x:p.e,y:eis?(c.imaginary==="negative"?p.current:-p.current):(normalize&&magnitude?p.current/magnitude:p.current)+shift,e:p.e,current:p.current,index}))};
    }),error:undefined};
  },[displayed,eis,stack,offset,normalize]);
  function change(id:string,patch:Partial<Curve>){(demo?setSamples:setCurves)(list=>list.map(c=>c.id===id?{...c,...patch}:c));}
  const formulaX=eis?"Z′":kind==="xrd"?"2θ":"Raman shift";
  const formulaY=eis?"−Z″（已取负的列保持不变）":`${normalize?"Intensity / max(|Intensity|)":"Intensity"}${stack?" + n × 堆叠间距":""}`;
  return <div className="lsv-workspace"><div className="lsv-heading"><div><div className="lsv-eyebrow">{eis?"ELECTROCHEMISTRY / 02":"SPECTROSCOPY"}</div><h1>{title} {eis?"Nyquist 绘图":"谱图绘制"}</h1><p>{eis?"选择实部、虚部和符号约定，比较阻抗曲线。":"导入谱图，在叠加与堆叠视图间切换。"}</p></div><div className="lsv-heading-actions"><button className="lsv-button secondary" onClick={()=>setDemo(v=>!v)}><Activity size={17}/>{demo?"返回我的数据":"体验示例"}</button><button className="lsv-button primary" onClick={()=>setOpen(true)}><Upload size={17}/>导入数据</button></div></div>
    <div className="lsv-layout"><aside className="lsv-controls"><section className="lsv-control-section"><div className="lsv-section-title"><span className="lsv-section-number">01</span><h2>坐标公式</h2><LockKeyhole size={16}/></div><div className="lsv-field">X 轴公式<div className="lsv-formula-display" aria-label="X 轴公式">{formulaX}</div></div><div className="lsv-field">Y 轴公式<div className="lsv-formula-display" aria-label="Y 轴公式">{formulaY}</div></div><p className="lsv-subtle">{eis?"默认显示阻抗 Ω。面积归一化的单位需另外核对；保留虚部正负号，不取绝对值。":"保留原始位置、强度和点序；堆叠只改变显示位置。"}</p></section>
    <section className="lsv-control-section"><div className="lsv-section-title"><span className="lsv-section-number">02</span><h2>{eis?"绘图样式":"谱图排列"}</h2></div>{eis?<label className="lsv-field">曲线样式<OptionSelect label="EIS 曲线样式" value={style} onChange={v=>setStyle(v as typeof style)} options={[{value:"scatter",label:"空心圆点（参考图样式）"},{value:"line",label:"连接线"}]}/></label>:<><label className="lsv-field">排列方式<OptionSelect label={`${title} 排列方式`} value={stack?"stack":"overlay"} onChange={v=>setStack(v==="stack")} options={[{value:"overlay",label:"叠加比较"},{value:"stack",label:"上下堆叠"}]}/></label><label className="lsv-field">强度处理<OptionSelect label={`${title} 强度处理`} value={normalize?"normalize":"raw"} onChange={v=>{const n=v==="normalize";setNormalize(n);setYLabel(n?"Normalized intensity / a.u.":"Intensity / a.u.");if(stack)setOffset(n?"1.2":"500");}} options={[{value:"raw",label:"保留原始强度"},{value:"normalize",label:"每条曲线按最大绝对值归一化"}]}/></label>{stack&&<label className="lsv-field">堆叠间距<input aria-label={`${title} 堆叠间距`} type="number" step="any" min="0" value={offset} onChange={e=>setOffset(e.target.value)}/></label>}</>}</section>
    <section className="lsv-control-section"><div className="lsv-section-title"><span className="lsv-section-number">03</span><h2>坐标标题</h2></div><label className="lsv-field">X 轴标题<input aria-label="X 轴标题" value={xLabel} onChange={e=>setXLabel(e.target.value)}/></label><label className="lsv-field">Y 轴标题<input aria-label="Y 轴标题" value={yLabel} onChange={e=>setYLabel(e.target.value)}/></label></section></aside>
    <div className="lsv-results">{demo&&<div className="lsv-demo-notice"><Activity size={16}/>当前为模拟数据，仅用于体验操作。</div>}{message&&!demo&&<div className="lsv-import-message" role="status">{message}</div>}<LsvPlot curves={result.curves} xLabel={xLabel} yLabel={yLabel} error={result.error} title={`${title} ${eis?"Nyquist 图":stack?"堆叠图":"谱图"}`} style={eis?style:"line"}/>
      <section className="lsv-curves-panel"><div className="lsv-curves-heading"><h2>曲线管理 <span>{displayed.length} / 10</span></h2><button className="lsv-add-pair" onClick={()=>setOpen(true)} disabled={curves.length>=10}><Plus size={15}/>添加曲线</button></div>{displayed.length?displayed.map(c=><div className="lsv-managed-curve" key={c.id}><div className="lsv-curve-row"><button aria-label={`${c.visible?"隐藏":"显示"} ${c.name}`} onClick={()=>change(c.id,{visible:!c.visible})}>{c.visible?<Eye size={17}/>:<EyeOff size={17}/>}</button><input type="color" className="lsv-color-input" aria-label={`${c.name}颜色`} value={c.color} onChange={e=>change(c.id,{color:e.target.value})}/><input aria-label={`${c.name}名称`} value={c.name} onChange={e=>change(c.id,{name:e.target.value})}/>{!demo&&<button aria-label={`删除 ${c.name}`} onClick={()=>setCurves(list=>list.filter(v=>v.id!==c.id))}><Trash2 size={16}/></button>}</div><div className="lsv-xy-source">{c.source} · {c.points.length.toLocaleString()} 个点{eis&&<OptionSelect label={`${c.name}虚部符号`} value={c.imaginary??"raw"} onChange={v=>change(c.id,{imaginary:v as Curve["imaginary"]})} options={[{value:"raw",label:"原始 Z″（绘图取负）"},{value:"negative",label:"已经是 −Z″（保留）"}]}/>}</div></div>):<p className="lsv-subtle">尚未导入数据。最多同时绘制 10 条曲线。</p>}</section>
    </div></div><section className="lsv-data-panel"><div><h2>导入 {title} 数据</h2><p>支持 TXT、CSV、TSV、DAT、XLSX 和粘贴数据，可手动选择坐标列。</p></div><button className="lsv-button secondary" onClick={()=>setOpen(true)} disabled={curves.length>=10}><Upload size={17}/>选择数据</button></section><footer className="lsv-footer"><span>科研绘图台 · {title}</span><span>切换绘图页保留数据；刷新前请保留原始文件。</span></footer>
    <XyImportDialog kind={kind} open={open} onOpenChange={setOpen} existingCount={curves.length} onAdd={(added,note)=>{setCurves(list=>[...list,...added]);setDemo(false);setMessage(note);}}/>
  </div>;
}
