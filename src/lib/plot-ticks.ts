export type AxisTickSettings = { step?: number; anchor: number; minorCount: number };
export type PlotTickSettings = { x: AxisTickSettings; y: AxisTickSettings };
export type AxisTicks = { major: number[]; minor: number[]; step: number };
export const DEFAULT_TICKS: PlotTickSettings = {
  x: { anchor: 0, minorCount: 1 }, y: { anchor: 0, minorCount: 1 },
};

export function formatTick(value: number, step: number): string {
  if (value === 0) return "0";
  const precision = Math.min(17, Math.max(6, Math.ceil(Math.log10(Math.abs(value) / step)) + 3));
  const rounded = Number(value.toPrecision(precision));
  if (Math.abs(rounded) >= 1e7 || Math.abs(rounded) < 1e-5) {
    return rounded.toExponential(precision - 1).replace(/(\.\d*?)0+(e)/, "$1$2").replace(/\.e/, "e");
  }
  return rounded.toString();
}

export function axisTicks(min: number, max: number, settings: AxisTickSettings): AxisTicks {
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
