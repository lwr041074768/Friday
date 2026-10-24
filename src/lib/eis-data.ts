import type { Curve, PlotCurve } from "./lsv-math";

export function plotEisCurves(curves: Curve[]): PlotCurve[] {
  return curves.map(c => ({ ...c, invalid: 0, plotted: c.points.map((p, index) => ({
    x: p.e, y: c.imaginary === "negative" ? p.current : -p.current,
    e: p.e, current: p.current, index,
  })) }));
}

function cell(value: string | number | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
  return /[,"\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

// Export full imported curves, including hidden samples and points outside the view.
// Every sample has its own XY columns so Origin can import unequal-length series.
export function buildEisCsv(curves: Curve[]): string {
  if (!curves.length) throw new Error("请先导入 EIS 数据。");
  const rows: (string | number | undefined)[][] = [curves.flatMap(c => [
    `${c.name} Z' / Ω`, `${c.name} Z'' / Ω`, `${c.name} −Z'' / Ω`, `${c.name} Frequency / Hz`,
  ])];
  const count = Math.max(...curves.map(c => c.points.length));
  for (let n = 0; n < count; n++) rows.push(curves.flatMap(c => {
    const p = c.points[n];
    if (!p) return [undefined, undefined, undefined, undefined];
    const raw = c.imaginary === "negative" ? -p.current : p.current;
    return [p.e, raw, -raw, p.frequency];
  }));
  rows.push([], ["样品备注"], ["名称", "来源", "导入虚部约定", "图中显示", "模拟数据", "点数", "单位"]);
  curves.forEach(c => rows.push([c.name, c.source, c.imaginary === "negative" ? "已取负 −Z″" : "原始 Z″", c.visible ? "是" : "否", c.demo ? "是" : "否", c.points.length, "Ω"]));
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
