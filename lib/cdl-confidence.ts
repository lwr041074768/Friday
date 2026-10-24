import { tQuantile } from "./tafel-auto";

export type CdlConfidencePoint = { rateMV: number; y: number; included?: boolean };
export type CdlMeanConfidenceBand = {
  level: number; dof: number; n: number; throughOrigin: boolean;
  points: { rate: number; low: number; high: number }[];
};

/** Conditional OLS mean band, distinct from replicate SD and a prediction band.
 * slope is per V/s, rateMV is mV/s. Undefined model means an aggregate curve,
 * which has no single OLS covariance and must not acquire a fabricated band.
 */
export function cdlMeanConfidenceBand(
  input: readonly CdlConfidencePoint[], slope: number, intercept: number,
  throughOrigin: boolean | undefined,
): CdlMeanConfidenceBand | null {
  if (typeof throughOrigin !== "boolean" || !Number.isFinite(slope) || !Number.isFinite(intercept)
    || (throughOrigin && intercept !== 0)) return null;
  const points = input.filter(point => point.included !== false && Number.isFinite(point.rateMV) && Number.isFinite(point.y));
  const n = points.length, dof = n - (throughOrigin ? 1 : 2);
  if (!(dof > 0)) return null;
  const mean = points.reduce((sum, point) => sum + point.rateMV / n, 0);
  let xx = 0, sse = 0, low = Infinity, high = -Infinity;
  for (const point of points) {
    const x = throughOrigin ? point.rateMV : point.rateMV - mean;
    xx += x * x;
    sse += (point.y - (slope * point.rateMV / 1000 + intercept)) ** 2;
    low = Math.min(low, point.rateMV); high = Math.max(high, point.rateMV);
  }
  const variance = sse / dof;
  if (!(xx > 0) || !(high > low) || ![xx, variance, mean, high - low].every(Number.isFinite)) return null;
  // tQuantile accepts the central confidence level, not a one-sided percentile.
  const level = .95, critical = tQuantile(level, dof);
  const band = Array.from({ length: 41 }, (_, index) => {
    const rate = low + (high - low) * index / 40;
    const leverage = throughOrigin ? rate * rate / xx : 1 / n + (rate - mean) ** 2 / xx;
    const margin = critical * Math.sqrt(variance * leverage);
    const prediction = slope * rate / 1000 + intercept;
    return { rate, low: prediction - margin, high: prediction + margin };
  });
  if (!band.every(point => [point.rate, point.low, point.high].every(Number.isFinite))) return null;
  return { level, dof, n, throughOrigin, points: band };
}
