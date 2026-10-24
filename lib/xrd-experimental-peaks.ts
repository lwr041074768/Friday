import type { Curve } from "./lsv-math";
import { referencePeaksAtWavelength, type ReferenceCard } from "./xrd-reference-types";

export type ExperimentalXrdPeak = {
  /** Index in the original curve, including descending scans. */
  index: number;
  x: number;
  intensity: number;
  prominence: number;
  matched: boolean;
  /** Experiment minus nearest visible reference, degrees; not a phase probability. */
  nearestReferenceDelta?: number;
};
export type ExperimentalXrdPeakOptions = {
  wavelength: number;
  toleranceDeg: number;
  minProminencePercent: number;
  minSeparationDeg: number;
  maxPeaks?: number;
};

/** Raw-point peak inspection, with no smoothing, interpolation or peak fitting. */
export function inspectExperimentalPeaks(curve: Curve, cards: ReferenceCard[], options: ExperimentalXrdPeakOptions): { peaks: ExperimentalXrdPeak[]; warnings: string[] } {
  const n = curve.points.length, maximumPeaks = options.maxPeaks ?? 100;
  if (n > 200000) throw new Error("峰提示最多检查 200,000 个原始点，请缩小数据范围。");
  if (!Number.isFinite(options.wavelength) || options.wavelength <= 0 || options.wavelength > 10) throw new Error("峰提示波长需为大于 0、不超过 10 Å 的有效值。");
  if (!Number.isFinite(options.toleranceDeg) || options.toleranceDeg < 0 || options.toleranceDeg > 5) throw new Error("匹配容差需在 0–5° 之间。");
  if (!Number.isFinite(options.minProminencePercent) || options.minProminencePercent <= 0 || options.minProminencePercent > 100) throw new Error("最低突出度需大于 0、不超过原始强度范围的 100%。");
  if (!Number.isFinite(options.minSeparationDeg) || options.minSeparationDeg < 0 || options.minSeparationDeg > 30) throw new Error("最小峰间距需在 0–30° 之间。");
  if (!Number.isInteger(maximumPeaks) || maximumPeaks < 1 || maximumPeaks > 500) throw new Error("最多显示峰数需为 1–500 的整数。");
  const warnings = ["使用原始数据局部极大值和突出度，未平滑或拟合；未匹配峰可能来自噪声、峰位偏移或参考库覆盖不足，不能直接判定杂相。"];
  if (n < 3) return { peaks: [], warnings: [...warnings, "原始数据少于 3 点，无法检查内部局部峰。"] };
  const points = curve.points.map((point, index) => ({ x: point.e, y: point.current, index }));
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error("原始谱包含缺失或非有限数值，请先核对源数据；峰提示不会跨越缺失点连接。");
  const ascending = points[1].x > points[0].x;
  for (let index = 1; index < n; index++) if (ascending ? points[index].x <= points[index - 1].x : points[index].x >= points[index - 1].x) throw new Error("原始 2θ 必须严格单调且无重复点，不能把往返扫描或重叠段直接当作一条 XRD 谱检查。");
  if (!ascending) points.reverse();
  let minY = Infinity, maxY = -Infinity;
  for (const point of points) { minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  if (maxY === minY) return { peaks: [], warnings: [...warnings, "原始谱强度恒定，没有可检查的局部峰。"] };
  const threshold = (maxY - minY) * options.minProminencePercent / 100;
  // Nearest strictly higher raw samples bound the prominence valleys. Equal
  // height points do not prematurely stop the search, including flat tops.
  const left = new Int32Array(n), right = new Int32Array(n), stack: number[] = [];
  for (let index = 0; index < n; index++) {
    while (stack.length && points[stack.at(-1)!].y <= points[index].y) stack.pop();
    left[index] = stack.length ? stack.at(-1)! : 0; stack.push(index);
  }
  stack.length = 0;
  for (let index = n - 1; index >= 0; index--) {
    while (stack.length && points[stack.at(-1)!].y <= points[index].y) stack.pop();
    right[index] = stack.length ? stack.at(-1)! : n - 1; stack.push(index);
  }
  let size = 1; while (size < n) size *= 2;
  const minima = new Float64Array(size * 2).fill(Infinity);
  for (let index = 0; index < n; index++) minima[size + index] = points[index].y;
  for (let index = size - 1; index > 0; index--) minima[index] = Math.min(minima[index * 2], minima[index * 2 + 1]);
  const rangeMinimum = (start: number, end: number): number => {
    let l = start + size, r = end + size, result = Infinity;
    while (l <= r) {
      if (l % 2) result = Math.min(result, minima[l++]);
      if (!(r % 2)) result = Math.min(result, minima[r--]);
      l = Math.floor(l / 2); r = Math.floor(r / 2);
    }
    return result;
  };
  const candidates: ExperimentalXrdPeak[] = [];
  for (let start = 1; start < n - 1; start++) {
    if (points[start].y <= points[start - 1].y) continue;
    let end = start;
    while (end + 1 < n && points[end + 1].y === points[start].y) end++;
    if (end < n - 1 && points[end].y > points[end + 1].y) {
      const center = Math.floor((start + end) / 2), point = points[center];
      const prominence = point.y - Math.max(rangeMinimum(left[center], center), rangeMinimum(center, right[center]));
      if (prominence >= threshold) candidates.push({ index: point.index, x: point.x, intensity: point.y, prominence, matched: false });
    }
    start = end;
  }
  candidates.sort((a, b) => b.prominence - a.prominence || b.intensity - a.intensity || a.x - b.x);
  // A small sorted selection keeps separation checks bounded by maxPeaks.
  const selected: ExperimentalXrdPeak[] = []; let capped = false;
  for (const peak of candidates) {
    if (selected.some(existing => Math.abs(existing.x - peak.x) < options.minSeparationDeg - 1e-10)) continue;
    if (selected.length >= maximumPeaks) { capped = true; break; }
    selected.push(peak);
  }
  if (capped) warnings.push(`达到 ${maximumPeaks} 个显示峰的上限，优先保留突出度较大的峰；此列表不是全部衍射峰。`);
  const positions = cards.filter(card => card.visible).flatMap(card => referencePeaksAtWavelength(card, options.wavelength).filter(peak => peak.intensity > 0 && Number.isFinite(peak.twoTheta)).map(peak => peak.twoTheta)).sort((a, b) => a - b);
  if (!positions.length) warnings.push("没有显示的有效参考卡峰，所有检查到的实验峰暂列为未匹配。");
  const nearest = (x: number): number | undefined => {
    if (!positions.length) return undefined;
    let low = 0, high = positions.length;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (positions[mid] < x) low = mid + 1; else high = mid; }
    const a = positions[Math.max(0, low - 1)], b = positions[Math.min(positions.length - 1, low)];
    return Math.abs(x - a) <= Math.abs(x - b) ? a : b;
  };
  const peaks = selected.sort((a, b) => a.x - b.x).map(peak => {
    const position = nearest(peak.x);
    if (position === undefined) return peak;
    const delta = peak.x - position;
    return { ...peak, matched: Math.abs(delta) <= options.toleranceDeg + 1e-10, nearestReferenceDelta: delta };
  });
  if (!peaks.length) warnings.push(`未找到突出度达到原始强度范围 ${options.minProminencePercent}% 的内部局部峰，请核对阈值、噪声与数据范围。`);
  return { peaks, warnings };
}
