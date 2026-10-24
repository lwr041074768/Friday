"use client";
import { useMemo, useRef, useState } from "react";

export type ColumnDesignation = "X" | "Y" | "Yerr" | "ignore";
export type OriginColumn = { id: string; name: string; unit: string; designation: ColumnDesignation; values: (number | null)[] };
export type OriginWorkbook = { id: string; name: string; columns: OriginColumn[] };
export type OriginTemplate = {
  id: string; name: string; colors: string[]; lineWidth: number; marker: "none" | "circle" | "square";
  fontFamily: string; fontSize: number; legend: "inside" | "above" | "none"; grid: boolean;
};
export type OriginFit = { seriesId: string; slope: number; intercept: number; r2: number; n: number };
export type OriginGraphModel = { id: string; name: string; workbookId: string; xColumnId: string; yColumnIds: string[]; fit: OriginFit | null };

export const ORIGIN_TEMPLATES: OriginTemplate[] = [
  { id: "default", name: "Origin 默认", colors: ["#1f4e79", "#c00000", "#2e7d32", "#7030a0"], lineWidth: 2, marker: "circle", fontFamily: "Arial, Microsoft YaHei, sans-serif", fontSize: 12, legend: "inside", grid: true },
  { id: "acs", name: "ACS 单栏 · 灰阶", colors: ["#111111", "#555555", "#888888", "#aaaaaa"], lineWidth: 1.6, marker: "square", fontFamily: "Times New Roman, SimSun, serif", fontSize: 11, legend: "inside", grid: false },
  { id: "nature", name: "Nature 双栏 · 彩色", colors: ["#0b3d91", "#d1495b", "#2a9d8f", "#e9a800"], lineWidth: 1.8, marker: "none", fontFamily: "Arial, Microsoft YaHei, sans-serif", fontSize: 10, legend: "above", grid: false },
];

const WIDTH = 720, HEIGHT = 480;
const MARGIN = { left: 78, right: 24, top: 42, bottom: 62 };
const format = (value: number) => value === 0 ? "0" : Math.abs(value) < 1e-5 || Math.abs(value) >= 1e6 ? value.toExponential(3) : Number(value.toPrecision(6)).toString();
const finite = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);

function niceStep(span: number, target = 6) {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const rough = span / target, magnitude = 10 ** Math.floor(Math.log10(rough)), fraction = rough / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}
function tickValues(min: number, max: number) {
  const step = niceStep(max - min);
  const first = Math.ceil(min / step - 1e-9), last = Math.floor(max / step + 1e-9);
  const values: number[] = [];
  for (let index = first; index <= last && values.length < 200; index++) values.push(Number((index * step).toPrecision(12)));
  return values;
}
export function fitSeries(points: { x: number; y: number }[]): { slope: number; intercept: number; r2: number; n: number } | null {
  const n = points.length;
  if (n < 3) return null;
  let meanX = 0, meanY = 0;
  for (const point of points) { meanX += point.x / n; meanY += point.y / n; }
  let sxx = 0, sxy = 0, syy = 0;
  for (const point of points) { const dx = point.x - meanX, dy = point.y - meanY; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx, intercept = meanY - slope * meanX;
  const r2 = syy > 0 ? Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy))) : 1;
  return { slope, intercept, r2, n };
}

export default function OriginGraph({ graph, workbook, template, svgRef, compact = false }: { graph: OriginGraphModel; workbook: OriginWorkbook; template: OriginTemplate; svgRef?: React.RefObject<SVGSVGElement | null>; compact?: boolean }) {
  const localRef = useRef<SVGSVGElement>(null), [hover, setHover] = useState<{ row: number; px: number; py: number } | null>(null);
  const xColumn = workbook.columns.find(column => column.id === graph.xColumnId);
  const series = useMemo(() => graph.yColumnIds.map((id, index) => {
    const column = workbook.columns.find(item => item.id === id);
    if (!column) return null;
    const points = (xColumn?.values ?? []).map((x, row) => ({ x, y: column.values[row] ?? null })).filter((point): point is { x: number; y: number } => finite(point.x) && finite(point.y));
    return { id: column.id, name: column.name, unit: column.unit, color: template.colors[index % template.colors.length], points };
  }).filter((item): item is NonNullable<typeof item> => item !== null), [graph.yColumnIds, workbook.columns, xColumn, template.colors]);
  const all = useMemo(() => series.flatMap(item => item.points), [series]);
  const bounds = useMemo(() => {
    if (!all.length) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const point of all) { x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x); y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y); }
    const padX = (x1 - x0 || Math.abs(x1) || 1) * .06, padY = (y1 - y0 || Math.abs(y1) || 1) * .08;
    return { x0: x0 - padX, x1: x1 + padX, y0: y0 - padY, y1: y1 + padY };
  }, [all]);
  const plotW = WIDTH - MARGIN.left - MARGIN.right, plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const sx = (value: number) => MARGIN.left + (value - bounds.x0) / (bounds.x1 - bounds.x0) * plotW;
  const sy = (value: number) => MARGIN.top + plotH - (value - bounds.y0) / (bounds.y1 - bounds.y0) * plotH;
  const xTicks = tickValues(bounds.x0, bounds.x1), yTicks = tickValues(bounds.y0, bounds.y1);
  const font = template.fontFamily;
  const hoverRow = hover ? hover.row : -1;
  const hoverX = hoverRow >= 0 ? xColumn?.values[hoverRow] ?? null : null;
  const fit = graph.fit ? series.find(item => item.id === graph.fit?.seriesId) : undefined;
  function move(event: React.PointerEvent<SVGSVGElement>) {
    const node = localRef.current;
    if (!node || !xColumn) { setHover(null); return; }
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) * WIDTH / rect.width, py = (event.clientY - rect.top) * HEIGHT / rect.height;
    if (px < MARGIN.left || px > MARGIN.left + plotW || py < MARGIN.top || py > MARGIN.top + plotH) { setHover(null); return; }
    const xValue = bounds.x0 + (px - MARGIN.left) / plotW * (bounds.x1 - bounds.x0);
    let nearest = -1, distance = Infinity;
    for (let row = 0; row < xColumn.values.length; row++) {
      const value = xColumn.values[row];
      if (!finite(value)) continue;
      const delta = Math.abs(value - xValue);
      if (delta < distance) { distance = delta; nearest = row; }
    }
    const value = nearest >= 0 ? xColumn.values[nearest] : null;
    setHover(nearest >= 0 && finite(value) ? { row: nearest, px: sx(value), py } : null);
  }
  const legendAbove = template.legend === "above";
  const yLabel = series.length === 1 ? `${series[0].name}${series[0].unit ? ` / ${series[0].unit}` : ""}` : series.length > 1 && series.every(item => item.unit === series[0].unit) && series[0].unit ? `Y / ${series[0].unit}` : "Y";
  return <svg ref={node => { if (svgRef) svgRef.current = node; localRef.current = node; }} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${graph.name}，Origin 图形`} data-testid="origin-graph" data-series={series.length} onPointerMove={move} onPointerLeave={() => setHover(null)} style={{ width: "100%", height: "auto", display: "block" }}>
    <rect width={WIDTH} height={HEIGHT} fill="#ffffff" data-plot-background="1" />
    <text x={MARGIN.left} y={26} fontFamily={font} fontSize={15} fontWeight={600} fill="#1d2c3a">{graph.name}</text>
    {legendAbove && <g transform={`translate(${MARGIN.left},${34})`}>{series.map((item, index) => <g key={item.id} transform={`translate(${index * 130},0)`}><line x1={0} x2={18} y1={-4} y2={-4} stroke={item.color} strokeWidth={template.lineWidth} />{template.marker !== "none" && <circle cx={9} cy={-4} r={3} fill="#fff" stroke={item.color} strokeWidth={1.4} />}<text x={24} y={0} fontFamily={font} fontSize={template.fontSize - 1} fill="#31465a">{item.name}</text></g>)}</g>}
    <rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} fill="none" stroke="#2b3d4d" strokeWidth={1.1} />
    {template.grid && yTicks.map(value => <line key={`gy-${value}`} x1={MARGIN.left} x2={MARGIN.left + plotW} y1={sy(value)} y2={sy(value)} stroke="#e6ebf0" strokeWidth={1} />)}
    {template.grid && xTicks.map(value => <line key={`gx-${value}`} x1={sx(value)} x2={sx(value)} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="#eef2f5" strokeWidth={1} />)}
    {yTicks.map(value => <g key={`ty-${value}`}><line x1={MARGIN.left - 6} x2={MARGIN.left} y1={sy(value)} y2={sy(value)} stroke="#2b3d4d" strokeWidth={1} /><text x={MARGIN.left - 10} y={sy(value) + 4} textAnchor="end" fontFamily={font} fontSize={template.fontSize} fill="#31465a">{format(value)}</text></g>)}
    {xTicks.map(value => <g key={`tx-${value}`}><line x1={sx(value)} x2={sx(value)} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH + 6} stroke="#2b3d4d" strokeWidth={1} /><text x={sx(value)} y={MARGIN.top + plotH + 22} textAnchor="middle" fontFamily={font} fontSize={template.fontSize} fill="#31465a">{format(value)}</text></g>)}
    <text x={MARGIN.left + plotW / 2} y={HEIGHT - 16} textAnchor="middle" fontFamily={font} fontSize={template.fontSize + 1} fill="#1d2c3a">{xColumn ? `${xColumn.name}${xColumn.unit ? ` / ${xColumn.unit}` : ""}` : ""}</text>
    <text transform={`translate(18,${MARGIN.top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontFamily={font} fontSize={template.fontSize + 1} fill="#1d2c3a">{yLabel}</text>
    {series.map(item => {
      const path = item.points.map((point, index) => `${index ? "L" : "M"}${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`).join(" ");
      const stride = Math.max(1, Math.ceil(item.points.length / 14));
      return <g key={item.id} data-origin-series={item.id}><path d={path} fill="none" stroke={item.color} strokeWidth={template.lineWidth} strokeLinejoin="round" strokeLinecap="round" />
        {template.marker !== "none" && item.points.filter((_, index) => index % stride === 0).map((point, index) => template.marker === "square"
          ? <rect key={index} x={sx(point.x) - 3} y={sy(point.y) - 3} width={6} height={6} fill="#fff" stroke={item.color} strokeWidth={1.4} />
          : <circle key={index} cx={sx(point.x)} cy={sy(point.y)} r={3.2} fill="#fff" stroke={item.color} strokeWidth={1.4} />)}
      </g>;
    })}
    {fit && graph.fit && (() => { const x0 = bounds.x0 + (bounds.x1 - bounds.x0) * .04, x1 = bounds.x1 - (bounds.x1 - bounds.x0) * .04, y0 = graph.fit.intercept + graph.fit.slope * x0, y1 = graph.fit.intercept + graph.fit.slope * x1; return <g data-origin-fit><line x1={sx(x0)} y1={sy(y0)} x2={sx(x1)} y2={sy(y1)} stroke="#c00000" strokeWidth={1.6} strokeDasharray="7 4" /><text x={MARGIN.left + plotW - 10} y={MARGIN.top + 18} textAnchor="end" fontFamily={font} fontSize={template.fontSize - 1} fill="#8a1c1c">{`y = ${format(graph.fit.intercept)} + ${format(graph.fit.slope)}·x   R² = ${graph.fit.r2.toFixed(4)}`}</text></g>; })()}
    {template.legend === "inside" && series.length > 0 && <g transform={`translate(${MARGIN.left + 12},${MARGIN.top + 12})`}><rect width={Math.max(...series.map(item => item.name.length)) * 7 + 46} height={series.length * 21 + 12} fill="#ffffff" fillOpacity={.9} stroke="#dbe3ea" rx={3} />{series.map((item, index) => <g key={item.id} transform={`translate(9,${index * 21 + 18})`}><line x1={0} x2={20} y1={-4} y2={-4} stroke={item.color} strokeWidth={template.lineWidth} />{template.marker !== "none" && <circle cx={10} cy={-4} r={3} fill="#fff" stroke={item.color} strokeWidth={1.3} />}<text x={27} y={0} fontFamily={font} fontSize={template.fontSize - 1} fill="#31465a">{item.name}</text></g>)}</g>}
    {hover && hoverRow >= 0 && (() => {
      const values = series.map(item => ({ name: item.name, color: item.color, value: item.points.find(point => point.x === hoverX)?.y })).filter(item => typeof item.value === "number");
      const boxW = 176, boxH = 24 + values.length * 18, left = Math.min(WIDTH - MARGIN.right - boxW, hover.px + 14), top = Math.max(MARGIN.top + 8, Math.min(MARGIN.top + plotH - boxH - 8, hover.py - boxH / 2));
      return <g pointerEvents="none" data-origin-hover><line x1={hover.px} x2={hover.px} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="#9bacbc" strokeDasharray="4 4" />{series.map(item => { const point = item.points.find(candidate => candidate.x === hoverX); return point ? <circle key={item.id} cx={sx(point.x)} cy={sy(point.y)} r={3.8} fill={item.color} stroke="#fff" strokeWidth={1.5} /> : null; })}<rect x={left} y={top} width={boxW} height={boxH} rx={4} fill="#172f46f2" /><text x={left + 10} y={top + 17} fontFamily={font} fontSize={11} fill="#dbe8f5">{`${xColumn?.name ?? "X"} = ${hoverX === null ? "" : format(hoverX)}`}</text>{values.map((item, index) => <g key={item.name} transform={`translate(${left + 10},${top + 34 + index * 18})`}><rect width={7} height={7} y={-6} fill={item.color} /><text x={13} y={0} fontFamily={font} fontSize={11} fill="#ffffff">{`${item.name}: ${format(item.value as number)}`}</text></g>)}</g>;
    })()}
    {!all.length && <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" fontFamily={font} fontSize={14} fill="#7b8fa3">该图引用的工作表没有有效数据</text>}
  </svg>;
}
