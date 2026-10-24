"use client";

import { useMemo, useRef, useState } from "react";
import { Activity, Download, Eye, EyeOff, Plus, Settings2, Trash2, Upload } from "lucide-react";
import LsvPlot from "@/components/lsv-plot";
import XyImportDialog from "@/components/xy-import-dialog";
import { OptionSelect, type FileImportRequest } from "@/components/lsv-import-dialog";
import { COLORS, type Curve } from "@/lib/lsv-math";
import { buildEisCsv, plotEisCurves } from "@/lib/eis-data";

function examples(): Curve[] {
  return [0, 1, 2].map(n => ({ id: `eis-demo-${n}`, name: `模拟样品 ${String.fromCharCode(65 + n)}`,
    color: COLORS[n], visible: true, unit: "A", resistance: "", area: "", compensation: "unknown", imaginary: "raw",
    source: "模拟数据 · 用于体验操作", demo: true,
    points: Array.from({ length: 81 }, (_, i) => {
      const angle = Math.PI * i / 80, radius = 1.2 + n * .55;
      return { e: 1 + radius * (1 - Math.cos(angle)), current: -radius * Math.sin(angle) };
    }),
  }));
}

export default function EisWorkspace() {
  const [curves, setCurves] = useState<Curve[]>([]), [samples, setSamples] = useState(examples);
  const [demo, setDemo] = useState(false), [open, setOpen] = useState(false), [message, setMessage] = useState("");
  const [fileRequest, setFileRequest] = useState<FileImportRequest>();
  const [style, setStyle] = useState<"scatter" | "line">("scatter"), [equalUnits, setEqualUnits] = useState(true);
  const [xLabel, setXLabel] = useState("Z′ / Ω"), [yLabel, setYLabel] = useState("−Z″ / Ω");
  const [removed, setRemoved] = useState<{ curve: Curve; index: number } | null>(null);
  const [exportError, setExportError] = useState("");
  const canvas = useRef<HTMLDivElement>(null);
  const displayed = demo ? samples : curves;
  const plotted = useMemo(() => plotEisCurves(displayed), [displayed]);
  function change(id: string, patch: Partial<Curve>) { (demo ? setSamples : setCurves)(list => list.map(c => c.id === id ? { ...c, ...patch } : c)); }
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
      const source = canvas.current?.querySelector("svg[data-testid='lsv-chart']");
      if (!source) throw new Error("尚无可导出的图形。");
      const clone = source.cloneNode(true) as SVGSVGElement;
      const [, , width, height] = (source.getAttribute("viewBox") ?? "").split(/\s+/);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", width); clone.setAttribute("height", height);
      clone.querySelectorAll("[data-plot-transient]").forEach(element => element.remove());
      const font = document.createElementNS("http://www.w3.org/2000/svg", "style");
      font.textContent = "text{font-family:Arial,Microsoft YaHei,sans-serif;fill:#26384b}.lsv-axis-title{font-weight:500}";
      clone.insertBefore(font, clone.firstChild);
      download(new XMLSerializer().serializeToString(clone), "image/svg+xml;charset=utf-8", "EIS-Nyquist.svg"); setExportError("");
    } catch (e) { setExportError((e as Error).message); }
  }
  const tools = <div className="eis-chart-tools"><div className="eis-style-controls" role="group" aria-label="EIS 曲线样式">
    <button aria-pressed={style === "scatter"} onClick={() => setStyle("scatter")}>散点</button><button aria-pressed={style === "line"} onClick={() => setStyle("line")}>连线</button>
  </div><button className="lsv-button secondary" disabled={!displayed.length} onClick={exportData}><Download size={15}/>导出数据</button>
    <button className="lsv-button secondary" disabled={!displayed.some(c => c.visible)} onClick={exportFigure}><Download size={15}/>导出图形</button></div>;
  return <div className="lsv-workspace lsv-raised-workspace eis-workspace"><div className="lsv-layout lsv-compact-layout">
    <aside className="lsv-controls"><div className="lsv-heading"><div><div className="lsv-eyebrow">ELECTROCHEMISTRY / 02</div><h1>EIS 曲线绘制</h1></div><div className="lsv-heading-actions">
      <button className="lsv-button secondary" onClick={() => setDemo(v => !v)}><Activity size={15}/>{demo ? "返回我的数据" : "体验示例"}</button>
      <button className="lsv-button primary" onClick={() => setOpen(true)} disabled={curves.length >= 10}><Upload size={15}/>导入数据</button></div><p>导入阻抗数据，比较 Nyquist 曲线。</p></div>
      <section className="lsv-curves-panel"><div className="lsv-curves-heading"><h2>曲线管理 <span>{displayed.length} / 10</span></h2><button className="lsv-add-pair" onClick={() => setOpen(true)} disabled={curves.length >= 10}><Plus size={15}/>添加曲线</button></div>
        {displayed.length ? displayed.map(c => <div className={`lsv-managed-curve ${c.visible ? "" : "hidden-curve"}`} key={c.id}><div className="lsv-curve-row">
          <button aria-label={`${c.visible ? "隐藏" : "显示"} ${c.name}`} onClick={() => change(c.id, { visible: !c.visible })}>{c.visible ? <Eye size={17}/> : <EyeOff size={17}/>}</button>
          <input type="color" className="lsv-color-input" aria-label={`${c.name}颜色`} value={c.color} onChange={e => change(c.id, { color: e.target.value })}/>
          <input aria-label={`${c.name}名称`} value={c.name} onChange={e => change(c.id, { name: e.target.value })}/>
          {!demo && <button className="lsv-delete-curve" aria-label={`删除 ${c.name}`} onClick={() => remove(c.id)}><Trash2 size={16}/></button>}</div>
          <details className="lsv-curve-details"><summary>{c.points.length} 个点 · 数据详情</summary><div className="eis-source-details"><p>{c.source}</p><label>导入的虚部列<OptionSelect label={`${c.name}虚部符号`} value={c.imaginary ?? "raw"} onChange={v => change(c.id, { imaginary: v as Curve["imaginary"] })} options={[{ value: "raw", label: "原始 Z″（绘图取负）" }, { value: "negative", label: "已取负 −Z″（保持不变）" }]}/></label><small>显示单位：Ω · 保留原始点序和正负号</small></div></details></div>) : <p className="lsv-subtle">拖入文件或点击导入，最多比较 10 条曲线。</p>}
        {removed && !demo && <div className="lsv-undo">已移除 {removed.curve.name}<button disabled={curves.length >= 10} onClick={() => { setCurves(list => { const next = [...list]; next.splice(Math.min(removed.index, next.length), 0, removed.curve); return next; }); setRemoved(null); }}>撤销</button></div>}
      </section>
      <details className="eis-settings"><summary><Settings2 size={16}/>图形设置</summary><div><label className="lsv-field">X 轴标题<input aria-label="EIS X 轴标题" value={xLabel} onChange={e => setXLabel(e.target.value)}/></label><label className="lsv-field">Y 轴标题<input aria-label="EIS Y 轴标题" value={yLabel} onChange={e => setYLabel(e.target.value)}/></label><label className="eis-equal-units"><input type="checkbox" checked={equalUnits} onChange={e => setEqualUnits(e.target.checked)}/>X、Y 轴每 Ω 等比例</label><p>等比例显示便于判断弧的形状。关闭后画布会拉伸填满。</p></div></details>
      <details className="eis-settings eis-help"><summary>EIS 导入说明</summary><div><p>辰华 TXT 或兼容 EIS BIN 可直接读取；Excel、Origin 导出的 TXT / CSV 可选择多组 Z′、Z″ 列。</p><p>OPJU 请先在 Origin 导出工作表；PNG 用作图形参考，不能替代原始数据。</p><p>实部为 Z′，纵轴为 −Z″。频率、模值和相位不能代替实部或虚部。此页保留原始数据，不进行 Rct 拟合。</p><p>导出数据包含全部曲线和完整点序；导出图形保存当前视图，可在矢量软件中编辑。</p></div></details>
    </aside>
    <div className="lsv-results" ref={canvas}>{demo && <div className="lsv-demo-notice"><Activity size={16}/>当前为模拟数据，仅用于体验操作。</div>}{message && !demo && <div className="lsv-import-message" role="status">{message}</div>}{exportError && <div className="lsv-error" role="alert">{exportError}</div>}
      <LsvPlot curves={plotted} xLabel={xLabel} yLabel={yLabel} title="EIS · Nyquist" style={style} legendInside legendAbove axisControls fillCanvas equalUnits={equalUnits} showFooter={false} toolbar={tools} onFilesDrop={drop} emptyText="拖入 TXT、兼容辰华 EIS BIN、Excel、CSV、DAT 或 TSV，也可粘贴数据。"/>
    </div>
  </div><XyImportDialog kind="eis" fileRequest={fileRequest} open={open} onOpenChange={setOpen} existingCount={curves.length} onAdd={(added, note) => { setCurves(list => [...list, ...added]); setDemo(false); setMessage(note); }}/></div>;
}
