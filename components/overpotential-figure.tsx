"use client";

import { useId, type Ref } from "react";
import type { OverpotentialAxes } from "@/lib/overpotential-axes";
import type { OverpotentialRow } from "@/lib/overpotential-data";
import type { OverpotentialStyle } from "@/lib/overpotential-styles";
import { formatTick } from "@/lib/plot-ticks";

export type OverpotentialFigureProps = {
  rows: readonly OverpotentialRow[];
  axes: OverpotentialAxes;
  style: OverpotentialStyle;
  scanLabel?: string;
  demo?: boolean;
  compact?: boolean;
  svgRef?: Ref<SVGSVGElement>;
  errors?: Record<string, number | undefined>;
};

function readingStatus(row: OverpotentialRow) {
  if (row.reading.etaMV === undefined || !Number.isFinite(row.reading.etaMV)) return "待核对";
  if (row.reading.etaMV < 0) return "负值 · 请核对";
  return row.reading.candidate ? "候选读数" : "已读取";
}

function sampleLines(name: string, width: number, fontSize = 12) {
  const budget = Math.max(3, (width - 12) / fontSize), lines: string[] = [];
  let current = "", used = 0;
  for (const character of Array.from(name || "未命名样品")) {
    const weight = /[\x00-\x7F]/.test(character) ? .58 : 1;
    if (used + weight > budget && current) {
      lines.push(current);
      if (lines.length === 3) {
        lines[2] = Array.from(lines[2]).slice(0, -1).join("") + "…";
        return lines;
      }
      current = ""; used = 0;
    }
    current += character; used += weight;
  }
  if (current) lines.push(current);
  return lines;
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function paletteColor(style: OverpotentialStyle, row: OverpotentialRow, index: number) {
  if (style.paletteMode === "source") return row.curve.color;
  return style.palette[style.paletteMode === "single" ? 0 : index % style.palette.length] ?? "#4477AA";
}
function numericLabel(value: number) {
  // Values remain unchanged; only very large/small labels use scientific notation.
  return Math.abs(value) >= 1e7 || (value !== 0 && Math.abs(value) < 1e-3) ? value.toExponential(2) : value.toFixed(1);
}
function luminance(color: string) {
  const text = color.replace("#", ""), hex = text.length === 3 ? text.split("").map(value => value + value).join("") : text;
  if (!/^[\da-f]{6}$/i.test(hex)) return .2;
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

/** Draw only the value-facing corners rounded, with the base precisely at zero. */
function roundedBarPath(x: number, y: number, w: number, h: number, radius: number,
  horizontal: boolean, negative: boolean) {
  const r = Math.min(radius, w / 2, h / 2);
  if (horizontal) {
    return negative
      ? `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`
      : `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  return negative
    ? `M${x},${y}H${x + w}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}Z`
    : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export default function OverpotentialFigure({ rows, axes, style, scanLabel = "正扫", demo = false, compact = false, svgRef, errors }: OverpotentialFigureProps) {
  const seed = "eta-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const clipId = `${seed}-plot`, titleId = `${seed}-title`, descriptionId = `${seed}-description`;
  const horizontal = style.orientation === "horizontal", width = 900, height = 530, top = 55;
  const yLabelLength = Math.max(1, ...axes.y.majorTicks.map(tick => formatTick(tick, axes.y.major).length));
  const left = horizontal ? 220 : Math.max(86, Math.min(245, Math.ceil(yLabelLength * 13 * .64 + 50)));
  const right = horizontal ? 45 : 30, bottom = horizontal ? 440 : 400;
  const plotWidth = width - left - right, plotHeight = bottom - top;
  const slot = (horizontal ? plotHeight : plotWidth) / (axes.x.max - axes.x.min);
  const thickness = Math.min(horizontal ? 46 : 86, slot * style.barRatio);
  const category = (value: number) => horizontal
    ? top + (value - axes.x.min) / (axes.x.max - axes.x.min) * plotHeight
    : left + (value - axes.x.min) / (axes.x.max - axes.x.min) * plotWidth;
  const valueCoordinate = (value: number) => horizontal
    ? left + (value - axes.y.min) / (axes.y.max - axes.y.min) * plotWidth
    : bottom - (value - axes.y.min) / (axes.y.max - axes.y.min) * plotHeight;
  // Clamp geometry before mapping to avoid overflow at manual viewports. Clipping
  // retains the exact visible segment between zero and the original signed value.
  const visibleValueCoordinate = (value: number) => valueCoordinate(clamp(value, axes.y.min, axes.y.max));
  const zero = visibleValueCoordinate(0), zeroVisible = axes.y.min <= 0 && axes.y.max >= 0;
  const family = style.font === "serif" ? "Times New Roman, Noto Serif SC, SimSun, serif" : "Arial, Microsoft YaHei, sans-serif";
  const axisColor = "#364A5B", labelColor = "#294052", minorColor = "#738391";
  const majorStroke = style.grid === "dashed" ? "#D5DFE5" : "#E4EBEF";
  const plotClip = `url(#${clipId})`;

  return <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height}
    role="img" aria-labelledby={`${titleId} ${descriptionId}`} data-eta-style-id={style.id} data-eta-style-name={style.name} data-eta-orientation={style.orientation}
    data-eta-x-min={axes.x.min} data-eta-x-max={axes.x.max} data-eta-y-min={axes.y.min} data-eta-y-max={axes.y.max}
    data-eta-zero-visible={zeroVisible ? "true" : "false"} data-eta-demo={demo ? "true" : "false"}>
    <title id={titleId}>{`${demo ? "示例数据 · " : ""}${scanLabel} η₁₀ 过电位对比柱状图 · ${style.name}（按已应用 IR）`}</title>
    <desc id={descriptionId}>{horizontal ? "横轴为过电位 mV，纵轴为原样品序号；" : "横轴为原样品序号，纵轴为过电位 mV；"}{rows.map(row => `${row.curve.name}：${row.reading.etaMV === undefined ? row.reading.note : `${row.reading.etaMV} mV，${readingStatus(row)}`}${errors?.[row.curve.id] !== undefined ? `，误差 ±${errors[row.curve.id]} mV` : ""}`).join("；")}</desc>
    <defs>
      <clipPath id={clipId}><rect x={left} y={top} width={plotWidth} height={plotHeight}/></clipPath>
      {rows.map((row, index) => {
        const color = paletteColor(style, row, index);
        return <pattern key={row.curve.id} id={`${seed}-pattern-${index}`} width={8} height={8} patternUnits="userSpaceOnUse">
          <rect width={8} height={8} fill="#FFFFFF"/>
          {style.fill === "diagonal" && <path d="M-2,2L2,-2M0,8L8,0M6,10L10,6" stroke={color} strokeWidth={1.1} fill="none"/>}
          {style.fill === "cross" && <path d="M0,0L8,8M0,8L8,0" stroke={color} strokeWidth={.9} fill="none"/>}
          {style.fill === "dots" && <><circle cx={2} cy={2} r={1.1} fill={color}/><circle cx={6} cy={6} r={1.1} fill={color}/></>}
          {style.fill === "horizontal" && <path d="M0,2H8M0,6H8" stroke={color} strokeWidth={.85} fill="none"/>}
          {style.fill === "vertical" && <path d="M2,0V8M6,0V8" stroke={color} strokeWidth={.85} fill="none"/>}
        </pattern>;
      })}
    </defs>
    <rect width={width} height={height} fill="#FFFFFF" data-plot-background="1"/>
    <text x={left} y={28} fill={labelColor} fontFamily={family} fontSize={compact ? 15 : 16} fontWeight={600}>η₁₀ · 10 mA·cm⁻² · 已应用 IR</text>
    <text x={width - right} y={28} textAnchor="end" fill={demo ? "#996626" : "#6C8194"} fontFamily={family} fontSize={13}>{demo ? `模拟数据 / ${scanLabel}` : `${scanLabel} / ${rows.length} 个样品`}</text>
    {style.grid === "bands" && <g clipPath={plotClip}>{axes.y.majorTicks.slice(0, -1).map((tick, index) => index % 2 === 0
      ? horizontal ? <rect key={tick} x={valueCoordinate(tick)} y={top} width={Math.abs(valueCoordinate(axes.y.majorTicks[index + 1]) - valueCoordinate(tick))} height={plotHeight} fill="#F3F6F8"/>
        : <rect key={tick} x={left} y={valueCoordinate(axes.y.majorTicks[index + 1])} width={plotWidth} height={Math.abs(valueCoordinate(axes.y.majorTicks[index + 1]) - valueCoordinate(tick))} fill="#F3F6F8"/>
      : null)}</g>}
    {axes.y.majorTicks.map(tick => <g key={tick} data-eta-y-major-tick={tick}>
      {(style.grid === "major" || style.grid === "dashed" || tick === 0) && (horizontal
        ? <line x1={valueCoordinate(tick)} x2={valueCoordinate(tick)} y1={top} y2={bottom} stroke={tick === 0 ? "#8698A6" : majorStroke} strokeWidth={tick === 0 ? 1.3 : .9} strokeDasharray={tick !== 0 && style.grid === "dashed" ? "4 5" : undefined}/>
        : <line x1={left} x2={width - right} y1={valueCoordinate(tick)} y2={valueCoordinate(tick)} stroke={tick === 0 ? "#8698A6" : majorStroke} strokeWidth={tick === 0 ? 1.3 : .9} strokeDasharray={tick !== 0 && style.grid === "dashed" ? "4 5" : undefined}/>)}
      {horizontal ? <><line x1={valueCoordinate(tick)} x2={valueCoordinate(tick)} y1={bottom} y2={bottom + 7} stroke={axisColor}/><text x={valueCoordinate(tick)} y={bottom + 24} textAnchor="middle" fill={axisColor} fontFamily={family} fontSize={13}>{formatTick(tick, axes.y.major)}</text></>
        : <><line x1={left - 7} x2={left} y1={valueCoordinate(tick)} y2={valueCoordinate(tick)} stroke={axisColor}/><text x={left - 13} y={valueCoordinate(tick) + 4} textAnchor="end" fill={axisColor} fontFamily={family} fontSize={13}>{formatTick(tick, axes.y.major)}</text></>}
    </g>)}
    {zeroVisible && !axes.y.majorTicks.includes(0) && (horizontal
      ? <line data-eta-zero-line="true" x1={valueCoordinate(0)} x2={valueCoordinate(0)} y1={top} y2={bottom} stroke="#8698A6" strokeWidth={1.3}/>
      : <line data-eta-zero-line="true" x1={left} x2={width - right} y1={valueCoordinate(0)} y2={valueCoordinate(0)} stroke="#8698A6" strokeWidth={1.3}/>)}
    {axes.y.minorTicks.map(tick => horizontal
      ? <line key={tick} data-eta-y-minor-tick={tick} x1={valueCoordinate(tick)} x2={valueCoordinate(tick)} y1={bottom} y2={bottom + 3.5} stroke={minorColor} strokeWidth={.8}/>
      : <line key={tick} data-eta-y-minor-tick={tick} x1={left - 3.5} x2={left} y1={valueCoordinate(tick)} y2={valueCoordinate(tick)} stroke={minorColor} strokeWidth={.8}/>)}
    <line x1={left} x2={left} y1={top} y2={bottom} stroke={axisColor} strokeWidth={1.25}/>
    <line x1={left} x2={width - right} y1={bottom} y2={bottom} stroke={axisColor} strokeWidth={1.25}/>
    {style.frame === "box" && <><line x1={left} x2={width - right} y1={top} y2={top} stroke={axisColor} strokeWidth={1.25}/><line x1={width - right} x2={width - right} y1={top} y2={bottom} stroke={axisColor} strokeWidth={1.25}/></>}
    {axes.x.majorTicks.map(tick => <g key={tick} data-eta-x-major-tick={tick}>{horizontal
      ? <><line x1={left - 6} x2={left} y1={category(tick)} y2={category(tick)} stroke={axisColor}/><text x={left - 9} y={category(tick) + 4} textAnchor="end" fill={axisColor} fontFamily={family} fontSize={11}>{formatTick(tick, axes.x.major)}</text></>
      : <><line x1={category(tick)} x2={category(tick)} y1={bottom} y2={bottom + 7} stroke={axisColor}/><text x={category(tick)} y={bottom + 24} textAnchor="middle" fill={axisColor} fontFamily={family} fontSize={13}>{formatTick(tick, axes.x.major)}</text></>}</g>)}
    {axes.x.minorTicks.map(tick => horizontal
      ? <line key={tick} data-eta-x-minor-tick={tick} x1={left - 3} x2={left} y1={category(tick)} y2={category(tick)} stroke={minorColor} strokeWidth={.8}/>
      : <line key={tick} data-eta-x-minor-tick={tick} x1={category(tick)} x2={category(tick)} y1={bottom} y2={bottom + 3.5} stroke={minorColor} strokeWidth={.8}/>)}
    {!horizontal && <text transform={`translate(25 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fill={labelColor} fontFamily={family} fontSize={16}>Overpotential η₁₀ (mV)</text>}
    {rows.map((row, index) => {
      const { curve, reading } = row, position = index + 1, center = category(position);
      const eta = reading.etaMV !== undefined && Number.isFinite(reading.etaMV) ? reading.etaMV : undefined;
      const etaError = eta !== undefined && Number.isFinite(errors?.[curve.id]) && (errors?.[curve.id] ?? 0) > 0 ? errors![curve.id]! : undefined;
      const inRange = position >= axes.x.min && position <= axes.x.max, color = paletteColor(style, row, index);
      const end = eta === undefined ? zero : visibleValueCoordinate(eta);
      const length = Math.abs(end - zero), negative = (eta ?? 0) < 0, valueInRange = eta !== undefined && eta >= axes.y.min && eta <= axes.y.max;
      const barX = horizontal ? Math.min(zero, end) : center - thickness / 2;
      const barY = horizontal ? center - thickness / 2 : Math.min(zero, end);
      const barW = horizontal ? length : thickness, barH = horizontal ? thickness : length;
      const fill = style.fill === "outline" ? "#FFFFFF" : style.fill === "solid" ? color : `url(#${seed}-pattern-${index})`;
      const stroke = style.outlineColor === "bar" ? color : style.outlineColor;
      const valueText = eta === undefined ? "" : numericLabel(eta);
      const valueTextWidth = valueText.length * 7.5;
      const outsideFits = horizontal ? negative ? end - left >= valueTextWidth + 15 : width - right - end >= valueTextWidth + 15
        : negative ? bottom - end >= 24 : end - top >= 25;
      const inside = (style.labels === "inside" || !outsideFits) && length >= (horizontal ? valueTextWidth + 18 : 29) && valueInRange && eta !== 0;
      const textColor = inside && style.fill === "solid" && style.opacity > .75 && luminance(color) < .59 ? "#FFFFFF" : negative ? "#A35222" : labelColor;
      const nameWidth = horizontal ? left - 45 : Math.min(slot, plotWidth);
      const nameLines = sampleLines(curve.name, nameWidth, horizontal ? 11 : 12);
      const nameCenter = clamp(center, left + nameWidth / 2, width - right - nameWidth / 2);
      const horizontalAnchor = inside ? negative ? "start" : "end" : negative ? "end" : "start";
      const horizontalTextX = clamp(end + (inside ? negative ? 9 : -9 : negative ? -9 : 9),
        left + 7 + (horizontalAnchor === "end" ? valueTextWidth : 0),
        width - right - 7 - (horizontalAnchor === "start" ? valueTextWidth : 0));
      return <g key={curve.id} data-overpotential-curve-id={curve.id} data-eta-status={reading.status} data-eta-mv={eta ?? ""} data-eta-position={position}>
        <title>{`${curve.name} · ${eta === undefined ? reading.note : `${eta} mV · ${reading.note}`}${!curve.visible ? " · 在 LSV 中隐藏" : ""}`}</title>
        {inRange && <><g clipPath={plotClip}>
          {eta === undefined ? <text x={horizontal ? clamp(zero + 18, left + 15, width - right - 15) : center} y={horizontal ? center + 6 : clamp(zero - 12, top + 20, bottom - 12)} textAnchor={horizontal ? "start" : "middle"} fontFamily={family} fontSize={21} fill="#8497A6">—</text>
            : <>{eta === 0 && zeroVisible ? horizontal
              ? <line data-eta-bar="true" data-eta-zero="true" x1={zero} x2={zero} y1={center - thickness / 2} y2={center + thickness / 2} stroke={color} strokeWidth={3}/>
              : <line data-eta-bar="true" data-eta-zero="true" x1={center - thickness / 2} x2={center + thickness / 2} y1={zero} y2={zero} stroke={color} strokeWidth={3}/>
              : length <= 0 ? null : style.corners === "top-round" && valueInRange
                ? <path data-eta-bar="true" data-eta-bar-x={barX} data-eta-bar-y={barY} data-eta-bar-width={barW} data-eta-bar-height={barH} d={roundedBarPath(barX, barY, barW, barH, 9, horizontal, negative)} fill={fill} fillOpacity={style.opacity} stroke={style.outline ? stroke : undefined} strokeWidth={style.outline}/>
                : <rect data-eta-bar="true" x={barX} y={barY} width={barW} height={barH} fill={fill} fillOpacity={style.opacity} stroke={style.outline ? stroke : undefined} strokeWidth={style.outline}/>
              }
              {style.cap === "line" && valueInRange && (horizontal
                ? <line x1={end} x2={end} y1={center - thickness / 2} y2={center + thickness / 2} stroke={stroke} strokeWidth={2.6}/>
                : <line x1={center - thickness / 2} x2={center + thickness / 2} y1={end} y2={end} stroke={stroke} strokeWidth={2.6}/>)}
              {etaError !== undefined && valueInRange && (() => {
                const high = clamp(valueCoordinate(eta! + etaError), horizontal ? left : top, horizontal ? width - right : bottom);
                const low = clamp(valueCoordinate(eta! - etaError), horizontal ? left : top, horizontal ? width - right : bottom);
                return <g data-eta-errorbar="true" data-eta-error={etaError} stroke="#3C5568" strokeWidth="1.5" fill="none">
                  {horizontal ? <><line x1={low} x2={high} y1={center} y2={center}/><line x1={low} x2={low} y1={center - 7} y2={center + 7}/><line x1={high} x2={high} y1={center - 7} y2={center + 7}/></>
                    : <><line x1={center} x2={center} y1={low} y2={high}/><line x1={center - 7} x2={center + 7} y1={low} y2={low}/><line x1={center - 7} x2={center + 7} y1={high} y2={high}/></>}
                </g>;
              })()}
              {valueInRange && (horizontal
                ? <text data-eta-value-label="true" x={horizontalTextX} y={center + 4} textAnchor={horizontalAnchor} fontFamily={family} fontSize={13} fontWeight={600} fill={textColor}>{valueText}</text>
                : <text data-eta-value-label="true" x={clamp(center, left + valueTextWidth / 2 + 3, width - right - valueTextWidth / 2 - 3)} y={clamp(end + (inside ? negative ? -9 : 20 : negative ? 20 : -10), top + 15, bottom - 5)} textAnchor="middle" fontFamily={family} fontSize={15} fontWeight={600} fill={textColor}>{valueText}</text>)}
            </>}
        </g>
          {horizontal ? <text x={left - 30} y={clamp(center - (nameLines.length - 1) * 6, top + 5, bottom - (nameLines.length - 1) * 12)} textAnchor="end" fontFamily={family} fontSize={11} fill="#3D596E"><title>{curve.name}</title>{nameLines.map((line, lineIndex) => <tspan key={lineIndex} x={left - 30} dy={lineIndex ? 12 : 0}>{line}</tspan>)}</text>
            : <text x={nameCenter} y={bottom + 44} textAnchor="middle" fontFamily={family} fontSize={12} fill="#3D596E"><title>{curve.name}</title>{nameLines.map((line, lineIndex) => <tspan key={lineIndex} x={nameCenter} dy={lineIndex ? 14 : 0}>{line}</tspan>)}</text>}
        </>}
      </g>;
    })}
    <text x={(left + width - right) / 2} y={height - 16} textAnchor="middle" fill={labelColor} fontFamily={family} fontSize={16}>{horizontal ? "Overpotential η₁₀ (mV)" : "样品序号"}</text>
    {horizontal && <text x={left - 25} y={top - 9} textAnchor="end" fill={labelColor} fontFamily={family} fontSize={12}>样品名称 / 序号</text>}
  </svg>;
}
