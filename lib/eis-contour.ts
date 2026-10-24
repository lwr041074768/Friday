import type { Curve, Point } from "./lsv-math";

export type EisSpectrum = Curve & { eisGroup?: string; eisPotential?: string };
export type EisContourQuantity = "log-imag" | "log-modulus";
export type EisContourRow = { name: string; potential: number; source: string; frequency: number[] };
export type EisContourGrid = {
  x: number[]; y: number[]; values: number[][]; names: string[];
  min: number; max: number; error?: string; note: string; rows: EisContourRow[];
  group: string; quantity: EisContourQuantity;
};

const fileStem = (value: string) => value.replace(/\.(?:bin|txt|csv|tsv|dat|xlsx?)$/i, "");
function potentialValue(value: string): number {
  const text = value.trim().replace(/−/g, "-").replace(",", ".");
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}

/** Infer only explicit EIS-potential labels or labels carrying a V unit. */
export function inferEisIdentity(name: string, source: string): { group: string; potential: string } {
  const normalized = source.replace(/\\/g, "/"), slash = normalized.lastIndexOf("/");
  const parent = slash >= 0 ? normalized.slice(0, slash) : "";
  const candidates = [fileStem(name.trim()), fileStem(normalized.slice(slash + 1).trim())];
  let potential = "", prefix = "";
  for (const stem of candidates) {
    const eis = /(?:^|[\s_-])EIS\s*[-_: ]\s*([+-]?(?:\d+[.,]\d+|0\d{1,3}|\d{1,2}))\s*(V)?\s*$/i.exec(stem);
    const withUnit = /(?:^|[\s_-])([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*V\s*$/i.exec(stem);
    const match = eis ?? withUnit;
    if (!match) continue;
    let token = match[1].replace(",", ".");
    // CHI names such as EIS-005 encode 0.05 V. A written V unit uses its literal number.
    if (eis && !eis[2] && /^0\d{1,3}$/.test(token)) token = `0.${token.slice(1)}`;
    const value = potentialValue(token);
    if (!Number.isFinite(value)) continue;
    potential = String(value);
    prefix = stem.slice(0, match.index).replace(/[\s_-]+$/, "");
    break;
  }
  return { group: parent || prefix || "样品1", potential };
}

export function prepareEisSpectra(curves: readonly Curve[]): EisSpectrum[] {
  return curves.map(curve => {
    const spectrum = curve as EisSpectrum, inferred = inferEisIdentity(curve.name, curve.source);
    return { ...curve, eisGroup: spectrum.eisGroup ?? inferred.group, eisPotential: spectrum.eisPotential ?? inferred.potential };
  });
}

function rawImaginary(curve: Curve, point: Point): number {
  return curve.imaginary === "negative" ? -point.current : point.current;
}
function quantityValue(curve: Curve, point: Point, quantity: EisContourQuantity): number {
  const imaginary = rawImaginary(curve, point);
  const value = quantity === "log-modulus" ? Math.hypot(point.e, imaginary) : Math.abs(imaginary);
  return Number.isFinite(value) && value > 0 ? Math.log10(value) : NaN;
}

/** x is log10(f / Hz); rows/y retain every distinct measured potential in ascending order. */
export function buildEisContourGrid(curves: readonly Curve[], group: string, quantity: EisContourQuantity = "log-imag"): EisContourGrid {
  const empty = (error: string): EisContourGrid => ({ x: [], y: [], values: [], names: [], min: 0, max: 1, rows: [], group, quantity, note: "", error });
  const selected = prepareEisSpectra(curves).filter(curve => curve.visible && curve.eisGroup === group);
  const unknown = selected.filter(curve => !curve.eisPotential?.trim()).length;
  if (selected.some(curve => curve.eisPotential?.trim() && !Number.isFinite(potentialValue(curve.eisPotential)))) return empty("请核对可见谱线的电位，填写有效数值或留空。");
  const known = selected.filter(curve => curve.eisPotential?.trim()).map(curve => ({ curve, potential: potentialValue(curve.eisPotential!) })).sort((a, b) => a.potential - b.potential);
  if (known.length < 2) return empty(`同一数据组至少需要两条已填写电位的可见 EIS 谱线。${unknown ? `当前有 ${unknown} 条未知电位谱线。` : ""}`);
  for (let i = 1; i < known.length; i++) {
    if (Math.abs(known[i].potential - known[i - 1].potential) <= 1e-7 * Math.max(1, Math.abs(known[i].potential), Math.abs(known[i - 1].potential))) return empty(`电位 ${known[i].potential} V 存在重复测量，请隐藏其中一条后绘图。`);
  }
  const spectra = known.map(({ curve, potential }) => {
    const points = curve.points.map((point, index) => ({ index, frequency: point.frequency, z: quantityValue(curve, point, quantity) }))
      .filter((point): point is { index: number; frequency: number; z: number } => typeof point.frequency === "number" && Number.isFinite(point.frequency) && point.frequency > 0);
    const frequencies = points.map(point => point.frequency);
    const duplicate = new Set(frequencies).size !== frequencies.length;
    const ascending = frequencies.every((frequency, i) => !i || frequency > frequencies[i - 1]);
    const descending = frequencies.every((frequency, i) => !i || frequency < frequencies[i - 1]);
    return { curve, potential, duplicate, ordered: ascending || descending, points: (descending ? [...points].reverse() : points).map(point => ({ ...point, x: Math.log10(point.frequency) })) };
  });
  const duplicate = spectra.find(spectrum => spectrum.duplicate);
  if (duplicate) return empty(`${duplicate.curve.name} 存在重复频率，请检查数据或隐藏该谱线。`);
  const unordered = spectra.find(spectrum => !spectrum.ordered);
  if (unordered) return empty(`${unordered.curve.name} 的频率需要严格递增或递减，请检查扫描点序。`);
  const insufficient = spectra.find(spectrum => spectrum.points.length < 2);
  if (insufficient) return empty(`${insufficient.curve.name} 至少需要两个正的有效频率点。`);
  const x0 = Math.max(...spectra.map(spectrum => spectrum.points[0].x)), x1 = Math.min(...spectra.map(spectrum => spectrum.points.at(-1)!.x));
  if (!(x1 > x0) || !Number.isFinite(x0) || !Number.isFinite(x1)) return empty("所选谱线需要具有共同的正频率区间。");
  const columns = Math.min(650, Math.max(80, ...spectra.map(spectrum => spectrum.points.length)));
  const positions = new Set(Array.from({ length: columns }, (_, i) => x0 + (x1 - x0) * i / (columns - 1)));
  positions.add(x0); positions.add(x1);
  // Include gap boundaries and their middle so even a narrow source gap remains visible.
  for (const spectrum of spectra) for (let i = 0; i < spectrum.points.length; i++) {
    const point = spectrum.points[i], next = spectrum.points[i + 1];
    if (!Number.isFinite(point.z) && point.x >= x0 && point.x <= x1) positions.add(point.x);
    if (next && (Math.abs(point.index - next.index) !== 1 || !Number.isFinite(point.z) || !Number.isFinite(next.z))) {
      for (const x of [point.x, (point.x + next.x) / 2, next.x]) if (x >= x0 && x <= x1) positions.add(x);
    }
  }
  const x = [...positions].sort((a, b) => a - b);
  const values = spectra.map(spectrum => {
    let j = 0;
    return x.map(position => {
      while (j < spectrum.points.length - 2 && spectrum.points[j + 1].x < position) j++;
      const a = spectrum.points[j], b = spectrum.points[j + 1];
      if (position === a.x) return a.z;
      if (position === b.x) return b.z;
      if (position < a.x || position > b.x || Math.abs(a.index - b.index) !== 1 || !Number.isFinite(a.z) || !Number.isFinite(b.z)) return NaN;
      return a.z + (b.z - a.z) * (position - a.x) / (b.x - a.x);
    });
  });
  let min = Infinity, max = -Infinity;
  for (const row of values) for (const value of row) if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  if (!Number.isFinite(min)) return empty("共同频率区间内需要至少一个有效的正模值；请检查零值和缺失点。");
  return { x, y: spectra.map(spectrum => spectrum.potential), values, names: spectra.map(spectrum => spectrum.curve.name), min, max, group, quantity,
    rows: spectra.map(spectrum => ({ name: spectrum.curve.name, potential: spectrum.potential, source: spectrum.curve.source, frequency: spectrum.curve.points.map(point => point.frequency).filter((frequency): frequency is number => typeof frequency === "number" && Number.isFinite(frequency) && frequency > 0) })),
    note: `颜色为 ${quantity === "log-modulus" ? "log₁₀(|Z| / Ω)" : "log₁₀(|Z″| / Ω)"}；在各谱共同 log₁₀(f / Hz) 区间内线性插值，保留实测电位间距与数据缺口。${unknown ? `已跳过 ${unknown} 条未知电位谱线。` : ""}` };
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[,"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function csv(rows: (string | number | undefined)[][]): string { return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n"; }

/** Full source-point export, including hidden spectra, signed imaginary values and gaps. */
export function buildEisContourCsv(curves: readonly Curve[], quantity: EisContourQuantity = "log-imag"): string {
  if (!curves.length) throw new Error("请先导入 EIS 数据。");
  const rows: (string | number | undefined)[][] = [["group", "sample_name", "source", "potential_V", "visible", "curve_id", "source_point", "frequency_Hz", "Zreal_Ohm", "imported_imaginary_value", "imaginary_convention", "raw_Zimag_Ohm", "minus_Zimag_Ohm", "log10_frequency_Hz", "quantity", "processed_value", "demo"]];
  for (const curve of prepareEisSpectra(curves)) curve.points.forEach((point, index) => {
    const imaginary = rawImaginary(curve, point), f = point.frequency;
    rows.push([curve.eisGroup, curve.name, curve.source, curve.eisPotential, curve.visible ? 1 : 0, curve.id, index + 1, f, point.e, point.current, curve.imaginary ?? "raw", imaginary, -imaginary,
      typeof f === "number" && Number.isFinite(f) && f > 0 ? Math.log10(f) : undefined, quantity, quantityValue(curve, point, quantity), curve.demo ? 1 : 0]);
  });
  return csv(rows);
}

/** Display grid export is separate from the source-point table. */
export function gridCsv(grid: EisContourGrid): string {
  const rows: (string | number | undefined)[][] = [["group", "potential_V", "sample_name", "source", "log10_frequency_Hz", "frequency_Hz", "quantity", "display_value", "display_interpolated"]];
  grid.y.forEach((potential, row) => grid.x.forEach((x, col) => rows.push([grid.group, potential, grid.names[row], grid.rows[row]?.source, x, 10 ** x, grid.quantity, grid.values[row]?.[col], 1])));
  return csv(rows);
}
export const buildEisContourGridCsv = gridCsv;
