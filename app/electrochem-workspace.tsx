"use client";
import {cleanFigureSvg} from "@/lib/figure-export";
import {useProjectState,useProjectEpoch} from "@/lib/project-state";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Download, Eye, EyeOff, Plus, SlidersHorizontal, Trash2, Upload, LockKeyhole } from "lucide-react";
import LsvPlot from "@/components/lsv-plot";
import LsvHelpDialog from "@/components/lsv-help-dialog";
import LsvEtaSummary from "@/components/lsv-eta-summary";
import LsvOriginExport from "@/components/lsv-origin-export";
import LsvImportDialog, { OptionSelect, UNIT_OPTIONS, type FileImportRequest } from "@/components/lsv-import-dialog";
import { demoCurves, INITIAL_X, INITIAL_Y, plotCurves, type Curve } from "@/lib/lsv-math";
import { selectScan, type ScanMode } from "@/lib/scan-branches";
import type { OverpotentialSnapshot } from "@/lib/overpotential-data";
import { buildTafelCsv, buildTafelFitCsv } from "@/lib/tafel-data-export";
import { useTafelAnalysis } from "@/components/tafel-analysis-tools";
import type { TafelFitResult } from "@/lib/tafel-analysis";
import type { PlotCurve } from "@/lib/lsv-math";
import { useDataBooks } from "@/components/data-book-panel";
import type { DataBookContext } from "@/lib/data-book";
type IrSettings={mode:"resistance"|"voltage";resistance:string;voltage:string};
const DEFAULT_IR:IrSettings={mode:"resistance",resistance:"0",voltage:"0"};
export default function ElectrochemWorkspace({kind="lsv",onSnapshotChange,active=true}:{kind?:"lsv"|"tafel";onSnapshotChange?:(snapshot:OverpotentialSnapshot)=>void;active?:boolean}) {
  const tafel=kind==="tafel",title=tafel?"Tafel":"LSV";
  const workspace=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=workspace.current,header=element?.closest(".lsv-app")?.querySelector<HTMLElement>(".lsv-header");
    if(!element||!header)return;
    const measure=()=>element.style.setProperty("--lsv-header-height",`${header.offsetHeight}px`);
    measure();const observer=new ResizeObserver(measure);observer.observe(header);
    return()=>observer.disconnect();
  },[tafel]);
  const [curves,setCurves]=useProjectState<Curve[]>(kind,'curves',[]),[samples,setSamples]=useProjectState<Curve[]>(kind,'samples',()=>demoCurves().map(c=>tafel?c:{...c,area:"1"})),[demoMode,setDemoMode]=useProjectState(kind,'demoMode',false);
  const [helpOpen,setHelpOpen]=useState(false),[fileRequest,setFileRequest]=useState<FileImportRequest>();
  function dropFiles(files:File[]){if(!files.length)return;setFileRequest(previous=>({id:(previous?.id??0)+1,files}));setImportOpen(true);}
  const [importOpen,setImportOpen]=useState(false),[draft,setDraft]=useProjectState<IrSettings>(kind,'draft',()=>tafel?DEFAULT_IR:{...DEFAULT_IR,mode:"voltage"}),[applied,setApplied]=useProjectState<IrSettings>(kind,'applied',()=>tafel?DEFAULT_IR:{...DEFAULT_IR,mode:"voltage"}),[individual,setIndividual]=useProjectState<Record<string,string>>(kind,'individual',{});
  const [message,setMessage]=useState(""),[irError,setIrError]=useState(""),[removed,setRemoved]=useState<{curve:Curve;index:number}|null>(null),[scan,setScan]=useProjectState<ScanMode>(kind,'scan',"all"),[density,setDensity]=useProjectState(kind,'density',false);
  const [exportError,setExportError]=useState("");
  const [voltageDrafts,setVoltageDrafts]=useProjectState<Record<string,string>>(kind,'voltageDrafts',{}),[voltageErrors,setVoltageErrors]=useState<Record<string,string>>({});
  const [xLabel,setXLabel]=useProjectState(kind,'xLabel',tafel?"log₁₀ |I / mA|":"Potential(-IR)vs.RHE(V)"),[yLabel,setYLabel]=useProjectState(kind,'yLabel',tafel?"过电位 η / V":"Current Density (mA cm⁻²)");
  const displayed=demoMode?samples:curves;
  const x=tafel?(density?"LOG(ABS(j))":"LOG(ABS(I * 1000))"):INITIAL_X;
  const y=tafel?"E - IR * I + 0.0592 * 13.65 + 0.197 - 1.23":INITIAL_Y;
  const result=useMemo(()=>plotCurves(displayed,{x,y,resistance:applied.resistance,fraction:"100",irMode:tafel?"resistance":"voltage",voltage:tafel?applied.voltage:"0"}),[displayed,x,y,applied,tafel]);
  const bookCurves=useMemo(()=>displayed.map(curve=>result.curves.find(item=>item.id===curve.id)??{...curve,plotted:[],invalid:curve.points.length,error:result.error}),[displayed,result.curves,result.error]);
  const selected=useMemo(()=>selectScan(result.curves,scan),[result.curves,scan]);
  const tafelAnalysis=useTafelAnalysis({enabled:tafel,curves:result.curves,scan,basis:density?"density":"current",datasetKey:demoMode?"demo":"user",onExportFit:saveFit});
  function saveFit(fit:TafelFitResult,curve:PlotCurve){
    try{
      setExportError("");const data=buildTafelFitCsv(fit,curve,{globalResistance:applied.resistance}),url=URL.createObjectURL(new Blob([data],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");
      link.href=url;link.download="Tafel-线性拟合结果.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(cause){setExportError(cause instanceof Error?cause.message:"拟合结果导出失败。");}
  }
  function saveTafel(kind:"csv"|"svg"){
    try{setExportError("");let data:string;
      if(kind==="csv")data=buildTafelCsv(result.curves,scan,{x,y},{x:xLabel,y:yLabel},{masks:tafelAnalysis.masks,fit:tafelAnalysis.fit,globalResistance:applied.resistance});
      else{
        const source=workspace.current?.querySelector<SVGSVGElement>('svg[data-testid="lsv-chart"]');if(!source)throw Error("暂无可导出的图形。");
        const {svg:clone}=cleanFigureSvg(source);
        if(tafelAnalysis.fit){
          const rows=workspace.current?.querySelectorAll<HTMLTableRowElement>('[data-testid="tafel-fit-table"] tr');
          if(rows?.length){
            const view=source.viewBox.baseVal,tableX=view.width+18,tableWidth=480,rowHeight=34,namespace="http://www.w3.org/2000/svg";
            const group=document.createElementNS(namespace,"g");group.setAttribute("data-testid","tafel-fit-export-table");group.setAttribute("font-family","Arial, Microsoft YaHei, sans-serif");
            rows.forEach((row,index)=>{
              const top=24+index*rowHeight,rect=document.createElementNS(namespace,"rect");rect.setAttribute("x",String(tableX));rect.setAttribute("y",String(top));rect.setAttribute("width",String(tableWidth));rect.setAttribute("height",String(rowHeight));rect.setAttribute("fill","white");rect.setAttribute("stroke","#8194a8");group.append(rect);
              [...row.cells].forEach((cell,column)=>{const text=document.createElementNS(namespace,"text");text.setAttribute("x",String(tableX+(column?180:10)));text.setAttribute("y",String(top+22));text.setAttribute("font-size",column?"12":"13");text.setAttribute("fill","#203c55");text.textContent=cell.textContent;group.append(text);});
            });
            const note=document.createElementNS(namespace,"text");note.setAttribute("x",String(tableX));note.setAttribute("y",String(24+rows.length*rowHeight+22));note.setAttribute("font-size","12");note.setAttribute("fill","#405a74");note.textContent="± 为 1 个标准误差（SE）；原始数据保留。";group.append(note);clone.append(group);
            const width=tableX+tableWidth+18,height=Math.max(view.height,rows.length*rowHeight+80);clone.setAttribute("viewBox",`0 0 ${width} ${height}`);clone.setAttribute("width",String(width));clone.setAttribute("height",String(height));
          }
        }else{clone.setAttribute("width",String(source.viewBox.baseVal.width));clone.setAttribute("height",String(source.viewBox.baseVal.height));}
        data=new XMLSerializer().serializeToString(clone);
      }
      const url=URL.createObjectURL(new Blob([data],{type:kind==="csv"?"text/csv;charset=utf-8":"image/svg+xml"}));const link=document.createElement("a");link.href=url;link.download=`Tafel.${kind}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(cause){setExportError(cause instanceof Error?cause.message:"Tafel 导出失败。");}
  }
  useEffect(()=>{
    if(!tafel)onSnapshotChange?.({curves:result.curves,scan,demo:demoMode});
  },[tafel,onSnapshotChange,result.curves,scan,demoMode]);
  const projectEpoch=useProjectEpoch();useEffect(()=>{if(projectEpoch){setMessage('');setIrError('');setExportError('');setVoltageErrors({});setImportOpen(false);setFileRequest(undefined);}},[projectEpoch]);
  const changed=JSON.stringify(draft)!==JSON.stringify(applied)||displayed.some(c=>(individual[c.id]??c.resistance)!==c.resistance);
  const bookContextForCurve=useCallback((curve:PlotCurve):DataBookContext=>({
    kind,scan,xFormula:x,yFormula:y,xLabel,yLabel,globalResistance:applied.resistance,
    maskedIndices:tafel?tafelAnalysis.masks[curve.id]:undefined,
    fitIndices:tafelAnalysis.fit?.curveId===curve.id?tafelAnalysis.fit.indices:undefined,
    irPending:tafel?JSON.stringify(draft)!==JSON.stringify(applied)||(individual[curve.id]??curve.resistance)!==curve.resistance:(voltageDrafts[curve.id]??curve.irVoltage??"0")!==(curve.irVoltage??"0"),
  }),[kind,scan,x,y,xLabel,yLabel,applied,draft,individual,tafel,tafelAnalysis.masks,tafelAnalysis.fit,voltageDrafts]);
  const dataBooks=useDataBooks({curves:bookCurves,kind,datasetKey:demoMode?"demo":"user",active,contextForCurve:bookContextForCurve});
  function changeCurve(id:string,patch:Partial<Curve>){(demoMode?setSamples:setCurves)(list=>list.map(c=>c.id===id?{...c,...patch}:c));}
  function applyIr(){
    const r=draft.resistance.trim()?Number(draft.resistance):NaN,v=draft.voltage.trim()?Number(draft.voltage):NaN;
    if((draft.mode==="resistance"&&(!Number.isFinite(r)||r<0))||(draft.mode==="voltage"&&!Number.isFinite(v))){setIrError(draft.mode==="resistance"?"请输入大于或等于 0 的电阻（Ω）。":"请输入有限的带符号电压降（V）。");return;}
    if(draft.mode==="resistance"&&displayed.some(c=>{const s=individual[c.id]??c.resistance;return s.trim()&&(!Number.isFinite(Number(s))||Number(s)<0);})){setIrError("每条曲线的电阻需为大于或等于 0 的数值；空白时跟随全局。");return;}
    (demoMode?setSamples:setCurves)(list=>list.map(c=>({...c,resistance:individual[c.id]??c.resistance})));
    setApplied({...draft});setIrError("");setMessage("IR 已应用，图形已按原始数据重新计算。");
  }
  function removeCurve(id:string){const index=curves.findIndex(c=>c.id===id);if(index>=0){setRemoved({curve:curves[index],index});setCurves(list=>list.filter(c=>c.id!==id));}}
  function applyCurveIr(curve:Curve){
    const raw=voltageDrafts[curve.id]??curve.irVoltage??"0",value=raw.trim()?Number(raw):NaN;
    if(!Number.isFinite(value)){setVoltageErrors(errors=>({...errors,[curve.id]:"请输入有效的 IR 数值，支持带符号的小数。"}));return;}
    if(curve.compensation==="corrected"&&value!==0){setVoltageErrors(errors=>({...errors,[curve.id]:"该样品的原数据已补偿，IR 应设为 0，避免重复补偿。"}));return;}
    const irVoltage=String(value);
    changeCurve(curve.id,{irVoltage});
    setVoltageDrafts(values=>({...values,[curve.id]:irVoltage}));
    setVoltageErrors(errors=>({...errors,[curve.id]:""}));
    setMessage(`${curve.name} 的 IR 已应用：${irVoltage}。该曲线已按原始数据重新计算。`);
  }
  const curveIrControls=displayed.length?<div className="lsv-sample-ir"><div className="lsv-sample-ir-heading">IR</div><div className="lsv-sample-ir-list">{displayed.map((curve,index)=>{
    const value=voltageDrafts[curve.id]??curve.irVoltage??"0",appliedVoltage=curve.irVoltage??"0",pending=value!==appliedVoltage,inputId=`lsv-ir-${curve.id}`,error=voltageErrors[curve.id];
    return <div className="lsv-compact-ir" key={curve.id} data-ir-curve-id={curve.id} role="group" aria-label={`${curve.name} IR 调整`}>
      <label htmlFor={inputId}><span className="lsv-ir-swatch" style={{backgroundColor:curve.color}} aria-hidden="true"/><span className="lsv-ir-name" title={curve.name}>{index+1}. {curve.name}</span></label>
      <div className="lsv-compact-ir-row"><input id={inputId} aria-label={`${curve.name} IR`} aria-describedby={`${inputId}-status`} aria-invalid={!!error} type="number" step="any" inputMode="decimal" value={value} onChange={e=>{setVoltageDrafts(values=>({...values,[curve.id]:e.target.value}));setVoltageErrors(errors=>({...errors,[curve.id]:""}));}} onKeyDown={e=>{if(e.key==="Enter")applyCurveIr(curve);}}/><button className="lsv-button primary" onClick={()=>applyCurveIr(curve)}>确定</button></div>
      <small id={`${inputId}-status`} role="status">{pending?`待确认 · 已应用 ${appliedVoltage}`:`已应用 ${appliedVoltage}`}</small>{error&&<div className="lsv-error" role="alert">{error}</div>}
    </div>;
  })}</div></div>:null;
  const scanTools=<div className="lsv-scan-controls" role="group" aria-label="扫描方向">
    <button aria-pressed={scan==="up"} onClick={()=>setScan("up")}><span>{tafel?"正向":"氧化峰"}</span><small>正向扫描</small></button>
    <button aria-pressed={scan==="down"} onClick={()=>setScan("down")}><span>{tafel?"反向":"还原峰"}</span><small>反向扫描</small></button>
    <button aria-pressed={scan==="all"} onClick={()=>setScan("all")} className="lsv-scan-all">全部</button>
  </div>;
  const curveManager=<section className="lsv-curves-panel">
    <div className="lsv-curves-heading"><h2>曲线管理 <span>{displayed.length} / 20</span></h2><button className="lsv-add-pair" onClick={()=>setImportOpen(true)} disabled={curves.length>=20}><Plus size={15}/>添加曲线</button></div>
    {displayed.length?<><div className="lsv-curve-columns"><span>显示 / 名称 / 颜色</span><span>原始单位</span></div>
      {displayed.map(c=><div className={`lsv-managed-curve ${c.visible?"":"hidden-curve"}`} key={c.id}>
        <div className="lsv-curve-row">
          <button aria-label={`${c.visible?"隐藏":"显示"} ${c.name}`} onClick={()=>changeCurve(c.id,{visible:!c.visible})}>{c.visible?<Eye size={17}/>:<EyeOff size={17}/>}</button>
          <input type="color" className="lsv-color-input" aria-label={`${c.name}颜色`} value={c.color} onChange={e=>changeCurve(c.id,{color:e.target.value})}/>
          <input aria-label={`${c.name}名称`} value={c.name} onChange={e=>changeCurve(c.id,{name:e.target.value})}/>
          {tafel&&<OptionSelect label={`${c.name}原始单位`} value={c.unit} onChange={v=>changeCurve(c.id,{unit:v as Curve["unit"]})} options={UNIT_OPTIONS}/>}
          {!demoMode&&<button className="lsv-delete-curve" aria-label={`删除 ${c.name}`} onClick={()=>removeCurve(c.id)}><Trash2 size={16}/></button>}
        </div>
        {dataBooks.controlsFor(bookCurves.find(curve=>curve.id===c.id)!)}
        {tafel&&<label className="tafel-curve-resistance">单独 Rs（Ω）<input className="lsv-r-input" type="number" min="0" step="any" placeholder="跟随全局" aria-label={`${c.name}电阻`} value={individual[c.id]??c.resistance} onChange={e=>setIndividual(m=>({...m,[c.id]:e.target.value}))}/></label>}
        {tafel&&<details className="lsv-curve-details" open={density}>
          <summary>{c.source} · {c.points.length.toLocaleString()} 个点{c.compensation==="corrected"?" · 原数据已补偿":c.compensation==="unknown"?" · 补偿状态待核对":""}</summary>
          <div><label>电极面积 S（cm²）<input type="number" min="0" step="any" aria-label={`${c.name}面积`} placeholder="用于电流密度换算" value={c.area} onChange={e=>changeCurve(c.id,{area:e.target.value})}/></label><label>原数据补偿状态<OptionSelect label={`${c.name}补偿状态`} value={c.compensation} onChange={v=>changeCurve(c.id,{compensation:v as Curve["compensation"]})} options={[{value:"unknown",label:"不确定"},{value:"raw",label:"未补偿"},{value:"corrected",label:"已补偿"}]}/></label></div>
        </details>}
        {result.curves.find(p=>p.id===c.id)?.error&&<p className="lsv-warning">{result.curves.find(p=>p.id===c.id)?.error}</p>}
        {!!result.curves.find(p=>p.id===c.id)?.invalid&&<p className="lsv-warning">{result.curves.find(p=>p.id===c.id)?.invalid} 个点无效，已保留为曲线缺口{tafel?"；零电流无法取对数":""}。</p>}
      </div>)}
    </>:<p className="lsv-subtle">尚未导入曲线。一次最多绘制 20 条 {title}。</p>}
    {removed&&!demoMode&&<div className="lsv-undo">已移除 {removed.curve.name}<button disabled={curves.length>=20} onClick={()=>{setCurves(list=>{const next=[...list];next.splice(Math.min(removed.index,next.length),0,removed.curve);return next;});setRemoved(null);}}>撤销</button></div>}
  </section>;
  const workspaceHeading=<div className="lsv-heading">
    <div><div className="lsv-eyebrow">ELECTROCHEMISTRY / {tafel?"03":"01"}</div><h1>{title} 曲线绘制</h1></div>
    <div className="lsv-heading-actions"><button className="lsv-button secondary" onClick={()=>setDemoMode(v=>!v)}><Activity size={17}/>{demoMode?"返回我的数据":"体验示例"}</button><button className="lsv-button primary" onClick={()=>setImportOpen(true)}><Upload size={17}/>导入数据</button></div>
    <p>{tafel?"导入数据，确认 Rs，查看电流对数与过电位曲线。":"导入数据，确认 IR，切换正向或反向扫描曲线。"}</p>
  </div>;
  const tafelExports=<div className="lsv-eta-panel tafel-export-panel">
    <div className="tafel-export-heading"><strong>Tafel 曲线</strong><span>全局 Rs：{applied.resistance} Ω</span></div>
    <div className="tafel-export-actions"><button className="lsv-button secondary" disabled={!displayed.length} onClick={()=>saveTafel("csv")}><Download size={16}/>导出数据</button><button className="lsv-button secondary" disabled={!selected.curves.some(c=>c.visible&&c.plotted.some(p=>p!==null))} onClick={()=>saveTafel("svg")}><Download size={16}/>导出图形 SVG</button></div>
    {tafelAnalysis.controls}
  </div>;
  return <div ref={workspace} className={`lsv-workspace lsv-raised-workspace lsv-viewport-workspace${tafel?" tafel-workspace":""}`}>
    <div className="lsv-layout lsv-compact-layout">
      <aside className="lsv-controls">
        {workspaceHeading}
        <section className="lsv-control-section lsv-formula-card">
          <div className="lsv-section-title">{tafel?<span className="lsv-section-number">01</span>:<button className="lsv-help-button" aria-label="LSV 基础知识" title="LSV 基础知识" onClick={()=>setHelpOpen(true)}>?</button>}<h2>绘图公式</h2><LockKeyhole size={16}/></div>
          <div className="lsv-field">X 轴公式<div className="lsv-formula-display" aria-label="X 轴公式">{tafel?x:x.replace(/\s/g, "").replace(/\*/g, "×")}</div></div>
          <div className="lsv-field">Y 轴公式<div className="lsv-formula-display" aria-label="Y 轴公式">{tafel?y:y.replace(/\s/g, "").replace(/\*/g, "×")}</div></div>
          {tafel?<>
            <label className="lsv-field lsv-tafel-basis">横轴计算<OptionSelect label="Tafel 横轴计算" value={density?"density":"current"} onChange={v=>{setDensity(v==="density");setXLabel(v==="density"?"log₁₀ |j / (mA cm⁻²)|":"log₁₀ |I / mA|");}} options={[{value:"current",label:"总电流 I（按原公式）"},{value:"density",label:"电流密度 j（需电极面积）"}]}/></label>
            <details className="tafel-formula-help"><summary>公式与单位说明</summary><div className="lsv-formula-note"><b>E</b> 原始电位（V）<br/><b>I</b> 换算后的总电流（A）<br/><b>IR</b> = 电阻 Rs（Ω）；<b>S</b> = 面积（cm²）</div><p className="lsv-subtle">公式已固定。原式减去 1.23，所得纵轴为过电位 η。参比电极仍需核对。</p></details>
          </>:curveIrControls}
        </section>
        {tafel&&<>
          <section className="lsv-control-section lsv-ir-section tafel-ir-card">
            <div className="lsv-section-title"><SlidersHorizontal size={19}/><h2>IR 调整</h2></div>
            <label className="lsv-field" htmlFor="tafel-global-rs">全局电阻 Rs（Ω）</label>
            <div className="lsv-compact-ir-row"><input id="tafel-global-rs" aria-label="IR 电阻 Rs" type="number" min="0" step="any" value={draft.resistance} onChange={e=>setDraft(d=>({...d,resistance:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyIr();}}/><button className="lsv-button primary" onClick={applyIr}>确定</button></div>
            <p className="lsv-ir-status" role="status">{changed?"有待应用的修改，点击确定后更新图形。":`当前已应用：${applied.resistance} Ω`}</p>
            {irError&&<div className="lsv-error" role="alert">{irError}</div>}
            <p className="lsv-subtle">单独 Rs 在曲线管理中填写，留空时跟随全局；修改后点击确定应用。</p>
          </section>
          <details className="lsv-control-section tafel-axis-settings"><summary>坐标标题</summary><div><label className="lsv-field">X 轴标题<input value={xLabel} onChange={e=>setXLabel(e.target.value)} aria-label="X 轴标题"/></label><label className="lsv-field">Y 轴标题<input value={yLabel} onChange={e=>setYLabel(e.target.value)} aria-label="Y 轴标题"/></label></div></details>
        </>}
      </aside>
      <div className="lsv-results">
        {exportError&&<div className="lsv-error" role="alert">{exportError}</div>}
        {demoMode&&<div className="lsv-demo-notice"><Activity size={16}/>当前为模拟数据，仅用于体验操作。</div>}
        {message&&!demoMode&&<div className="lsv-import-message" role="status">{message}</div>}
        <LsvPlot projectScope={`${kind}.plot`} compactToolbar squarePlot showFooter={false} leftPanel={curveManager} rightPanel={tafel?tafelAnalysis.resultPanel:undefined} analysis={tafelAnalysis.analysis} notice={selected.missing.length?`${selected.missing.join("、")}：未发现${scan==="up"?"正向":"反向"}扫描段，或电位保持不变。`:undefined} onFilesDrop={dropFiles} curves={tafel?tafelAnalysis.chartCurves:selected.curves} xLabel={xLabel} yLabel={yLabel} error={result.error} title={`${title} 曲线`} legendInside axisControls summary={tafel?tafelExports:<LsvEtaSummary curves={result.curves} scan={scan} action={<LsvOriginExport curves={result.curves} scan={scan}/>}/>} toolbar={scanTools} emptyText={selected.missing.length?`所选数据没有${scan==="up"?"正向":"反向"}扫描段。点击“全部”可恢复完整曲线。`:undefined}/>
      </div>
    </div>
    {dataBooks.panel}
    {!tafel&&<LsvHelpDialog open={helpOpen} onOpenChange={setHelpOpen}/>}
    <LsvImportDialog fileRequest={fileRequest} open={importOpen} onOpenChange={setImportOpen} existingCount={curves.length} title={title} onAdd={(newCurves,note)=>{setCurves(list=>[...list,...newCurves.map(curve=>tafel?curve:{...curve,irVoltage:"0",area:curve.area.trim()?curve.area:"1"})]);setDemoMode(false);setMessage(note);}}/>
  </div>;
}
