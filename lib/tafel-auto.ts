/**
 * Automatic selection of a linear Tafel window, plus confidence intervals for
 * the slope and the exchange current density derived from a fitted window.
 *
 * Input points are already transformed Tafel coordinates:
 *   x = log10(|current| or |current density|), y = overpotential in V,
 *   index = original data-row number.
 *
 * The fit is unweighted ordinary least squares with an intercept. It uses the
 * same centered, compensated-summation formulas as lib/tafel-analysis.ts; that
 * existing file is deliberately left untouched.
 *
 * Search cost and the 4000-point cap:
 *   Every start/end pair with at least `minPoints` points and at least
 *   `minSpan` decades is considered. Window moments are obtained from prefix
 *   sums in O(1), so the scan is O(n^2) for up to 4000 unique points (about
 *   8 million windows; typically well under a second). Above 4000 unique
 *   points the sorted input is uniformly downsampled to 4000 points, keeping
 *   both endpoints, before scanning. Returned `indices` are still original
 *   row indices, but a fit then represents the sampled points only. The 64
 *   highest approximate scores are re-fitted directly (two-pass, compensated
 *   sums) so the reported coefficients, standard errors and R² do not rely on
 *   the prefix approximation.
 */

export type TafelAutoPoint = { x: number; y: number; index: number };
export type TafelAutoFit = {
  indices: number[]; n: number; min: number; max: number;
  intercept: number; slope: number; interceptSE: number; slopeSE: number;
  rSquared: number | null; residualSD: number; score: number;
};
export type TafelAutoOptions = { minPoints?: number; minSpan?: number; level?: number };
export type TafelAutoResult = { best: TafelAutoFit | null; candidates: TafelAutoFit[]; reason?: string };

const DEFAULT_MIN_POINTS = 6;
const DEFAULT_MIN_SPAN = 0.3;
const MAX_SCAN_POINTS = 4000;
const TOP_CANDIDATES = 5;
const SCAN_CANDIDATES = 64;
const SPAN_WEIGHT = 0.15;
const COUNT_WEIGHT = 0.002;
const SPAN_TOLERANCE = 1e-12;

/** Neumaier compensated summation, copied in spirit from lib/tafel-analysis.ts. */
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

function failure(reason: string): TafelAutoResult {
  return { best: null, candidates: [], reason };
}

function normalizeOptions(options?: TafelAutoOptions): { minPoints: number; minSpan: number } {
  const rawMinPoints = options?.minPoints;
  const minPoints = typeof rawMinPoints === "number" && Number.isFinite(rawMinPoints)
    ? Math.max(3, Math.floor(rawMinPoints)) : DEFAULT_MIN_POINTS;
  const rawMinSpan = options?.minSpan;
  const minSpan = typeof rawMinSpan === "number" && Number.isFinite(rawMinSpan)
    ? Math.max(0, rawMinSpan) : DEFAULT_MIN_SPAN;
  // options.level is intentionally not used here: window selection is
  // confidence-level independent. Callers pass the same level to
  // slopeConfidence when they display the interval.
  return { minPoints, minSpan };
}

function compareFits(a: TafelAutoFit, b: TafelAutoFit): number {
  if (b.score !== a.score) return b.score - a.score;
  const spanA = a.max - a.min, spanB = b.max - b.min;
  if (spanB !== spanA) return spanB - spanA;
  if (b.n !== a.n) return b.n - a.n;
  if (a.min !== b.min) return a.min - b.min;
  return a.indices[0] - b.indices[0];
}

/**
 * Two-pass OLS over points[start..end] (inclusive), matching tafel-analysis.ts:
 * centre on the first point before means, use compensated sums, then evaluate
 * the intercept offset separately. Returns null rather than throwing for a
 * window whose moments overflow or whose R² is undefined (constant Y).
 */
function fitWindow(
  points: readonly TafelAutoPoint[],
  start: number,
  end: number,
  minSpan: number,
): TafelAutoFit | null {
  const n = end - start + 1;
  if (n < 3) return null;

  const originX = points[start].x, originY = points[start].y;
  const sumX = new StableSum(), sumY = new StableSum();
  let xMin = points[start].x, xMax = points[start].x;
  for (let k = start; k <= end; k++) {
    const dx = points[k].x - originX, dy = points[k].y - originY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    sumX.add(dx); sumY.add(dy);
    if (points[k].x < xMin) xMin = points[k].x;
    if (points[k].x > xMax) xMax = points[k].x;
  }
  const meanDX = sumX.value() / n, meanDY = sumY.value() / n;
  const meanX = originX + meanDX;
  if (!Number.isFinite(meanDX) || !Number.isFinite(meanDY) || !Number.isFinite(meanX)) return null;

  const sumXX = new StableSum(), sumXY = new StableSum(), sumYY = new StableSum();
  for (let k = start; k <= end; k++) {
    const dx = (points[k].x - originX) - meanDX;
    const dy = (points[k].y - originY) - meanDY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    sumXX.add(dx * dx); sumXY.add(dx * dy); sumYY.add(dy * dy);
  }
  const sxx = sumXX.value(), sxy = sumXY.value(), syy = sumYY.value();
  if (!Number.isFinite(sxx) || !Number.isFinite(sxy) || !Number.isFinite(syy)) return null;
  if (!(sxx > 0) || !(xMax > xMin)) return null;

  const slope = sxy / sxx;
  const intercept = (originY - slope * originX) + (meanDY - slope * meanDX);
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;

  const residualSquares = new StableSum();
  for (let k = start; k <= end; k++) {
    const residual = ((points[k].y - originY) - meanDY)
      - slope * ((points[k].x - originX) - meanDX);
    if (!Number.isFinite(residual)) return null;
    residualSquares.add(residual * residual);
  }
  // Compensated summation of non-negative terms cannot be meaningfully
  // negative; clamp a possible -0/rounding artefact so sqrt stays real.
  const sse = Math.max(0, residualSquares.value());
  const residualSD = Math.sqrt(sse / (n - 2));
  const sqrtXX = Math.sqrt(sxx);
  const slopeSE = residualSD / sqrtXX;
  const interceptSE = residualSD * Math.hypot(1 / Math.sqrt(n), meanX / sqrtXX);
  if (!Number.isFinite(residualSD) || !Number.isFinite(slopeSE) || !Number.isFinite(interceptSE)) return null;

  const rSquared = syy > 0 ? Math.max(0, Math.min(1, 1 - sse / syy)) : null;
  if (rSquared === null || !Number.isFinite(rSquared)) return null;
  const span = xMax - xMin;
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const score = rSquared - SPAN_WEIGHT * (minSpan / span) - COUNT_WEIGHT / Math.sqrt(n);
  if (!Number.isFinite(score)) return null;

  return {
    indices: points.slice(start, end + 1).map(point => point.index),
    n, min: xMin, max: xMax, intercept, slope, interceptSE, slopeSE,
    rSquared, residualSD, score,
  };
}

/**
 * Select the best-scoring linear window from pre-computed Tafel points.
 *
 * Window score = R² - 0.15·(minSpan/span) - 0.002/√n. R² must be defined.
 * `best` is the highest-scoring deduplicated window; `candidates` holds up to
 * five distinct index sets in descending score order. Invalid points (NaN or
 * infinite x/y, non-integer/negative index) are ignored. Duplicate indices are
 * collapsed, keeping the first occurrence in the input. Windows shorter than
 * three points are impossible because standard errors require n >= 3.
 */
export function autoTafelWindow(
  points: readonly TafelAutoPoint[],
  options?: TafelAutoOptions,
): TafelAutoResult {
  const { minPoints, minSpan } = normalizeOptions(options);
  if (!Array.isArray(points)) return failure("输入不是有效的数据点数组");

  const unique: TafelAutoPoint[] = [];
  const seenIndices = new Set<number>();
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || !Number.isInteger(point.index) || point.index < 0) continue;
    if (seenIndices.has(point.index)) continue;
    seenIndices.add(point.index);
    unique.push({ x: point.x, y: point.y, index: point.index });
  }
  if (unique.length < minPoints) {
    return failure(`有效点不足 ${minPoints} 个（仅 ${unique.length} 个有限且 index 不重复的点）`);
  }
  if (minPoints > MAX_SCAN_POINTS) {
    return failure(`最小点数 ${minPoints} 超过自动扫描上限 ${MAX_SCAN_POINTS} 点`);
  }

  unique.sort((a, b) => {
    const dx = a.x - b.x;
    if (dx !== 0) return dx;
    if (a.index !== b.index) return a.index - b.index;
    return 0;
  });

  let scanPoints: TafelAutoPoint[] = unique;
  if (unique.length > MAX_SCAN_POINTS) {
    const sampled: TafelAutoPoint[] = [];
    const last = unique.length - 1;
    for (let k = 0; k < MAX_SCAN_POINTS; k++) {
      sampled.push(unique[Math.round((k * last) / (MAX_SCAN_POINTS - 1))]);
    }
    scanPoints = sampled;
  }
  if (scanPoints.length < minPoints) {
    return failure(`有效点不足 ${minPoints} 个（降采样后仅 ${scanPoints.length} 个点）`);
  }

  const count = scanPoints.length;
  const totalSpan = scanPoints[count - 1].x - scanPoints[0].x;
  if (!(totalSpan > 0)) return failure("有效 X 值没有变化，无法拟合斜率");
  const spanTolerance = SPAN_TOLERANCE * Math.max(1, Math.abs(minSpan));
  if (totalSpan + spanTolerance < minSpan) {
    return failure(`没有跨度 ≥${minSpan} 的连续窗口（有效 X 总跨度为 ${totalSpan.toFixed(3)} decade）`);
  }

  const originX = scanPoints[0].x, originY = scanPoints[0].y;
  const px = new Float64Array(count + 1), py = new Float64Array(count + 1);
  const pxx = new Float64Array(count + 1), pxy = new Float64Array(count + 1);
  const pyy = new Float64Array(count + 1);
  let yMin = scanPoints[0].y, yMax = scanPoints[0].y;
  for (let k = 0; k < count; k++) {
    const dx = scanPoints[k].x - originX, dy = scanPoints[k].y - originY;
    const dx2 = dx * dx, dy2 = dy * dy, dxy = dx * dy;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dx2)
      || !Number.isFinite(dy2) || !Number.isFinite(dxy)) {
      return failure("数据数值范围过大，无法可靠计算线性拟合");
    }
    px[k + 1] = px[k] + dx; py[k + 1] = py[k] + dy;
    pxx[k + 1] = pxx[k] + dx2; pxy[k + 1] = pxy[k] + dxy; pyy[k + 1] = pyy[k] + dy2;
    if (!Number.isFinite(px[k + 1]) || !Number.isFinite(py[k + 1])
      || !Number.isFinite(pxx[k + 1]) || !Number.isFinite(pxy[k + 1])
      || !Number.isFinite(pyy[k + 1])) {
      return failure("数据数值范围过大，无法可靠计算线性拟合");
    }
    if (scanPoints[k].y < yMin) yMin = scanPoints[k].y;
    if (scanPoints[k].y > yMax) yMax = scanPoints[k].y;
  }

  const invN = new Float64Array(count + 1);
  const countPenalty = new Float64Array(count + 1);
  for (let n = 1; n <= count; n++) {
    invN[n] = 1 / n;
    countPenalty[n] = COUNT_WEIGHT / Math.sqrt(n);
  }
  const spanPenalty = SPAN_WEIGHT * minSpan;

  // Min-heap of the best approximate candidates (score, start, end).
  const heapScore: number[] = [];
  const heapStart: number[] = [];
  const heapEnd: number[] = [];
  function heapSiftUp(position: number) {
    let pos = position;
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (heapScore[parent] <= heapScore[pos]) break;
      const score = heapScore[parent]; heapScore[parent] = heapScore[pos]; heapScore[pos] = score;
      const start = heapStart[parent]; heapStart[parent] = heapStart[pos]; heapStart[pos] = start;
      const end = heapEnd[parent]; heapEnd[parent] = heapEnd[pos]; heapEnd[pos] = end;
      pos = parent;
    }
  }
  function heapSiftDown(position: number) {
    let pos = position;
    const size = heapScore.length;
    for (;;) {
      const left = pos * 2 + 1;
      if (left >= size) break;
      const right = left + 1;
      let smallest = left;
      if (right < size && heapScore[right] < heapScore[left]) smallest = right;
      if (heapScore[pos] <= heapScore[smallest]) break;
      const score = heapScore[pos]; heapScore[pos] = heapScore[smallest]; heapScore[smallest] = score;
      const start = heapStart[pos]; heapStart[pos] = heapStart[smallest]; heapStart[smallest] = start;
      const end = heapEnd[pos]; heapEnd[pos] = heapEnd[smallest]; heapEnd[smallest] = end;
      pos = smallest;
    }
  }
  function offer(score: number, start: number, end: number) {
    if (heapScore.length < SCAN_CANDIDATES) {
      const pos = heapScore.length;
      heapScore.push(score); heapStart.push(start); heapEnd.push(end);
      heapSiftUp(pos);
    } else if (score > heapScore[0]) {
      heapScore[0] = score; heapStart[0] = start; heapEnd[0] = end;
      heapSiftDown(0);
    }
  }

  let firstBySpan = 0;
  for (let i = 0; i < count; i++) {
    const xi = scanPoints[i].x;
    while (firstBySpan < count && scanPoints[firstBySpan].x - xi + spanTolerance < minSpan) {
      firstBySpan++;
    }
    const jStart = Math.max(i + minPoints - 1, firstBySpan);
    if (jStart >= count) continue;
    const pxi = px[i], pyi = py[i], pxxi = pxx[i], pxyi = pxy[i], pyyi = pyy[i];
    for (let j = jStart; j < count; j++) {
      const span = scanPoints[j].x - xi;
      if (!(span > 0)) continue;
      const n = j - i + 1;
      const sx = px[j + 1] - pxi;
      const sy = py[j + 1] - pyi;
      const sxx = (pxx[j + 1] - pxxi) - sx * sx * invN[n];
      const syy = (pyy[j + 1] - pyyi) - sy * sy * invN[n];
      if (!(sxx > 0) || !(syy > 0)) continue;
      const sxy = (pxy[j + 1] - pxyi) - sx * sy * invN[n];
      const denominator = sxx * syy;
      if (!(denominator > 0)) continue;
      let rSquared = (sxy * sxy) / denominator;
      if (!(rSquared >= 0) || rSquared === Infinity) continue;
      if (rSquared > 1) rSquared = 1;
      const score = rSquared - spanPenalty / span - countPenalty[n];
      if (!Number.isFinite(score)) continue;
      if (heapScore.length < SCAN_CANDIDATES || score > heapScore[0]) offer(score, i, j);
    }
  }

  if (heapScore.length === 0) {
    if (yMin === yMax) {
      return failure("所有有效点的 Y 值相同，R² 无定义，无法选择线性窗口");
    }
    return failure(`没有满足跨度 ≥${minSpan} decade 且不少于 ${minPoints} 点的可拟合窗口`);
  }

  // Re-fit the approximate leaders directly so reported values use compensated
  // two-pass sums rather than differences of prefix sums.
  const approximate: { score: number; start: number; end: number }[] = [];
  for (let k = 0; k < heapScore.length; k++) {
    approximate.push({ score: heapScore[k], start: heapStart[k], end: heapEnd[k] });
  }
  approximate.sort((a, b) => b.score - a.score);
  const stable: TafelAutoFit[] = [];
  for (const candidate of approximate) {
    const fit = fitWindow(scanPoints, candidate.start, candidate.end, minSpan);
    if (fit) stable.push(fit);
  }
  if (stable.length === 0) {
    return failure("候选窗口的拟合结果非有限，无法选择线性窗口");
  }

  stable.sort(compareFits);
  const uniqueFits: TafelAutoFit[] = [];
  const seenWindows = new Set<string>();
  for (const fit of stable) {
    const key = fit.indices.join(",");
    if (seenWindows.has(key)) continue;
    seenWindows.add(key);
    uniqueFits.push(fit);
    if (uniqueFits.length === TOP_CANDIDATES) break;
  }
  return { best: uniqueFits[0], candidates: uniqueFits };
}

// ---------------------------------------------------------------------------
// Student t critical values and confidence intervals
// ---------------------------------------------------------------------------

const LANCZOS_COEFFICIENTS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Lanczos approximation of log Γ(x) for x > 0. */
function logGamma(value: number): number {
  let x = value;
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let series = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS_COEFFICIENTS.length; i++) {
    series += LANCZOS_COEFFICIENTS[i] / (x + i + 1);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(series);
}

/** Continued fraction for the regularized incomplete beta function. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300, epsilon = 3e-14, maxIterations = 300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function regularizedBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log1p(-x),
  );
  if (!Number.isFinite(front)) return x < (a + 1) / (a + b + 2) ? 0 : 1;
  const value = x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
  return Math.max(0, Math.min(1, value));
}

/** P(T > t) for a Student t distribution; avoids 1 - CDF cancellation in tails. */
function studentUpperTail(t: number, df: number): number {
  if (t <= 0) return 0.5;
  const x = df / (df + t * t);
  return 0.5 * regularizedBeta(df / 2, 0.5, x);
}

/**
 * Two-sided Student t critical value: P(|T_df| <= t) = level.
 *
 * `level` must be finite and in [0.8, 0.999]; `df` must be finite and >= 1,
 * and should be an integer for sample-size use. The required range df = 1..1000
 * is covered by direct inversion of the incomplete beta CDF; larger df also
 * works (the normal limit is approached automatically). Throws RangeError for
 * unsupported arguments, because no meaningful number exists for them.
 */
export function tQuantile(level: number, df: number): number {
  if (!Number.isFinite(level) || level < 0.8 || level > 0.999) {
    throw new RangeError("level 仅支持 0.8–0.999");
  }
  if (!Number.isFinite(df) || df < 1) {
    throw new RangeError("df 需为 ≥1 的有限数值");
  }
  const alpha = (1 - level) / 2;
  let low = 0, high = 1;
  while (studentUpperTail(high, df) > alpha && high < 1e15) high *= 2;
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (studentUpperTail(middle, df) > alpha) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * slope ± tQuantile(level, n-2)·slopeSE.
 * Returns {low: NaN, high: NaN} (never throws) when n < 3, when the slope or
 * its standard error is not finite, or when `level` is unsupported.
 */
export function slopeConfidence(
  fit: Pick<TafelAutoFit, "slope" | "slopeSE" | "n">,
  level = 0.95,
): { low: number; high: number } {
  const { slope, slopeSE, n } = fit;
  if (!Number.isInteger(n) || n < 3 || !Number.isFinite(slope)
    || !Number.isFinite(slopeSE) || slopeSE < 0) {
    return { low: NaN, high: NaN };
  }
  let critical: number;
  try {
    critical = tQuantile(level, n - 2);
  } catch {
    return { low: NaN, high: NaN };
  }
  if (!Number.isFinite(critical)) return { low: NaN, high: NaN };
  const margin = critical * slopeSE;
  const low = slope - margin, high = slope + margin;
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : { low: NaN, high: NaN };
}

/**
 * Exchange current density from η = intercept + slope·log10(j):
 *   log10(j0) = -intercept / slope, j0 = 10^log10(j0).
 * Returns null for a zero/non-finite slope, a non-finite intercept, or a
 * non-finite logarithm.
 */
export function exchangeCurrentDensity(
  fit: Pick<TafelAutoFit, "slope" | "intercept">,
): { log10: number; value: number } | null {
  const { slope, intercept } = fit;
  if (!Number.isFinite(slope) || slope === 0 || !Number.isFinite(intercept)) return null;
  const log10 = -intercept / slope;
  if (!Number.isFinite(log10)) return null;
  return { log10, value: 10 ** log10 };
}
