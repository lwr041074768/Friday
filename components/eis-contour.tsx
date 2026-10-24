"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type PointerEvent } from "react";
import { Maximize2, RotateCcw } from "lucide-react";
import type { EisContourGrid } from "@/lib/eis-contour";
import { ramanContourPaths } from "@/lib/raman-data";
import { ramanColor } from "@/components/raman-contour";
import { axisTicks, DEFAULT_TICKS, formatTick, type AxisTicks, type PlotTickSettings } from "@/lib/plot-ticks";
import { useProjectEpoch, useProjectState } from "@/lib/project-state";
import FigureExportDialog from "@/components/figure-export-dialog";
import PlotSettingsDialog from "@/components/plot-settings-dialog";
import "./eis-contour.css";

export type EisContourProps = {
  grid: EisContourGrid;
  bands: number;
  palette: string;
  onFilesDrop: (files: File[]) => void;
  toolbar?: ReactNode;
  settingsContent?: ReactNode;
  colorLabel?: string;
  showMeasuredRows?: boolean;
};
type View = { x0: number; x1: number; y0: number; y1: number };
type Hover = { x: number; potential: number; frequency: number; z: number; name: string; source: string };
type TickDraft = Record<"x" | "y", {step: string; anchor: string; minorCount: string}>;
const dimensions = ["x", "y"] as const;
const format = (value: number) => !Number.isFinite(value) ? "缺失" : Math.abs(value) >= 10000 || Math.abs(value) > 0 && Math.abs(value) < .001 ? value.toExponential(3) : Number(value.toPrecision(6)).toString();
const nearest = (values: number[], target: number) => values.reduce((best, value, index) => Math.abs(value - target) < Math.abs(values[best] - target) ? index : best, 0);
const tickDraftFrom = (settings: PlotTickSettings): TickDraft => ({x: {step: settings.x.step === undefined ? "" : String(settings.x.step), anchor: String(settings.x.anchor), minorCount: String(settings.x.minorCount)}, y: {step: settings.y.step === undefined ? "" : String(settings.y.step), anchor: String(settings.y.anchor), minorCount: String(settings.y.minorCount)}});

export default function EisContour({grid, bands, palette, onFilesDrop, toolbar, settingsContent, colorLabel = "log₁₀(|Z″| / Ω)", showMeasuredRows}: EisContourProps) {
  const card = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [manual, setManual] = useProjectState<{x?: [number, number]; y?: [number, number]}>("eis.contour", "manual", {});
  const [ranges, setRanges] = useProjectState("eis.contour", "ranges", {x0: "", x1: "", y0: "", y1: ""});
  const [tickSettings, setTickSettings] = useProjectState<PlotTickSettings>("eis.contour", "tickSettings", DEFAULT_TICKS);
  const [measuredRows, setMeasuredRows] = useProjectState("eis.contour", "measuredRows", true);
  const [hover, setHover] = useState<Hover | null>(null), [over, setOver] = useState(false);
  const [rangeError, setRangeError] = useState(""), [canvasError, setCanvasError] = useState("");
  const [tickDraft, setTickDraft] = useState<TickDraft>(() => tickDraftFrom(tickSettings)), [tickError, setTickError] = useState("");
  const epoch = useProjectEpoch(), clip = `eis-contour-${useId().replace(/:/g, "")}`;
  useEffect(() => { setHover(null); setRangeError(""); setCanvasError(""); }, [grid, manual, epoch]);
  useEffect(() => { setTickDraft(tickDraftFrom(tickSettings)); setTickError(""); }, [tickSettings, epoch]);
  const bandCount = Number.isFinite(bands) ? Math.max(4, Math.min(64, Math.round(bands))) : 24;
  const source: View = {x0: grid.x[0] ?? 0, x1: grid.x.at(-1) ?? 1, y0: grid.y[0] ?? 0, y1: grid.y.at(-1) ?? 1};
  const usableSource = grid.x.length >= 2 && grid.y.length >= 2 && Object.values(source).every(Number.isFinite) && source.x1 > source.x0 && source.y1 > source.y0 && Number.isFinite(source.x1 - source.x0) && Number.isFinite(source.y1 - source.y0);
  const full: View = usableSource ? source : {x0: 0, x1: 1, y0: 0, y1: 1};
  const view: View = {x0: manual.x?.[0] ?? full.x0, x1: manual.x?.[1] ?? full.x1, y0: manual.y?.[0] ?? full.y0, y1: manual.y?.[1] ?? full.y1};
  const {x0, x1, y0, y1} = view;
  const viewport = [(x0 - full.x0) / (full.x1 - full.x0) * 1000, (full.y1 - y1) / (full.y1 - full.y0) * 1000, (x1 - x0) / (full.x1 - full.x0) * 1000, (y1 - y0) / (full.y1 - full.y0) * 1000];
  const usableView = viewport.every(Number.isFinite) && viewport[2] > 0 && viewport[3] > 0;
  const error = grid.error || (!usableSource ? "等高线图需要至少两个有效电位及共同频率区间，请检查电位和数据组。" : !usableView ? "请调整坐标范围，或点击复位恢复完整频率和电位区间。" : undefined);
  const paths = useMemo(() => ramanContourPaths({...grid, values: grid.values.map(row => row.map(value => value === null ? NaN : value))}, bandCount), [grid, bandCount]);
  const l = 116, t = 58, w = 560, h = 560, b = t + h, colorX = 716, colorWidth = 24;
  const sx = (value: number) => l + (value - x0) / (x1 - x0) * w;
  const sy = (value: number) => t + h - (value - y0) / (y1 - y0) * h;
  const warnings: string[] = [];
  function ticksFor(dimension: "x" | "y"): AxisTicks {
    try { return axisTicks(view[`${dimension}0`], view[`${dimension}1`], {...tickSettings[dimension], scale: "linear"}); }
    catch (issue) {
      warnings.push(`${dimension.toUpperCase()} 轴：${(issue as Error).message}，当前使用自动刻度。`);
      try { return axisTicks(view[`${dimension}0`], view[`${dimension}1`], DEFAULT_TICKS[dimension]); }
      catch { return {major: [], minor: [], step: 1}; }
    }
  }
  const xTicks = ticksFor("x"), yTicks = ticksFor("y");
  function applyTicks() {
    const next = {} as PlotTickSettings;
    for (const dimension of dimensions) {
      const draft = tickDraft[dimension];
      next[dimension] = {step: draft.step.trim() ? Number(draft.step) : undefined, anchor: draft.anchor.trim() ? Number(draft.anchor) : NaN, minorCount: draft.minorCount.trim() ? Number(draft.minorCount) : NaN, scale: "linear"};
      try { axisTicks(view[`${dimension}0`], view[`${dimension}1`], next[dimension]); }
      catch (issue) { setTickError(`${dimension.toUpperCase()} 轴：${(issue as Error).message}`); return; }
    }
    setTickSettings(next); setTickError("");
  }
  function reset() { setManual({}); setRanges({x0: "", x1: "", y0: "", y1: ""}); setRangeError(""); setHover(null); }
  function applyRanges() {
    const next: {x?: [number, number]; y?: [number, number]} = {};
    for (const dimension of dimensions) {
      const lower = ranges[`${dimension}0`].trim(), upper = ranges[`${dimension}1`].trim();
      if (!lower && !upper) continue;
      const min = Number(lower), max = Number(upper), span = full[`${dimension}1`] - full[`${dimension}0`];
      if (!lower || !upper || !Number.isFinite(min) || !Number.isFinite(max) || min >= max || !Number.isFinite(max - min)) { setRangeError(`${dimension.toUpperCase()} 轴请填写完整范围，最小值须小于最大值。`); return; }
      if (!Number.isFinite((min - full[`${dimension}0`]) / span * 1000) || !Number.isFinite((max - min) / span * 1000) || (max - min) / span * 1000 <= 0) { setRangeError(`${dimension.toUpperCase()} 轴范围超出可显示的数值尺度，请调整范围。`); return; }
      next[dimension] = [min, max];
    }
    setManual(next); setRangeError(""); setHover(null);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    if (error) return;
    const matrix = event.currentTarget.getScreenCTM(); if (!matrix) return;
    const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (pointer.x < l || pointer.x > l + w || pointer.y < t || pointer.y > t + h) { setHover(null); return; }
    const position = x0 + (pointer.x - l) / w * (x1 - x0), potential = y0 + (b - pointer.y) / h * (y1 - y0);
    if (position < source.x0 || position > source.x1 || potential < source.y0 || potential > source.y1) { setHover(null); return; }
    const r = nearest(grid.y, potential), c = nearest(grid.x, position), row = grid.rows?.[r];
    const frequencies = row?.frequency.filter(value => Number.isFinite(value) && value > 0) ?? [];
    const frequencyIndex = frequencies.length ? nearest(frequencies.map(value => Math.log10(value)), position) : -1;
    const frequency = frequencyIndex >= 0 ? frequencies[frequencyIndex] : 10 ** grid.x[c];
    setHover({x: Math.log10(frequency), potential: grid.y[r], frequency, z: grid.values[r]?.[c] ?? NaN, name: row?.name ?? grid.names[r] ?? "", source: row?.source ?? ""});
  }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await card.current?.requestFullscreen(); }
    catch (issue) { setCanvasError((issue as Error).message); }
  }
  const rangeControls = <div className="lsv-axis-controls">
    {dimensions.map(dimension => <div className="lsv-axis-range" key={dimension} role="group" aria-label={`${dimension.toUpperCase()} 轴范围`}><strong>{dimension.toUpperCase()} 轴范围</strong><input type="number" step="any" aria-label={`${dimension.toUpperCase()} 轴最小值`} placeholder={`最小 ${format(full[`${dimension}0`])}`} value={ranges[`${dimension}0`]} onChange={event => setRanges(old => ({...old, [`${dimension}0`]: event.target.value}))} onKeyDown={event => { if (event.key === "Enter") applyRanges(); }}/><span>至</span><input type="number" step="any" aria-label={`${dimension.toUpperCase()} 轴最大值`} placeholder={`最大 ${format(full[`${dimension}1`])}`} value={ranges[`${dimension}1`]} onChange={event => setRanges(old => ({...old, [`${dimension}1`]: event.target.value}))} onKeyDown={event => { if (event.key === "Enter") applyRanges(); }}/></div>)}
    <button type="button" className="lsv-button secondary" onClick={applyRanges}>应用范围</button><button type="button" className="lsv-button secondary" onClick={reset}>恢复自动范围</button>
    {rangeError && <div className="lsv-error" role="alert">{rangeError}</div>}
  </div>;
  const tickControls = <div className="eis-contour-ticks">
    {dimensions.map(dimension => <fieldset key={dimension}><legend>{dimension.toUpperCase()} 轴刻度</legend>{([{key: "step", label: "主刻度间隔"}, {key: "anchor", label: "锚点"}, {key: "minorCount", label: "次刻度数量"}] as const).map(field => <label key={field.key}>{field.label}<input type="number" step={field.key === "minorCount" ? 1 : "any"} min={field.key === "minorCount" ? 0 : field.key === "step" ? Number.EPSILON : undefined} max={field.key === "minorCount" ? 20 : undefined} aria-label={`${dimension.toUpperCase()} 轴${field.label}`} placeholder={field.key === "step" ? "自动" : undefined} value={tickDraft[dimension][field.key]} onChange={event => setTickDraft(old => ({...old, [dimension]: {...old[dimension], [field.key]: event.target.value}}))} onKeyDown={event => { if (event.key === "Enter") applyTicks(); }}/></label>)}</fieldset>)}
    <button type="button" className="lsv-button secondary" onClick={applyTicks}>应用刻度</button><button type="button" className="lsv-button secondary" onClick={() => { setTickSettings(DEFAULT_TICKS); setTickDraft(tickDraftFrom(DEFAULT_TICKS)); setTickError(""); }}>恢复自动刻度</button>
    {tickError && <div className="lsv-error" role="alert">{tickError}</div>}
  </div>;
  const pageSettings = <div className="eis-contour-page-settings">{showMeasuredRows === undefined && <label><input type="checkbox" checked={measuredRows} onChange={event => setMeasuredRows(event.target.checked)}/>显示实测电位标记</label>}{settingsContent}</div>;
  const rowMarkers = showMeasuredRows ?? measuredRows;
  return <div ref={card} className="lsv-plot-card eis-contour-card" onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setOver(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }} onDrop={event => { event.preventDefault(); setOver(false); onFilesDrop(Array.from(event.dataTransfer.files)); }}>
    <div className="lsv-plot-toolbar">{toolbar}<FigureExportDialog getSvg={() => svg.current} defaultName="EIS-原位等高线" disabled={!!error} compact/><PlotSettingsDialog rangeControls={rangeControls} tickControls={tickControls}>{pageSettings}</PlotSettingsDialog><div className="lsv-plot-actions"><button type="button" onClick={reset} title="恢复完整范围"><RotateCcw size={16}/><span>复位</span></button><button type="button" title="全屏显示等高线" aria-label="全屏显示等高线" onClick={() => void fullscreen()}><Maximize2 size={17}/></button></div></div>
    {(warnings.length > 0 || canvasError) && <div className="lsv-error" role="status">{warnings.join(" ")}{canvasError}</div>}
    <div className="eis-contour-canvas">
      <svg ref={svg} viewBox="0 0 980 720" width="100%" height="100%" role="img" aria-label={`原位 EIS 等高线图，${grid.y.length} 个实测电位，横轴 log₁₀(f / Hz)，纵轴 Potential / V，颜色 ${colorLabel}`} data-testid="eis-contour" data-potential-count={grid.y.length} data-frequency-count={grid.x.length} data-plot-width={w} data-plot-height={h} data-source-x-min={source.x0} data-source-x-max={source.x1} data-source-y-min={source.y0} data-source-y-max={source.y1} data-x-min={x0} data-x-max={x1} data-y-min={y0} data-y-max={y1} data-band-count={bandCount} data-color-label={colorLabel} data-color-min={grid.min} data-color-max={grid.max} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        <rect width="980" height="720" fill="white" data-plot-background="1"/>
        {!error && <>
          <defs><clipPath id={clip}><rect x={l} y={t} width={w} height={h}/></clipPath></defs>
          <svg x={l} y={t} width={w} height={h} viewBox={usableView ? viewport.join(" ") : "0 0 1000 1000"} preserveAspectRatio="none" overflow="hidden" data-contour-viewport>{paths.map((d, index) => <path key={index} d={d} fill={ramanColor((index + .5) / bandCount, palette)} stroke={ramanColor((index + .5) / bandCount, palette)} strokeWidth=".2" data-contour-band={index}/>)}</svg>
          {rowMarkers && <g clipPath={`url(#${clip})`} data-testid="eis-measured-potential-rows">{grid.y.filter(value => value >= y0 && value <= y1).map((value, index) => <g key={index} data-measured-potential={value}><path d={`M${l},${sy(value)}h8M${l + w - 8},${sy(value)}h8`} stroke="white" strokeWidth="2.5"/><path d={`M${l},${sy(value)}h8M${l + w - 8},${sy(value)}h8`} stroke="#233c53" strokeWidth="1"/></g>)}</g>}
          <rect x={l} y={t} width={w} height={h} fill="none" stroke="#111" strokeWidth="1.5" data-testid="eis-contour-axes"/>
          {xTicks.minor.map((value, index) => <path key={`xm${index}`} d={`M${sx(value)},${b}v-4`} stroke="#111" data-axis="x" data-tick="minor" data-value={value}/>)}
          {yTicks.minor.map((value, index) => <path key={`ym${index}`} d={`M${l},${sy(value)}h4`} stroke="#111" data-axis="y" data-tick="minor" data-value={value}/>)}
          {xTicks.major.map((value, index) => <g key={`x${index}`} data-axis="x" data-tick="major" data-value={value}><path d={`M${sx(value)},${b}v-7`} stroke="#111"/><text x={sx(value)} y={b + 30} textAnchor="middle" fontSize="18" fill="#111" fontFamily="Arial, sans-serif">{formatTick(value, xTicks.step)}</text></g>)}
          {yTicks.major.map((value, index) => <g key={`y${index}`} data-axis="y" data-tick="major" data-value={value}><path d={`M${l},${sy(value)}h7`} stroke="#111"/><text x={l - 15} y={sy(value) + 6} textAnchor="end" fontSize="18" fill="#111" fontFamily="Arial, sans-serif">{formatTick(value, yTicks.step)}</text></g>)}
          <text x={l + w / 2} y="686" textAnchor="middle" fontSize="25" fontWeight="700" fontFamily="Arial, sans-serif" fill="#111">log₁₀(f / Hz)</text>
          <text transform={`translate(37 ${t + h / 2}) rotate(-90)`} textAnchor="middle" fontSize="25" fontWeight="700" fontFamily="Arial, sans-serif" fill="#111">Potential / V</text>
          <g data-testid="eis-contour-colorbar">{Array.from({length: bandCount}, (_, index) => <rect key={index} x={colorX} y={b - (index + 1) * h / bandCount} width={colorWidth} height={h / bandCount + .3} fill={ramanColor((index + .5) / bandCount, palette)}/>)}<rect x={colorX} y={t} width={colorWidth} height={h} fill="none" stroke="#111"/>{Array.from({length: 6}, (_, index) => <g key={index}><path d={`M${colorX + colorWidth},${b - index * h / 5}h5`} stroke="#111"/><text x={colorX + colorWidth + 12} y={b - index * h / 5 + 5} fontSize="17" fontFamily="Arial, sans-serif" fill="#111">{format(grid.min + ((grid.max === grid.min ? grid.min + 1 : grid.max) - grid.min) * index / 5)}</text></g>)}<text transform={`translate(922 ${t + h / 2}) rotate(-90)`} textAnchor="middle" fontSize="22" fontFamily="Arial, sans-serif" fill="#111">{colorLabel}</text></g>
          {hover && <g clipPath={`url(#${clip})`} data-plot-transient pointerEvents="none"><path d={`M${l},${sy(hover.potential)}H${l + w}M${sx(hover.x)},${t}V${b}`} stroke="#fff" strokeWidth="1.2" strokeDasharray="5 4"/><circle cx={sx(hover.x)} cy={sy(hover.potential)} r="4" fill="none" stroke="#111" strokeWidth="1.5"/></g>}
        </>}
      </svg>
      {error && <div className="lsv-chart-empty"><span className="lsv-empty-mark">∿</span><strong>{grid.x.length ? "检查原位 EIS 数据" : "导入原位 EIS 数据"}</strong><p>{error}</p></div>}
      {over && <div className="lsv-drop-overlay"><strong>松开文件，导入 EIS 数据</strong></div>}
    </div>
    <div className="eis-contour-reading" role="status" data-testid="eis-contour-reading" data-hover-potential={hover?.potential} data-hover-frequency={hover?.frequency}>{hover ? <><strong>{hover.name}</strong><span>实测电位 {format(hover.potential)} V · 最近实测频率 {format(hover.frequency)} Hz · 颜色网格值 {format(hover.z)}</span>{hover.source && <small title={hover.source}>来源：{hover.source}</small>}</> : <span>{grid.note || "导入含频率的 EIS 数据，并填写各条测量的电位。"}</span>}</div>
  </div>;
}
