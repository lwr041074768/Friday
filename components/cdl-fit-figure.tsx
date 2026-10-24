"use client";

import { useId, useState } from "react";
import { axisTicks, formatTick, type AxisTicks } from "../lib/plot-ticks";
import { cdlMeanConfidenceBand, type CdlMeanConfidenceBand } from "../lib/cdl-confidence";
import type {CdlFigureSettings} from "./cdl-axis-settings";

export type CdlFitSeries = {
  id: string;
  name: string;
  color: string;
  points: { rateMV: number; y: number; sd?: number; included?: boolean }[];
  /** Slope is per V/s; displayed X is mV/s. */
  slope: number;
  intercept: number;
  /** Actual OLS model; undefined for an aggregate of independent electrode fits. */
  throughOrigin?: boolean;
};

type PreparedSeries = CdlFitSeries & { domain?: [number, number]; band: CdlMeanConfidenceBand | null };
type Props = {
  rows: CdlFitSeries[];
  half: boolean;
  density: boolean;
  /** Real SVG viewport dimensions; omitted dimensions preserve export defaults. */
  width?: number;
  height?: number;
  compact?: boolean;
  settings?: CdlFigureSettings;
};

const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const validSD = (value: number | undefined): value is number => finite(value) && value >= 0;

function extent(values: number[]): [number, number] | undefined {
  if (!values.length) return;
  let low = Infinity, high = -Infinity;
  for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
  const span = high - low;
  if (!Number.isFinite(span)) return;
  const padding = span > 0 ? span * .09 : low === 0 ? .01 : Math.abs(low) * .1;
  const result: [number, number] = [low - padding, high + padding];
  return result.every(Number.isFinite) && result[1] > result[0] ? result : undefined;
}

function niceTicks(low: number, high: number): AxisTicks {
  try { return axisTicks(low, high, { anchor: 0, minorCount: 0 }); }
  catch { return { major: [low, high], minor: [], step: high - low }; }
}

function color(value: string): string {
  // An exported SVG is self-contained; never accept external paint resources.
  return !/url\s*\(/i.test(value) && /^[#a-zA-Z0-9(),.%\s+-]+$/.test(value) ? value : "#2374d5";
}

function legendLabel(value: string, available: number, fontSize = 16): string {
  let width = 0, output = "";
  for (const character of value) {
    width += /[^\x00-\x7F]/.test(character) ? fontSize : fontSize / 2;
    if (width > available - 14) return output + "…";
    output += character;
  }
  return output;
}

function numeric(value: number): string {
  return Number(value.toPrecision(7)).toString();
}

export default function CdlFitFigure({ rows, half, density, width: requestedWidth, height: requestedHeight, compact = false,settings }: Props) {
  const clipId = "cdl-fit-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [selected, setSelected] = useState<string>();
  const width = finite(requestedWidth) ? Math.max(300, requestedWidth) : 760;
  const shortViewport = compact && finite(requestedHeight) && requestedHeight < 240;
  const legendColumns = shortViewport && rows.length > 4 ? 3 : 2;
  const legendRowHeight = shortViewport ? 18 : compact ? 22 : 27;
  const legendFont = compact ? 12 : 16, tickFont = compact ? 12 : 16, axisFont = shortViewport ? 14 : compact ? 17 : 21;
  const prepared: PreparedSeries[] = rows.map(row => {
    const points = row.points.filter(point => finite(point.rateMV) && finite(point.y));
    const included = points.filter(point => point.included !== false);
    const rates = included.map(point => point.rateMV);
    const candidate: [number, number] | undefined = rates.length && finite(row.slope) && finite(row.intercept)
      ? [Math.min(...rates), Math.max(...rates)] : undefined;
    const domain = candidate?.every(rate => finite(row.slope * rate / 1000 + row.intercept)) ? candidate : undefined;
    const band = domain ? cdlMeanConfidenceBand(points, row.slope, row.intercept, row.throughOrigin) : null;
    return { ...row, points, domain, band };
  }).filter(row => row.points.length);
  const legendHeight = Math.ceil(prepared.length / legendColumns) * legendRowHeight;
  const height = finite(requestedHeight) ? Math.max(shortViewport ? 140 : 240, requestedHeight) : 390 + legendHeight;
  const margin = shortViewport
    ? { left: 64, right: 16, top: 18 + legendHeight, bottom: 48 }
    : compact
    ? { left: 78, right: 24, top: 26 + legendHeight, bottom: 64 }
    : { left: 96, right: 29, top: 30 + legendHeight, bottom: 88 };
  const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  const xValues = prepared.flatMap(row => row.points.map(point => point.rateMV));
  const yValues = prepared.flatMap(row => [
    ...row.points.flatMap(point => {
      const bounds = validSD(point.sd) && point.included !== false ? [point.y - point.sd, point.y + point.sd] : [];
      return [point.y, ...bounds.filter(Number.isFinite)];
    }),
    ...(row.domain ? row.domain.map(rate => row.slope * rate / 1000 + row.intercept).filter(Number.isFinite) : []),
    ...(row.band ? row.band.points.flatMap(point => [point.low, point.high]) : []),
  ]);
  const xDomain = settings?.bounds?[settings.bounds.x0,settings.bounds.x1] as [number,number]:extent(xValues), yDomain = settings?.bounds?[settings.bounds.y0,settings.bounds.y1] as [number,number]:extent(yValues);
  const label = density ? "j" : "I", unit = density ? "mA cm⁻²" : "mA";
  const yLabel = `${half ? `(${label}ₐ − ${label}c)/2` : `${label}ₐ − ${label}c`} / ${unit}`;
  const emptyText = !prepared.length ? "导入 CV 或取点数据后显示 Cdl 拟合图" : "当前数值范围无法绘制，请核对单位和数据";
  const pointText = (row: PreparedSeries, point: PreparedSeries["points"][number]) => `${row.name}；扫速 ${numeric(point.rateMV)} mV/s；${half ? "半电流差" : "电流差"} ${numeric(point.y)} ${unit}${validSD(point.sd) ? `；SD ${numeric(point.sd)} ${unit}` : ""}${point.included === false ? "；未纳入拟合" : ""}`;

  if (!xDomain || !yDomain) return <svg xmlns="http://www.w3.org/2000/svg" data-cdl-figure="fit" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cdl 电流差与扫描速率拟合图" fontFamily="Arial, sans-serif">
    <title>Cdl 电流差与扫描速率拟合图</title>
    <rect width={width} height={height} fill="white" data-plot-background="1"/>
    <text x={width / 2} y={height / 2} textAnchor="middle" fill="#63758a" fontSize={compact ? 13 : 16}>{compact && !prepared.length ? "导入数据后自动显示 Cdl 拟合" : emptyText}</text>
  </svg>;

  const sx = (rateMV: number) => margin.left + (rateMV - xDomain[0]) / (xDomain[1] - xDomain[0]) * plotWidth;
  const sy = (value: number) => margin.top + (yDomain[1] - value) / (yDomain[1] - yDomain[0]) * plotHeight;
  const reduceTicks = (ticks: AxisTicks, limit: number): AxisTicks => {
    if (!compact || ticks.major.length <= limit) return ticks;
    const stride = Math.ceil((ticks.major.length - 1) / (limit - 1));
    return { ...ticks, major: ticks.major.filter((_, index) => index % stride === 0) };
  };
  const tickWarnings:string[]=[];
  function configuredTicks(axis:"x"|"y",domain:[number,number],limit:number):AxisTicks{
    if(settings)try{return axisTicks(...domain,settings.ticks[axis]);}catch(issue){tickWarnings.push(`${axis.toUpperCase()} 轴：${(issue as Error).message}；暂用自动刻度。`);}
    return reduceTicks(niceTicks(...domain),limit);
  }
  const xTicks = configuredTicks("x",xDomain, Math.max(2, Math.floor(plotWidth / 60)));
  const yTicks = configuredTicks("y",yDomain, Math.max(2, Math.floor(plotHeight / 34)));
  const legendWidth = plotWidth / legendColumns;

  return <svg xmlns="http://www.w3.org/2000/svg" data-cdl-figure="fit" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cdl 电流差与扫描速率拟合图，${prepared.length} 条曲线，横轴 mV/s，纵轴 ${unit}${tickWarnings.length?`；${tickWarnings.join(" ")}`:""}`} fontFamily="Arial, sans-serif" data-x-unit="mV/s" data-y-unit={density ? "mA/cm2" : "mA"} data-x-min={xDomain[0]} data-x-max={xDomain[1]} data-y-min={yDomain[0]} data-y-max={yDomain[1]}>
    <title>Cdl 电流差与扫描速率拟合图</title>
    <desc>横轴扫描速率为 mV/s。拟合线使用每 V/s 的斜率乘以横轴数值除以 1000。垂直误差棒显示独立电极间的电流差 SD；浅色带仅用于有明确拟合模型的逐电极 OLS，表示条件 95% 均值置信带，区分含截距和过原点模型，不是预测带。组平均曲线只显示 SD，不推算单一 OLS 置信带。点击或键盘选择数据点可查看数值。</desc>
    <rect width={width} height={height} fill="white" data-plot-background="1"/>
    <defs><clipPath id={clipId}><rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight}/></clipPath></defs>
    <g aria-label="样品图例">{prepared.map((row, index) => <g key={row.id} transform={`translate(${margin.left + index % legendColumns * legendWidth},${(compact ? 17 : 21) + Math.floor(index / legendColumns) * legendRowHeight})`}>
      <title>{row.name}</title>
      <line x1="0" x2="23" y1="-5" y2="-5" stroke={color(row.color)} strokeWidth="2.4"/>
      <circle cx="11.5" cy="-5" r="3.7" fill="white" stroke={color(row.color)} strokeWidth="1.8"/>
      <text x="32" y="0" fontSize={legendFont} fill="#2c4359">{legendLabel(row.name, legendWidth - 43, legendFont)}</text>
    </g>)}</g>
    <g aria-hidden="true">
      {xTicks.major.map(value => <line key={`x-${value}`} x1={sx(value)} x2={sx(value)} y1={margin.top} y2={margin.top + plotHeight} stroke="#e8edf2" strokeWidth="1"/>)}
      {yTicks.major.map(value => <line key={`y-${value}`} x1={margin.left} x2={margin.left + plotWidth} y1={sy(value)} y2={sy(value)} stroke="#e8edf2" strokeWidth="1"/>)}
      <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill="none" stroke="#24394e" strokeWidth="1.8"/>
    </g>
    {xTicks.major.map(value => <g key={`tick-x-${value}`} data-tick-kind="major" data-axis="x" data-tick-value={value}>
      <line x1={sx(value)} x2={sx(value)} y1={margin.top + plotHeight} y2={margin.top + plotHeight + 6} stroke="#24394e" strokeWidth="1.5"/>
      <text x={sx(value)} y={margin.top + plotHeight + (shortViewport ? 18 : compact ? 22 : 27)} textAnchor="middle" fontSize={tickFont} fill="#2c4359">{formatTick(value, xTicks.step)}</text>
    </g>)}
    {yTicks.major.map(value => <g key={`tick-y-${value}`} data-tick-kind="major" data-axis="y" data-tick-value={value}>
      <line x1={margin.left - 6} x2={margin.left} y1={sy(value)} y2={sy(value)} stroke="#24394e" strokeWidth="1.5"/>
      <text x={margin.left - (compact ? 9 : 12)} y={sy(value) + (compact ? 4 : 5)} textAnchor="end" fontSize={tickFont} fill="#2c4359">{formatTick(value, yTicks.step)}</text>
    </g>)}
    {xTicks.minor.map(value=><line key={`minor-x-${value}`} data-tick-kind="minor" data-axis="x" data-tick-value={value} x1={sx(value)} x2={sx(value)} y1={margin.top+plotHeight} y2={margin.top+plotHeight+3} stroke="#24394e"/>)}
    {yTicks.minor.map(value=><line key={`minor-y-${value}`} data-tick-kind="minor" data-axis="y" data-tick-value={value} x1={margin.left-3} x2={margin.left} y1={sy(value)} y2={sy(value)} stroke="#24394e"/>)}
    <g clipPath={`url(#${clipId})`}>{prepared.map(row => {
      const paint = color(row.color);
      return <g key={row.id} data-cdl-series={row.id}>
        {row.band && row.band.points.length > 1 && (()=>{ const { points, level, dof, throughOrigin }=row.band; const upper=points.map(point=>`${sx(point.rate).toFixed(2)},${sy(point.high).toFixed(2)}`).join(" L"); const lower=[...points].reverse().map(point=>`${sx(point.rate).toFixed(2)},${sy(point.low).toFixed(2)}`).join(" L"); return <path data-cdl-confidence-band={row.id} data-confidence-level={level} data-confidence-dof={dof} data-confidence-model={throughOrigin?"through-origin":"intercept"} d={`M${upper} L${lower} Z`} fill={paint} fillOpacity={.12} stroke="none"><title>{`条件 95% 均值置信带（${throughOrigin?"过原点":"含截距"} OLS；自由度 ${dof}；不是电极间 SD）`}</title></path>; })()}
        {row.domain && row.domain[1] > row.domain[0] && <line data-cdl-fit-line={row.id} x1={sx(row.domain[0])} x2={sx(row.domain[1])} y1={sy(row.slope * row.domain[0] / 1000 + row.intercept)} y2={sy(row.slope * row.domain[1] / 1000 + row.intercept)} stroke={paint} strokeWidth="2.4"/>}
        <g data-testid={`cdl-fit-points-${row.id}`} data-cdl-points={row.id}>{row.points.map((point, index) => {
          const text = pointText(row, point), excluded = point.included === false;
          const x = sx(point.rateMV), y = sy(point.y);
          const showError = !excluded && validSD(point.sd) && finite(point.y - point.sd) && finite(point.y + point.sd);
          return <g key={`${point.rateMV}-${index}`} data-cdl-point="true" data-series-id={row.id} data-rate-mv={point.rateMV} data-y={point.y} data-sd={validSD(point.sd) ? point.sd : undefined} data-included={excluded ? "false" : "true"} role="button" tabIndex={0} aria-label={text} onClick={() => setSelected(text)} onFocus={() => setSelected(text)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(text); } }} style={{ cursor: "pointer" }}>
            <title>{text}</title>
            {showError && <g data-cdl-errorbar="true" stroke={paint} strokeWidth="1.5" fill="none">
              <line x1={x} x2={x} y1={sy(point.y - point.sd!)} y2={sy(point.y + point.sd!)}/>
              <line x1={x - 5} x2={x + 5} y1={sy(point.y - point.sd!)} y2={sy(point.y - point.sd!)}/>
              <line x1={x - 5} x2={x + 5} y1={sy(point.y + point.sd!)} y2={sy(point.y + point.sd!)}/>
            </g>}
            <circle cx={x} cy={y} r="7" fill="transparent"/>
            <circle cx={x} cy={y} r={compact ? 3.8 : 4.6} fill={excluded ? "white" : paint} stroke={excluded ? "#8393a4" : "white"} strokeWidth={excluded ? "1.8" : "1.2"}/>
          </g>;
        })}</g>
      </g>;
    })}</g>
    <text x={margin.left + plotWidth / 2} y={height - (shortViewport ? 7 : compact ? 22 : 34)} textAnchor="middle" fontSize={axisFont} fill="#263d54">Scan rate / mV s⁻¹</text>
    <text transform={`translate(${compact ? 21 : 26} ${margin.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={axisFont} fill="#263d54" aria-label={yLabel}>
      {half ? "(" : ""}{label}<tspan baselineShift="sub" fontSize={compact ? 12 : 14}>a</tspan>{" − "}{label}<tspan baselineShift="sub" fontSize={compact ? 12 : 14}>c</tspan>{half ? ")/2 / " : " / "}{unit}
    </text>
    {selected && !shortViewport && <text x={margin.left + plotWidth / 2} y={height - (compact ? 5 : 9)} textAnchor="middle" fontSize={compact ? 12 : 16} fill="#63758a"><title>{selected}</title>{legendLabel(selected, plotWidth + 22, compact ? 12 : 16)}</text>}
  </svg>;
}
