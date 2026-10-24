"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { PlotCurve, PlotPoint } from "../lib/lsv-math";
import { axisTicks, formatTick, type AxisTicks } from "../lib/plot-ticks";
import type {CdlFigureSettings} from "./cdl-axis-settings";

type Bounds = { x0: number; x1: number; y0: number; y1: number };
type Drag = { x0: number; x1: number; y0: number; y1: number };
type Hover = { point: PlotPoint; curve: PlotCurve; px: number; py: number };
type Props = {
  curves: PlotCurve[];
  e0: number;
  xLabel?: string;
  yLabel: string;
  onFilesDrop?: (files: File[]) => void;
  svgRef?: Ref<SVGSVGElement>;
  settings?: CdlFigureSettings;
};

const valid = (point: PlotPoint | null): point is PlotPoint => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
const numeric = (value: number) => Number(value.toPrecision(7)).toString();

function extent(curves: PlotCurve[]): Bounds {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const curve of curves) for (const point of curve.plotted) if (valid(point)) {
    x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x);
    y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y);
  }
  if (!Number.isFinite(x0)) return { x0: 0, x1: 1, y0: -1, y1: 1 };
  const xPad = (x1 - x0 || Math.abs(x0) || 1) * .055;
  const yPad = (y1 - y0 || Math.abs(y0) || 1) * .08;
  return { x0: x0 - xPad, x1: x1 + xPad, y0: y0 - yPad, y1: y1 + yPad };
}

function ticks(low: number, high: number, count: number): AxisTicks {
  try {
    const rough = (high - low) / count;
    const magnitude = 10 ** Math.floor(Math.log10(rough)), fraction = rough / magnitude;
    const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
    return axisTicks(low, high, { step, anchor: 0, minorCount: 0 });
  } catch { return { major: [low, high], minor: [], step: high - low }; }
}

function paint(value: string) {
  return !/url\s*\(/i.test(value) && /^[#a-zA-Z0-9(),.%\s+-]+$/.test(value) ? value : "#2374d5";
}

function ellipsis(value: string, available: number, fontSize = 11): string {
  let width = 0, output = "";
  for (const character of value) {
    width += /[^\x00-\x7F]/.test(character) ? fontSize : fontSize * .56;
    if (width > available - fontSize) return output + "…";
    output += character;
  }
  return output;
}

/** A CV-only viewport. It renders acquisition order, including gaps and signed currents. */
export default function CdlCvFigure({ curves, e0, xLabel = "Potential / V", yLabel, onFilesDrop, svgRef, settings }: Props) {
  const host = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement | null>(null);
  const clipId = "cdl-cv-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [size, setSize] = useState({ width: 620, height: 340 });
  const [view, setView] = useState<Bounds | null>(null);
  const [hover, setHover] = useState<Hover | null>(null), [drag, setDrag] = useState<Drag | null>(null);
  const dragDepth = useRef(0), [fileOver, setFileOver] = useState(false);
  const active = useMemo(() => curves.filter(curve => curve.visible && !curve.error && curve.plotted.some(valid)), [curves]);
  const full = useMemo(() => extent(active), [active]);
  const bounds = view ?? settings?.bounds ?? full;

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const measure = () => {
      const { width, height } = target.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(previous => Math.abs(width - previous.width) < .5 && Math.abs(height - previous.height) < .5 ? previous : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(target);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => { setView(null); setHover(null); setDrag(null); }, [curves]);
  useEffect(() => { setView(null); setHover(null); setDrag(null); }, [settings?.bounds]);
  const assignSvg = useCallback((node: SVGSVGElement | null) => {
    svg.current = node;
    if (typeof svgRef === "function") svgRef(node);
    else if (svgRef) svgRef.current = node;
  }, [svgRef]);

  const compact = size.width < 500 || size.height < 290;
  const fontSize = compact ? 11 : 12;
  const tickWarnings:string[]=[];
  function configuredTicks(axis:"x"|"y",count:number):AxisTicks{
    if(settings)try{return axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],settings.ticks[axis]);}catch(issue){tickWarnings.push(`${axis.toUpperCase()} 轴：${(issue as Error).message}，当前范围暂用自动刻度。`);}
    return ticks(bounds[`${axis}0`],bounds[`${axis}1`],count);
  }
  const xTicks = configuredTicks("x",Math.max(3, Math.min(6, Math.floor(size.width / 95))));
  const yTicks = configuredTicks("y",Math.max(3, Math.min(6, Math.floor(size.height / 60))));
  const legendColumns = Math.max(1, Math.min(active.length || 1, Math.floor((size.width - 56) / (compact ? 100 : 160))));
  const legendRows = Math.ceil(active.length / legendColumns), legendRowHeight = compact ? 16 : 18;
  const tickWidth = Math.max(1, ...yTicks.major.map(value => formatTick(value, yTicks.step).length)) * fontSize * .58;
  const margin = { left: Math.max(compact ? 60 : 66, Math.min(108, tickWidth + 33)), right: 16, top: legendRows * legendRowHeight + 13, bottom: compact ? 42 : 47 };
  const w = Math.max(1, size.width - margin.left - margin.right), h = Math.max(1, size.height - margin.top - margin.bottom);
  const sx = useCallback((value: number) => margin.left + (value - bounds.x0) / (bounds.x1 - bounds.x0) * w, [margin.left, bounds.x0, bounds.x1, w]);
  const sy = useCallback((value: number) => margin.top + (bounds.y1 - value) / (bounds.y1 - bounds.y0) * h, [margin.top, bounds.y0, bounds.y1, h]);
  const ix = (pixel: number) => bounds.x0 + (pixel - margin.left) / w * (bounds.x1 - bounds.x0);
  const iy = (pixel: number) => bounds.y1 - (pixel - margin.top) / h * (bounds.y1 - bounds.y0);
  const legendWidth = (size.width - margin.left - 12) / legendColumns;

  // Never sort, join gaps, or take absolute current. Hover also uses these original points.
  const paths = useMemo(() => active.map(curve => {
    let start = true, count = 0, first: PlotPoint | undefined;
    const commands: string[] = [];
    for (const point of curve.plotted) {
      if (!valid(point)) { start = true; continue; }
      if (!first) first = point;
      count++;
      commands.push(`${start ? "M" : "L"}${sx(point.x).toFixed(3)},${sy(point.y).toFixed(3)}`);
      start = false;
    }
    return { curve, path: commands.join(" "), count, first };
  }), [active, sx, sy]);

  function coordinates(event: React.PointerEvent | React.WheelEvent) {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height };
  }
  function inside(x: number, y: number) { return x >= margin.left && x <= margin.left + w && y >= margin.top && y <= margin.top + h; }
  function zoom(factor: number, cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2) {
    const next = { x0: cx + (bounds.x0 - cx) * factor, x1: cx + (bounds.x1 - cx) * factor, y0: cy + (bounds.y0 - cy) * factor, y1: cy + (bounds.y1 - cy) * factor };
    if (Object.values(next).every(Number.isFinite) && next.x1 - next.x0 > 1e-12 && next.y1 - next.y0 > 1e-12) { setView(next); setHover(null); }
  }
  function reset() { setView(null); setHover(null); setDrag(null); }
  function move(event: React.PointerEvent) {
    const point = coordinates(event);
    if (drag) {
      setDrag({ ...drag, x1: Math.max(margin.left, Math.min(margin.left + w, point.x)), y1: Math.max(margin.top, Math.min(margin.top + h, point.y)) });
      return;
    }
    if (!inside(point.x, point.y)) { setHover(null); return; }
    let nearest: Hover | null = null, distance = 18 ** 2;
    for (const curve of active) for (const sourcePoint of curve.plotted) {
      if (!valid(sourcePoint) || sourcePoint.x < bounds.x0 || sourcePoint.x > bounds.x1 || sourcePoint.y < bounds.y0 || sourcePoint.y > bounds.y1) continue;
      const px = sx(sourcePoint.x), py = sy(sourcePoint.y), delta = (px - point.x) ** 2 + (py - point.y) ** 2;
      if (delta < distance) { nearest = { curve, point: sourcePoint, px, py }; distance = delta; }
    }
    setHover(nearest);
  }
  function finish(event: React.PointerEvent) {
    if (drag && Math.abs(drag.x1 - drag.x0) > 10 && Math.abs(drag.y1 - drag.y0) > 10) {
      setView({ x0: ix(Math.min(drag.x0, drag.x1)), x1: ix(Math.max(drag.x0, drag.x1)), y0: iy(Math.max(drag.y0, drag.y1)), y1: iy(Math.min(drag.y0, drag.y1)) });
    }
    setDrag(null);
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
  }
  function fileDrag(event: React.DragEvent) { return !!onFilesDrop && Array.from(event.dataTransfer.types).includes("Files"); }

  return <div className="cdl-cv-figure" data-testid="cdl-cv-chart" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, position: "relative" }}>
    <div className="cdl-cv-tools" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5, minHeight: 27, padding: "1px 10px", flex: "0 0 auto", color: "#64758b", fontSize: 11 }}>
      <span>{active.length ? `${active.length} 条扫速曲线${view ? " · 已缩放" : ""}` : "每组导入同一电极的多个扫速"}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <button type="button" aria-label="缩小 CV 图" title="缩小" disabled={!active.length} onClick={() => zoom(1.35)} style={{ display: "inline-flex", padding: 3, border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}><Minus size={14}/></button>
        <button type="button" aria-label="放大 CV 图" title="放大" disabled={!active.length} onClick={() => zoom(1 / 1.35)} style={{ display: "inline-flex", padding: 3, border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}><Plus size={14}/></button>
        <button type="button" aria-label="复位 CV 图" title={settings?.bounds?"恢复设置中的范围；也可双击图形":"恢复全部数据范围；也可双击图形"} disabled={!active.length} onClick={reset} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: 3, border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}><RotateCcw size={13}/><span>复位</span></button>
      </div>
    </div>
    {tickWarnings.length>0&&<div className="cdl-axis-warning" role="status">{tickWarnings.join(" ")}</div>}
    <div ref={host} style={{ position: "relative", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}
      onDragEnter={event => { if (fileDrag(event)) { event.preventDefault(); dragDepth.current++; setFileOver(true); } }}
      onDragOver={event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={event => { if (fileDrag(event)) { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setFileOver(false); } }}
      onDrop={event => { if (fileDrag(event)) { event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setFileOver(false); setHover(null); setDrag(null); onFilesDrop?.(Array.from(event.dataTransfer.files)); } }}>
      <svg ref={assignSvg} xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} data-cdl-figure="cv" role="img" aria-label={`CV 图，${active.length} 条扫速曲线，横轴 ${xLabel}，纵轴 ${yLabel}`} fontFamily="Arial, sans-serif" data-x-min={bounds.x0} data-x-max={bounds.x1} data-y-min={bounds.y0} data-y-max={bounds.y1}
        style={{ display: "block", touchAction: "none", userSelect: "none" }} onPointerMove={move} onPointerLeave={() => { if (!drag) setHover(null); }}
        onPointerDown={event => { if (event.button !== 0 || !active.length) return; const point = coordinates(event); if (!inside(point.x, point.y)) return; svg.current?.setPointerCapture(event.pointerId); setDrag({ x0: point.x, x1: point.x, y0: point.y, y1: point.y }); setHover(null); }}
        onPointerUp={finish} onPointerCancel={() => setDrag(null)} onDoubleClick={reset}
        onWheel={event => { if (!event.ctrlKey || !active.length) return; const point = coordinates(event); if (inside(point.x, point.y)) { event.preventDefault(); zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, ix(point.x), iy(point.y)); } }}>
        <title>CV 扫速曲线</title>
        <desc>各曲线使用当前所选循环，保持原始点顺序、电流正负号和数据断点。竖虚线为取点电位 E₀。拖动框选放大，双击复位，悬停读取原始数据点。</desc>
        <rect width={size.width} height={size.height} fill="white" data-plot-background="1"/>
        {active.length > 0 ? <>
          <defs><clipPath id={clipId}><rect x={margin.left} y={margin.top} width={w} height={h}/></clipPath></defs>
          <g aria-label="扫速图例">{active.map((curve, index) => <g key={curve.id} transform={`translate(${margin.left + index % legendColumns * legendWidth},${12 + Math.floor(index / legendColumns) * legendRowHeight})`}>
            <title>{curve.name}</title><line x1="0" x2="18" y1="-3.5" y2="-3.5" stroke={paint(curve.color)} strokeWidth="2"/>
            <text x="24" y="0" fontSize={fontSize} fill="#3b536c">{ellipsis(curve.name, legendWidth - 28, fontSize)}</text>
          </g>)}</g>
          <g aria-hidden="true">
            {xTicks.major.map(value => <line key={`gx-${value}`} x1={sx(value)} x2={sx(value)} y1={margin.top} y2={margin.top + h} stroke="#e9eef4"/>)}
            {yTicks.major.map(value => <line key={`gy-${value}`} x1={margin.left} x2={margin.left + w} y1={sy(value)} y2={sy(value)} stroke="#e9eef4"/>)}
            <rect x={margin.left} y={margin.top} width={w} height={h} fill="none" stroke="#536579" strokeWidth="1.2"/>
          </g>
          <g clipPath={`url(#${clipId})`}>
            {Number.isFinite(e0) && <line data-cdl-e0={e0} x1={sx(e0)} x2={sx(e0)} y1={margin.top} y2={margin.top + h} stroke="#748399" strokeDasharray="4 4" strokeWidth="1"><title>{`取点电位 E₀ = ${numeric(e0)} V`}</title></line>}
            {paths.map(({ curve, path, count, first }) => <path key={curve.id} data-cv-curve={curve.id} data-first-x={first?.x} data-first-y={first?.y} data-point-count={count} data-source-point-count={curve.points.length} d={path} fill="none" stroke={paint(curve.color)} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><title>{curve.name}</title></path>)}
            {hover && <circle cx={hover.px} cy={hover.py} r="4" fill="white" stroke={paint(hover.curve.color)} strokeWidth="2"/>}
          </g>
          {Number.isFinite(e0) && e0 >= bounds.x0 && e0 <= bounds.x1 && <text x={Math.min(size.width - 65, Math.max(margin.left + 4, sx(e0) + 4))} y={margin.top + 13} fill="#6d7d90" fontSize="10">E₀ {numeric(e0)} V</text>}
          {xTicks.major.map(value => <g key={`tx-${value}`} data-tick-kind="major" data-axis="x" data-tick-value={value}><line x1={sx(value)} x2={sx(value)} y1={margin.top + h} y2={margin.top + h + 4} stroke="#536579"/><text x={sx(value)} y={margin.top + h + 18} textAnchor="middle" fill="#536579" fontSize={fontSize}>{formatTick(value, xTicks.step)}</text></g>)}
          {yTicks.major.map(value => <g key={`ty-${value}`} data-tick-kind="major" data-axis="y" data-tick-value={value}><line x1={margin.left - 4} x2={margin.left} y1={sy(value)} y2={sy(value)} stroke="#536579"/><text x={margin.left - 8} y={sy(value) + fontSize * .35} textAnchor="end" fill="#536579" fontSize={fontSize}>{formatTick(value, yTicks.step)}</text></g>)}
          {xTicks.minor.map(value=><line key={`mx-${value}`} data-tick-kind="minor" data-axis="x" data-tick-value={value} x1={sx(value)} x2={sx(value)} y1={margin.top+h} y2={margin.top+h+2.5} stroke="#536579"/>)}
          {yTicks.minor.map(value=><line key={`my-${value}`} data-tick-kind="minor" data-axis="y" data-tick-value={value} x1={margin.left-2.5} x2={margin.left} y1={sy(value)} y2={sy(value)} stroke="#536579"/>)}
          <text x={margin.left + w / 2} y={size.height - 8} textAnchor="middle" fill="#2c435b" fontSize={compact ? 13 : 14}>{xLabel}</text>
          <text transform={`translate(15 ${margin.top + h / 2}) rotate(-90)`} textAnchor="middle" fill="#2c435b" fontSize={compact ? 13 : 14}>{yLabel}</text>
          {drag && <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} fill="#2374d5" fillOpacity=".1" stroke="#2374d5" strokeDasharray="4 3"/>}
        </> : <g fill="#718197" textAnchor="middle"><text x={size.width / 2} y={size.height / 2 - 7} fontSize="15">导入本组数据，自动显示 CV</text><text x={size.width / 2} y={size.height / 2 + 16} fontSize="12">可一次选择或拖入多个扫速文件</text></g>}
      </svg>
      {hover && <div data-testid="cdl-cv-tooltip" data-x={hover.point.x} data-y={hover.point.y} data-source-index={hover.point.index} style={{ position: "absolute", pointerEvents: "none", left: Math.max(4, Math.min(size.width - 206, hover.px + 12)), top: Math.max(4, Math.min(size.height - 86, hover.py - 79)), width: 198, padding: "7px 9px", background: "#fff", border: "1px solid #d5e0ec", boxShadow: "0 3px 10px #22394f15", borderRadius: 6, color: "#30465d", fontSize: 11, lineHeight: 1.5 }}>
        <strong style={{ color: paint(hover.curve.color), display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hover.curve.name}</strong>
        <div>E = {numeric(hover.point.x)} V · {yLabel.includes("density") ? "j" : "I"} = {numeric(hover.point.y)}</div>
        <small>原始第 {hover.point.index + 1} 点 · {yLabel.split("/").slice(1).join("/").trim()}</small>
      </div>}
      {fileOver && <div role="status" style={{ position: "absolute", inset: 5, border: "2px dashed #2374d5", borderRadius: 7, background: "#edf5fff2", display: "grid", placeItems: "center", color: "#2365b4", fontSize: 16, pointerEvents: "none" }}>松开文件，导入当前组</div>}
    </div>
  </div>;
}
