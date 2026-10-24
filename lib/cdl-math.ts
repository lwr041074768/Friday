import type { CurrentUnit, PlotCurve, Point } from "./lsv-math";

export type CdlCurrentUnit = CurrentUnit;
export type CdlSeries = {
  id: string; rateMV: number; points: Point[]; cycle?: number; included?: boolean; source?: string;
  rateSource?: string; headerRateMV?: number; fileNameRateMV?: number; rateWarning?: string; metadata?: Record<string, unknown>;
};
export type CdlSummaryPoint = (
  | { rateMV: number; anodic: number; cathodic: number; halfDelta?: never }
  | { rateMV: number; halfDelta: number; anodic?: never; cathodic?: never }
) & { source?: string; included?: boolean; rateSource?: string; rateWarning?: string };
// A sample is always one independently prepared/measured electrode. groupName
// joins electrode results for statistics; it never joins their scan-rate data.
export type CdlSample = { id: string; name: string; groupName?: string; replicate?: string; role?: "electrode" | "meanCurve"; color: string; visible: boolean; source: string; unit?: CdlCurrentUnit; areaCM2?: number; summaryPotential?: number; demo?: boolean; series: CdlSeries[]; summary?: CdlSummaryPoint[] };
export type CdlSettings = { e0: number; currentUnit: CdlCurrentUnit; normalizeArea: boolean; areaCM2?: number; cycle: "last" | number; halfDelta: boolean; throughOrigin: boolean };
export type CdlOutputUnit = "mA" | "mA/cm2";
export type CdlExtractedPoint = {
  seriesId: string; rateMV: number; rateV: number; anodic?: number; cathodic?: number; delta: number; halfDelta: number; y: number;
  cycle?: number; source: string; included: boolean; inputKind: "cv" | "pair" | "halfDelta"; currentUnit: CdlCurrentUnit; outputUnit: CdlOutputUnit;
  rawAnodic?: number; rawCathodic?: number; rawHalfDelta?: number;
};
export type CdlFit = {
  slope: number; intercept: number; r2: number; r2Definition: "centered" | "uncentered"; slopeSE: number; interceptSE: number; rmse: number; n: number;
  cdl: number; cdlSE: number; cdlUnit: "mF" | "mF/cm2"; throughOrigin: boolean;
  residuals: { seriesId: string; rateV: number; y: number; predicted: number; residual: number }[];
};
export type CdlSampleResult = {
  id: string; name: string; extracted: CdlExtractedPoint[]; fit?: CdlFit; errors: string[]; warnings: string[];
  cycles: { seriesId: string; count: number; selected?: number; lastTwo?: CdlCycleComparison }[]; outputUnit: CdlOutputUnit;
};
export type CdlResult = { samples: CdlSampleResult[]; error?: string };
export type CdlCycleComparison = { previous: number; last: number; previousHalfDelta: number; lastHalfDelta: number; relativeChange?: number; unit: CdlOutputUnit; e0: number };
export type CdlPlotCurve = PlotCurve & { sampleId: string; seriesId: string; rateMV: number; outputUnit: CdlOutputUnit; included: boolean; cycle?: number; cycleCount: number; originalStart?: number; originalEnd?: number };
export type CdlGroupResult = {
  id: string; name: string; color: string; replicates: { sample: CdlSample; result?: CdlSampleResult }[];
  mean?: number; sd?: number; n: number; electrodeCount: number; unit?: CdlFit["cdlUnit"]; outputUnit?: CdlOutputUnit;
  rates: { rateMV: number; mean?: number; sd?: number; n: number; unit?: CdlOutputUnit }[];
  errors: string[]; warnings: string[];
};
export type CdlOriginTable = { name: string; columns: string[]; rows: (string | number | undefined)[][] };

const CURRENT_SCALE_MA: Record<CurrentUnit, number> = { A: 1000, mA: 1, uA: .001, nA: .000001, "A/cm2": 1000, "mA/cm2": 1, "uA/cm2": .001 };
const finite = (point: Point) => Number.isFinite(point.e) && Number.isFinite(point.current);

function settingsError(settings: CdlSettings): string | undefined {
  if (!Number.isFinite(settings.e0)) return "取点电位 E₀ 必须为有限数值（V）";
  if (!Object.prototype.hasOwnProperty.call(CURRENT_SCALE_MA, settings.currentUnit)) return "请确认原始电流单位";
  if (settings.cycle !== "last" && (!Number.isInteger(settings.cycle) || settings.cycle < 1)) return "循环序号需为从 1 开始的整数";
}

function conversion(sample: CdlSample, settings: CdlSettings): { factor: number; unit: CurrentUnit; outputUnit: CdlOutputUnit; area?: number; error?: string } {
  const unit = sample.unit ?? settings.currentUnit, density = unit.includes("/cm2"), area = sample.areaCM2 ?? settings.areaCM2;
  const outputUnit = density || settings.normalizeArea ? "mA/cm2" : "mA";
  if (!Object.prototype.hasOwnProperty.call(CURRENT_SCALE_MA, unit)) return { factor: NaN, unit, outputUnit, area, error: "请确认原始电流单位" };
  if (settings.normalizeArea && !density && !(Number.isFinite(area) && (area as number) > 0)) return { factor: NaN, unit, outputUnit, area, error: "总电流换算为电流密度需要大于 0 的电极面积（cm²）" };
  return { factor: CURRENT_SCALE_MA[unit] / (settings.normalizeArea && !density ? area as number : 1), unit, outputUnit, area };
}

type IndexedPoint = Point & { index: number };
type Branch = { direction: 1 | -1; segments: IndexedPoint[][]; min: number; max: number };
type Cycle = { anodic: Branch; cathodic: Branch };

// Branches follow the measured potential direction. Current sign never defines a branch.
// Missing rows split interpolation segments, even when the same sweep resumes afterwards.
function scanBranches(points: Point[]): Branch[] {
  const segments: IndexedPoint[][] = [];
  let active: IndexedPoint[] = [], direction = 0;
  const flush = () => { if (active.length >= 2 && direction !== 0) segments.push(active); active = []; direction = 0; };
  for (const [index, point] of points.entries()) {
    if (!finite(point)) { flush(); continue; }
    const next = { ...point, index };
    if (!active.length) { active = [next]; continue; }
    const previous = active[active.length - 1], sign = Math.sign(point.e - previous.e);
    if (sign !== 0 && direction !== 0 && sign !== direction) { segments.push(active); active = [previous, next]; direction = sign; }
    else { active.push(next); if (sign !== 0) direction = sign; }
  }
  flush();
  const branches: Branch[] = [];
  for (const segment of segments) {
    const first = segment[0], last = segment[segment.length - 1], sign = Math.sign(last.e - first.e) as 1 | -1;
    const previous = branches[branches.length - 1], previousLast = previous?.segments[previous.segments.length - 1].at(-1);
    // A gap can continue an existing direction, but cannot supply an interpolation edge.
    const canResume = previous && previous.direction === sign && previousLast && (first.e - previousLast.e) * sign >= 0;
    if (canResume) { previous.segments.push(segment); previous.min = Math.min(previous.min, first.e, last.e); previous.max = Math.max(previous.max, first.e, last.e); }
    else branches.push({ direction: sign, segments: [segment], min: Math.min(first.e, last.e), max: Math.max(first.e, last.e) });
  }
  return branches;
}

function completeCycles(points: Point[]): { cycles: Cycle[]; branchCount: number; partial: boolean; hasGap: boolean; startupIgnored: boolean; endpointOffset: boolean } {
  const branches = scanBranches(points), valid = points.filter(finite);
  if (!valid.length) return { cycles: [], branchCount: 0, partial: false, hasGap: points.length > 0, startupIgnored: false, endpointOffset: false };
  let minimum = Infinity, maximum = -Infinity;
  for (const point of valid) { minimum = Math.min(minimum, point.e); maximum = Math.max(maximum, point.e); }
  const epsilon = Math.max(1e-9, (maximum - minimum) * 1e-6);
  // Estimate the recorded potential resolution using adjacent valid source rows,
  // never a jump across a missing row. An endpoint offset of one ordinary step
  // is common when acquisition omits the repeated terminal vertex. Cap tolerance
  // at 5% of the window so sparse points cannot make a half-cycle look complete.
  const steps: number[] = [];
  for (let index = 1; index < points.length; index++) {
    if (!finite(points[index - 1]) || !finite(points[index])) continue;
    const step = Math.abs(points[index].e - points[index - 1].e);
    if (step > epsilon) steps.push(step);
  }
  steps.sort((a, b) => a - b);
  const typicalStep = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
  const endpointTolerance = Math.max(epsilon, Math.min(typicalStep * (1 + 1e-6), (maximum - minimum) * .05));
  const strictComplete = (branch: Branch) => branch.min <= minimum + epsilon && branch.max >= maximum - epsilon;
  const complete = (branch: Branch) => branch.min <= minimum + endpointTolerance && branch.max >= maximum - endpointTolerance;
  const cycles: Cycle[] = [];
  // A one/two-step startup reversal (e.g. .051 -> .050 -> .051 ...)
  // precedes the intended sweep in the actual source files. Only such a tiny,
  // contiguous leading fragment may be ignored to choose the acquisition anchor.
  const first = branches[0], next = branches[1];
  const startupIgnored = Boolean(first && next && !complete(first) && complete(next) && first.segments.length === 1
    && first.segments[0].length <= 3 && first.max - first.min <= Math.min(typicalStep * 2 * (1 + 1e-6), (maximum - minimum) * .05) + epsilon);
  const firstIndex = startupIgnored ? 1 : 0;
  // Anchor acquisition cycles to the first measured direction. A partial first
  // cycle is skipped as a pair; its return sweep must not be joined to the next
  // cycle's outgoing sweep. This also preserves cycle identity after truncation.
  const firstDirection = branches[firstIndex]?.direction;
  let usedBranches = 0, endpointOffset = false;
  for (let cursor = firstIndex; cursor < branches.length - 1; cursor++) {
    const a = branches[cursor], b = branches[cursor + 1];
    if (a.direction !== firstDirection || a.direction === b.direction) continue;
    if (complete(a) && complete(b)) {
      cycles.push({ anodic: a.direction === 1 ? a : b, cathodic: a.direction === -1 ? a : b });
      usedBranches += 2;
      endpointOffset ||= !strictComplete(a) || !strictComplete(b);
    }
    cursor++;
  }
  return { cycles, branchCount: branches.length, partial: usedBranches !== branches.length, hasGap: valid.length !== points.length, startupIgnored, endpointOffset };
}

function interpolate(branch: Branch, e0: number): { current?: number; error?: string } {
  const epsilon = 1e-10 * Math.max(1, Math.abs(e0));
  if (e0 < branch.min - epsilon || e0 > branch.max + epsilon) return { error: "E₀ 超出该扫描支路的电位范围" };
  for (const segment of branch.segments) {
    for (let index = 0; index < segment.length; index++) {
      const point = segment[index];
      if (Math.abs(point.e - e0) <= epsilon) return { current: point.current };
      const next = segment[index + 1];
      if (!next || point.e === next.e) continue;
      if (e0 > Math.min(point.e, next.e) && e0 < Math.max(point.e, next.e)) {
        const current = point.current + (next.current - point.current) * (e0 - point.e) / (next.e - point.e);
        return Number.isFinite(current) ? { current } : { error: "支路插值结果无效" };
      }
    }
  }
  return { error: "E₀ 位于数据缺口，不能跨缺口插值" };
}

function cycleComparison(cycles: Cycle[], settings: CdlSettings, factor: number, unit: CdlOutputUnit): CdlCycleComparison | undefined {
  if (cycles.length < 2) return;
  const values = cycles.slice(-2).map(cycle => {
    const up = interpolate(cycle.anodic, settings.e0), down = interpolate(cycle.cathodic, settings.e0);
    if (up.current === undefined || down.current === undefined) return undefined;
    return (up.current - down.current) * factor / 2;
  });
  const [previousHalfDelta, lastHalfDelta] = values;
  if (previousHalfDelta === undefined || lastHalfDelta === undefined) return;
  // The signed half difference is retained. A zero denominator does not imply
  // zero change. This diagnostic concerns E0 only, not the full CV window.
  const relativeChange = Math.abs(previousHalfDelta) > 0 ? Math.abs(lastHalfDelta - previousHalfDelta) / Math.abs(previousHalfDelta) : undefined;
  return { previous: cycles.length - 1, last: cycles.length, previousHalfDelta, lastHalfDelta, relativeChange, unit, e0: settings.e0 };
}

function cycleSourceRange(cycle: Cycle): { start: number; end: number } {
  let start = Infinity, end = -Infinity;
  for (const branch of [cycle.anodic, cycle.cathodic]) for (const segment of branch.segments) {
    start = Math.min(start, segment[0].index); end = Math.max(end, segment[segment.length - 1].index);
  }
  return { start, end };
}

function fitPoints(points: CdlExtractedPoint[], settings: CdlSettings, outputUnit: CdlOutputUnit): { fit?: CdlFit; error?: string } {
  const included = points.filter(point => point.included);
  if (included.length < 3) return { error: "线性拟合至少需要 3 个不同扫描速率的有效取点" };
  const rates = new Set<number>();
  for (const point of included) {
    if (rates.has(point.rateMV)) return { error: `扫描速率 ${point.rateMV} mV/s 重复；请明确选择一组数据，当前不会自动平均` };
    rates.add(point.rateMV);
  }
  const n = included.length, xMean = included.reduce((sum, point) => sum + point.rateV, 0) / n, yMean = included.reduce((sum, point) => sum + point.y, 0) / n;
  let xx = 0, xy = 0;
  for (const point of included) { const x = settings.throughOrigin ? point.rateV : point.rateV - xMean; xx += x * x; xy += x * (settings.throughOrigin ? point.y : point.y - yMean); }
  if (!(xx > 0) || !Number.isFinite(xx) || !Number.isFinite(xy)) return { error: "扫描速率无法形成有效的线性拟合" };
  const slope = xy / xx, intercept = settings.throughOrigin ? 0 : yMean - slope * xMean;
  const residuals = included.map(point => { const predicted = slope * point.rateV + intercept; return { seriesId: point.seriesId, rateV: point.rateV, y: point.y, predicted, residual: point.y - predicted }; });
  const sse = residuals.reduce((sum, point) => sum + point.residual ** 2, 0), sst = included.reduce((sum, point) => sum + (settings.throughOrigin ? point.y : point.y - yMean) ** 2, 0);
  // Constant y has undefined R². Retain NaN rather than inventing a perfect fit.
  const r2 = sst > 0 ? 1 - sse / sst : NaN, variance = sse / (n - (settings.throughOrigin ? 1 : 2));
  const slopeSE = Math.sqrt(variance / xx), interceptSE = settings.throughOrigin ? 0 : Math.sqrt(variance * (1 / n + xMean * xMean / xx));
  const divisor = settings.halfDelta ? 1 : 2;
  if (![slope, intercept, variance, slopeSE, interceptSE].every(Number.isFinite)) return { error: "线性拟合数值无效，请检查数据数量级" };
  return { fit: { slope, intercept, r2, r2Definition: settings.throughOrigin ? "uncentered" : "centered", slopeSE, interceptSE, rmse: Math.sqrt(sse / n), n,
    cdl: slope / divisor, cdlSE: slopeSE / divisor, cdlUnit: outputUnit === "mA/cm2" ? "mF/cm2" : "mF", throughOrigin: settings.throughOrigin, residuals } };
}

export function calculateCdl(samples: CdlSample[], settings: CdlSettings): CdlResult {
  const error = settingsError(settings);
  if (error) return { samples: [], error };
  return { samples: samples.map(sample => {
    const converted = conversion(sample, settings), result: CdlSampleResult = { id: sample.id, name: sample.name, extracted: [], errors: [], warnings: [], cycles: [], outputUnit: converted.outputUnit };
    if (sample.role === "meanCurve") result.warnings.push("这是已有均值曲线，可单独查看拟合；不作为独立电极计入平行样 n 或样本 SD");
    if (converted.error) { result.errors.push(converted.error); return result; }
    if (settings.normalizeArea && converted.unit.includes("/cm2")) result.warnings.push("原始数据已是电流密度，不会再次除以电极面积");
    if (sample.summary?.length) {
      if (sample.series.length) result.warnings.push("当前拟合使用摘要取点；CV 原始曲线保留用于核对");
      if (!Number.isFinite(sample.summaryPotential)) result.warnings.push("摘要的原始取点电位未记录；E₀ 设置仅作用于 CV，不会重新提取已有摘要");
      else if (Math.abs((sample.summaryPotential as number) - settings.e0) > 1e-9) result.warnings.push(`摘要的原始取点电位为 ${sample.summaryPotential} V；新的 E₀ = ${settings.e0} V 不会重新提取已有摘要`);
      for (const [index, point] of sample.summary.entries()) {
        if (point.rateWarning) result.warnings.push(point.rateWarning);
        if (!(Number.isFinite(point.rateMV) && point.rateMV > 0)) { result.errors.push(`摘要第 ${index + 1} 行扫描速率需大于 0（mV/s）`); continue; }
        const isHalf = "halfDelta" in point && Number.isFinite(point.halfDelta), rawAnodic = point.anodic, rawCathodic = point.cathodic;
        if (!isHalf && !(Number.isFinite(rawAnodic) && Number.isFinite(rawCathodic))) { result.errors.push(`摘要第 ${index + 1} 行电流无效`); continue; }
        const halfDelta = (isHalf ? point.halfDelta as number : ((rawAnodic as number) - (rawCathodic as number)) / 2) * converted.factor;
        const anodic = rawAnodic === undefined ? undefined : rawAnodic * converted.factor, cathodic = rawCathodic === undefined ? undefined : rawCathodic * converted.factor;
        result.extracted.push({ seriesId: `summary-${index}`, rateMV: point.rateMV, rateV: point.rateMV / 1000, anodic, cathodic, delta: halfDelta * 2, halfDelta, y: halfDelta * (settings.halfDelta ? 1 : 2), source: point.source ?? sample.source, included: point.included !== false,
          inputKind: isHalf ? "halfDelta" : "pair", currentUnit: converted.unit, outputUnit: converted.outputUnit, rawAnodic, rawCathodic, rawHalfDelta: isHalf ? point.halfDelta : undefined });
      }
    } else {
      for (const series of sample.series) {
        if (series.rateWarning) result.warnings.push(`${series.rateMV} mV/s：${series.rateWarning}`);
        if (!(Number.isFinite(series.rateMV) && series.rateMV > 0)) { result.errors.push(`${series.id}：扫描速率需大于 0（mV/s）`); continue; }
        const scanned = completeCycles(series.points), requested = series.cycle ?? settings.cycle;
        const selected = requested === "last" ? scanned.cycles.length : requested;
        const lastTwo = cycleComparison(scanned.cycles, settings, converted.factor, converted.outputUnit);
        result.cycles.push({ seriesId: series.id, count: scanned.cycles.length, selected: selected >= 1 && selected <= scanned.cycles.length ? selected : undefined, lastTwo });
        if (lastTwo?.relativeChange !== undefined && lastTwo.relativeChange > .01) result.warnings.push(`${series.rateMV} mV/s：末两圈在 E₀ 的半差变化 ${(lastTwo.relativeChange * 100).toFixed(2)}%，需结合完整 CV 判断`);
        if (!scanned.cycles.length) { result.errors.push(`${series.rateMV} mV/s：没有覆盖完整电位窗口的正反扫描，不能提取 Cdl`); continue; }
        if (!Number.isInteger(selected) || selected < 1 || selected > scanned.cycles.length) { result.errors.push(`${series.rateMV} mV/s：循环 ${selected} 不存在，共 ${scanned.cycles.length} 组完整正反扫描`); continue; }
        if (scanned.cycles.length > 1) result.warnings.push(`${series.rateMV} mV/s：检测到 ${scanned.cycles.length} 组完整正反扫描，使用第 ${selected} 组`);
        if (scanned.startupIgnored) result.warnings.push(`${series.rateMV} mV/s：起始仅 1–2 个采样步的局部反向段不作为独立循环，原始点仍保留`);
        if (scanned.endpointOffset) result.warnings.push(`${series.rateMV} mV/s：扫描端点相差不超过一个典型采样步；取点仍限定在两支路实测范围内`);
        if (scanned.partial) result.warnings.push(`${series.rateMV} mV/s：已忽略不能配对的局部扫描`);
        if (scanned.hasGap) result.warnings.push(`${series.rateMV} mV/s：保留数据缺口，插值仅使用相邻有效点`);
        const cycle = scanned.cycles[selected - 1], up = interpolate(cycle.anodic, settings.e0), down = interpolate(cycle.cathodic, settings.e0);
        if (up.error || down.error) { result.errors.push(`${series.rateMV} mV/s：${up.error ? `正扫：${up.error}` : ""}${up.error && down.error ? "；" : ""}${down.error ? `反扫：${down.error}` : ""}`); continue; }
        const rawAnodic = up.current as number, rawCathodic = down.current as number, anodic = rawAnodic * converted.factor, cathodic = rawCathodic * converted.factor, delta = anodic - cathodic;
        result.extracted.push({ seriesId: series.id, rateMV: series.rateMV, rateV: series.rateMV / 1000, anodic, cathodic, delta, halfDelta: delta / 2, y: delta / (settings.halfDelta ? 2 : 1), cycle: selected, source: series.source ?? sample.source,
          included: series.included !== false, inputKind: "cv", currentUnit: converted.unit, outputUnit: converted.outputUnit, rawAnodic, rawCathodic });
      }
    }
    if (result.cycles.some(cycle => cycle.lastTwo)) result.warnings.push("末两圈半差变化仅描述 E₀ 的单点重复性；即使低于 1%，也不能证明整个电位窗口稳定或不存在法拉第反应");
    const fitted = fitPoints(result.extracted, settings, result.outputUnit);
    if (fitted.error) result.errors.push(fitted.error); else result.fit = fitted.fit;
    if (result.fit && result.fit.cdl < 0) result.warnings.push("Cdl 拟合结果为负；请核对取点窗口、支路、单位及背景电流，当前保留符号");
    if (settings.throughOrigin) result.warnings.push("已明确选择过原点拟合；R² 使用未中心化定义，不能直接与含截距拟合的 R² 比较");
    return result;
  }) };
}

export function selectedCdlCvCurves(samples: CdlSample[], settings: CdlSettings): CdlPlotCurve[] {
  const globalError = settingsError(settings);
  return samples.flatMap(sample => {
    const converted = conversion(sample, settings);
    return sample.series.map(series => {
      let invalid = 0;
      const scanned = completeCycles(series.points), requested = series.cycle ?? settings.cycle;
      const selected = requested === "last" ? scanned.cycles.length : requested;
      const cycle = Number.isInteger(selected) && selected >= 1 ? scanned.cycles[selected - 1] : undefined;
      const range = cycle ? cycleSourceRange(cycle) : undefined;
      const error = globalError ?? converted.error ?? (!scanned.cycles.length ? "没有完整正反扫描，不能显示所选循环" : !cycle ? `循环 ${selected} 不存在，共 ${scanned.cycles.length} 组完整正反扫描` : undefined);
      const plotted: PlotCurve["plotted"] = error || !range ? [] : series.points.slice(range.start, range.end + 1).map((point, offset) => {
        const index = range.start + offset;
        const y = point.current * converted.factor;
        if (!finite(point) || !Number.isFinite(y)) { invalid++; return null; }
        return { x: point.e, y, e: point.e, current: point.current, index };
      });
      return { id: `${sample.id}:${series.id}`, name: `${sample.name} · ${series.rateMV} mV/s`, color: sample.color, visible: sample.visible, points: series.points, unit: converted.unit, resistance: "", area: converted.area === undefined ? "" : String(converted.area), compensation: "raw" as const,
        source: series.source ?? sample.source, demo: sample.demo, plotted, invalid, error: error ?? (series.points.length && invalid === series.points.length ? "CV 电位与电流均无有效数据" : undefined),
        sampleId: sample.id, seriesId: series.id, rateMV: series.rateMV, outputUnit: converted.outputUnit, included: series.included !== false,
        cycle: cycle ? selected : undefined, cycleCount: scanned.cycles.length, originalStart: range?.start, originalEnd: range?.end };
    });
  });
}

// Keep the public name compatible while making the display use the same full
// cycle as extraction. points remains the untouched, complete source array.
export const cdlCvCurves = selectedCdlCvCurves;

function meanAndSampleSD(values: number[]): { mean?: number; sd?: number } {
  if (!values.length) return {};
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { mean, sd: values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : undefined };
}

export function groupedCdlResults(samples: CdlSample[], results: CdlSampleResult[] | CdlResult): CdlGroupResult[] {
  const calculated = Array.isArray(results) ? results : results.samples;
  const groups = new Map<string, CdlGroupResult>();
  for (const sample of samples) {
    const groupName = sample.groupName?.trim(), id = groupName ? `group:${groupName}` : `electrode:${sample.id}`;
    const group: CdlGroupResult = groups.get(id) ?? { id, name: groupName || sample.name, color: sample.color, replicates: [], n: 0, electrodeCount: 0, rates: [], errors: [], warnings: [] };
    group.replicates.push({ sample, result: calculated.find(item => item.id === sample.id) });
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    const electrodes = group.replicates.filter(item => item.sample.role !== "meanCurve");
    group.electrodeCount = electrodes.length;
    if (electrodes.length !== group.replicates.length) group.warnings.push(`已有均值曲线 ${group.replicates.length - electrodes.length} 条，仅供查看，不计入独立电极统计`);
    if (!electrodes.length) group.warnings.push("当前只有均值曲线，缺少独立平行电极结果，不能报告平行样 Cdl 均值或 SD，n = 0");
    const outputUnits = new Set(electrodes.flatMap(item => item.result ? [item.result.outputUnit] : []));
    if (outputUnits.size === 1) group.outputUnit = [...outputUnits][0];
    const valid = electrodes.filter(item => item.result?.fit && Number.isFinite(item.result.fit.cdl));
    group.n = valid.length;
    const units = new Set(valid.map(item => item.result?.fit?.cdlUnit));
    const fittedRateSets = new Set(valid.map(item => item.result!.extracted.filter(point => point.included).map(point => point.rateMV).sort((a, b) => a - b).join(",")));
    if (fittedRateSets.size > 1) group.errors.push("平行电极参与拟合的扫速集合不同，不能合并 Cdl 均值和 SD；请统一所选五点后重新计算");
    if (units.size > 1) group.errors.push("平行电极的 Cdl 单位不同，不能合并均值和 SD；请先确认面积归一化");
    else if (valid.length) {
      group.unit = valid[0].result?.fit?.cdlUnit; group.outputUnit = valid[0].result?.outputUnit;
      if (fittedRateSets.size === 1) Object.assign(group, meanAndSampleSD(valid.map(item => item.result!.fit!.cdl)));
    }
    for (const item of electrodes) if (!item.result?.fit) group.errors.push(`${item.sample.name}：无有效独立拟合，未计入平行电极统计`);
    if (group.n < electrodes.length) group.warnings.push(`已拟合 ${group.n}/${electrodes.length} 片电极；组统计仅使用有效独立拟合`);
    if (group.n === 1) group.warnings.push("只有 1 片有效电极，不能计算样本 SD；拟合标准误不能代替平行样 SD");
    const rateList = [...new Set(electrodes.flatMap(item => item.result?.extracted.filter(point => point.included).map(point => point.rateMV) ?? []))].sort((a, b) => a - b);
    group.rates = rateList.map(rateMV => {
      const points = electrodes.flatMap(item => {
        // Repeated rates are invalid per-electrode data, not extra replicates.
        const matches = item.result?.extracted.filter(point => point.included && point.rateMV === rateMV && Number.isFinite(point.halfDelta)) ?? [];
        return matches.length === 1 ? matches : [];
      });
      const pointUnits = new Set(points.map(point => point.outputUnit));
      return { rateMV, n: points.length, ...(pointUnits.size === 1 ? { ...meanAndSampleSD(points.map(point => point.halfDelta)), unit: points[0].outputUnit } : {}) };
    });
    if (group.rates.some(point => point.n !== electrodes.length)) group.warnings.push("部分扫速缺少平行电极取点；逐点 n 与 Cdl 统计 n 分别记录，不补造数据");
  }
  return [...groups.values()];
}

export function buildCdlOriginTables(samples: CdlSample[], settings: CdlSettings, result = calculateCdl(samples, settings)): {
  meanPoints: CdlOriginTable; replicatePoints: CdlOriginTable; summary: CdlOriginTable; electrodeFits: CdlOriginTable; cv: CdlOriginTable[];
} {
  const groups = groupedCdlResults(samples, result);
  const electrodes = samples.filter(sample => sample.role !== "meanCurve"), electrodeIds = new Set(electrodes.map(sample => sample.id));
  const rates = [...new Set(result.samples.filter(item => electrodeIds.has(item.id)).flatMap(item => item.extracted.filter(point => point.included).map(point => point.rateMV)))].sort((a, b) => a - b);
  const outputLabel = (unit?: CdlOutputUnit) => unit === "mA/cm2" ? "mA/cm²" : unit === "mA" ? "mA" : "unit_unconfirmed";
  const meanPoints: CdlOriginTable = {
    name: "Cdl_组均值取点", columns: ["Scan_rate_X_mV_s", ...groups.map(group => `${group.name}_half_delta_Y_${outputLabel(group.outputUnit)}`), ...groups.map(group => `${group.name}_SD_${outputLabel(group.outputUnit)}`), ...groups.map(group => `${group.name}_n`)],
    rows: rates.map(rateMV => {
      const points = groups.map(group => group.rates.find(item => item.rateMV === rateMV));
      return [rateMV, ...points.map(point => point?.mean), ...points.map(point => point?.sd), ...points.map(point => point?.n)];
    }),
  };
  const replicatePoints: CdlOriginTable = {
    name: "Cdl_各电极拟合取点", columns: ["Scan_rate_X_mV_s", ...electrodes.map(sample => `${sample.name}_${settings.halfDelta ? "half_delta" : "delta"}_Y_${outputLabel(result.samples.find(item => item.id === sample.id)?.outputUnit)}`)],
    rows: rates.map(rateMV => [rateMV, ...electrodes.map(sample => {
      const matches = result.samples.find(item => item.id === sample.id)?.extracted.filter(point => point.included && point.rateMV === rateMV) ?? [];
      return matches.length === 1 ? matches[0].y : undefined;
    })]),
  };
  const groupSlots = groups.map(group => {
    const used = new Map<string, number>();
    return group.replicates.filter(item => item.sample.role !== "meanCurve").map((item, index) => {
      const base = item.sample.replicate?.trim() || String(index + 1), count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      return { ...item, label: count === 1 ? base : `${base}_${count}` };
    });
  });
  const labels = [...new Set(groupSlots.flatMap(slots => slots.map(item => item.label)))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const summary: CdlOriginTable = {
    name: "Cdl_组均值与样本SD", columns: ["Group", ...labels.map(label => `Replicate_${label}_Cdl`), "Mean_Cdl", "Sample_SD", "n", "Unit"],
    rows: groups.map((group, index) => [group.name, ...labels.map(label => groupSlots[index].find(item => item.label === label)?.result?.fit?.cdl), group.mean, group.sd, group.n, group.unit]),
  };
  const electrodeFits: CdlOriginTable = {
    name: "Cdl_逐电极拟合参数", columns: ["Group", "Electrode", "Replicate", "Cdl", "Cdl_unit", "Fit_slope_per_V_s", "Fit_intercept", "Fit_R_squared", "Fit_Cdl_SE", "Fit_n_rates"], rows: [],
  };
  for (const group of groups) {
    for (const { sample, result: electrode } of group.replicates) {
      if (sample.role === "meanCurve") continue;
      const fit = electrode?.fit;
      electrodeFits.rows.push([group.name, sample.name, sample.replicate, fit?.cdl, fit?.cdlUnit, fit?.slope, fit?.intercept, Number.isFinite(fit?.r2) ? fit?.r2 : undefined, fit?.cdlSE, fit?.n]);
    }
  }
  const curves = selectedCdlCvCurves(samples, settings);
  const cv = samples.map(sample => {
    const selected = curves.filter(curve => curve.sampleId === sample.id && curve.included).sort((a, b) => a.rateMV - b.rateMV);
    const length = Math.max(0, ...selected.map(curve => curve.plotted.length));
    return { name: `Cdl_CV_${sample.name}`, columns: selected.flatMap(curve => [`${curve.rateMV}mV_s_E_X_V_cycle${curve.cycle ?? "missing"}`, `${curve.rateMV}mV_s_I_Y_${outputLabel(curve.outputUnit)}_cycle${curve.cycle ?? "missing"}`]),
      rows: Array.from({ length }, (_, index) => selected.flatMap(curve => { const point = curve.plotted[index]; return [point?.x, point?.y]; })) };
  });
  return { meanPoints, replicatePoints, summary, electrodeFits, cv };
}

// Numeric negatives remain numeric in Origin-oriented tables. Text fields still
// use CSV formula protection; TXT is a direct tab-separated pure data table.
export function exportCdlTable(table: CdlOriginTable, delimiter: "," | "\t" = ","): string {
  const cell = (value: string | number | undefined) => {
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "";
    if (delimiter === ",") return csvCell(value);
    return String(value).replace(/[\t\r\n]/g, " ");
  };
  return "\uFEFF" + [table.columns.map(cell).join(delimiter), ...table.rows.map(row => row.map(cell).join(delimiter))].join("\r\n");
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Long-form CSV preserves hidden samples, excluded rates, original order, and gaps.
// It also stores complete settings/sample/series metadata, so exports remain auditable.
export function exportCdlCsv(samples: CdlSample[], settings: CdlSettings, result = calculateCdl(samples, settings)): string {
  const columns = ["record_type", "sample_id", "sample_name", "group_name", "replicate", "sample_role", "visible", "sample_source", "series_id", "series_source", "scan_rate_mV_s", "scan_rate_V_s", "rate_source", "header_rate_mV_s", "file_name_rate_mV_s", "included", "original_index", "potential_V", "raw_current", "raw_unit", "area_cm2", "output_unit", "value_unit", "summary_potential_V", "extraction_e0_V", "anodic", "cathodic", "half_delta", "delta", "fit_y", "cycle", "input_kind", "slope", "intercept", "r_squared", "r_squared_definition", "slope_standard_error", "intercept_standard_error", "rmse", "fit_n", "Cdl", "Cdl_standard_error", "Cdl_unit", "group_mean_Cdl", "group_sample_SD", "replicate_n", "electrode_total", "errors", "warnings", "settings_json", "sample_metadata_json", "series_metadata_json", "cycle_comparison_json", "raw_point_json"];
  const rows: Record<string, unknown>[] = [{ record_type: "settings", settings_json: settings, errors: result.error }];
  for (const sample of samples) {
    const converted = conversion(sample, settings), calculated = result.samples.find(item => item.id === sample.id);
    const base = { sample_id: sample.id, sample_name: sample.name, group_name: sample.groupName, replicate: sample.replicate, sample_role: sample.role ?? "electrode", visible: sample.visible, sample_source: sample.source, raw_unit: converted.unit, area_cm2: converted.area, output_unit: converted.outputUnit, summary_potential_V: sample.summaryPotential };
    const summary = sample.summary, sampleMetadata = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== "series" && key !== "summary"));
    rows.push({ ...base, record_type: "sample", sample_metadata_json: sampleMetadata, cycle_comparison_json: calculated?.cycles, errors: calculated?.errors.join("；"), warnings: calculated?.warnings.join("；") });
    for (const series of sample.series) {
      const { points, ...seriesMetadata } = series;
      const seriesBase = { ...base, series_id: series.id, series_source: series.source ?? sample.source, scan_rate_mV_s: series.rateMV, scan_rate_V_s: series.rateMV / 1000, rate_source: series.rateSource, header_rate_mV_s: series.headerRateMV, file_name_rate_mV_s: series.fileNameRateMV, included: series.included !== false, cycle: series.cycle };
      rows.push({ ...seriesBase, record_type: "series", series_metadata_json: seriesMetadata });
      for (const [index, point] of points.entries()) rows.push({ ...seriesBase, record_type: "raw_cv", original_index: index, potential_V: point.e, raw_current: point.current, value_unit: converted.unit, raw_point_json: point });
    }
    for (const [index, point] of (summary ?? []).entries()) rows.push({ ...base, record_type: "raw_summary", series_id: `summary-${index}`, series_source: point.source ?? sample.source, scan_rate_mV_s: point.rateMV, scan_rate_V_s: point.rateMV / 1000, included: point.included !== false, original_index: index,
      anodic: point.anodic, cathodic: point.cathodic, half_delta: point.halfDelta, input_kind: point.halfDelta === undefined ? "pair" : "halfDelta", series_metadata_json: point, value_unit: converted.unit });
    for (const point of calculated?.extracted ?? []) rows.push({ ...base, record_type: "extracted", series_id: point.seriesId, series_source: point.source, scan_rate_mV_s: point.rateMV, scan_rate_V_s: point.rateV, included: point.included, anodic: point.anodic, cathodic: point.cathodic, half_delta: point.halfDelta, delta: point.delta, fit_y: point.y, cycle: point.cycle, input_kind: point.inputKind, value_unit: converted.outputUnit, extraction_e0_V: point.inputKind === "cv" ? settings.e0 : sample.summaryPotential });
    if (calculated?.fit) {
      const fit = calculated.fit;
      rows.push({ ...base, record_type: "fit", slope: fit.slope, intercept: fit.intercept, r_squared: fit.r2, r_squared_definition: fit.r2Definition, slope_standard_error: fit.slopeSE, intercept_standard_error: fit.interceptSE, rmse: fit.rmse, fit_n: fit.n, Cdl: fit.cdl, Cdl_standard_error: fit.cdlSE, Cdl_unit: fit.cdlUnit });
    }
  }
  for (const group of groupedCdlResults(samples, result)) rows.push({ record_type: "group", group_name: group.name, Cdl_unit: group.unit, group_mean_Cdl: group.mean, group_sample_SD: group.sd, replicate_n: group.n, electrode_total: group.electrodeCount, errors: group.errors.join("；"), warnings: group.warnings.join("；") });
  return "\uFEFF" + [columns.join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\r\n");
}

export function demoCdlSamples(): CdlSample[] {
  return [{ id: "cdl-demo", name: "模拟 CV 样品", color: "#2374d5", visible: true, source: "模拟数据，仅用于体验；非用户测量", unit: "mA", demo: true,
    series: [20, 40, 60, 80, 100].map(rateMV => {
      const capacitance = 12, leakage = .12, amount = capacitance * rateMV / 1000;
      const up = Array.from({ length: 101 }, (_, index) => { const e = .025 + index * .001; return { e, current: leakage + amount + (e - .075) * .5 }; });
      const down = Array.from({ length: 100 }, (_, index) => { const e = .124 - index * .001; return { e, current: leakage - amount + (e - .075) * .5 }; });
      return { id: `demo-${rateMV}`, rateMV, points: [...up, ...down], included: true };
    }) }];
}
