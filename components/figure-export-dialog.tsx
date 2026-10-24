"use client";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FIGURE_DPI_CHOICES, FIGURE_WIDTH_PRESETS, canExportVectorPdf, figureFilename, figurePixelSize, renderFigureFile, type FigureFormat } from "@/lib/figure-export";
import "./figure-export-dialog.css";

const FORMATS: { value: FigureFormat; label: string }[] = [
  { value: "png", label: "PNG（位图，投稿常用）" },
  { value: "tiff", label: "TIFF（无损位图，期刊）" },
  { value: "pdf", label: "PDF（矢量，按毫米排版）" },
  { value: "svg", label: "SVG（矢量，可继续编辑）" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
}

export default function FigureExportDialog({ getSvg, defaultName, disabled = false, compact = false }: { getSvg: () => SVGSVGElement | null; defaultName: string; disabled?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<FigureFormat>("png");
  const [widthMm, setWidthMm] = useState(160);
  const [dpi, setDpi] = useState(300);
  const [transparent, setTransparent] = useState(false);
  const [filename, setFilename] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aspect, setAspect] = useState<number | null>(null);
  const [container, setContainer] = useState<HTMLElement | undefined>(() => document.fullscreenElement as HTMLElement || undefined);
  useEffect(() => { const sync = () => setContainer(document.fullscreenElement as HTMLElement || undefined); document.addEventListener("fullscreenchange", sync); return () => document.removeEventListener("fullscreenchange", sync); }, []);
  useEffect(() => { if (!open) return; setError(""); setFilename(defaultName); try { const box = (getSvg()?.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number); setAspect(box.length === 4 && box[2] > 0 && box[3] > 0 ? box[2] / box[3] : null); } catch { setAspect(null); } }, [open, defaultName, getSvg]);
  const preview = useMemo(() => {
    if (aspect === null) return "";
    if (format === "svg" || format === "pdf") return `${widthMm} × ${(widthMm / aspect).toFixed(1)} mm · 矢量图形（不受 dpi 限制）`;
    try { const size = figurePixelSize(widthMm, aspect, dpi); return `${size.widthPx} × ${size.heightPx} px · 高 ${size.heightMm.toFixed(1)} mm`; }
    catch (issue) { return (issue as Error).message; }
  }, [format, widthMm, dpi, aspect]);
  async function submit() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const svg = getSvg();
      if (!svg) throw new Error("当前页面还没有可导出的图形。");
      const file = await renderFigureFile(svg, { format, widthMm, dpi, transparent, filename: filename.trim() || defaultName });
      downloadBlob(file.blob, file.filename);
      setOpen(false);
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <DialogTrigger asChild><button type="button" className={`lsv-button secondary${compact ? " is-compact" : ""}`} aria-label="导出图形（多格式）" title="导出图形（PNG / TIFF / PDF / SVG，可设毫米与分辨率）" disabled={disabled}><Download size={15}/>导出图形…</button></DialogTrigger>
    <DialogContent className="figure-export-dialog" overlayClassName="figure-export-overlay" container={container}>
      <DialogHeader><DialogTitle>导出图形</DialogTitle><DialogDescription className="figure-export-description">按目标期刊的宽度和分辨率导出；高度随图形比例自动计算。</DialogDescription></DialogHeader>
      <div className="figure-export-grid">
        <label htmlFor="figure-format">格式</label>
        <select id="figure-format" aria-label="图形格式" value={format} onChange={event => setFormat(event.target.value as FigureFormat)}>{FORMATS.map(item => <option key={item.value} value={item.value} disabled={item.value === "pdf" && !canExportVectorPdf()}>{item.label}</option>)}</select>
        <label htmlFor="figure-width">宽度 / mm</label>
        <div className="figure-export-width"><input id="figure-width" aria-label="图形宽度毫米" type="number" min={20} max={1000} step={1} value={widthMm} onChange={event => setWidthMm(Number(event.target.value))} /><div className="figure-export-presets">{FIGURE_WIDTH_PRESETS.map(item => <button key={item.value} type="button" className={widthMm === item.value ? "is-active" : ""} onClick={() => setWidthMm(item.value)}>{item.value}</button>)}</div></div>
        <label htmlFor="figure-dpi">分辨率</label>
        <select id="figure-dpi" aria-label="图形分辨率" value={dpi} disabled={format === "svg" || format === "pdf"} onChange={event => setDpi(Number(event.target.value))}>{FIGURE_DPI_CHOICES.map(value => <option key={value} value={value}>{value} dpi</option>)}</select>
        <span>背景</span>
        <label className="figure-export-check"><input type="checkbox" aria-label="透明背景" checked={transparent} disabled={format === "svg" || format === "pdf"} onChange={event => setTransparent(event.target.checked)} />透明背景（PNG / TIFF）</label>
        <label htmlFor="figure-name">文件名</label>
        <input id="figure-name" aria-label="图形文件名" value={filename} maxLength={80} onChange={event => setFilename(event.target.value)} />
      </div>
      {!canExportVectorPdf() && <p className="figure-export-description">矢量 PDF 需使用 Friday 桌面版；当前环境可导出 SVG 矢量图。</p>}
      {preview && <p className="figure-export-preview" role="status">{preview} · {figureFilename(filename || defaultName, format, widthMm, dpi)}</p>}
      {error && <div className="lsv-error" role="alert">{error}</div>}
      <div className="figure-export-actions"><button type="button" className="lsv-button secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="lsv-button primary" disabled={busy} onClick={() => void submit()}>{busy ? "正在导出…" : "导出"}</button></div>
    </DialogContent>
  </Dialog>;
}
