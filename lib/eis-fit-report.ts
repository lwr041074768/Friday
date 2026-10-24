import type { Curve } from "./lsv-math";
import { circuitParameters, type EisCircuitKind, type EisFitPoint, type EisFitResult } from "./eis-circuit";
import { ZSIMP_MODELS } from "./eis-zsimp-models";

export type EisWeighting = "modulus" | "unit";
export const EIS_CIRCUIT_MODELS: readonly { value: EisCircuitKind; label: string; equation: string }[] = [
  ...ZSIMP_MODELS,
  { value: "r-cpe", label: "Rs + (Rct ∥ CPE)", equation: "Z = Rs + Rct / [1 + Q Rct (jω)^n]" },
  { value: "r-cpe-w", label: "Rs + [ CPE ∥ (Rct + W) ]", equation: "Z = Rs + (Rct + σ/√(jω)) / [1 + Q (jω)^n (Rct + σ/√(jω))]" },
  { value: "rq-rq", label: "Rs + 两个 (R ∥ CPE)", equation: "Z = Rs + R1/[1+Q1 R1 (jω)^n1] + R2/[1+Q2 R2 (jω)^n2]" },
];
export type EisFitCandidateSummary = {
  kind: EisCircuitKind; label: string; expression: string; rank: number;
  aicc: number; deltaAicc: number; score: number; stable: boolean; converged: boolean;
  rms: number; parameterCount: number; warnings: string[];
  starts: number; successfulStarts: number; searchIterations: number; refined: boolean;
};
export type EisFitSearchBudget = {
  screeningStarts: number; screeningIterations: number; refinementStarts: number;
  refinementIterations: number; refinedModels: number;
};
export type EisFitSelection = {
  mode: "auto" | "manual"; attempted: number; total: number; failed: number;
  elapsedMs: number; selectedRank?: number; candidates: EisFitCandidateSummary[];
  searchBudget?: EisFitSearchBudget;
};
export type EisFitReport = {
  curveId: string; curveName: string; source: string; imaginary: "raw" | "negative";
  originalCount: number; indices: number[]; observed: EisFitPoint[];
  weighting: EisWeighting; fit: EisFitResult; demo: boolean;
  selection?: EisFitSelection;
};

/** Keep acquisition order and original row indices; never take absolute imaginary values. */
export function collectEisFitPoints(curve: Curve) {
  const points: EisFitPoint[] = [], indices: number[] = [];
  curve.points.forEach((point, index) => {
    const frequency = point.frequency;
    if (typeof frequency !== "number" || !Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(point.e) || !Number.isFinite(point.current)) return;
    points.push({ frequency, zReal: point.e, minusZImag: curve.imaginary === "negative" ? point.current : -point.current });
    indices.push(index);
  });
  return { points, indices, missing: curve.points.length - points.length };
}

export function eisResidualSummary(fit: EisFitResult) {
  let squared = 0, max = 0;
  for (const point of fit.residuals) { const magnitude = Math.hypot(point.zReal, point.minusZImag); squared += magnitude * magnitude; max = Math.max(max, magnitude); }
  return { rms: Math.sqrt(squared / Math.max(1, fit.residuals.length)), max };
}

export function eisResistanceLabel(kind: EisCircuitKind) {
  if (String(kind).startsWith("zsimp:")) return "直流极限电阻";
  return kind === "rq-rq" ? "Rs + R1 + R2" : kind === "r-cpe-w" ? "Rs + Rct（不含扩散阻抗）" : "Rs + Rct";
}

export function createEisFitReport(curve: Curve, fit: EisFitResult, weighting: EisWeighting, selection?: EisFitSelection): EisFitReport {
  const { points, indices } = collectEisFitPoints(curve);
  const report: EisFitReport = {
    curveId: curve.id, curveName: curve.name, source: curve.source, imaginary: curve.imaginary === "negative" ? "negative" : "raw",
    originalCount: curve.points.length, indices, observed: points, weighting, fit, demo: !!curve.demo, selection,
  };
  validateEisFitReport(report, curve);
  return report;
}

/** Refuse a stale report even when invoked separately from the UI lifecycle guard. */
export function validateEisFitReport(report: EisFitReport, curve: Curve): void {
  const fail = () => { throw new Error("拟合报告与当前样品或数据不一致，请重新拟合。"); };
  const { fit } = report, model = EIS_CIRCUIT_MODELS.find(item => item.value === fit.kind);
  if (!model || !fit.converged || !["unit", "modulus"].includes(report.weighting) || report.curveId !== curve.id || report.curveName !== curve.name || report.source !== curve.source || report.imaginary !== (curve.imaginary === "negative" ? "negative" : "raw") || !curve.visible || report.originalCount !== curve.points.length) fail();
  const actual = collectEisFitPoints(curve);
  if (fit.n !== actual.points.length || fit.n !== report.indices.length || fit.n !== report.observed.length || fit.n !== fit.predicted.length || fit.n !== fit.residuals.length || !Number.isInteger(fit.n) || fit.n < 5 || !Number.isFinite(fit.chiSquared)) fail();
  if (report.selection?.mode === "auto") {
    const selection = report.selection, budget = selection.searchBudget;
    const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
    if (!budget || !count(selection.attempted) || !count(selection.total) || !count(selection.failed) || selection.attempted < 1 || selection.attempted > selection.total || selection.failed > selection.attempted || selection.candidates.length > selection.attempted) fail();
    if (budget) {
      for (const value of Object.values(budget)) if (!count(value)) fail();
      if (budget.screeningStarts < 1 || budget.screeningIterations < 1 || budget.refinementStarts < 1 || budget.refinementIterations < 1 || budget.refinedModels !== selection.candidates.filter(candidate => candidate.refined).length) fail();
      const ranks = new Set<number>(), kinds = new Set<EisCircuitKind>();
      for (const candidate of selection.candidates) {
        if (!count(candidate.rank) || candidate.rank < 1 || ranks.has(candidate.rank) || kinds.has(candidate.kind) || !EIS_CIRCUIT_MODELS.some(item => item.value === candidate.kind)) fail();
        ranks.add(candidate.rank); kinds.add(candidate.kind);
        if (!count(candidate.starts) || candidate.starts < 1 || !count(candidate.successfulStarts) || candidate.successfulStarts > candidate.starts || !count(candidate.searchIterations) || typeof candidate.refined !== "boolean" || typeof candidate.converged !== "boolean") fail();
        if (candidate.starts !== budget.screeningStarts + (candidate.refined ? budget.refinementStarts : 0)) fail();
        const maximumIterations = budget.screeningStarts * budget.screeningIterations + (candidate.refined ? budget.refinementStarts * budget.refinementIterations : 0);
        if (candidate.searchIterations > maximumIterations) fail();
      }
    }
    const selected = selection.candidates.find(candidate => candidate.rank === selection.selectedRank);
    if (!selected || selected.kind !== fit.kind || !selected.converged || selected.searchIterations < fit.iterations) fail();
  }
  for (const parameter of circuitParameters(fit.kind)) {
    if (!Number.isFinite(fit.params[parameter.key]) || typeof fit.standardErrors[parameter.key] !== "number") fail();
  }
  for (let index = 0; index < fit.n; index++) {
    const observed = report.observed[index], point = actual.points[index], predicted = fit.predicted[index], residual = fit.residuals[index];
    if (report.indices[index] !== actual.indices[index] || observed.frequency !== point.frequency || observed.zReal !== point.zReal || observed.minusZImag !== point.minusZImag) fail();
    for (const key of ["zReal", "minusZImag"] as const) {
      if (!Number.isFinite(predicted[key]) || !Number.isFinite(residual[key])) fail();
      const expected = predicted[key] - observed[key];
      if (Math.abs(residual[key] - expected) > 1e-10 * Math.max(1, Math.abs(expected), Math.abs(predicted[key]), Math.abs(observed[key]))) fail();
    }
  }
}

function csvCell(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** A separate analysis report: original raw-data and Origin exports remain unchanged. */
export function buildEisFitReportCsv(report: EisFitReport, curve: Curve): string {
  validateEisFitReport(report, curve);
  const { fit } = report, model = EIS_CIRCUIT_MODELS.find(item => item.value === fit.kind)!, residual = eisResidualSummary(fit);
  const rows: (string | number)[][] = [
    ["Friday · EIS 等效电路拟合报告"],
    ["样品", report.curveName], ["源文件", report.source], ["样品ID", report.curveId],
    ["数据性质", report.demo ? "模拟数据，仅用于体验操作" : "导入数据"],
    ["电路", model.label], ["电路代码", fit.kind], ["方程", model.equation],
    ["加权方式", report.weighting === "modulus" ? "按 |Z| 加权" : "不加权"],
    ["虚部约定", report.imaginary === "negative" ? "导入列为 −Z″，保持符号" : "导入列为 Z″，取负得到 −Z″"],
    ["残差定义", "拟合值 − 观测值；逐点残差与 RMS 为未加权 Ω 值"],
    ["收敛", fit.converged ? "是" : "否"], ["迭代次数", fit.iterations],
    ["原始点数", report.originalCount], ["参与拟合点数", fit.n], ["跳过无效/缺少频率点数", report.originalCount - fit.n], ["自由度", fit.dof],
    ["χ²（所选加权残差平方和）", fit.chiSquared],
    ...(Number.isFinite(fit.totalResistance) ? [[eisResistanceLabel(fit.kind), fit.totalResistance, "Ω"]] : []),
    ["残差复数模 RMS", residual.rms, "Ω"], ["残差复数模最大值", residual.max, "Ω"],
    ["标准误差说明", "± 为局部协方差估计的标准误差；估计缺失时留空。"],
    ["模型说明", "模型选择综合拟合误差、参数数量与数值稳定性；参数解释请结合实验条件。"],
    ["警告", fit.warnings.join("；")],
  ];
  const selection = report.selection;
  if (selection) {
    rows.push(["选择方式", selection.mode === "auto" ? "自动选择最佳电路" : "手动指定电路"],
      ["模型评估数", selection.attempted], ["模型总数", selection.total], ["拟合失败数", selection.failed]);
    if (selection.mode === "auto") {
      const budget = selection.searchBudget!;
      rows.push(["粗筛初值次数_每模型", budget.screeningStarts], ["粗筛每次最大迭代", budget.screeningIterations],
        ["精修初值次数_每模型", budget.refinementStarts], ["精修每次最大迭代", budget.refinementIterations],
        ["完成精修模型数", budget.refinedModels]);
      rows.push(["当前候选排名", selection.selectedRank ?? ""],
        ["排序依据", "相同数据和加权下比较 AICc；与最小 AICc 相差不超过 2 的候选优先参数较少、估计较稳定的电路。"], [],
        ["候选误差定义", report.weighting === "modulus" ? "加权实虚部残差分量 RMS，量纲为1；界面以百分数显示。" : "实虚部残差分量 RMS，单位 Ω。"], [],
        ["候选排名", "电路代码", "电路", "AICc", "ΔAICc", "排序分数", "收敛", "参数稳定", report.weighting === "modulus" ? "加权残差分量RMS_1" : "残差分量RMS_Ω", "参数数目", "初值尝试次数", "初值收敛次数", "累计搜索迭代次数", "已精修", "警告"]);
      for (const candidate of selection.candidates) rows.push([candidate.rank, candidate.kind, candidate.expression || candidate.label, candidate.aicc, candidate.deltaAicc, candidate.score, candidate.converged ? "是" : "待收敛", candidate.stable ? "是" : "待检查", candidate.rms, candidate.parameterCount, candidate.starts, candidate.successfulStarts, candidate.searchIterations, candidate.refined ? "是" : "否", candidate.warnings.join("；")]);
    }
  }
  rows.push([], ["参数代码", "参数名称", "估计值", "标准误差", "单位"]);
  for (const parameter of circuitParameters(fit.kind)) rows.push([parameter.key, parameter.label, fit.params[parameter.key], fit.standardErrors[parameter.key], parameter.unit]);
  rows.push([], ["原始点序（从1开始）", "频率_Hz", "观测Z′_Ω", "观测−Z″_Ω", "拟合Z′_Ω", "拟合−Z″_Ω", "残差Z′_Ω（拟合−观测）", "残差−Z″_Ω（拟合−观测）"]);
  report.observed.forEach((point, index) => rows.push([report.indices[index] + 1, point.frequency, point.zReal, point.minusZImag, fit.predicted[index].zReal, fit.predicted[index].minusZImag, fit.residuals[index].zReal, fit.residuals[index].minusZImag]));
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
