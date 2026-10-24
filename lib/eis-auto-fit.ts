import { circuitParameters, fitEisCircuit, initialGuess, type EisCircuitKind, type EisFitPoint, type EisFitResult } from "./eis-circuit";
import { ZSIMP_MODELS, zsimpSpec } from "./eis-zsimp-models";

export type EisFitCandidate = {
  kind: EisCircuitKind; label: string; expression: string; fit: EisFitResult;
  parameterCount: number; aicc: number; deltaAicc: number; score: number;
  /** RMS of the weighted real/imaginary residual components. */
  rms: number; stable: boolean; warnings: string[]; rank: number;
  starts: number; successfulStarts: number; searchIterations: number; refined: boolean;
};
export type EisFitFailure = { kind: EisCircuitKind; expression: string; reason: string; starts: number };
export type EisAutoFitProgress = { completed: number; total: number; currentModel: string; phase: "screening" | "refining" };
export type EisAutoFitResult = {
  best: EisFitResult | null; candidates: EisFitCandidate[]; failures: EisFitFailure[];
  attempted: number; total: number; failed: number; elapsedMs: number; cancelled: boolean;
  weighting: "unit" | "modulus"; pointCount: number; recommendationReason?: string;
  searchBudget?: { screeningStarts: number; screeningIterations: number; refinementStarts: number; refinementIterations: number; refinedModels: number };
};
export type EisAutoFitOptions = {
  weighting?: "unit" | "modulus"; signal?: AbortSignal;
  onProgress?: (progress: EisAutoFitProgress) => void;
  maxIterations?: number; starts?: number;
};
export type EisFitWorkerRequest =
  | { type: "fit"; requestId: string; points: EisFitPoint[]; options: { kind: "auto" | EisCircuitKind; weighting?: "unit" | "modulus"; maxIterations?: number; starts?: number; initial?: Record<string, number> } }
  | { type: "cancel"; requestId: string };
export type EisFitWorkerResponse =
  | ({ type: "progress"; requestId: string } & EisAutoFitProgress)
  | { type: "result"; requestId: string; result: EisAutoFitResult }
  | { type: "error"; requestId: string; message: string };

// The same observations and weights are used for every candidate. AICc counts
// both impedance components as observations; k is the circuit parameter count.
export function eisAicc(chiSquared: number, observations: number, parameterCount: number): number {
  const k = parameterCount;
  if (observations <= k + 1 || !Number.isFinite(chiSquared) || chiSquared < 0) return Infinity;
  const rss = Math.max(chiSquared, observations * 1e-16);
  return observations * Math.log(rss / observations) + 2 * k + 2 * k * (k + 1) / (observations - k - 1);
}

function validateData(points: readonly EisFitPoint[], weighting: "unit" | "modulus") {
  if (points.length < 5) throw new Error("EIS 拟合至少需要 5 个数据点");
  points.forEach((point, index) => {
    if (!Number.isFinite(point.frequency) || point.frequency <= 0) throw new Error(`第 ${index + 1} 个数据点的频率需为有限正数`);
    if (!Number.isFinite(point.zReal) || !Number.isFinite(point.minusZImag)) throw new Error(`第 ${index + 1} 个数据点的阻抗需为有限数值`);
    if (weighting === "modulus" && !(Math.hypot(point.zReal, point.minusZImag) > 0)) throw new Error(`第 ${index + 1} 个数据点的阻抗模值需大于 0`);
  });
  if (new Set(points.map(point => point.frequency)).size < 5) throw new Error("自动选优至少需要 5 个不同频率的数据点");
}

function startValues(kind: EisCircuitKind, points: readonly EisFitPoint[], count: number): Record<string, number>[] {
  const guess = initialGuess(kind, points);
  const spec = zsimpSpec(kind);
  const starts = [{ ...guess }];
  // Deterministic shifts of the time constants and exponent avoid a single
  // random lucky run deciding a model's rank. Each candidate receives the same
  // search budget; promising candidates receive additional refinement.
  for (let start = 1; start < count; start++) {
    const values = { ...guess };
    spec.parameters.forEach((parameter, index) => {
      const transform = spec.transforms[index];
      if (transform === "n") values[parameter.key] = [0.72, 0.95, 0.55, 0.88][(start - 1) % 4];
      else if (transform === "identity") values[parameter.key] = guess[parameter.key] + (start % 2 ? 0.25 : -0.25);
      else {
        const shift = Math.sin((index + 1) * 2.399963 + start * 1.618034) * (start < 3 ? 1.6 : 3);
        values[parameter.key] = guess[parameter.key] * Math.exp(shift);
      }
    });
    starts.push(values);
  }
  return starts;
}

function evaluate(kind: EisCircuitKind, points: readonly EisFitPoint[], weighting: "unit" | "modulus", initial: Record<string, number>, iterations: number, fastJacobian = false): EisFitResult | null {
  try {
    const fit = fitEisCircuit(points, { kind, weighting, initial, maxIterations: iterations, fastJacobian });
    return Number.isFinite(fit.chiSquared) && Object.values(fit.params).every(Number.isFinite) ? fit : null;
  } catch { return null; }
}

function makeCandidate(kind: EisCircuitKind, label: string, expression: string, fit: EisFitResult, starts: number, successfulStarts: number, searchIterations: number, refined = false): EisFitCandidate {
  const p = circuitParameters(kind).length;
  const warnings = [...fit.warnings];
  let stable = true;
  for (const [key, value] of Object.entries(fit.params)) {
    const error = fit.standardErrors[key];
    if (!Number.isFinite(error) || error > Math.max(Math.abs(value), 1e-30)) stable = false;
  }
  if (!stable) warnings.push("部分参数约束较弱；请结合参数标准误差与测量频率范围检查。");
  const aicc = eisAicc(fit.chiSquared, 2 * fit.n, p);
  return { kind, label, expression, fit, parameterCount: p, aicc, deltaAicc: 0, score: aicc,
    rms: Math.sqrt(fit.chiSquared / (2 * fit.n)), stable, warnings, rank: 0, starts, successfulStarts, searchIterations, refined };
}


function compareCandidates(a: EisFitCandidate, b: EisFitCandidate): number {
  // Converged candidates form the recommendation set. Among those, AICc is
  // primary: it balances residual reduction and parameter count. Stability is
  // used only for effectively tied scores rather than overriding fit quality.
  if (a.fit.converged !== b.fit.converged) return a.fit.converged ? -1 : 1;
  const delta = a.aicc - b.aicc;
  if (Math.abs(delta) < 1e-7 && a.stable !== b.stable) return a.stable ? -1 : 1;
  return delta || a.parameterCount - b.parameterCount || a.expression.localeCompare(b.expression);
}

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Fit every one of the 112 imported ZSimpWin models, then refine the most
 * competitive models on all original data. This runs in a worker in the UI;
 * the async yields also permit progress and AbortSignal cancellation in callers.
 */
export async function rankEisCircuits(points: readonly EisFitPoint[], options: EisAutoFitOptions = {}): Promise<EisAutoFitResult> {
  const started = performance.now();
  const weighting = options.weighting ?? "modulus";
  if (weighting !== "modulus" && weighting !== "unit") throw new Error("加权方式需为 modulus 或 unit");
  validateData(points, weighting);
  if (options.maxIterations !== undefined && (!Number.isFinite(options.maxIterations) || options.maxIterations < 1)) throw new Error("最大迭代次数需为正有限数值");
  const iterations = Math.min(300, Math.floor(options.maxIterations ?? 240));
  const screeningIterations = Math.min(iterations, 85);
  if (options.starts !== undefined && (!Number.isFinite(options.starts) || options.starts < 1)) throw new Error("初值次数需为正有限数值");
  const starts = Math.max(2, Math.min(8, Math.floor(options.starts ?? 3)));
  const candidates: EisFitCandidate[] = [];
  const failures: EisFitFailure[] = [];
  const convergedFits = new Map<EisCircuitKind, EisFitResult>();
  let attempted = 0;
  // Defensive copies ensure row order and the imported raw values are preserved.
  const data = points.map(point => ({ ...point }));
  for (const model of ZSIMP_MODELS) {
    if (options.signal?.aborted) break;
    const kind = model.value as EisCircuitKind;
    attempted++;
    const p = circuitParameters(kind).length;
    if (2 * data.length <= p + 2) {
      failures.push({ kind, expression: model.expression, starts: 0, reason: `参数数目 ${p}，AICc 所需的残差自由度不足（${data.length} 个复数点）。` });
    } else {
      let best: EisFitResult | null = null, successful = 0, searchIterations = 0;
      for (const initial of startValues(kind, data, 2)) {
        if (options.signal?.aborted) break;
        const fit = evaluate(kind, data, weighting, initial, screeningIterations, true);
        if (fit) {
          searchIterations += fit.iterations;
          if (fit.converged) {
            successful++;
            const previous = convergedFits.get(kind);
            if (!previous || fit.chiSquared < previous.chiSquared) convergedFits.set(kind, fit);
          }
          if (!best || fit.chiSquared < best.chiSquared) best = fit;
        }
      }
      if (best) candidates.push(makeCandidate(kind, model.label, model.expression, best, 2, successful, searchIterations));
      else failures.push({ kind, expression: model.expression, starts: 2, reason: "两个初值均产生非有限残差或参数，拟合失败。" });
    }
    options.onProgress?.({ completed: attempted, total: ZSIMP_MODELS.length, currentModel: model.expression, phase: "screening" });
    await pause();
  }
  // Rank screening results by residual/complexity even when still iterating:
  // this keeps a complex circuit with a useful partial fit in the refinement set.
  const competitive = [...candidates].sort((a, b) => a.aicc - b.aicc);
  const refine = competitive.filter((candidate, index) => index < 16 || candidate.aicc <= competitive[0].aicc + 20).slice(0, 28);
  for (let index = 0; index < refine.length && !options.signal?.aborted; index++) {
    const candidate = refine[index];
    let best = candidate.fit;
    let successful = candidate.successfulStarts;
    let searchIterations = candidate.searchIterations;
    const seeds = [best.params, ...startValues(candidate.kind, data, starts).slice(1)];
    for (const initial of seeds) {
      if (options.signal?.aborted) break;
      const fit = evaluate(candidate.kind, data, weighting, initial, iterations);
      if (fit) searchIterations += fit.iterations;
      if (fit?.converged) {
        successful++;
        const previous = convergedFits.get(candidate.kind);
        if (!previous || fit.chiSquared < previous.chiSquared) convergedFits.set(candidate.kind, fit);
      }
      if (fit && (fit.chiSquared < best.chiSquared || (fit.converged && !best.converged && fit.chiSquared <= best.chiSquared * (1 + 1e-8)))) best = fit;
      await pause();
    }
    Object.assign(candidate, makeCandidate(candidate.kind, candidate.label, candidate.expression, best, 2 + seeds.length, successful, searchIterations, true));
    options.onProgress?.({ completed: attempted, total: ZSIMP_MODELS.length, currentModel: candidate.expression, phase: "refining" });
  }
  // A slightly smaller non-converged SSE must never replace a successful
  // solution from another initial value. Keep the lowest converged solution
  // separately while using exploratory partial fits to decide refinement.
  for (const candidate of candidates) {
    const convergedFit = convergedFits.get(candidate.kind);
    if (convergedFit) Object.assign(candidate, makeCandidate(candidate.kind, candidate.label, candidate.expression, convergedFit,
      candidate.starts, candidate.successfulStarts, candidate.searchIterations, candidate.refined));
  }
  const converged = candidates.filter(candidate => candidate.fit.converged && Number.isFinite(candidate.aicc));
  const minimumAicc = converged.length ? Math.min(...converged.map(candidate => candidate.aicc)) : Infinity;
  // ΔAICc ≤ 2 expresses comparable support. Within that explicitly defined
  // group recommend the smaller circuit, then better constrained parameters;
  // retain the raw AICc and delta for inspection/export.
  candidates.sort((a, b) => {
    const aComparable = a.fit.converged && a.aicc <= minimumAicc + 2;
    const bComparable = b.fit.converged && b.aicc <= minimumAicc + 2;
    if (aComparable !== bComparable) return aComparable ? -1 : 1;
    if (aComparable && bComparable) {
      if (a.parameterCount !== b.parameterCount) return a.parameterCount - b.parameterCount;
      if (a.stable !== b.stable) return a.stable ? -1 : 1;
    }
    return compareCandidates(a, b);
  });
  const recommended = candidates.find(candidate => candidate.fit.converged && Number.isFinite(candidate.aicc));
  candidates.forEach((candidate, index) => {
    candidate.rank = index + 1;
    candidate.deltaAicc = candidate.fit.converged ? candidate.aicc - minimumAicc : Infinity;
    if (!candidate.fit.converged) failures.push({ kind: candidate.kind, expression: candidate.expression, starts: candidate.starts, reason: candidate.fit.warnings.find(warning => warning.includes("未收敛")) ?? "所有初值均未满足收敛判据。" });
  });
  return { best: recommended?.fit ?? null, candidates, failures, attempted, total: ZSIMP_MODELS.length,
    failed: failures.length, elapsedMs: performance.now() - started, cancelled: options.signal?.aborted ?? false, weighting, pointCount: data.length,
    recommendationReason: recommended ? `全部候选使用相同数据与 ${weighting} 权重；ΔAICc≤2 的收敛候选优先参数较少，再比较参数稳定性。推荐 ${recommended.expression}（${recommended.parameterCount} 个参数，ΔAICc=${(recommended.aicc-minimumAicc).toFixed(3)}）。` : "当前搜索预算内暂无满足收敛判据的推荐电路。",
    searchBudget: { screeningStarts: 2, screeningIterations, refinementStarts: starts, refinementIterations: iterations, refinedModels: refine.filter(candidate => candidate.refined).length } };
}
