"use client";
import {cleanFigureSvg} from "@/lib/figure-export";
import {useEffect as useProjectEffect} from "react";
import {useProjectState,useProjectEpoch} from "@/lib/project-state";


import { useMemo, useRef, useState } from "react";
import { Activity, Download, Eye, EyeOff, Plus, Settings2, Trash2, Upload } from "lucide-react";
import LsvPlot from "@/components/lsv-plot";
import { useEisCircuitFit } from "@/components/eis-analysis-panel";
import XyImportDialog from "@/components/xy-import-dialog";
import XyOriginExport from "@/components/xy-origin-export";
import { OptionSelect, type FileImportRequest } from "@/components/lsv-import-dialog";
import { COLORS, type Curve } from "@/lib/lsv-math";
import { buildEisCsv, plotEisCurves } from "@/lib/eis-data";
import EisContour from "@/components/eis-contour";
import EisBode from "@/components/eis-bode";
import {buildEisBode,buildEisBodeCsv,type EisBodeView,type EisBodePhaseSign} from "@/lib/eis-bode";
import { buildEisContourGrid, buildEisContourCsv, gridCsv, prepareEisSpectra, type EisSpectrum, type EisContourQuantity } from "@/lib/eis-contour";
import "./eis-contour-workspace.css";

function examples(): EisSpectrum[] {
  return [.2,.3,.4,.43,.5,.6].map((potential,n) => ({ id: `eis-demo-${n}`, name: `EIS-${potential} V`,eisGroup:"模拟样品",eisPotential:String(potential),
    color: COLORS[n], visible: true, unit: "A", resistance: "", area: "", compensation: "unknown", imaginary: "raw",
    source: "模拟数据 · 用于体验操作", demo: true,
    points: Array.from({ length: 81 }, (_, i) => {
      const frequency=10**(5-7*i/80),resistance=30+15*n,omegaRC=2*Math.PI*frequency*resistance*.0004;
      return { e: 2+resistance/(1+omegaRC**2), current: -resistance*omegaRC/(1+omegaRC**2),frequency };
    }),
  }));
}

export default function EisWorkspace() {
  const [curves, setCurves] = useProjectState<EisSpectrum[]>('eis','curves',[]), [samples, setSamples] = useProjectState<EisSpectrum[]>('eis','samples',examples);
  const [demo, setDemo] = useProjectState('eis','demo',false), [open, setOpen] = useState(false), [message, setMessage] = useState("");
  const [fileRequest, setFileRequest] = useState<FileImportRequest>();
  const [style, setStyle] = useProjectState<"scatter" | "line">('eis','style',"scatter"), [equalUnits, setEqualUnits] = useProjectState('eis','equalUnits',true);
  const [xLabel, setXLabel] = useProjectState('eis','xLabel',"Z′ / Ω"), [yLabel, setYLabel] = useProjectState('eis','yLabel',"−Z″ / Ω");
  const [mode,setMode]=useProjectState<"nyquist"|"contour"|"bode">('eis','mode','nyquist');
  const [bodeView,setBodeView]=useProjectState<EisBodeView>('eis','bodeView','both');
  const [bodePhaseSign,setBodePhaseSign]=useProjectState<EisBodePhaseSign>('eis','bodePhaseSign','negative');
  const [contourGroup,setContourGroup]=useProjectState('eis','contourGroup','');
  const [quantity,setQuantity]=useProjectState<EisContourQuantity>('eis','contourQuantity','log-imag');
  const [palette,setPalette]=useProjectState('eis','contourPalette','viridis');
  const [bands,setBands]=useProjectState('eis','contourBands',24);
  const [removed, setRemoved] = useState<{ curve: Curve; index: number } | null>(null);
  const [exportError, setExportError] = useState("");
  const projectEpoch=useProjectEpoch();useProjectEffect(()=>{if(projectEpoch){setMessage('');setExportError('');setOpen(false);setFileRequest(undefined);setRemoved(null);}},[projectEpoch]);
  const canvas = useRef<HTMLDivElement>(null);
  const displayed = demo ? samples : curves;
  const spectra=useMemo(()=>prepareEisSpectra(displayed),[displayed]);
  const groups=useMemo(()=>[...new Set(spectra.map(c=>c.eisGroup??"样品1"))],[spectra]);
  const groupOptions=useMemo(()=>groups.map(group=>({value:group,label:group.replace(/\\/g,'/').split('/').filter(Boolean).at(-1)||group})),[groups]);
  const selectedGroup=groups.includes(contourGroup)?contourGroup:groups[0]??"";
  const grid=useMemo(()=>buildEisContourGrid(spectra,selectedGroup,quantity),[spectra,selectedGroup,quantity]);
  const bode=useMemo(()=>buildEisBode(spectra,selectedGroup),[spectra,selectedGroup]);
  const basePlotted = useMemo(() => plotEisCurves(displayed), [displayed]);
  const eisFit = useEisCircuitFit(displayed, true);
  const plotted = useMemo(() => eisFit.overlay ? [...basePlotted, eisFit.overlay] : basePlotted, [basePlotted, eisFit.overlay]);
  function change(id: string, patch: Partial<EisSpectrum>) { (demo ? setSamples : setCurves)(list => list.map(c => c.id === id ? { ...c, ...patch } : c)); }
  function drop(files: File[]) { if (!files.length) return; setFileRequest(last => ({ id: (last?.id ?? 0) + 1, files })); setOpen(true); }
  function remove(id: string) {
    const index = curves.findIndex(c => c.id === id);
    if (index < 0) return;
    setRemoved({ curve: curves[index], index }); setCurves(list => list.filter(c => c.id !== id));
  }
  function download(text: string, mime: string, filename: string) {
    const url = URL.createObjectURL(new Blob([text], { type: mime })), link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }
  function exportData() {
    try { download(buildEisCsv(displayed), "text/csv;charset=utf-8", "EIS-数据.csv"); setExportError(""); }
    catch (e) { setExportError((e as Error).message); }
  }
  function exportFigure() {
    try {
      const source = canvas.current?.querySelector(mode==="bode"?"svg[data-testid='eis-bode']":mode==="contour"?"svg[data-testid='eis-contour']":"svg[data-testid='lsv-chart']");
      if (!source) throw new Error("尚无可导出的图形。");
      const {svg:clone}=cleanFigureSvg(source as SVGSVGElement);
      download(new XMLSerializer().serializeToString(clone), "image/svg+xml;charset=utf-8", mode==="bode"?"EIS-原位Bode.svg":mode==="contour"?"EIS-原位等高线.svg":"EIS-Nyquist.svg"); setExportError("");
    } catch (e) { setExportError((e as Error).message); }
  }
  const tools = <div className="eis-chart-tools"><div className="eis-style-controls" role="group" aria-label="EIS 曲线样式">
    <button aria-pressed={style === "scatter"} onClick={() => setStyle("scatter")}>散点</button><button aria-pressed={style === "line"} onClick={() => setStyle("line")}>连线</button>
  </div><button className="lsv-button secondary" disabled={!displayed.length} onClick={exportData}><Download size={15}/>导出数据</button>
    <button className="lsv-button secondary" disabled={!displayed.some(c => c.visible)} onClick={exportFigure}><Download size={15}/>导出图形</button><XyOriginExport kind="eis" curves={basePlotted} xLabel={xLabel} yLabel={yLabel} plotStyle={style} equalUnits={equalUnits}/></div>;
  const contourTools=<div className="eis-chart-tools"><button className="lsv-button secondary" disabled={!spectra.length} onClick={()=>{try{download(buildEisContourCsv(spectra,quantity),'text/csv;charset=utf-8','EIS-原位完整数据.csv');setExportError('');}catch(e){setExportError((e as Error).message);}}}><Download size={15}/>导出原始数据</button><button className="lsv-button secondary" disabled={!!grid.error||!grid.x.length} onClick={()=>{try{download(gridCsv(grid),'text/csv;charset=utf-8','EIS-原位显示网格.csv');setExportError('');}catch(e){setExportError((e as Error).message);}}}>导出网格</button><button className="lsv-button secondary" disabled={!!grid.error||!grid.x.length} onClick={exportFigure}><Download size={15}/>导出 SVG</button></div>;
  const bodeTools=<div className="eis-chart-tools"><button className="lsv-button secondary" disabled={!spectra.length} onClick={()=>{try{download(buildEisBodeCsv(spectra),'text/csv;charset=utf-8','EIS-原位Bode完整数据.csv');setExportError('');}catch(e){setExportError((e as Error).message);}}}><Download size={15}/>导出 Bode 数据</button><button className="lsv-button secondary" disabled={!bode.series.length||!!bode.error} onClick={exportFigure}><Download size={15}/>导出 SVG</button></div>;
  return <div className="lsv-workspace lsv-raised-workspace eis-workspace"><div className="lsv-layout lsv-compact-layout">
    <aside className="lsv-controls"><div className="lsv-heading"><div><div className="lsv-eyebrow">ELECTROCHEMISTRY / 02</div><h1>EIS 曲线绘制</h1></div><div className="lsv-heading-actions">
      <button className="lsv-button secondary" onClick={() => {if(!demo)setSamples(examples());setDemo(v => !v);}}><Activity size={15}/>{demo ? "返回我的数据" : "体验示例"}</button>
      <button className="lsv-button primary" onClick={() => setOpen(true)} disabled={curves.length >= 80}><Upload size={15}/>导入数据</button></div><p>同一批 EIS 数据，切换查看三种图形。</p><div className="eis-view-switch" role="group" aria-label="EIS 图形类型"><button aria-pressed={mode==='nyquist'} onClick={()=>setMode('nyquist')}>Nyquist</button><button aria-pressed={mode==='contour'} onClick={()=>setMode('contour')}>原位等高线</button><button aria-pressed={mode==='bode'} onClick={()=>setMode('bode')}>原位 Bode</button></div></div>
      {mode!=='nyquist'&&<section className="eis-contour-options" aria-label="原位 EIS 设置">
        <label>样品组<OptionSelect label="原位 EIS 样品组" value={selectedGroup} onChange={setContourGroup} options={groupOptions.length?groupOptions:[{value:'',label:'导入后选择'}]}/></label>
        {mode==='contour'&&<>
        <label>颜色数据<OptionSelect label="原位 EIS 颜色数据" value={quantity} onChange={v=>setQuantity(v as EisContourQuantity)} options={[{value:'log-imag',label:'log₁₀(|Z″| / Ω)'},{value:'log-modulus',label:'log₁₀(|Z| / Ω)'}]}/></label>
        <div className="eis-contour-option-row"><label>配色<OptionSelect label="原位 EIS 配色" value={palette} onChange={setPalette} options={[{value:'viridis',label:'蓝绿黄'},{value:'warm',label:'蓝黄红'}]}/></label><label>等高线级数<OptionSelect label="原位 EIS 等高线级数" value={String(bands)} onChange={v=>setBands(Number(v))} options={[16,24,32,48].map(n=>({value:String(n),label:String(n)}))}/></label></div>
        <small>按实测电位排列，在共同频率区间内显示。每条曲线下方可调整样品组和电位。</small>
        </>}
        {mode==='bode'&&<>
          <label>显示内容<OptionSelect label="Bode 显示内容" value={bodeView} onChange={v=>setBodeView(v as EisBodeView)} options={[{value:'both',label:'模值与相位双图'},{value:'phase',label:'相位角'},{value:'magnitude',label:'阻抗模值'}]}/></label>
          <label>相位符号<OptionSelect label="Bode 相位符号" value={bodePhaseSign} onChange={v=>setBodePhaseSign(v as EisBodePhaseSign)} options={[{value:'negative',label:'−φ（负相位角）'},{value:'signed',label:'φ（原始相位角）'}]}/></label>
          <small>按实测频率显示各电位的阻抗模值与相位。样品组和电位与等高线共用。</small>
        </>}
      </section>}
      <section className="lsv-curves-panel"><div className="lsv-curves-heading"><h2>曲线管理 <span>{displayed.length} / 80</span></h2><button className="lsv-add-pair" onClick={() => setOpen(true)} disabled={curves.length >= 80}><Plus size={15}/>添加曲线</button></div>
        {spectra.length ? spectra.map(c => <div className={`lsv-managed-curve ${c.visible ? "" : "hidden-curve"}`} key={c.id}><div className="lsv-curve-row">
          <button aria-label={`${c.visible ? "隐藏" : "显示"} ${c.name}`} onClick={() => change(c.id, { visible: !c.visible })}>{c.visible ? <Eye size={17}/> : <EyeOff size={17}/>}</button>
          <input type="color" className="lsv-color-input" aria-label={`${c.name}颜色`} value={c.color} onChange={e => change(c.id, { color: e.target.value })}/>
          <input aria-label={`${c.name}名称`} value={c.name} onChange={e => change(c.id, { name: e.target.value })}/>
          {!demo && <button className="lsv-delete-curve" aria-label={`删除 ${c.name}`} onClick={() => remove(c.id)}><Trash2 size={16}/></button>}</div>
          {mode!=='nyquist'&&<div className="eis-spectrum-identity"><label>样品组<input aria-label={`${c.name}样品组`} value={c.eisGroup??''} onChange={e=>change(c.id,{eisGroup:e.target.value})}/></label><label>电位 / V<input type="number" step="any" aria-label={`${c.name}电位`} placeholder="填写电位" value={c.eisPotential??''} onChange={e=>change(c.id,{eisPotential:e.target.value})}/></label></div>}
          <details className="lsv-curve-details"><summary>{c.points.length} 个点 · 数据详情</summary><div className="eis-source-details"><p>{c.source}</p><label>导入的虚部列<OptionSelect label={`${c.name}虚部符号`} value={c.imaginary ?? "raw"} onChange={v => change(c.id, { imaginary: v as Curve["imaginary"] })} options={[{ value: "raw", label: "原始 Z″（绘图取负）" }, { value: "negative", label: "已取负 −Z″（保持不变）" }]}/></label><small>显示单位：Ω · 保留原始点序和正负号</small></div></details></div>) : <p className="lsv-subtle">拖入文件或点击导入，最多管理 80 条谱线。</p>}
        {removed && !demo && <div className="lsv-undo">已移除 {removed.curve.name}<button disabled={curves.length >= 80} onClick={() => { setCurves(list => { const next = [...list]; next.splice(Math.min(removed.index, next.length), 0, removed.curve); return next; }); setRemoved(null); }}>撤销</button></div>}
      </section>
      <div hidden={mode!=='nyquist'}>{eisFit.controls}</div>
      <details className="eis-settings" hidden={mode!=='nyquist'}><summary><Settings2 size={16}/>图形设置</summary><div><label className="lsv-field">X 轴标题<input aria-label="EIS X 轴标题" value={xLabel} onChange={e => setXLabel(e.target.value)}/></label><label className="lsv-field">Y 轴标题<input aria-label="EIS Y 轴标题" value={yLabel} onChange={e => setYLabel(e.target.value)}/></label><label className="eis-equal-units"><input type="checkbox" checked={equalUnits} onChange={e => setEqualUnits(e.target.checked)}/>X、Y 轴每 Ω 等比例</label><p>绘图区保持正方形；等比例开启时，较短轴自动向正方向扩展至相同跨度。</p></div></details>
      <details className="eis-settings eis-help"><summary>EIS 导入说明</summary><div><p>辰华 TXT 或兼容 EIS BIN 可直接读取；Excel、Origin 导出的 TXT / CSV 可选择多组 Z′、Z″ 列。</p><p>OPJU 请先在 Origin 导出工作表；PNG 用作图形参考，不能替代原始数据。</p><p>实部为 Z′，纵轴为 −Z″。频率、模值和相位不能代替实部或虚部。等效电路拟合需要频率列，参数解释须核对实验条件与模型。</p><p>导出数据包含全部曲线和完整点序；拟合参数与逐点残差通过“导出拟合报告”单独保存。导出图形保存当前视图，可在矢量软件中编辑。</p></div></details>
    </aside>
    <div className="lsv-results" ref={canvas}>{demo && <div className="lsv-demo-notice"><Activity size={16}/>当前为模拟数据，仅用于体验操作。</div>}{message && !demo && <div className="lsv-import-message" role="status">{message}</div>}{exportError && <div className="lsv-error" role="alert">{exportError}</div>}
      <div className="eis-chart-view" hidden={mode!=='nyquist'}><LsvPlot projectScope="eis.plot" curves={plotted} xLabel={xLabel} yLabel={yLabel} title="EIS · Nyquist" compactToolbar style={style} legendInside legendRight squarePlot axisControls fillCanvas equalUnits={equalUnits} showFooter={false} toolbar={tools} rightPanel={eisFit.resultPanel} onFilesDrop={drop} emptyText="拖入 TXT、兼容辰华 EIS BIN、Excel、CSV、DAT 或 TSV，也可粘贴数据。"/></div>
      <div className="eis-chart-view" hidden={mode!=='contour'}><EisContour grid={grid} bands={bands} palette={palette} colorLabel={quantity==='log-modulus'?'log₁₀(|Z| / Ω)':'log₁₀(|Z″| / Ω)'} onFilesDrop={drop} toolbar={contourTools}/></div>
      <div className="eis-chart-view" hidden={mode!=='bode'}><EisBode data={bode} view={bodeView} phaseSign={bodePhaseSign} onFilesDrop={drop} toolbar={bodeTools}/></div>
    </div>
  </div><XyImportDialog kind="eis" fileRequest={fileRequest} open={open} onOpenChange={setOpen} existingCount={curves.length} onAdd={(added, note) => { setCurves(list => [...list, ...prepareEisSpectra(added)]); setDemo(false); setMessage(note); }}/></div>;
}
