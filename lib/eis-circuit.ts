// EIS equivalent-circuit complex non-linear least-squares fitting.
// Data carry minusZImag = -Z'' (capacitive positive); the model works with
// Z = Z' + jZ'' internally. Pure arithmetic only, so this module is safe to
// import from Node scripts, workers and the renderer alike.

import { zsimpSpec, zsimpInitialGuess, zsimpTotalResistance } from "./eis-zsimp-models";

export type EisCircuitKind = "r-cpe" | "r-cpe-w" | "rq-rq" | `zsimp:${string}`;
export type EisFitPoint = { frequency: number; zReal: number; minusZImag: number };
export type EisCircuitParameter = { key: string; label: string; unit: string };
export type EisFitOptions = {
  kind: EisCircuitKind;
  weighting?: "unit" | "modulus";
  initial?: Record<string, number>;
  maxIterations?: number;
  /** Forward differences for automatic library screening; final refinement uses central differences. */
  fastJacobian?: boolean;
};
export type EisFitResult = {
  kind: EisCircuitKind;
  params: Record<string, number>;
  standardErrors: Record<string, number>;
  predicted: { zReal: number; minusZImag: number }[];
  residuals: { zReal: number; minusZImag: number }[];
  chiSquared: number; iterations: number; converged: boolean;
  n: number; dof: number; totalResistance: number; warnings: string[];
};

type Complex = { re: number; im: number };
type Transform = "log" | "n" | "identity";

type CircuitSpec = {
  parameters: readonly EisCircuitParameter[];
  transforms: readonly Transform[];
  impedance: (params: Readonly<Record<string, number>>, omega: number) => Complex;
};

const MAX_ITERATIONS = 300;
const RELATIVE_TOLERANCE = 1e-10;
const MAX_DAMPING = 1e12;
const MIN_DAMPING = 1e-12;
// Weighted residuals below ~1e-10 cannot be improved meaningfully in double
// precision; noise-free synthetic data lands here once the model is recovered.
const NUMERICAL_CHI_FLOOR = 1e-20;

// Positive-valued parameters are fitted as exp(theta); n uses a logistic
// transform so 0 < n < 1 by construction.
function cpeImpedance(q: number, n: number, omega: number): Complex {
  const magnitude = 1 / (q * Math.pow(omega, n));
  const phase = n * Math.PI / 2;
  return { re: magnitude * Math.cos(phase), im: -magnitude * Math.sin(phase) };
}

// Z_W = sigma / sqrt(j*omega) = sigma/sqrt(2*omega) * (1 - j).
function warburgImpedance(sigma: number, omega: number): Complex {
  const magnitude = sigma / Math.sqrt(2 * omega);
  return { re: magnitude, im: -magnitude };
}

function parallel(a: Complex, b: Complex): Complex {
  const sumRe = a.re + b.re, sumIm = a.im + b.im;
  const denominator = sumRe * sumRe + sumIm * sumIm;
  const productRe = a.re * b.re - a.im * b.im;
  const productIm = a.re * b.im + a.im * b.re;
  return {
    re: (productRe * sumRe + productIm * sumIm) / denominator,
    im: (productIm * sumRe - productRe * sumIm) / denominator,
  };
}

const SPECS: Record<"r-cpe" | "r-cpe-w" | "rq-rq", CircuitSpec> = {
  "r-cpe": {
    parameters: [
      { key: "Rs", label: "溶液电阻 Rs", unit: "Ω" },
      { key: "Rct", label: "电荷转移电阻 Rct", unit: "Ω" },
      { key: "Q", label: "CPE 系数 Q", unit: "S·s^n" },
      { key: "n", label: "CPE 指数 n", unit: "" },
    ],
    transforms: ["log", "log", "log", "n"],
    impedance(params, omega) {
      const branch = parallel({ re: params.Rct, im: 0 }, cpeImpedance(params.Q, params.n, omega));
      return { re: params.Rs + branch.re, im: branch.im };
    },
  },
  "r-cpe-w": {
    parameters: [
      { key: "Rs", label: "溶液电阻 Rs", unit: "Ω" },
      { key: "Rct", label: "电荷转移电阻 Rct", unit: "Ω" },
      { key: "Q", label: "CPE 系数 Q", unit: "S·s^n" },
      { key: "n", label: "CPE 指数 n", unit: "" },
      { key: "sigma", label: "Warburg 系数 σ", unit: "Ω·s^-0.5" },
    ],
    transforms: ["log", "log", "log", "n", "log"],
    impedance(params, omega) {
      const warburg = warburgImpedance(params.sigma, omega);
      const series = { re: params.Rct + warburg.re, im: warburg.im };
      const branch = parallel(cpeImpedance(params.Q, params.n, omega), series);
      return { re: params.Rs + branch.re, im: branch.im };
    },
  },
  "rq-rq": {
    parameters: [
      { key: "Rs", label: "溶液电阻 Rs", unit: "Ω" },
      { key: "R1", label: "第一支路电阻 R1", unit: "Ω" },
      { key: "Q1", label: "第一支路 CPE 系数 Q1", unit: "S·s^n" },
      { key: "n1", label: "第一支路 CPE 指数 n1", unit: "" },
      { key: "R2", label: "第二支路电阻 R2", unit: "Ω" },
      { key: "Q2", label: "第二支路 CPE 系数 Q2", unit: "S·s^n" },
      { key: "n2", label: "第二支路 CPE 指数 n2", unit: "" },
    ],
    transforms: ["log", "log", "log", "n", "log", "log", "n"],
    impedance(params, omega) {
      const first = parallel({ re: params.R1, im: 0 }, cpeImpedance(params.Q1, params.n1, omega));
      const second = parallel({ re: params.R2, im: 0 }, cpeImpedance(params.Q2, params.n2, omega));
      return { re: params.Rs + first.re + second.re, im: first.im + second.im };
    },
  },
};

function specFor(kind: EisCircuitKind): CircuitSpec {
  if (kind.startsWith("zsimp:")) return zsimpSpec(kind);
  switch (kind) {
    case "r-cpe": return SPECS["r-cpe"];
    case "r-cpe-w": return SPECS["r-cpe-w"];
    case "rq-rq": return SPECS["rq-rq"];
    default: throw new Error(`不支持的等效电路类型：${String(kind)}`);
  }
}

function validatePoints(points: readonly EisFitPoint[], minimum: number): void {
  if (points.length < minimum) throw new Error(`EIS 拟合至少需要 ${minimum} 个数据点`);
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) throw new Error(`第 ${i + 1} 个数据点缺失`);
    if (!Number.isFinite(point.frequency) || point.frequency <= 0) {
      throw new Error(`第 ${i + 1} 个数据点的频率需为有限正数`);
    }
    if (!Number.isFinite(point.zReal)) throw new Error(`第 ${i + 1} 个数据点的 zReal 需为有限数值`);
    if (!Number.isFinite(point.minusZImag)) throw new Error(`第 ${i + 1} 个数据点的 minusZImag 需为有限数值`);
  }
}

function decodeParameters(spec: CircuitSpec, theta: readonly number[]): Record<string, number> | null {
  const params: Record<string, number> = {};
  for (let i = 0; i < theta.length; i++) {
    if (!Number.isFinite(theta[i])) return null;
    const key = spec.parameters[i].key;
    if (spec.transforms[i] === "log") {
      const value = Math.exp(theta[i]);
      if (!(value > 0) || !Number.isFinite(value)) return null;
      params[key] = value;
    } else if (spec.transforms[i] === "identity") {
      params[key] = theta[i];
    } else {
      const value = 0.5 + 0.5 * Math.tanh(theta[i]);
      if (!(value > 0 && value <= 1)) return null;
      params[key] = value;
    }
  }
  return params;
}

function encodeParameter(transform: Transform, value: number, key: string): number {
  if (!Number.isFinite(value)) throw new Error(`参数 ${key} 需为有限数值`);
  if (transform === "identity") return value;
  if (transform === "log") {
    if (!(value > 0)) throw new Error(`参数 ${key} 需大于 0`);
    return Math.log(value);
  }
  if (!(value > 0 && value <= 1)) throw new Error(`参数 ${key} 需在 (0, 1] 范围内`);
  // n = 1 is representable only as the transform's asymptote.
  const safe = Math.min(1 - 1e-12, Math.max(1e-12, value));
  return Math.atanh(2 * safe - 1);
}

function transformDerivative(transform: Transform, params: Readonly<Record<string, number>>, key: string): number {
  if (transform === "identity") return 1;
  if (transform === "log") return params[key];
  const n = params[key];
  return 2 * n * (1 - n);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function apexFrequency(points: readonly EisFitPoint[]): number {
  let best = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].minusZImag > best.minusZImag) best = points[i];
  }
  return best.frequency;
}

// At the -Z'' apex of an R||CPE branch, R*Q*(2*pi*f)^n = 1.  The starting n is
// fixed at 0.85, matching the midpoint of the admissible range.
function cpeGuessAtApex(frequency: number, resistance: number): number {
  const omega = 2 * Math.PI * frequency;
  return positiveOr(1 / (resistance * Math.pow(omega, 0.85)), 1e-6);
}

function totalResistanceAt(kind: EisCircuitKind, params: Readonly<Record<string, number>>): number {
  if (kind.startsWith("zsimp:")) return zsimpTotalResistance(kind, params);
  switch (kind) {
    // The Warburg branch diverges as omega -> 0, so only Rs + Rct is reported.
    case "r-cpe":
    case "r-cpe-w": return params.Rs + params.Rct;
    case "rq-rq": return params.Rs + params.R1 + params.R2;
    default: return Number.NaN;
  }
}

export function circuitParameters(kind: EisCircuitKind): EisCircuitParameter[] {
  return specFor(kind).parameters.map(parameter => ({ ...parameter }));
}

export function initialGuess(kind: EisCircuitKind, points: readonly EisFitPoint[]): Record<string, number> {
  validatePoints(points, 5);
  if (kind.startsWith("zsimp:")) return zsimpInitialGuess(kind, points);
  // Work from high to low frequency independently of the caller's row order.
  const ordered = [...points].sort((a, b) => b.frequency - a.frequency);
  const bandSize = Math.max(1, Math.ceil(ordered.length * 0.2));
  const highReal = median(ordered.slice(0, bandSize).map(point => point.zReal));
  const lowReal = median(ordered.slice(-bandSize).map(point => point.zReal));
  const rawSpan = lowReal - highReal;
  const span = rawSpan > 0 && Number.isFinite(rawSpan)
    ? rawSpan
    : Math.max(Math.abs(lowReal), Math.abs(highReal), 1);
  const rs = positiveOr(highReal, Math.max(span * 1e-3, 1e-9));
  const total = positiveOr(span, Math.max(Math.abs(lowReal) * 0.5, 1));

  switch (kind) {
    case "r-cpe": {
      return {
        Rs: rs,
        Rct: total,
        Q: cpeGuessAtApex(apexFrequency(ordered), total),
        n: 0.85,
      };
    }
    case "r-cpe-w": {
      return {
        Rs: rs,
        Rct: total,
        Q: cpeGuessAtApex(apexFrequency(ordered), total),
        n: 0.85,
        sigma: Math.max(total * 0.1, 1e-12),
      };
    }
    case "rq-rq": {
      // Two time constants: split the total resistance evenly and read one Q
      // from the apex of each half of the frequency range.
      const half = Math.max(total / 2, 1e-12);
      const split = Math.ceil(ordered.length / 2);
      const highBand = ordered.slice(0, split);
      const lowBand = ordered.slice(ordered.length - split);
      return {
        Rs: rs,
        R1: half,
        Q1: cpeGuessAtApex(apexFrequency(highBand), half),
        n1: 0.85,
        R2: half,
        Q2: cpeGuessAtApex(apexFrequency(lowBand), half),
        n2: 0.85,
      };
    }
    default:
      throw new Error(`不支持的等效电路类型：${String(kind)}`);
  }
}

export function predictCircuit(
  kind: EisCircuitKind,
  params: Readonly<Record<string, number>>,
  frequency: number,
): { zReal: number; minusZImag: number } {
  const spec = specFor(kind);
  if (!Number.isFinite(frequency) || frequency <= 0) throw new Error("频率需为有限正数");
  const values: Record<string, number> = {};
  for (let i = 0; i < spec.parameters.length; i++) {
    const key = spec.parameters[i].key;
    const value = params[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`参数 ${key} 需为有限数值`);
    if (spec.transforms[i] === "log") {
      if (!(value > 0)) throw new Error(`参数 ${key} 需大于 0`);
    } else if (spec.transforms[i] === "n" && !(value > 0 && value <= 1)) {
      throw new Error(`参数 ${key} 需在 (0, 1] 范围内`);
    }
    values[key] = value;
  }
  const impedance = spec.impedance(values, 2 * Math.PI * frequency);
  if (!Number.isFinite(impedance.re) || !Number.isFinite(impedance.im)) {
    throw new Error("给定参数下阻抗计算结果非有限");
  }
  return { zReal: impedance.re, minusZImag: -impedance.im };
}

function sumOfSquares(values: readonly number[]): number {
  let sum = 0, correction = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
    const square = value * value;
    const next = sum + square;
    correction += Math.abs(sum) >= Math.abs(square) ? (sum - next) + square : (square - next) + sum;
    sum = next;
  }
  return sum + correction;
}

type NormalEquations = { matrix: number[][]; gradient: number[] };

function normalEquations(jacobian: readonly (readonly number[])[], residuals: readonly number[]): NormalEquations {
  const rows = jacobian.length;
  const columns = rows ? jacobian[0].length : 0;
  const matrix: number[][] = Array.from({ length: columns }, () => new Array<number>(columns).fill(0));
  const gradient = new Array<number>(columns).fill(0);
  for (let row = 0; row < rows; row++) {
    const values = jacobian[row], residual = residuals[row];
    for (let i = 0; i < columns; i++) {
      const left = values[i];
      if (left === 0) continue;
      gradient[i] += left * residual;
      for (let j = i; j < columns; j++) matrix[i][j] += left * values[j];
    }
  }
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < i; j++) matrix[i][j] = matrix[j][i];
  }
  return { matrix, gradient };
}

function jacobianMatrix(
  theta: readonly number[],
  residualAt: (candidate: readonly number[]) => number[] | null,
  forward = false,
): number[][] | null {
  const base = residualAt(theta);
  if (!base) return null;
  const rows = base.length, columns = theta.length;
  const jacobian: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let column = 0; column < columns; column++) {
    const step = 1e-6 * Math.max(1, Math.abs(theta[column]));
    const plus = theta.slice();
    const minus = theta.slice();
    plus[column] += step;
    minus[column] -= step;
    const upper = residualAt(plus), lower = forward ? base : residualAt(minus);
    if (!upper || !lower) return null;
    for (let row = 0; row < rows; row++) {
      const derivative = (upper[row] - lower[row]) / ((forward ? 1 : 2) * step);
      if (!Number.isFinite(derivative)) return null;
      jacobian[row][column] = derivative;
    }
  }
  return jacobian;
}

// Damped normal equations are symmetric positive definite, so plain Gaussian
// elimination with partial pivoting is sufficient and stable here.
function solveLinearSystem(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const size = rhs.length;
  const augmented: number[][] = matrix.map((row, i) => [...row, rhs[i]]);
  for (let column = 0; column < size; column++) {
    let pivotRow = column;
    let pivot = Math.abs(augmented[column][column]);
    for (let row = column + 1; row < size; row++) {
      const candidate = Math.abs(augmented[row][column]);
      if (candidate > pivot) { pivot = candidate; pivotRow = row; }
    }
    if (!(pivot > 0) || !Number.isFinite(pivot)) return null;
    if (pivotRow !== column) {
      const temporary = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = temporary;
    }
    const diagonal = augmented[column][column];
    for (let row = column + 1; row < size; row++) {
      const factor = augmented[row][column] / diagonal;
      if (factor === 0) continue;
      for (let k = column; k <= size; k++) augmented[row][k] -= factor * augmented[column][k];
    }
  }
  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row--) {
    let value = augmented[row][size];
    for (let column = row + 1; column < size; column++) value -= augmented[row][column] * solution[column];
    const diagonal = augmented[row][row];
    if (!(Math.abs(diagonal) > 0) || !Number.isFinite(diagonal)) return null;
    solution[row] = value / diagonal;
    if (!Number.isFinite(solution[row])) return null;
  }
  return solution;
}

// Invert J^T J after scaling it to a correlation-like matrix, which makes the
// singularity test meaningful even when Q and sigma differ by many decades.
function invertNormalMatrix(matrix: readonly (readonly number[])[]): number[][] | null {
  const size = matrix.length;
  if (!size) return null;
  const diagonal = matrix.map((row, index) => row[index]);
  if (diagonal.some(value => !(value > 0) || !Number.isFinite(value))) return null;
  const scaling = diagonal.map(value => 1 / Math.sqrt(value));
  const augmented: number[][] = Array.from({ length: size }, (_, row) => [
    ...Array.from({ length: size }, (_, column) => matrix[row][column] * scaling[row] * scaling[column]),
    ...Array.from({ length: size }, (_, column) => row === column ? 1 : 0),
  ]);
  for (let column = 0; column < size; column++) {
    let pivotRow = column;
    let pivot = Math.abs(augmented[column][column]);
    for (let row = column + 1; row < size; row++) {
      const candidate = Math.abs(augmented[row][column]);
      if (candidate > pivot) { pivot = candidate; pivotRow = row; }
    }
    if (!(pivot > 1e-12) || !Number.isFinite(pivot)) return null;
    if (pivotRow !== column) {
      const temporary = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = temporary;
    }
    const diagonalValue = augmented[column][column];
    for (let k = 0; k < 2 * size; k++) augmented[column][k] /= diagonalValue;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let k = 0; k < 2 * size; k++) augmented[row][k] -= factor * augmented[column][k];
    }
  }
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => augmented[row][size + column] * scaling[row] * scaling[column]));
}

function standardErrorsFor(
  spec: CircuitSpec,
  theta: readonly number[],
  params: Readonly<Record<string, number>>,
  chiSquared: number,
  dof: number,
  warnings: string[],
  residualAt: (candidate: readonly number[]) => number[] | null,
): Record<string, number> {
  const errors: Record<string, number> = {};
  for (const parameter of spec.parameters) errors[parameter.key] = Number.NaN;
  if (!(dof > 0)) {
    warnings.push("残差自由度不足，无法估计标准误差，已返回 NaN。");
    return errors;
  }
  if (!Number.isFinite(chiSquared)) {
    warnings.push("chi² 非有限，无法估计标准误差，已返回 NaN。");
    return errors;
  }
  const residuals = residualAt(theta);
  if (!residuals) {
    warnings.push("最终参数无法计算残差，标准误差已返回 NaN。");
    return errors;
  }
  const jacobian = jacobianMatrix(theta, residualAt);
  if (!jacobian) {
    warnings.push("数值雅可比矩阵计算失败，标准误差已返回 NaN。");
    return errors;
  }
  const { matrix } = normalEquations(jacobian, residuals);
  const covariance = invertNormalMatrix(matrix);
  if (!covariance) {
    warnings.push("(JᵀJ) 奇异，参数不可辨识，标准误差已返回 NaN。");
    return errors;
  }
  const varianceScale = chiSquared / dof;
  if (!Number.isFinite(varianceScale) || varianceScale < 0) {
    warnings.push("残差方差非有限，标准误差已返回 NaN。");
    return errors;
  }
  let missing = false;
  for (let i = 0; i < spec.parameters.length; i++) {
    const key = spec.parameters[i].key;
    const variance = varianceScale * covariance[i][i];
    const derivative = transformDerivative(spec.transforms[i], params, key);
    if (!Number.isFinite(variance) || variance < 0 || !Number.isFinite(derivative)) {
      missing = true;
      continue;
    }
    const error = Math.sqrt(variance) * Math.abs(derivative);
    if (Number.isFinite(error)) errors[key] = error;
    else missing = true;
  }
  if (missing) warnings.push("部分参数的标准误差无法估计，已返回 NaN。");
  return errors;
}

export function fitEisCircuit(points: readonly EisFitPoint[], options: EisFitOptions): EisFitResult {
  const kind = options.kind;
  const spec = specFor(kind);
  validatePoints(points, 5);
  const weighting = options.weighting ?? "modulus";
  if (weighting !== "unit" && weighting !== "modulus") {
    throw new Error('加权方式需为 "unit" 或 "modulus"');
  }
  const requestedIterations = options.maxIterations ?? MAX_ITERATIONS;
  if (!Number.isFinite(requestedIterations) || requestedIterations < 0) {
    throw new Error("最大迭代次数需为非负有限数值");
  }
  const maxIterations = Math.min(MAX_ITERATIONS, Math.floor(requestedIterations));
  const n = points.length;
  const parameterCount = spec.parameters.length;
  const keys = spec.parameters.map(parameter => parameter.key);
  const dof = 2 * n - parameterCount;

  const guess = initialGuess(kind, points);
  if (options.initial) {
    for (const key of keys) {
      const value = options.initial[key];
      if (value === undefined) continue;
      guess[key] = value;
    }
  }
  const thetaStart = keys.map((key, index) => encodeParameter(spec.transforms[index], guess[key], key));

  const weights = points.map(point => {
    if (weighting === "unit") return 1;
    const modulus = Math.hypot(point.zReal, point.minusZImag);
    if (!(modulus > 0) || !Number.isFinite(modulus)) {
      throw new Error("modulus 加权要求每个数据点的阻抗模值大于 0");
    }
    return 1 / modulus;
  });
  // Scale threshold: a fit at numerical precision must count as converged even
  // when a trial step can no longer strictly lower chi². 1e-16 of the weighted
  // data energy corresponds to an RMS relative error around 1e-8.
  const dataScale = points.reduce((sum, point, index) => {
    const weight = weights[index];
    return sum + (weight * point.zReal) ** 2 + (weight * point.minusZImag) ** 2;
  }, 0);
  const numericalFloor = Math.max(NUMERICAL_CHI_FLOOR, dataScale * 1e-16);

  const predictPoint = (
    params: Readonly<Record<string, number>>,
    point: EisFitPoint,
  ): { zReal: number; minusZImag: number } => {
    const impedance = spec.impedance(params, 2 * Math.PI * point.frequency);
    return { zReal: impedance.re, minusZImag: -impedance.im };
  };

  const residualAt = (candidate: readonly number[]): number[] | null => {
    const params = decodeParameters(spec, candidate);
    if (!params) return null;
    const values = new Array<number>(2 * n);
    for (let i = 0; i < n; i++) {
      const point = points[i];
      const impedance = spec.impedance(params, 2 * Math.PI * point.frequency);
      if (!Number.isFinite(impedance.re) || !Number.isFinite(impedance.im)) return null;
      values[2 * i] = weights[i] * (impedance.re - point.zReal);
      values[2 * i + 1] = weights[i] * (-impedance.im - point.minusZImag);
    }
    return values;
  };

  const warnings: string[] = [];
  const predictedFor = (params: Readonly<Record<string, number>>) => points.map(point => predictPoint(params, point));
  const residualsFor = (
    predicted: readonly { zReal: number; minusZImag: number }[],
  ) => predicted.map((value, index) => ({
    zReal: value.zReal - points[index].zReal,
    minusZImag: value.minusZImag - points[index].minusZImag,
  }));

  let theta = thetaStart;
  let residuals = residualAt(theta);
  let chiSquared = residuals ? sumOfSquares(residuals) : Number.POSITIVE_INFINITY;
  let converged = residuals !== null && (chiSquared === 0 || chiSquared <= numericalFloor);
  let iterations = 0;
  let stopReason: "converged" | "iterations" | "stagnated" = converged ? "converged" : "iterations";

  if (!residuals || !Number.isFinite(chiSquared)) {
    const params = decodeParameters(spec, theta) ?? { ...guess };
    const predicted = predictedFor(params);
    const failedResiduals = residualsFor(predicted);
    const standardErrors: Record<string, number> = {};
    for (const key of keys) standardErrors[key] = Number.NaN;
    warnings.push("LM 未收敛：初始残差平方和非有限，迭代无法开始。");
    return {
      kind, params, standardErrors, predicted, residuals: failedResiduals,
      chiSquared: Number.POSITIVE_INFINITY, iterations: 0, converged: false,
      n, dof, totalResistance: totalResistanceAt(kind, params), warnings,
    };
  }

  let damping = 1e-3;
  while (!converged && iterations < maxIterations) {
    iterations++;
    const jacobian = jacobianMatrix(theta, residualAt, options.fastJacobian);
    if (!jacobian) {
      warnings.push("LM 未收敛：数值雅可比矩阵计算失败，拟合提前停止。");
      stopReason = "stagnated";
      break;
    }
    const { matrix, gradient } = normalEquations(jacobian, residuals);
    const diagonal = matrix.map((row, index) => row[index]);
    // Orthogonality of residual and all sensitivity columns is the standard
    // LM stationarity criterion. It also recognizes noisy optima where floating
    // point arithmetic prevents one more strictly decreasing trial step.
    const relativeGradient = Math.max(...gradient.map((value, index) => diagonal[index] > 0
      ? Math.abs(value) / Math.sqrt(diagonal[index] * Math.max(chiSquared, Number.MIN_VALUE)) : 0));
    if (kind.startsWith("zsimp:") && iterations > 1 && relativeGradient < 1e-7) {
      converged = true;
      stopReason = "converged";
      break;
    }
    const diagonalScale = Math.max(1e-30, ...diagonal);
    const damped = matrix.map((row, rowIndex) => row.map((value, columnIndex) =>
      rowIndex === columnIndex ? value + damping * Math.max(value, diagonalScale * 1e-12) : value));
    const step = solveLinearSystem(damped, gradient.map(value => -value));
    if (!step) {
      damping *= 10;
      if (damping > MAX_DAMPING) {
        warnings.push("LM 未收敛：阻尼达到上限且线性方程组无法求解，拟合提前停止。");
        stopReason = "stagnated";
        break;
      }
      continue;
    }
    // Keep exploratory ZSimpWin steps within two log units. Without this
    // trust-region cap a nearly inactive branch can jump by hundreds of
    // decades and destroy the next finite-difference Jacobian.
    const stepScale = kind.startsWith("zsimp:")
      ? Math.max(1, ...step.map((value, index) => spec.transforms[index] === "identity" ? 0 : Math.abs(value) / 2))
      : 1;
    const trialTheta = theta.map((value, index) => value + step[index] / stepScale);
    const trialResiduals = residualAt(trialTheta);
    const trialChiSquared = trialResiduals ? sumOfSquares(trialResiduals) : Number.POSITIVE_INFINITY;
    if (trialResiduals && Number.isFinite(trialChiSquared) && trialChiSquared < chiSquared) {
      const relativeChange = (chiSquared - trialChiSquared) / Math.max(chiSquared, Number.MIN_VALUE);
      theta = trialTheta;
      residuals = trialResiduals;
      chiSquared = trialChiSquared;
      if (relativeChange < RELATIVE_TOLERANCE || chiSquared <= numericalFloor) {
        converged = true;
        stopReason = "converged";
        break;
      }
      damping = Math.max(damping / 10, MIN_DAMPING);
    } else {
      if (chiSquared <= numericalFloor) {
        // No strictly better trial step remains, but the fit is already at
        // numerical precision. Treat it as converged rather than stagnated.
        converged = true;
        stopReason = "converged";
        break;
      }
      damping *= 10;
      if (damping > MAX_DAMPING) {
        warnings.push("LM 未收敛：阻尼达到上限仍未降低 chi²，拟合提前停止。");
        stopReason = "stagnated";
        break;
      }
    }
  }
  if (!converged && stopReason === "iterations") {
    warnings.push(`LM 未收敛：已达到最大迭代次数（${iterations}），未满足相对 chi² 变化 < 1e-10 的收敛判据。`);
  }
  if (maxIterations === 0) {
    warnings.push("最大迭代次数为 0，结果仅包含初始参数。");
  }

  const params = decodeParameters(spec, theta);
  const finalParams = params ?? { ...guess };
  if (!params) warnings.push("最终变换参数无法还原，已退回初始参数。");
  const predicted = predictedFor(finalParams);
  const finalResiduals = residualsFor(predicted);
  const standardErrors = standardErrorsFor(spec, theta, finalParams, chiSquared, dof, warnings, residualAt);

  return {
    kind, params: finalParams, standardErrors, predicted, residuals: finalResiduals,
    chiSquared, iterations, converged, n, dof,
    totalResistance: totalResistanceAt(kind, finalParams), warnings,
  };
}
