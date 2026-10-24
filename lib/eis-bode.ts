import type { Curve, Point } from "./lsv-math";
import { prepareEisSpectra } from "./eis-contour";

export type EisBodeView = "both" | "phase" | "magnitude";
export type EisBodePhaseSign = "negative" | "signed";
export type EisBodePoint = {
  frequency: number; logFrequency: number; real: number; rawImaginary: number;
  magnitude: number; logMagnitude: number | null;
  phase: number | null; negativePhase: number | null; index: number;
};
export type EisBodeSeries = {
  id: string; name: string; color: string; source: string;
  potential: string; label: string; points: (EisBodePoint | null)[];
};
export type EisBodeData = {
  series: EisBodeSeries[]; group: string;
  /** Frequency bounds are Hz; magnitude bounds are positive ohms, without padding. */
  xMin: number; xMax: number; logXMin: number; logXMax: number;
  magMin: number; magMax: number;
  phaseMin: number; phaseMax: number; negativePhaseMin: number; negativePhaseMax: number;
  error?: string; note: string;
};

function potentialNumber(value: string | undefined): number {
  const text = value?.trim().replace(/−/g, "-").replace(",", ".") ?? "";
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}
function impedance(curve: Curve, point: Point) {
  const real = point.e, rawImaginary = curve.imaginary === "negative" ? -point.current : point.current;
  const valid = Number.isFinite(real) && Number.isFinite(rawImaginary);
  const magnitude = valid ? Math.hypot(real, rawImaginary) : NaN;
  const finiteMagnitude = Number.isFinite(magnitude);
  const phase = valid && finiteMagnitude && magnitude > 0 ? Math.atan2(rawImaginary, real) * 180 / Math.PI : null;
  return { real, rawImaginary, magnitude, logMagnitude: finiteMagnitude && magnitude > 0 ? Math.log10(magnitude) : null, phase, negativePhase: phase === null ? null : -phase, valid: valid && finiteMagnitude };
}
function bodePoint(curve: Curve, point: Point, index: number): EisBodePoint | null {
  const f = point.frequency, z = impedance(curve, point);
  if (typeof f !== "number" || !Number.isFinite(f) || f <= 0 || !z.valid) return null;
  return { frequency: f, logFrequency: Math.log10(f), real: z.real, rawImaginary: z.rawImaginary, magnitude: z.magnitude, logMagnitude: z.logMagnitude, phase: z.phase, negativePhase: z.negativePhase, index };
}

/** Every points slot keeps the original point index and source scan order. */
export function buildEisBode(curves: readonly Curve[], group: string): EisBodeData {
  const selected = prepareEisSpectra(curves).filter(curve => curve.visible && curve.eisGroup === group)
    .map((curve, order) => ({ curve, order, potential: potentialNumber(curve.eisPotential) }))
    .sort((a, b) => {
      const knownA = Number.isFinite(a.potential), knownB = Number.isFinite(b.potential);
      return knownA && knownB ? a.potential - b.potential || a.order - b.order : knownA ? -1 : knownB ? 1 : a.order - b.order;
    });
  const series: EisBodeSeries[] = selected.map(({ curve, potential }) => {
    const known = Number.isFinite(potential), text = known ? String(potential) : "";
    return { id: curve.id, name: curve.name, color: curve.color, source: curve.source, potential: text, label: known ? `${text} V · ${curve.name}` : curve.name,
      points: curve.points.map((point, index) => bodePoint(curve, point, index)) };
  });
  let xMin = Infinity, xMax = -Infinity, magMin = Infinity, magMax = -Infinity;
  let phaseMin = Infinity, phaseMax = -Infinity, negativePhaseMin = Infinity, negativePhaseMax = -Infinity;
  let gaps = 0, zeros = 0, drawable = 0;
  for (const item of series) for (const point of item.points) {
    if (point === null) { gaps++; continue; }
    xMin = Math.min(xMin, point.frequency); xMax = Math.max(xMax, point.frequency);
    if (point.magnitude > 0) { magMin = Math.min(magMin, point.magnitude); magMax = Math.max(magMax, point.magnitude); drawable++; } else zeros++;
    if (point.phase !== null && point.negativePhase !== null) {
      phaseMin = Math.min(phaseMin, point.phase); phaseMax = Math.max(phaseMax, point.phase);
      negativePhaseMin = Math.min(negativePhaseMin, point.negativePhase); negativePhaseMax = Math.max(negativePhaseMax, point.negativePhase);
    }
  }
  if (!Number.isFinite(xMin)) { xMin = 1; xMax = 10; }
  if (!Number.isFinite(magMin)) { magMin = 1; magMax = 10; }
  if (!Number.isFinite(phaseMin)) { phaseMin = -90; phaseMax = 0; negativePhaseMin = 0; negativePhaseMax = 90; }
  const error = !series.length ? "当前数据组需要至少一条可见 EIS 谱线。" : !drawable ? "当前谱线需要正的有效频率和至少一个非零有效阻抗点。" : undefined;
  const unknown = series.filter(item => !item.potential).length;
  return { series, group, xMin, xMax, logXMin: Math.log10(xMin), logXMax: Math.log10(xMax), magMin, magMax, phaseMin, phaseMax, negativePhaseMin, negativePhaseMax, error,
    note: `|Z| = hypot(Z′, Z″)，φ = atan2(Z″, Z′)，−φ = −atan2(Z″, Z′)；相位单位为 °。${gaps ? ` ${gaps} 个缺失频率或无效阻抗点保留为断线。` : ""}${zeros ? ` ${zeros} 个零阻抗点的相位与对数模值留空。` : ""}${unknown ? ` ${unknown} 条未知电位谱线按原名称显示。` : ""}` };
}

function cell(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[,"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Export all groups and original slots, including hidden spectra and invalid plot points. */
export function buildEisBodeCsv(curves: readonly Curve[]): string {
  if (!curves.length) throw new Error("请先导入 EIS 数据。");
  const rows: (string | number | null | undefined)[][] = [["group", "sample_name", "source", "potential_V", "visible", "curve_id", "source_point", "frequency_Hz", "Zreal_Ohm", "imported_imaginary_value", "imaginary_convention", "raw_Zimag_Ohm", "minus_Zimag_Ohm", "magnitude_Ohm", "phase_deg", "negative_phase_deg", "log10_frequency_Hz", "log10_magnitude_Ohm", "valid_frequency", "valid_impedance", "valid_phase", "demo"]];
  for (const curve of prepareEisSpectra(curves)) curve.points.forEach((point, index) => {
    const z = impedance(curve, point), f = point.frequency;
    const validFrequency = typeof f === "number" && Number.isFinite(f) && f > 0;
    rows.push([curve.eisGroup, curve.name, curve.source, curve.eisPotential, curve.visible ? 1 : 0, curve.id, index + 1, f, point.e, point.current, curve.imaginary ?? "raw", z.rawImaginary, -z.rawImaginary,
      z.magnitude, z.phase, z.negativePhase, validFrequency ? Math.log10(f) : null, z.logMagnitude, validFrequency ? 1 : 0, z.valid ? 1 : 0, z.phase === null ? 0 : 1, curve.demo ? 1 : 0]);
  });
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
