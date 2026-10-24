import type { PlotCurve, PlotPoint } from "./lsv-math";
import type { ScanMode } from "./scan-branches";

export const MAX_BOOKS_PER_SAMPLE = 10;
const MAX_EXPORT_ROWS = 500_000;

export type DataBookContext = {
  kind: "lsv" | "tafel";
  scan: ScanMode;
  xFormula: string;
  yFormula: string;
  xLabel: string;
  yLabel: string;
  /** The already-applied global Rs, never the unconfirmed input field. */
  globalResistance: string;
  maskedIndices?: readonly number[];
  fitIndices?: readonly number[];
  irPending?: boolean;
};
export type DataBookColumn = { key: string; label: string; unit?: string };
export type DataBookRow = { index: number; cells: (number | string | null)[] };
export type DataBookSource = {
  columns: DataBookColumn[];
  rowCount: number;
  /** Zero-based lookup; the returned index and displayed point number are one-based. */
  row: (index: number) => DataBookRow;
  metadata: Record<string, string | number | null>;
};

type DerivedLookup = (index: number) => PlotPoint | null;
type CurveCache = {
  derived: DerivedLookup;
};
// Curves and their raw arrays are immutable React state. Reusing this work is
// important when an IR draft changes, or ten BOOK windows view the same sample.
const curveCaches = new WeakMap<PlotCurve, CurveCache>();
const UNIT_SCALE: Record<PlotCurve["unit"], number> = {
  A: 1, mA: 1e-3, uA: 1e-6, nA: 1e-9,
  "A/cm2": 1, "mA/cm2": 1e-3, "uA/cm2": 1e-6,
};
const SCAN_LABELS: Record<ScanMode, string> = { all: "全部", up: "正向扫描", down: "反向扫描" };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function parameter(value: unknown, allowNegative = false): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && (allowNegative || number >= 0) ? number : null;
}
function validate(curve: PlotCurve, context: DataBookContext) {
  if (!curve || !Array.isArray(curve.points) || !Array.isArray(curve.plotted)) {
    throw new Error("BOOK 需要完整的原始数据和已计算曲线。");
  }
  if (context.kind !== "lsv" && context.kind !== "tafel") throw new Error("BOOK 工作台类型无效。");
  if (!["all", "up", "down"].includes(context.scan)) throw new Error("BOOK 扫描方向无效。");
  if (!Object.prototype.hasOwnProperty.call(UNIT_SCALE, curve.unit)) throw new Error("BOOK 原始电流单位无效。");
}

function cacheFor(curve: PlotCurve): CurveCache {
  const existing = curveCaches.get(curve);
  if (existing) return existing;
  let derived: DerivedLookup;
  if (curve.error) derived = () => null;
  else if (curve.plotted.length === curve.points.length && curve.plotted.every((point, index) => !point || point.index === index)) {
    derived = index => curve.plotted[index] ?? null;
  } else {
    // Do not interpret a filtered array position as an original row number.
    const points = new Map<number, PlotPoint | null>();
    for (const point of curve.plotted) {
      if (!point || !Number.isInteger(point.index) || point.index < 0 || point.index >= curve.points.length) continue;
      if (points.has(point.index)) {
        const previous = points.get(point.index);
        if (!previous || previous.x !== point.x || previous.y !== point.y) points.set(point.index, null);
      } else points.set(point.index, point);
    }
    derived = index => points.get(index) ?? null;
  }
  const cache = { derived };
  curveCaches.set(curve, cache);
  return cache;
}

export function dataBookColumns(curve: PlotCurve, context: DataBookContext): DataBookColumn[] {
  return [
    { key: "rawPotential", label: "原始电位", unit: "V" },
    { key: "rawCurrent", label: "导入电流", unit: curve.unit.replace("uA", "μA").replace("cm2", "cm²") },
    { key: "spacer", label: "" },
    { key: "x", label: context.xLabel || "当前 X" },
    { key: "y", label: context.yLabel || "当前 Y" },
  ];
}

/**
 * Expose all imported rows without copying or changing the source data. X/Y
 * come from the applied plot result, not from evaluating the displayed formula
 * again. Call with the full result.curves before masks, scan or plot decimation.
 */
export function buildDataBookSource(curve: PlotCurve, context: DataBookContext): DataBookSource {
  validate(curve, context);
  const cache = cacheFor(curve);
  const parsedArea = parameter(curve.area), area = parsedArea !== null && parsedArea > 0 ? parsedArea : null;
  const sampleResistance = parameter(curve.resistance), globalResistance = parameter(context.globalResistance);
  const rawResistance = curve.resistance.trim() || context.globalResistance;
  const resistance = parameter(rawResistance);
  const appliedIR = context.kind === "lsv" ? parameter(curve.irVoltage ?? "0", true) : resistance;
  const columns = dataBookColumns(curve, context);
  const rowCount = curve.points.length;
  const metadata: DataBookSource["metadata"] = {
    "样品": curve.name,
    "源文件": curve.source,
    "原始点数": rowCount,
    "原始电流单位": curve.unit,
    "面积 / cm²": area,
    "原始补偿状态": curve.compensation,
    "曲线显示": curve.visible ? "显示" : "隐藏（BOOK 保留全部数据）",
    "扫描选择": SCAN_LABELS[context.scan],
    "X 公式": context.xFormula,
    "Y 公式": context.yFormula,
    "IR 状态": context.irPending ? "有待确认的修改；表内仍为已应用数值" : "已应用",
    "计算状态": curve.error || (curve.invalid ? `${curve.invalid} 个点无效，保留空值` : "与当前曲线一致"),
  };
  if (context.kind === "lsv") metadata["已应用 IR 参数"] = appliedIR;
  else {
    metadata["全局 Rs / Ω"] = globalResistance;
    metadata["样品 Rs / Ω"] = sampleResistance;
    metadata["已应用 Rs / Ω"] = resistance;
  }
  if (curve.demo) metadata["数据性质"] = "模拟数据，仅用于体验操作";

  return {
    columns, rowCount, metadata,
    row(index) {
      if (!Number.isInteger(index) || index < 0 || index >= rowCount) throw new RangeError("BOOK 原始点序超出范围。");
      const raw = curve.points[index];
      const rawE = finite(raw?.e), rawCurrent = finite(raw?.current);
      const point = cache.derived(index);
      const valid = rawE !== null && rawCurrent !== null && !!point && finite(point.x) !== null && finite(point.y) !== null;
      // The row number is a separate index header. C is deliberately empty,
      // leaving only four data columns: imported A/B and applied plot X/Y in D/E.
      const cells: DataBookRow["cells"] = [rawE, rawCurrent, null,
        valid ? point!.x : null, valid ? point!.y : null];
      return { index: index + 1, cells };
    },
  };
}

function csvCell(value: number | string | null): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (value === null || value === "") return "";
  const text = value ?? "";
  // Spreadsheet programs must treat user-provided column labels as literal text.
  const escaped = /^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + escaped.replace(/"/g, '""') + '"';
}

/** The same A/B, empty C, D/E layout as BOOK, with every original row. */
export function buildDataBookCsv(curve: PlotCurve, context: DataBookContext): string {
  return buildDataBookCsvFromSource(buildDataBookSource(curve, context));
}

/** CSV for any BOOK-shaped source, including extended worksheet columns. */
export function buildDataBookCsvFromSource(source: DataBookSource): string {
  if (!source.rowCount) throw new Error("BOOK 没有可导出的原始数据。");
  if (source.rowCount > MAX_EXPORT_ROWS) throw new Error("一次最多导出 500,000 个原始数据点。");
  const header = source.columns.map(column => column.label + (column.unit ? ` / ${column.unit}` : ""));
  const lines = [header.map(csvCell).join(",")];
  for (let index = 0; index < source.rowCount; index++) {
    lines.push(source.row(index).cells.map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Return the first available BOOK number for one sample in one workspace. */
export function nextDataBookNumber(existing: readonly number[]): number | null {
  const used = new Set(existing);
  for (let number = 1; number <= MAX_BOOKS_PER_SAMPLE; number++) if (!used.has(number)) return number;
  return null;
}
