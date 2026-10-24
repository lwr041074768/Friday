import type { PlotCurve } from "./lsv-math";

export type XyExportKind = "xrd" | "eis";
export type XyColumnProfile = "full" | "origin";
export type XyExportSettings = Record<string, string | number | boolean>;
export type XyExportOptions = {
  kind: XyExportKind;
  curves: PlotCurve[];
  xLabel: string;
  yLabel: string;
  settings?: XyExportSettings;
  plotStyle?: "line" | "scatter";
  equalUnits?: boolean;
};
export type XyExportColumn = { key: string; label: string; unit: string; role: "x" | "y" | "data" };
export type XyExportSample = {
  name: string; source: string; visible: boolean; demo: boolean;
  imaginary: "raw" | "negative" | null;
  rows: (number | null)[][];
  note: string;
};
export type XyOriginPayload = {
  schema: "xy-origin/v1";
  requestId: string;
  createdAt: string;
  kind: XyExportKind;
  axes: { x: string; y: string };
  settings: XyExportSettings;
  plot: { style: "line" | "scatter"; equalUnits: boolean };
  columns: XyExportColumn[];
  samples: XyExportSample[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN_MISSING = -1.23456789e-300;
function text(value: string, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0") || (!allowEmpty && !value.trim())) {
    throw new Error(`${label}需为不超过 ${maximum} 个字符的文本。`);
  }
  return value;
}
function finite(value: number | undefined): number | null {
  if (value === ORIGIN_MISSING) throw new Error("原始数据包含 Origin 的缺失值保留数字，请确认后拆分或重新导入。");
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function xyExportColumns(kind: XyExportKind, xLabel: string, yLabel: string, profile: XyColumnProfile = "full"): XyExportColumn[] {
  return kind === "xrd" ? [
    { key: "rawX", label: "原始 2θ", unit: "deg", role: "x" },
    { key: "rawY", label: "原始强度", unit: "a.u.", role: "y" },
    { key: "plotX", label: xLabel, unit: "deg", role: "x" },
    { key: "plotY", label: yLabel, unit: "a.u.", role: "y" },
  ] : profile === "origin" ? [
    { key: "real", label: "原始 Z′", unit: "ohm", role: "x" },
    { key: "importedImaginary", label: "导入虚部列（见符号约定）", unit: "ohm", role: "y" },
    { key: "plotX", label: xLabel, unit: "ohm", role: "x" },
    { key: "plotY", label: yLabel, unit: "ohm", role: "y" },
  ] : [
    { key: "real", label: "原始 Z′", unit: "ohm", role: "x" },
    { key: "importedImaginary", label: "导入虚部列（见符号约定）", unit: "ohm", role: "y" },
    { key: "imaginary", label: "Z″（还原原始符号）", unit: "ohm", role: "y" },
    { key: "negativeImaginary", label: "−Z″", unit: "ohm", role: "y" },
    { key: "frequency", label: "Frequency", unit: "Hz", role: "data" },
    { key: "plotX", label: xLabel, unit: "ohm", role: "x" },
    { key: "plotY", label: yLabel, unit: "ohm", role: "y" },
  ];
}

/** Full original rows and already applied XY, never chart decimation or viewport clipping. */
export function buildXyOriginExport(options: XyExportOptions, requestId?: string, profile: XyColumnProfile = "full"): XyOriginPayload {
  const { kind, curves, xLabel, yLabel } = options;
  if (kind !== "xrd" && kind !== "eis") throw new Error("导出类型无效。");
  if (profile !== "full" && profile !== "origin") throw new Error("导出列设置无效。");
  const compactEis = kind === "eis" && profile === "origin";
  const title = kind.toUpperCase();
  if (!curves.length) throw new Error(`请先导入 ${title} 数据。`);
  if (curves.length > 20) throw new Error("一次最多导出 20 条曲线。");
  text(xLabel, "X 轴标题", 256); text(yLabel, "Y 轴标题", 256);
  if (options.plotStyle !== undefined && !["line", "scatter"].includes(options.plotStyle)) throw new Error("曲线样式无效。");
  if (options.equalUnits !== undefined && typeof options.equalUnits !== "boolean") throw new Error("坐标比例设置无效。");
  const settings: XyExportSettings = {};
  // Equivalent settings objects must not generate new handoff downloads merely
  // because their keys were inserted in a different order.
  const entries = Object.entries(options.settings ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length > 32) throw new Error("导出设置最多允许 32 项。");
  for (const [key, value] of entries) {
    text(key, "设置名称", 64);
    if (typeof value === "string") text(value, "设置值", 2048, true);
    else if (typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value) && value !== ORIGIN_MISSING)) throw new Error("导出设置值需为文本、有限数值或布尔值。");
    Object.defineProperty(settings, key, { value, enumerable: true });
  }
  let total = 0;
  for (const curve of curves) {
    total += curve.points.length;
    if (total > 500_000) throw new Error("一次最多导出 500,000 个原始数据点，请拆分后导出。");
    if (curve.points.length < 2) throw new Error(`${curve.name} 至少需要两个原始数据点。`);
    if (!curve.error && curve.plotted.length !== curve.points.length) throw new Error("导出需要完整曲线，不能传入筛选或抽稀后的绘图数据。");
  }
  const id = requestId ?? crypto.randomUUID();
  if (!UUID.test(id)) throw new Error("导出请求 ID 必须是有效的 UUID。");
  const columns = xyExportColumns(kind, xLabel, yLabel, profile);
  const samples = curves.map((curve): XyExportSample => {
    text(curve.name, "样品名", 256); text(curve.source, "来源", 2048, true);
    if (typeof curve.visible !== "boolean") throw new Error("样品显示状态无效。");
    if (kind === "eis" && curve.imaginary !== undefined && !["raw", "negative"].includes(curve.imaginary)) throw new Error("EIS 导入虚部符号约定无效。");
    let gaps = 0;
    const rows = curve.points.map((point, index) => {
      const rawX = finite(point.e), rawY = finite(point.current);
      const derived = curve.error ? null : curve.plotted[index];
      if (derived && derived.index !== index) throw new Error("绘图点序与原始点序不一致，无法完整导出。");
      let plotX = derived ? finite(derived.x) : null, plotY = derived ? finite(derived.y) : null;
      if (rawX === null || rawY === null || plotX === null || plotY === null) { plotX = null; plotY = null; gaps++; }
      if (kind === "xrd") return [rawX, rawY, plotX, plotY];
      if (compactEis) return [rawX, rawY, plotX, plotY];
      const imaginary = rawY === null ? null : curve.imaginary === "negative" ? -rawY : rawY;
      return [rawX, rawY, imaginary, imaginary === null ? null : -imaginary, finite(point.frequency), plotX, plotY];
    });
    const notes = [
      "保留全部原始行、导入点序及完整数值精度；未按当前视窗裁剪或抽稀。",
      "绘图 X/Y 是网页当前已应用的结果，Origin 中不再次计算。",
      kind === "xrd" ? "原始 2θ 和原始强度独立保留；归一化及堆叠设置见处理设置。" : `导入第二列为${curve.imaginary === "negative" ? "已取负 −Z″；Z″ = −导入第二列" : "原始 Z″；−Z″ = −导入第二列"}。保留虚部正负号，未取绝对值；${compactEis ? "Origin 每组仅保留原始 Z′、导入虚部及绘图 X/Y 四列。" : "频率缺失时留空。"}`,
    ];
    if (gaps) notes.push(`${gaps} 行绘图结果缺失，以空值保留曲线缺口。`);
    if (!curve.visible) notes.push("该样品当前隐藏，仍完整导出。Origin 中绘图时请按备注选择样品。");
    if (curve.demo) notes.push("模拟数据，仅供体验。");
    if (curve.error) notes.push("网页处理错误：" + text(curve.error, "处理错误", 1024, true));
    return { name: curve.name, source: curve.source, visible: curve.visible, demo: !!curve.demo,
      imaginary: kind === "eis" ? curve.imaginary ?? "raw" : null, rows, note: notes.join(" ") };
  });
  return { schema: "xy-origin/v1", requestId: id, createdAt: new Date().toISOString(), kind,
    axes: { x: xLabel, y: yLabel }, settings,
    plot: { style: options.plotStyle ?? (kind === "eis" ? "scatter" : "line"), equalUnits: options.equalUnits ?? kind === "eis" }, columns, samples };
}
