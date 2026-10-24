export type AxisScale = "linear" | "log10" | "reciprocal";
export type AxisTickSettings = { step?: number; anchor: number; minorCount: number; scale?: AxisScale; break?: { from: number; to: number } };
export type PlotTickSettings = { x: AxisTickSettings; y: AxisTickSettings };
export type AxisTicks = { major: number[]; minor: number[]; step: number; scale?: AxisScale };
export const DEFAULT_TICKS: PlotTickSettings = {
  x: { anchor: 0, minorCount: 1 }, y: { anchor: 0, minorCount: 1 },
};

export function axisScale(settings: AxisTickSettings): AxisScale { return settings.scale === "log10" ? "log10" : settings.scale === "reciprocal" ? "reciprocal" : "linear"; }
export function isLogAxis(scale: AxisScale | undefined): boolean { return scale === "log10"; }
export function isReciprocalAxis(scale: AxisScale | undefined): boolean { return scale === "reciprocal"; }
/** Data value -> axis coordinate. Log and reciprocal axes reject zero; log also rejects negatives. */
export function transformAxisValue(scale: AxisScale | undefined, value: number): number { return isLogAxis(scale) ? Math.log10(value) : isReciprocalAxis(scale) ? 1 / value : value; }
export function untransformAxisValue(scale: AxisScale | undefined, value: number): number { return isLogAxis(scale) ? 10 ** value : isReciprocalAxis(scale) ? 1 / value : value; }
export function axisValueAllowed(scale: AxisScale | undefined, value: number): boolean { return Number.isFinite(value) && (!isLogAxis(scale) || value > 0) && (!isReciprocalAxis(scale) || value !== 0); }
/** A reciprocal or log axis cannot span zero: both ends stay on one side. */
export function axisRangeAllowed(scale: AxisScale | undefined, min: number, max: number): boolean {
  if (!axisValueAllowed(scale, min) || !axisValueAllowed(scale, max) || !(max > min)) return false;
  if (isReciprocalAxis(scale)) return (min > 0 && max > 0) || (min < 0 && max < 0);
  if (isLogAxis(scale)) return min > 0 && max > 0;
  return true;
}

export function formatTick(value: number, step: number): string {
  if (value === 0) return "0";
  const precision = Math.min(17, Math.max(6, Math.ceil(Math.log10(Math.abs(value) / step)) + 3));
  const rounded = Number(value.toPrecision(precision));
  if (Math.abs(rounded) >= 1e7 || Math.abs(rounded) < 1e-5) {
    return rounded.toExponential(precision - 1).replace(/(\.\d*?)0+(e)/, "$1$2").replace(/\.e/, "e");
  }
  return rounded.toString();
}

/** Label for one major tick. Log labels are decade values, so the linear spacing step does not apply. */
export function tickLabel(value: number, ticks: AxisTicks): string {
  if (ticks.scale === "log10") return formatTick(value, Math.abs(value) / 9 || 1);
  return formatTick(value, ticks.step);
}

export function axisTicks(min: number, max: number, settings: AxisTickSettings): AxisTicks {
  if (isReciprocalAxis(settings.scale)) return reciprocalAxisTicks(min, max, settings);
  return isLogAxis(settings.scale) ? logAxisTicks(min, max, settings) : linearAxisTicks(min, max, settings);
}

function reciprocalAxisTicks(min: number, max: number, settings: AxisTickSettings): AxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("坐标范围需为有限数值");
  if (min === 0 || max === 0) throw new Error("倒数轴的范围不能包含 0");
  if (!axisRangeAllowed("reciprocal", min, max)) throw new Error("倒数轴的范围必须同号且大于或小于 0");
  // Ticks are chosen in data units so labels stay readable; their screen positions follow 1/x.
  const ticks = linearAxisTicks(min, max, settings);
  return { ...ticks, scale: "reciprocal" };
}

function logAxisTicks(min: number, max: number, settings: AxisTickSettings): AxisTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("坐标范围需为有限数值");
  if (!(min > 0) || !(max > 0)) throw new Error("对数轴的范围必须大于 0");
  if (!(max > min)) throw new Error("坐标范围无效");
  const lo = Math.log10(min), hi = Math.log10(max);
  const first = Math.ceil(lo - 1e-12), last = Math.floor(hi + 1e-12);
  if (last - first >= 1) {
    const major: number[] = [], minor: number[] = [];
    for (let exponent = first; exponent <= last; exponent++) {
      if (major.length >= 200) throw new Error("刻度过密，请缩小对数轴范围");
      major.push(10 ** exponent);
    }
    // Standard log minor ticks at 2–9 within each visible decade; 0 hides them.
    if (settings.minorCount !== 0) {
      for (let exponent = Math.floor(lo); exponent <= Math.floor(hi); exponent++) {
        for (let mantissa = 2; mantissa <= 9; mantissa++) {
          const value = mantissa * 10 ** exponent;
          if (!(value > min * (1 + 1e-12)) || !(value < max * (1 - 1e-12))) continue;
          if (minor.length >= 2000) throw new Error("刻度过密，请缩小对数轴范围");
          minor.push(value);
        }
      }
    }
    return { major, minor, step: 1, scale: "log10" };
  }
  // Less than one full decade inside the range: keep the axis logarithmic but label
  // automatic data-space ticks, otherwise a single decade would leave no major ticks.
  const fallback = linearAxisTicks(min, max, { anchor: settings.anchor, minorCount: settings.minorCount });
  return { ...fallback, scale: "log10" };
}

function linearAxisTicks(min: number, max: number, settings: AxisTickSettings): AxisTicks {
  const span = max - min;
  if (![min, max, span].every(Number.isFinite) || span <= 0) throw new Error("坐标范围无效");
  if (!Number.isFinite(settings.anchor)) throw new Error("锚点需为有限数值");
  if (!Number.isInteger(settings.minorCount) || settings.minorCount < 0 || settings.minorCount > 20) throw new Error("次刻度数量需为 0～20 的整数");
  let step = settings.step;
  if (step === undefined) {
    const rough = span / 6, magnitude = 10 ** Math.floor(Math.log10(rough)), fraction = rough / magnitude;
    step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  }
  if (!Number.isFinite(step) || step <= 0) throw new Error("主刻度间隔需大于 0");
  const divisions = settings.minorCount + 1, minorStep = step / divisions;
  const numericalTolerance = Number.EPSILON * Math.max(Math.abs(min), Math.abs(max), Math.abs(settings.anchor)) * 8;
  if (numericalTolerance >= minorStep / 1000) throw new Error("间隔或锚点尺度导致精度不足，请增大间隔或调整锚点");
  const lo = (min - settings.anchor) / minorStep, hi = (max - settings.anchor) / minorStep;
  const indexTolerance = Number.EPSILON * Math.max(1, Math.abs(lo), Math.abs(hi)) * 4;
  const first = Math.ceil(lo - indexTolerance), last = Math.floor(hi + indexTolerance);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || !Number.isFinite(minorStep) || minorStep <= 0) throw new Error("间隔或锚点超出可分辨的数值范围");
  const total = Math.max(0, last - first + 1);
  const majorTotal = Math.max(0, Math.floor(last / divisions) - Math.ceil(first / divisions) + 1);
  if (majorTotal > 200 || total > 1000) throw new Error("刻度过密，请增大主刻度间隔或减少次刻度数量（每轴最多 200 个主刻度、1000 个总刻度）");
  const major: number[] = [], minor: number[] = [], tolerance = Math.min(span * 1e-9, Number.EPSILON * Math.max(Math.abs(min), Math.abs(max)) * 8);
  let previous = -Infinity;
  for (let i = first; i <= last; i++) {
    const k = Math.floor(i / divisions), r = i - k * divisions;
    const rawValue = settings.anchor + (k + r / divisions) * step;
    const cancellationTolerance = Number.EPSILON * Math.max(Math.abs(settings.anchor), Math.abs((k + r / divisions) * step)) * 4;
    const value = Math.abs(rawValue) <= cancellationTolerance ? 0 : rawValue;
    if (!Number.isFinite(value) || value <= previous) throw new Error("相邻刻度无法区分，请增大间隔或调整锚点");
    previous = value;
    if (value < min - tolerance || value > max + tolerance) continue;
    (r === 0 ? major : minor).push(value);
  }
  if (new Set(major.map(v => formatTick(v, step))).size !== major.length) throw new Error("刻度标签无法区分，请增大主刻度间隔");
  return { major, minor, step };
}
