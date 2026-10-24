export type OverpotentialAxisSettings = {
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  xMajor: string;
  yMajor: string;
  xMinor: string;
  yMinor: string;
};

export type OverpotentialAxis = {
  min: number;
  max: number;
  major: number;
  majorTicks: number[];
  minorTicks: number[];
};

export type OverpotentialAxes = { x: OverpotentialAxis; y: OverpotentialAxis };

export const defaultOverpotentialAxisSettings: OverpotentialAxisSettings = {
  xMin: "", xMax: "", yMin: "", yMax: "",
  xMajor: "", yMajor: "", xMinor: "1", yMinor: "1",
};

// Includes both major and minor ticks. Validate the count before allocating or
// iterating, so an accidentally tiny interval cannot freeze the chart.
const MAX_TICKS_PER_AXIS = 1000;
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function optionalNumber(text: string, label: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!NUMBER_PATTERN.test(trimmed) || !Number.isFinite(value)) {
    throw new Error(`${label}请输入有限数字。`);
  }
  return value;
}

function minorCount(text: string, label: string) {
  const value = optionalNumber(text, label) ?? 1;
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error(`${label}请输入 0 至 10 的整数，表示相邻主刻度之间的次刻度数量。`);
  }
  return value;
}

function positiveMajor(text: string, label: string, integer: boolean) {
  const value = optionalNumber(text, label);
  if (value !== undefined && (value <= 0 || (integer && !Number.isSafeInteger(value)))) {
    throw new Error(`${label}请输入${integer ? "正整数" : "大于 0 的有限数字"}。`);
  }
  return value;
}

function niceStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Y 轴自动刻度超出可绘制的数值范围，请设置合适的上下限和主刻度。");
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  if (magnitude === 0) return value;
  const fraction = value / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * magnitude;
  if (!Number.isFinite(step)) {
    throw new Error("Y 轴自动刻度超出可绘制的数值范围，请设置合适的主刻度。");
  }
  return step;
}

function axis(min: number, max: number, major: number, minors: number, anchor: number, label: string): OverpotentialAxis {
  const span = max - min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(span)) {
    throw new Error(`${label}范围超出可绘制的数值范围。`);
  }
  if (span <= 0) throw new Error(`${label}下限必须小于上限。`);
  if (!Number.isFinite(major) || major <= 0) throw new Error(`${label}主刻度必须大于 0。`);

  const divisions = minors + 1;
  const step = major / divisions;
  if (step === 0 || !Number.isFinite(step)) throw new Error(`${label}刻度间隔过小。`);
  // X ticks are anchored at category 1; Y ticks are anchored at zero. A custom
  // minimum changes the viewport, without shifting a sample's numeric position.
  const first = Math.ceil((min - anchor) / step - 1e-9);
  const last = Math.floor((max - anchor) / step + 1e-9);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
    throw new Error(`${label}刻度间隔相对范围过小，请增大主刻度。`);
  }
  const count = Math.max(0, last - first + 1);
  if (count > MAX_TICKS_PER_AXIS) {
    throw new Error(`${label}主、次刻度合计超过 ${MAX_TICKS_PER_AXIS} 个，请增大主刻度或缩小范围。`);
  }

  const majorTicks: number[] = [], minorTicks: number[] = [];
  let previous: number | undefined;
  for (let offset = 0; offset < count; offset++) {
    const index = first + offset;
    const value = anchor + index * step;
    if (!Number.isFinite(value) || (previous !== undefined && value <= previous)) {
      throw new Error(`${label}刻度无法在当前数值精度下区分，请增大主刻度。`);
    }
    previous = value;
    // Reconstruct major ticks directly from the major interval to avoid a
    // subdivision rounding error when the minor count is, for example, two.
    const tick = index % divisions === 0 ? anchor + (index / divisions) * major : value;
    // Permit only floating point roundoff at a boundary (e.g. 3 * .1), rather
    // than treating a deliberately cropped nearby tick as part of the range.
    const tolerance = Math.min(step * 1e-10, Number.EPSILON * Math.max(1, Math.abs(min), Math.abs(max), Math.abs(tick)) * 4);
    if (tick < min - tolerance || tick > max + tolerance) continue;
    const bounded = Math.max(min, Math.min(max, tick));
    const normalized = Object.is(bounded, -0) ? 0 : bounded;
    if (index % divisions === 0) majorTicks.push(normalized);
    else minorTicks.push(normalized);
  }
  return { min, max, major, majorTicks, minorTicks };
}

/**
 * Resolve presentation-only axes. Every row retains its category position 1..N;
 * cropping an axis never removes, renames, or modifies source/export rows.
 * Empty limits and major intervals use automatic values. Minor settings count
 * ticks strictly between adjacent major ticks (0 disables them).
 */
export function resolveOverpotentialAxes(
  rows: readonly { reading: { etaMV?: number } }[],
  settings: OverpotentialAxisSettings = defaultOverpotentialAxisSettings,
): OverpotentialAxes {
  const xMin = optionalNumber(settings.xMin, "X 轴下限") ?? .5;
  const xMax = optionalNumber(settings.xMax, "X 轴上限") ?? Math.max(1, rows.length) + .5;
  const xMajor = positiveMajor(settings.xMajor, "X 轴主刻度", true) ?? 1;
  const xMinor = minorCount(settings.xMinor, "X 轴次刻度");
  const yMinSetting = optionalNumber(settings.yMin, "Y 轴下限");
  const yMaxSetting = optionalNumber(settings.yMax, "Y 轴上限");
  const yMajorSetting = positiveMajor(settings.yMajor, "Y 轴主刻度", false);
  const yMinor = minorCount(settings.yMinor, "Y 轴次刻度");

  let low = 0, high = 0;
  for (const row of rows) {
    const value = row.reading.etaMV;
    if (value !== undefined && Number.isFinite(value)) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const naturalSpan = high - low || 100;
  const baseMin = yMinSetting ?? low;
  const baseMax = yMaxSetting ?? (high || (low < 0 ? 0 : 100));
  const baseSpan = baseMax - baseMin;
  if (!Number.isFinite(baseSpan) || baseSpan <= 0) {
    throw new Error("Y 轴下限必须小于上限，且范围须为有限数字。");
  }
  const yMajor = yMajorSetting ?? niceStep(baseSpan * 1.2 / 5);
  const yMin = yMinSetting ?? (low < 0 ? Math.floor((low - naturalSpan * .12) / yMajor) * yMajor : 0);
  const yMax = yMaxSetting ?? (high > 0 ? Math.ceil((high + naturalSpan * .12) / yMajor) * yMajor : low < 0 ? 0 : 100);

  return {
    x: axis(xMin, xMax, xMajor, xMinor, 1, "X 轴"),
    y: axis(yMin, yMax, yMajor, yMinor, 0, "Y 轴"),
  };
}
