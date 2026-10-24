"use client";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Maximize2, RotateCcw } from "lucide-react";
import type { EisBodeData, EisBodePhaseSign, EisBodePoint, EisBodeSeries, EisBodeView } from "@/lib/eis-bode";
import { axisTicks, DEFAULT_TICKS, tickLabel, type AxisTicks, type PlotTickSettings } from "@/lib/plot-ticks";
import { useProjectEpoch, useProjectState } from "@/lib/project-state";
import FigureExportDialog from "@/components/figure-export-dialog";
import PlotSettingsDialog from "@/components/plot-settings-dialog";
import "./eis-bode.css";

export type EisBodeProps = { data: EisBodeData; view: EisBodeView; phaseSign: EisBodePhaseSign; onFilesDrop: (files: File[]) => void; toolbar?: ReactNode; settingsContent?: ReactNode };
type Pair = [number, number];
type PanelKind = "magnitude" | "phase";
type Panel = {kind: PanelKind; top: number; height: number; range: Pair; ticks: AxisTicks; label: string};
type Ranges = {x0: string; x1: string; phase0: string; phase1: string; mag0: string; mag1: string};
type TickDraft = {phaseStep: string; phaseAnchor: string; phaseMinor: string; frequencyMinor: boolean; magnitudeMinor: boolean};
type Hover = {series: EisBodeSeries; point: EisBodePoint; panel: PanelKind};
const EMPTY_RANGES: Ranges = {x0: "", x1: "", phase0: "", phase1: "", mag0: "", mag1: ""};
const DEFAULT_BODE_TICKS: PlotTickSettings = {x: {anchor: 0, minorCount: 1, scale: "log10"}, y: {...DEFAULT_TICKS.y, scale: "linear"}};
const DEFAULT_MAG_TICKS: PlotTickSettings = {x: {...DEFAULT_BODE_TICKS.x}, y: {anchor: 0, minorCount: 1, scale: "log10"}};
const format = (value: number) => !Number.isFinite(value) ? "缺失" : Math.abs(value) >= 10000 || Math.abs(value) > 0 && Math.abs(value) < .001 ? value.toExponential(3) : Number(value.toPrecision(6)).toString();
function logExtent(min: number, max: number): Pair {
  if (!(min > 0) || !Number.isFinite(min) || !(max >= min) || !Number.isFinite(max)) return [.1, 10];
  const lo = Math.log10(min), hi = Math.log10(max), padding = hi > lo ? (hi - lo) * .035 : .5;
  const lower = Math.max(Number.MIN_VALUE, 10 ** Math.max(Math.log10(Number.MIN_VALUE), lo - padding));
  const upper = 10 ** (hi + padding);
  return [lower, Number.isFinite(upper) ? upper : Number.MAX_VALUE];
}
function linearExtent(min: number, max: number): Pair {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [0, 90];
  const padding = max > min ? (max - min) * .07 : Math.max(1, Math.abs(min) * .05);
  return [min - padding, max + padding];
}
function axisLabel(value: number, ticks: AxisTicks): ReactNode {
  const exponent = Math.log10(value);
  return ticks.scale === "log10" && Math.abs(exponent - Math.round(exponent)) < 1e-9 ? <><tspan>10</tspan><tspan baselineShift="super" fontSize=".72em">{Math.round(exponent)}</tspan></> : tickLabel(value, ticks);
}
function wrapped(text: string, width: number, font: number): string[] {
  const lines: string[] = []; let line = "", length = 0;
  for (const char of text) {const next = char.charCodeAt(0) > 255 ? font : font * .53; if (line && length + next > width) {lines.push(line); line = ""; length = 0;} line += char; length += next;}
  lines.push(line); return lines;
}
const tickDraftFrom = (ticks: PlotTickSettings, magnitude: PlotTickSettings): TickDraft => ({phaseStep: ticks.y.step === undefined ? "" : String(ticks.y.step), phaseAnchor: String(ticks.y.anchor), phaseMinor: String(ticks.y.minorCount), frequencyMinor: ticks.x.minorCount > 0, magnitudeMinor: magnitude.y.minorCount > 0});

export default function EisBode({data, view, phaseSign, onFilesDrop, toolbar, settingsContent}: EisBodeProps) {
  const card = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [manual, setManual] = useProjectState<{x?: Pair; y?: Pair}>("eis.bode", "manual", {});
  const [magManual, setMagManual] = useProjectState<{y?: Pair}>("eis.bode.magnitude", "manual", {});
  const [manualPhaseSign, setManualPhaseSign] = useProjectState<EisBodePhaseSign>("eis.bode", "manualPhaseSign", "negative");
  const [ranges, setRanges] = useProjectState<Ranges>("eis.bode", "ranges", EMPTY_RANGES);
  const [rangesPhaseSign, setRangesPhaseSign] = useProjectState<EisBodePhaseSign>("eis.bode", "rangesPhaseSign", "negative");
  const [tickSettings, setTickSettings] = useProjectState<PlotTickSettings>("eis.bode", "tickSettings", DEFAULT_BODE_TICKS);
  const [magTicks, setMagTicks] = useProjectState<PlotTickSettings>("eis.bode.magnitude", "tickSettings", DEFAULT_MAG_TICKS);
  const [tickDraft, setTickDraft] = useState<TickDraft>(() => tickDraftFrom(tickSettings, magTicks));
  const [hover, setHover] = useState<Hover | null>(null), [over, setOver] = useState(false);
  const [rangeError, setRangeError] = useState(""), [tickError, setTickError] = useState(""), [canvasError, setCanvasError] = useState("");
  const epoch = useProjectEpoch(), id = `eis-bode-${useId().replace(/:/g, "")}`;
  useEffect(() => {setHover(null); setRangeError(""); setTickError(""); setCanvasError("");}, [data, view, phaseSign, manual, magManual, epoch]);
  useEffect(() => {setTickDraft(tickDraftFrom(tickSettings, magTicks)); setTickError("");}, [tickSettings, magTicks, epoch]);
  const fullX = useMemo(() => logExtent(data.xMin, data.xMax), [data.xMin, data.xMax]);
  const fullMag = useMemo(() => logExtent(data.magMin, data.magMax), [data.magMin, data.magMax]);
  const fullPhase = useMemo(() => linearExtent(phaseSign === "negative" ? data.negativePhaseMin : data.phaseMin, phaseSign === "negative" ? data.negativePhaseMax : data.phaseMax), [data, phaseSign]);
  const xRange = manual.x ?? fullX, magRange = magManual.y ?? fullMag;
  const phaseRange: Pair = manual.y ? manualPhaseSign === phaseSign ? manual.y : [-manual.y[1], -manual.y[0]] : fullPhase;
  const displayRanges: Ranges = rangesPhaseSign === phaseSign ? ranges : {...ranges, phase0: ranges.phase1.trim() ? String(-Number(ranges.phase1)) : "", phase1: ranges.phase0.trim() ? String(-Number(ranges.phase0)) : ""};
  const phaseLabel = phaseSign === "negative" ? "−φ / °" : "φ / °";
  const left = 116, width = 640, legendX = 794, legendWidth = 220;
  const warnings: string[] = [];
  function getTicks(range: Pair, settings: PlotTickSettings["x"], scale: "linear" | "log10", label: string): AxisTicks {
    try {return axisTicks(...range, {...settings, scale});}
    catch (issue) {warnings.push(`${label}：${(issue as Error).message}，当前使用自动刻度。`); try {return axisTicks(...range, {anchor: 0, minorCount: 1, scale});} catch {return {major: [], minor: [], step: 1, scale};}}
  }
  const xTicks = getTicks(xRange, tickSettings.x, "log10", "频率轴");
  const panels: Panel[] = view === "both" ? [
    {kind: "magnitude", top: 48, height: 270, range: magRange, ticks: getTicks(magRange, magTicks.y, "log10", "模值轴"), label: "|Z| / Ω"},
    {kind: "phase", top: 402, height: 270, range: phaseRange, ticks: getTicks(phaseRange, tickSettings.y, "linear", "相位轴"), label: phaseLabel},
  ] : [{kind: view, top: 48, height: 640, range: view === "phase" ? phaseRange : magRange, ticks: view === "phase" ? getTicks(phaseRange, tickSettings.y, "linear", "相位轴") : getTicks(magRange, magTicks.y, "log10", "模值轴"), label: view === "phase" ? phaseLabel : "|Z| / Ω"}];
  const logX0 = Math.log10(xRange[0]), logX1 = Math.log10(xRange[1]);
  const sx = (frequency: number) => left + (Math.log10(frequency) - logX0) / (logX1 - logX0) * width;
  const panelValue = (point: EisBodePoint, kind: PanelKind) => kind === "magnitude" ? point.magnitude > 0 && point.logMagnitude !== null ? point.magnitude : null : phaseSign === "negative" ? point.negativePhase : point.phase;
  const sy = (value: number, panel: Panel) => panel.top + panel.height - (panel.kind === "magnitude" ? (Math.log10(value) - Math.log10(panel.range[0])) / (Math.log10(panel.range[1]) - Math.log10(panel.range[0])) : (value - panel.range[0]) / (panel.range[1] - panel.range[0])) * panel.height;
  const usable = [...xRange, ...magRange, ...phaseRange].every(Number.isFinite) && xRange[0] > 0 && xRange[1] > xRange[0] && magRange[0] > 0 && magRange[1] > magRange[0] && phaseRange[1] > phaseRange[0] && logX1 > logX0;
  const error = data.error || (!usable ? "请调整 Bode 坐标范围，或点击复位恢复完整数据。" : undefined);
  const legendColumns = data.series.length > 32 ? 2 : 1, columnWidth = legendWidth / legendColumns, perColumn = Math.ceil(data.series.length / legendColumns);
  const legendLayout = (font: number) => {const heights = Array.from({length: legendColumns}, () => 10); const items = data.series.map((series, index) => {const column = Math.min(legendColumns - 1, Math.floor(index / Math.max(1, perColumn))), lines = wrapped(series.label || series.name, columnWidth - 42, font), y = heights[column]; heights[column] += lines.length * (font + 3) + 8; return {series, lines, x: column * columnWidth + 9, y};}); return {items, height: Math.max(...heights) + 7};};
  let legendFont = 16, legend = legendLayout(legendFont);
  while (legend.height > 690 && legendFont > 8) {legendFont--; legend = legendLayout(legendFont);}
  const svgHeight = Math.max(800, legend.height + 90);
  const potentialCount = new Set(data.series.filter(series => series.potential.trim() && Number.isFinite(Number(series.potential))).map(series => Number(series.potential))).size;
  function reset() {setManual({}); setMagManual({}); setRanges(EMPTY_RANGES); setManualPhaseSign(phaseSign); setRangesPhaseSign(phaseSign); setRangeError(""); setHover(null);}
  function changeRange(key: keyof Ranges, value: string) {setRanges({...displayRanges, [key]: value}); setRangesPhaseSign(phaseSign);}
  function applyRanges() {
    const next: {x?: Pair; y?: Pair} = {}, magnitude: {y?: Pair} = {};
    const definitions = [{keys: ["x0", "x1"], label: "频率轴", log: true, target: "x"}, {keys: ["phase0", "phase1"], label: "相位轴", log: false, target: "phase"}, {keys: ["mag0", "mag1"], label: "模值轴", log: true, target: "mag"}] as const;
    for (const definition of definitions) {
      const lower = displayRanges[definition.keys[0]].trim(), upper = displayRanges[definition.keys[1]].trim(); if (!lower && !upper) continue;
      const min = Number(lower), max = Number(upper);
      if (!lower || !upper || !Number.isFinite(min) || !Number.isFinite(max) || !(max > min) || !Number.isFinite(max - min) || definition.log && (!(min > 0) || !(Math.log10(max) > Math.log10(min)))) {setRangeError(`${definition.label}请填写完整有效范围，最小值须小于最大值${definition.log ? "，且两端均大于 0" : ""}。`); return;}
      if (definition.target === "x") next.x = [min, max]; else if (definition.target === "phase") next.y = [min, max]; else magnitude.y = [min, max];
    }
    setManual(next); setMagManual(magnitude); setManualPhaseSign(phaseSign); setRanges(displayRanges); setRangesPhaseSign(phaseSign); setRangeError(""); setHover(null);
  }
  function applyTicks() {
    const step = tickDraft.phaseStep.trim() ? Number(tickDraft.phaseStep) : undefined;
    const y = {step, anchor: tickDraft.phaseAnchor.trim() ? Number(tickDraft.phaseAnchor) : NaN, minorCount: tickDraft.phaseMinor.trim() ? Number(tickDraft.phaseMinor) : NaN, scale: "linear" as const};
    try {axisTicks(...phaseRange, y);} catch (issue) {setTickError(`相位轴：${(issue as Error).message}`); return;}
    const x = {anchor: 0, minorCount: tickDraft.frequencyMinor ? 1 : 0, scale: "log10" as const};
    setTickSettings({x, y}); setMagTicks({x, y: {anchor: 0, minorCount: tickDraft.magnitudeMinor ? 1 : 0, scale: "log10"}}); setTickError("");
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    if (error) return; const matrix = event.currentTarget.getScreenCTM(); if (!matrix) return;
    const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const panel = panels.find(item => pointer.x >= left && pointer.x <= left + width && pointer.y >= item.top && pointer.y <= item.top + item.height);
    if (!panel) {setHover(null); return;}
    let closest: Hover | null = null, distance = Infinity;
    for (const series of data.series) for (const point of series.points) {
      if (!point) continue; const value = panelValue(point, panel.kind); if (value === null || !Number.isFinite(value)) continue;
      const x = sx(point.frequency), y = sy(value, panel); if (x < left || x > left + width || y < panel.top || y > panel.top + panel.height) continue;
      const next = (x - pointer.x) ** 2 + (y - pointer.y) ** 2; if (next < distance) {distance = next; closest = {series, point, panel: panel.kind};}
    }
    setHover(closest);
  }
  async function fullscreen() {try {if (document.fullscreenElement) await document.exitFullscreen(); else await card.current?.requestFullscreen();} catch (issue) {setCanvasError((issue as Error).message);}}
  const rangeControls = <div className="eis-bode-ranges">{([{keys: ["x0", "x1"], name: "频率", unit: "Hz", full: fullX}, {keys: ["mag0", "mag1"], name: "模值", unit: "Ω", full: fullMag}, {keys: ["phase0", "phase1"], name: "相位", unit: "°", full: fullPhase}] as const).map(axis => <fieldset key={axis.name}><legend>{axis.name} / {axis.unit}</legend><label>最小值<input type="number" step="any" aria-label={`${axis.name}最小值`} value={displayRanges[axis.keys[0]]} placeholder={format(axis.full[0])} onChange={event => changeRange(axis.keys[0], event.target.value)} onKeyDown={event => {if (event.key === "Enter") applyRanges();}}/></label><label>最大值<input type="number" step="any" aria-label={`${axis.name}最大值`} value={displayRanges[axis.keys[1]]} placeholder={format(axis.full[1])} onChange={event => changeRange(axis.keys[1], event.target.value)} onKeyDown={event => {if (event.key === "Enter") applyRanges();}}/></label></fieldset>)}<div className="eis-bode-setting-actions"><button type="button" className="lsv-button secondary" onClick={applyRanges}>应用范围</button><button type="button" className="lsv-button secondary" onClick={reset}>恢复自动范围</button></div>{rangeError && <div className="lsv-error" role="alert">{rangeError}</div>}</div>;
  const tickControls = <div className="eis-bode-ticks"><fieldset><legend>频率与模值刻度</legend><label><input type="checkbox" aria-label="显示频率次刻度" checked={tickDraft.frequencyMinor} onChange={event => setTickDraft(old => ({...old, frequencyMinor: event.target.checked}))}/>显示频率次刻度</label><label><input type="checkbox" aria-label="显示模值次刻度" checked={tickDraft.magnitudeMinor} onChange={event => setTickDraft(old => ({...old, magnitudeMinor: event.target.checked}))}/>显示模值次刻度</label></fieldset><fieldset><legend>相位刻度</legend>{([{key: "phaseStep", label: "相位主刻度间隔"}, {key: "phaseAnchor", label: "相位锚点"}, {key: "phaseMinor", label: "相位次刻度数量"}] as const).map(field => <label key={field.key}>{field.label}<input type="number" step={field.key === "phaseMinor" ? 1 : "any"} min={field.key === "phaseMinor" ? 0 : field.key === "phaseStep" ? Number.EPSILON : undefined} max={field.key === "phaseMinor" ? 20 : undefined} aria-label={field.label} placeholder={field.key === "phaseStep" ? "自动" : undefined} value={tickDraft[field.key]} onChange={event => setTickDraft(old => ({...old, [field.key]: event.target.value}))} onKeyDown={event => {if (event.key === "Enter") applyTicks();}}/></label>)}</fieldset><div className="eis-bode-setting-actions"><button type="button" className="lsv-button secondary" onClick={applyTicks}>应用刻度</button><button type="button" className="lsv-button secondary" onClick={() => {setTickSettings(DEFAULT_BODE_TICKS); setMagTicks(DEFAULT_MAG_TICKS); setTickDraft(tickDraftFrom(DEFAULT_BODE_TICKS, DEFAULT_MAG_TICKS)); setTickError("");}}>恢复自动刻度</button></div>{tickError && <div className="lsv-error" role="alert">{tickError}</div>}</div>;
  function renderSeries(series: EisBodeSeries, panel: Panel) {
    let path = "", drawing = false, segments = 0, count = 0;
    for (const point of series.points) {const value = point ? panelValue(point, panel.kind) : null; if (!point || value === null || !Number.isFinite(value)) {drawing = false; continue;} const x = sx(point.frequency), y = sy(value, panel); if (!Number.isFinite(x) || !Number.isFinite(y)) {drawing = false; continue;} path += `${drawing ? "L" : "M"}${x.toFixed(4)},${y.toFixed(4)}`; if (!drawing) segments++; drawing = true; count++;}
    return <g key={series.id} data-bode-curve={series.id} data-potential={series.potential} data-source={series.source} data-point-count={count}><path d={path} fill="none" stroke={series.color} strokeWidth="1.9" strokeLinejoin="round" data-bode-line={series.id} data-segment-count={segments}/>{series.points.map((point, index) => {const value = point ? panelValue(point, panel.kind) : null; if (!point || value === null || !Number.isFinite(value)) return null; const x = sx(point.frequency), y = sy(value, panel); return Number.isFinite(x) && Number.isFinite(y) ? <circle key={index} cx={x} cy={y} r="2.3" fill="white" stroke={series.color} strokeWidth="1.1" data-frequency={point.frequency} data-phase={point.phase ?? undefined} data-abs={point.magnitude} data-value={value} data-source-index={point.index}/> : null;})}</g>;
  }
  return <div ref={card} className="lsv-plot-card eis-bode-card" onDragOver={event => {if (Array.from(event.dataTransfer.types).includes("Files")) {event.preventDefault(); setOver(true);}}} onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);}} onDrop={event => {event.preventDefault(); setOver(false); onFilesDrop(Array.from(event.dataTransfer.files));}}>
    <div className="lsv-plot-toolbar">{toolbar}<FigureExportDialog getSvg={() => svg.current} defaultName="EIS-原位Bode" disabled={!!error} compact/><PlotSettingsDialog rangeControls={rangeControls} tickControls={tickControls}>{settingsContent}</PlotSettingsDialog><div className="lsv-plot-actions"><button type="button" onClick={reset} title="恢复完整范围"><RotateCcw size={16}/><span>复位</span></button><button type="button" title="全屏显示 Bode 图" aria-label="全屏显示 Bode 图" onClick={() => void fullscreen()}><Maximize2 size={17}/></button></div></div>
    {(warnings.length > 0 || canvasError) && <div className="lsv-error" role="status">{warnings.join(" ")}{canvasError}</div>}
    <div className={`eis-bode-canvas eis-bode-view-${view}`}>
      <svg ref={svg} viewBox={`0 0 1040 ${svgHeight}`} width="100%" height="100%" role="img" aria-label={`原位 Bode 图，${data.series.length} 条谱线，频率与模值为对数坐标，相位显示${phaseSign === "negative" ? "负相位 −φ" : "有符号相位 φ"}`} data-testid="eis-bode" data-view={view} data-phase-sign={phaseSign} data-potential-count={potentialCount} data-series-count={data.series.length} data-curve-count={data.series.length} data-panel-count={panels.length} data-x-scale="log10" data-x-min={xRange[0]} data-x-max={xRange[1]} data-log-x-min={logX0} data-log-x-max={logX1} data-source-x-min={data.xMin} data-source-x-max={data.xMax} data-plot-width={width} data-plot-height={panels[0].height} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        <rect width="1040" height={svgHeight} fill="white" data-plot-background="1"/>
        {!error && <>
          <defs>{panels.map(panel => <clipPath id={`${id}-${panel.kind}`} key={panel.kind}><rect x={left} y={panel.top} width={width} height={panel.height}/></clipPath>)}</defs>
          {panels.map((panel, panelIndex) => <g key={panel.kind} data-testid={`bode-${panel.kind}-panel`} data-bode-panel={panel.kind} data-x-scale="log10" data-y-scale={panel.kind === "magnitude" ? "log10" : "linear"} data-x-min={xRange[0]} data-x-max={xRange[1]} data-y-min={panel.range[0]} data-y-max={panel.range[1]} data-plot-left={left} data-plot-top={panel.top} data-plot-width={width} data-plot-height={panel.height}>
            <g clipPath={`url(#${id}-${panel.kind})`}>{data.series.map(series => renderSeries(series, panel))}</g>
            <rect x={left} y={panel.top} width={width} height={panel.height} fill="none" stroke="#111" strokeWidth="1.5" data-bode-axes={panel.kind}/>
            {xTicks.minor.map((value, index) => <path key={`xm${index}`} d={`M${sx(value)},${panel.top + panel.height}v-4`} stroke="#111" data-axis="x" data-tick="minor" data-value={value}/>)}
            {panel.ticks.minor.map((value, index) => <path key={`ym${index}`} d={`M${left},${sy(value, panel)}h4`} stroke="#111" data-axis="y" data-tick="minor" data-value={value}/>)}
            {xTicks.major.map((value, index) => <g key={`x${index}`} data-axis="x" data-tick="major" data-value={value}><path d={`M${sx(value)},${panel.top + panel.height}v-7`} stroke="#111"/>{panelIndex === panels.length - 1 && <text x={sx(value)} y={panel.top + panel.height + 29} textAnchor="middle" fontSize="19" fontFamily="Arial, sans-serif" fill="#111">{axisLabel(value, xTicks)}</text>}</g>)}
            {panel.ticks.major.map((value, index) => <g key={`y${index}`} data-axis="y" data-tick="major" data-value={value}><path d={`M${left},${sy(value, panel)}h7`} stroke="#111"/><text x={left - 15} y={sy(value, panel) + 6} textAnchor="end" fontSize="19" fontFamily="Arial, sans-serif" fill="#111">{axisLabel(value, panel.ticks)}</text></g>)}
            <text transform={`translate(32 ${panel.top + panel.height / 2}) rotate(-90)`} textAnchor="middle" fontSize="25" fontFamily="Arial, sans-serif" fontWeight="700" fill="#111">{panel.label}</text>
            {hover && (() => {const value = panelValue(hover.point, panel.kind); return value === null ? null : <g data-plot-transient pointerEvents="none" clipPath={`url(#${id}-${panel.kind})`}><path d={`M${sx(hover.point.frequency)},${panel.top}V${panel.top + panel.height}`} stroke="#56758f" strokeWidth="1" strokeDasharray="5 4"/><circle cx={sx(hover.point.frequency)} cy={sy(value, panel)} r="5" fill="white" stroke={hover.series.color} strokeWidth="2"/></g>;})()}
          </g>)}
          <text x={left + width / 2} y={view === "both" ? 752 : 768} textAnchor="middle" fontSize="25" fontFamily="Arial, sans-serif" fontWeight="700" fill="#111">f / Hz</text>
          <g className="eis-bode-legend" data-testid="eis-bode-legend" aria-label="电位谱线图例" transform={`translate(${legendX},48)`}><rect width={legendWidth} height={legend.height} fill="white" stroke="#333" strokeWidth="1"/>{legend.items.map(item => <g key={item.series.id} transform={`translate(${item.x},${item.y})`} data-bode-legend={item.series.id} data-potential={item.series.potential}><title>{item.series.label || item.series.name}</title><line x1="0" x2="23" y1={legendFont * .62} y2={legendFont * .62} stroke={item.series.color} strokeWidth="2"/><circle cx="11.5" cy={legendFont * .62} r="2.4" fill="white" stroke={item.series.color} strokeWidth="1.1"/><text x="31" fontSize={legendFont} fontFamily="Arial, Microsoft YaHei, sans-serif" fill="#233c53">{item.lines.map((line, index) => <tspan key={index} x="31" y={legendFont + index * (legendFont + 3)}>{line}</tspan>)}</text></g>)}</g>
        </>}
      </svg>
      {error && <div className="lsv-chart-empty"><span className="lsv-empty-mark">∿</span><strong>{data.series.length ? "检查 Bode 数据" : "导入 EIS 数据"}</strong><p>{error}</p></div>}
      {over && <div className="lsv-drop-overlay"><strong>松开文件，导入 EIS 数据</strong></div>}
    </div>
    <div className="eis-bode-reading" role="status" data-testid="eis-bode-reading" data-hover-frequency={hover?.point.frequency} data-hover-phase={hover?.point.phase ?? undefined} data-hover-abs={hover?.point.magnitude} data-hover-source={hover?.series.source} data-hover-potential={hover?.series.potential} data-hover-displayed-phase={hover ? phaseSign === "negative" ? hover.point.negativePhase ?? undefined : hover.point.phase ?? undefined : undefined}>{hover ? <><strong>{hover.series.label || hover.series.name}</strong><span>频率 {format(hover.point.frequency)} Hz · {phaseSign === "negative" ? "−φ" : "φ"} {format((phaseSign === "negative" ? hover.point.negativePhase : hover.point.phase) ?? NaN)} ° · |Z| {format(hover.point.magnitude)} Ω</span><small title={hover.series.source}>来源：{hover.series.source}</small></> : <span>{data.series.length} 条谱线 · 悬停查看实测频率、模值、相位及来源</span>}</div>
  </div>;
}
