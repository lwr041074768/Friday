import type { PlotCurve, PlotPoint } from "./lsv-math";
import type { ScanMode } from "./scan-branches";

export type TafelRange = { min: number; max: number };
export type TafelMaskRectangle = { x0: number; x1: number; y0: number; y1: number };
export type TafelFitOptions = {
  scan: ScanMode;
  basis: "current" | "density";
  maskedIndices?: readonly number[];
};
export type TafelFitResult = {
  curveId: string;
  curveName: string;
  range: TafelRange;
  scan: ScanMode;
  basis: "current" | "density";
  indices: number[];
  n: number;
  intercept: number;
  slope: number;
  interceptSE: number;
  slopeSE: number;
  sse: number;
  pearsonR: number | null;
  rSquared: number | null;
  adjustedRSquared: number | null;
  residualSD: number;
  slopeMvPerDec: number;
  slopeSEmvPerDec: number;
  xMin: number;
  xMax: number;
};

function validPoint(point: PlotPoint | null): point is PlotPoint {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Number.isInteger(point.index) && point.index >= 0;
}

function normalizeRange(range: TafelRange): TafelRange {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    throw new Error("拟合范围需为有限数值");
  }
  return { min: Math.min(range.min, range.max), max: Math.max(range.min, range.max) };
}

/** Return original row indices for this curve only; boundary points are included. */
export function indicesInRectangle(curve: PlotCurve, rectangle: TafelMaskRectangle): number[] {
  if (![rectangle.x0, rectangle.x1, rectangle.y0, rectangle.y1].every(Number.isFinite)) {
    throw new Error("屏蔽框的坐标需为有限数值");
  }
  const xMin = Math.min(rectangle.x0, rectangle.x1), xMax = Math.max(rectangle.x0, rectangle.x1);
  const yMin = Math.min(rectangle.y0, rectangle.y1), yMax = Math.max(rectangle.y0, rectangle.y1);
  const indices = new Set<number>();
  for (const point of curve.plotted) {
    if (validPoint(point) && point.x >= xMin && point.x <= xMax && point.y >= yMin && point.y <= yMax) {
      indices.add(point.index);
    }
  }
  return [...indices];
}

/** Mask the display with gaps, preserving original data, row indices and scan breaks. */
export function withTafelMasks(curves: PlotCurve[], masks: Record<string, readonly number[]>): PlotCurve[] {
  return curves.map(curve => {
    const masked = new Set(masks[curve.id] ?? []);
    return { ...curve, plotted: curve.plotted.map(point => point && masked.has(point.index) ? null : point) };
  });
}

// Neumaier compensated summation also handles terms of very different magnitudes.
class StableSum {
  private sum = 0;
  private correction = 0;
  add(value: number) {
    const next = this.sum + value;
    this.correction += Math.abs(this.sum) >= Math.abs(value)
      ? (this.sum - next) + value : (value - next) + this.sum;
    this.sum = next;
  }
  value() { return this.sum + this.correction; }
}

function requireFinite(...values: number[]) {
  if (!values.every(Number.isFinite)) throw new Error("数据数值范围过大，无法可靠计算线性拟合");
}

/**
 * Unweighted, intercept-including ordinary least squares on actual plotted X/Y.
 * Pass a curve already filtered by scan direction. Repeated scan turning points
 * are counted once using their original row index. Original rows stay untouched.
 * Formulas: https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm
 * The mV/dec fields assume Y is in V and X is a base-10 current logarithm.
 */
export function fitTafelLine(curve: PlotCurve, selectedRange: TafelRange, options: TafelFitOptions): TafelFitResult {
  const range = normalizeRange(selectedRange);
  const masked = new Set(options.maskedIndices ?? []), seen = new Set<number>();
  const points: PlotPoint[] = [];
  for (const point of curve.plotted) {
    if (!validPoint(point) || point.x < range.min || point.x > range.max
      || masked.has(point.index) || seen.has(point.index)) continue;
    seen.add(point.index);
    points.push(point);
  }
  const n = points.length;
  if (n < 3) throw new Error("所选范围内至少需要 3 个未屏蔽的有效数据点");

  // Center around an observed point before taking means, avoiding subtraction of
  // two large, almost equal sums for data with a large common coordinate offset.
  const originX = points[0].x, originY = points[0].y;
  const sumX = new StableSum(), sumY = new StableSum();
  let xMin = points[0].x, xMax = points[0].x;
  for (const point of points) {
    const dx = point.x - originX, dy = point.y - originY;
    requireFinite(dx, dy);
    sumX.add(dx); sumY.add(dy);
    xMin = Math.min(xMin, point.x); xMax = Math.max(xMax, point.x);
  }
  const meanDX = sumX.value() / n, meanDY = sumY.value() / n;
  const meanX = originX + meanDX;
  requireFinite(meanDX, meanDY, meanX);
  const sumXX = new StableSum(), sumXY = new StableSum(), sumYY = new StableSum();
  for (const point of points) {
    const dx = (point.x - originX) - meanDX, dy = (point.y - originY) - meanDY;
    sumXX.add(dx * dx); sumXY.add(dx * dy); sumYY.add(dy * dy);
  }
  const sxx = sumXX.value(), sxy = sumXY.value(), syy = sumYY.value();
  requireFinite(sxx, sxy, syy);
  if (!(sxx > 0) || xMin === xMax) throw new Error("所选数据的 X 值没有有效变化，无法拟合斜率");
  const slope = sxy / sxx;
  // Evaluate the offset term separately to retain the small intercept when
  // both coordinate means have a large offset.
  const intercept = (originY - slope * originX) + (meanDY - slope * meanDX);
  requireFinite(slope, intercept);

  const residualSquares = new StableSum();
  for (const point of points) {
    const residual = ((point.y - originY) - meanDY) - slope * ((point.x - originX) - meanDX);
    residualSquares.add(residual * residual);
  }
  const sse = residualSquares.value();
  const residualSD = Math.sqrt(sse / (n - 2));
  const sqrtXX = Math.sqrt(sxx), slopeSE = residualSD / sqrtXX;
  const interceptSE = residualSD * Math.hypot(1 / Math.sqrt(n), meanX / sqrtXX);
  const slopeMvPerDec = slope * 1000, slopeSEmvPerDec = slopeSE * 1000;
  requireFinite(sse, residualSD, slopeSE, interceptSE, slopeMvPerDec, slopeSEmvPerDec);

  // Pearson r and R² have no defined denominator for an exactly constant Y.
  // Keep null so the UI can explicitly show unavailable instead of inventing 1.
  const pearsonR = syy > 0 ? Math.max(-1, Math.min(1, (sxy / sqrtXX) / Math.sqrt(syy))) : null;
  const rSquared = syy > 0 ? Math.max(0, Math.min(1, 1 - sse / syy)) : null;
  const adjustedRSquared = rSquared === null ? null : 1 - (1 - rSquared) * (n - 1) / (n - 2);
  if (pearsonR !== null) requireFinite(pearsonR, rSquared!, adjustedRSquared!);

  return {
    curveId: curve.id, curveName: curve.name, range, scan: options.scan, basis: options.basis,
    indices: points.map(point => point.index), n, intercept, slope, interceptSE, slopeSE,
    sse, pearsonR, rSquared, adjustedRSquared, residualSD, slopeMvPerDec, slopeSEmvPerDec, xMin, xMax,
  };
}
