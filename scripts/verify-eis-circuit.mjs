import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const modules = {};
for (const name of ['eis-zsimp-models', 'eis-circuit']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    if (!modules[dependency]) throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {circuitParameters, initialGuess, predictCircuit, fitEisCircuit} = await import(modules['eis-circuit']);

// 40 log-spaced points, 1e5 Hz -> 0.1 Hz, used by every synthetic dataset below.
const FREQUENCIES = Array.from({length: 40}, (_, index) => 10 ** (5 - 6 * index / 39));

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Independent complex reference so the fitter is not validated against itself.
function referenceImpedance(kind, p, frequency) {
  const omega = 2 * Math.PI * frequency;
  const cpe = (q, n) => {
    const magnitude = 1 / (q * omega ** n), phase = n * Math.PI / 2;
    return [magnitude * Math.cos(phase), -magnitude * Math.sin(phase)];
  };
  const parallel = (a, b) => {
    const sumRe = a[0] + b[0], sumIm = a[1] + b[1];
    const denominator = sumRe * sumRe + sumIm * sumIm;
    const productRe = a[0] * b[0] - a[1] * b[1];
    const productIm = a[0] * b[1] + a[1] * b[0];
    return [(productRe * sumRe + productIm * sumIm) / denominator,
      (productIm * sumRe - productRe * sumIm) / denominator];
  };
  let zRe, zIm;
  if (kind === 'r-cpe') {
    const branch = parallel([p.Rct, 0], cpe(p.Q, p.n));
    zRe = p.Rs + branch[0]; zIm = branch[1];
  } else if (kind === 'r-cpe-w') {
    const warburg = p.sigma / Math.sqrt(2 * omega);
    const branch = parallel(cpe(p.Q, p.n), [p.Rct + warburg, -warburg]);
    zRe = p.Rs + branch[0]; zIm = branch[1];
  } else {
    const first = parallel([p.R1, 0], cpe(p.Q1, p.n1));
    const second = parallel([p.R2, 0], cpe(p.Q2, p.n2));
    zRe = p.Rs + first[0] + second[0]; zIm = first[1] + second[1];
  }
  return {zReal: zRe, minusZImag: -zIm};
}

function synthesize(kind, truth, seed) {
  const random = lcg(seed);
  return FREQUENCIES.map(frequency => {
    const exact = referenceImpedance(kind, truth, frequency);
    return {
      frequency,
      zReal: exact.zReal * (1 + 0.003 * (2 * random() - 1)),
      minusZImag: exact.minusZImag * (1 + 0.003 * (2 * random() - 1)),
    };
  });
}

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE);
}

function near(actual, expected, tolerance, label, absolute = false) {
  const error = absolute ? Math.abs(actual - expected) : relativeError(actual, expected);
  assert.ok(error <= tolerance, `${label}: expected ${expected}, received ${actual} (error ${error})`);
}

function assertFiniteFit(result, label) {
  assert.equal(result.converged, true, `${label} did not converge: ${result.warnings.join('; ')}`);
  assert.equal(result.n, 40, `${label} point count`);
  assert.ok(Number.isFinite(result.chiSquared) && result.chiSquared < 1e-2, `${label} chi² too large: ${result.chiSquared}`);
  for (const key of Object.keys(result.params)) {
    assert.ok(Number.isFinite(result.params[key]), `${label} parameter ${key} is not finite`);
  }
  for (const key of Object.keys(result.standardErrors)) {
    assert.ok(Number.isFinite(result.standardErrors[key]) && result.standardErrors[key] > 0,
      `${label} standard error ${key} is not a positive finite number`);
  }
  assert.equal(result.predicted.length, 40);
  assert.equal(result.residuals.length, 40);
}

const TRUTHS = {
  'r-cpe': {Rs: 10, Rct: 200, Q: 2e-4, n: 0.85},
  'r-cpe-w': {Rs: 5, Rct: 150, Q: 1e-4, n: 0.9, sigma: 30},
  // tau = R*Q: 4.2e-4 s and 7.8e-2 s (ratio ~186, well separated).
  'rq-rq': {Rs: 8, R1: 140, Q1: 3e-6, n1: 0.92, R2: 260, Q2: 3e-4, n2: 0.82},
};

// Parameters and analytic predictions.
assert.deepEqual(circuitParameters('r-cpe').map(parameter => parameter.key), ['Rs', 'Rct', 'Q', 'n']);
assert.deepEqual(circuitParameters('r-cpe-w').map(parameter => parameter.key), ['Rs', 'Rct', 'Q', 'n', 'sigma']);
assert.deepEqual(circuitParameters('rq-rq').map(parameter => parameter.key), ['Rs', 'R1', 'Q1', 'n1', 'R2', 'Q2', 'n2']);
assert.equal(circuitParameters('r-cpe-w').find(parameter => parameter.key === 'sigma').unit, 'Ω·s^-0.5');
assert.equal(circuitParameters('r-cpe')[2].unit, 'S·s^n');
const mutableParameters = circuitParameters('r-cpe');
mutableParameters[0].key = 'destroyed';
assert.equal(circuitParameters('r-cpe')[0].key, 'Rs', 'circuitParameters must return a defensive copy');

for (const [kind, truth] of Object.entries(TRUTHS)) {
  for (const frequency of [1e5, 4321.5, 17.3, 0.1]) {
    const actual = predictCircuit(kind, truth, frequency);
    const expected = referenceImpedance(kind, truth, frequency);
    near(actual.zReal, expected.zReal, 1e-12, `${kind} Z' at ${frequency} Hz`);
    near(actual.minusZImag, expected.minusZImag, 1e-12, `${kind} -Z'' at ${frequency} Hz`);
  }
}

// Hand-derived limits check the impedance conventions independently of the
// loop above: at omega=1 an ideal CPE (n=1) is a capacitor, and a very small Q
// makes the r-cpe-w parallel branch collapse to Rct + Zw.
const ideal = predictCircuit('r-cpe', {Rs: 10, Rct: 200, Q: 2e-4, n: 1}, 1 / (2 * Math.PI));
const idealProduct = 200 * 2e-4;
near(ideal.zReal, 10 + 200 / (1 + idealProduct ** 2), 1e-12, 'ideal CPE real part');
near(ideal.minusZImag, 200 * idealProduct / (1 + idealProduct ** 2), 1e-12, 'ideal CPE minus imaginary');
const warburgLimit = predictCircuit('r-cpe-w', {Rs: 5, Rct: 150, Q: 1e-30, n: 0.9, sigma: 30}, 1);
const warburgReal = 30 / Math.sqrt(2 * 2 * Math.PI);
near(warburgLimit.zReal, 155 + warburgReal, 1e-12, 'Warburg real part');
near(warburgLimit.minusZImag, warburgReal, 1e-12, 'Warburg minus imaginary');

// r-cpe recovery.
const rcpeData = synthesize('r-cpe', TRUTHS['r-cpe'], 20261018);
const rcpeSnapshot = structuredClone(rcpeData);
const rcpeGuess = initialGuess('r-cpe', rcpeData);
assert.deepEqual(Object.keys(rcpeGuess), ['Rs', 'Rct', 'Q', 'n']);
near(rcpeGuess.Rs, 10, 0.2, 'r-cpe initial Rs');
near(rcpeGuess.Rct, 200, 0.2, 'r-cpe initial Rct');
assert.ok(rcpeGuess.Q > 2e-4 / 5 && rcpeGuess.Q < 2e-4 * 5, `r-cpe initial Q out of range: ${rcpeGuess.Q}`);
assert.equal(rcpeGuess.n, 0.85);
const rcpe = fitEisCircuit(rcpeData, {kind: 'r-cpe'});
assertFiniteFit(rcpe, 'r-cpe');
assert.equal(rcpe.dof, 80 - 4);
near(rcpe.params.Rs, 10, 0.03, 'r-cpe Rs');
near(rcpe.params.Rct, 200, 0.03, 'r-cpe Rct');
near(rcpe.params.Q, 2e-4, 0.10, 'r-cpe Q');
near(rcpe.params.n, 0.85, 0.03, 'r-cpe n', true);
near(rcpe.totalResistance, 210, 0.055, 'r-cpe total resistance');
assert.ok(rcpe.standardErrors.Rs > 0 && rcpe.standardErrors.Rs < 1, 'r-cpe Rs standard error out of range');
assert.ok(rcpe.standardErrors.Rct > 0 && rcpe.standardErrors.Rct < 5, 'r-cpe Rct standard error out of range');

// Weighted chi² must be reproducible from the exported residual vectors.
const rcpeChi = rcpe.residuals.reduce((sum, residual, index) => {
  const modulus = Math.hypot(rcpeData[index].zReal, rcpeData[index].minusZImag);
  return sum + (residual.zReal / modulus) ** 2 + (residual.minusZImag / modulus) ** 2;
}, 0);
near(rcpeChi, rcpe.chiSquared, 1e-12, 'r-cpe chi² reconstruction');

// Unit weighting is the documented alternative and still recovers the circuit.
const rcpeUnit = fitEisCircuit(rcpeData, {kind: 'r-cpe', weighting: 'unit'});
assert.equal(rcpeUnit.converged, true, `unit weighting did not converge: ${rcpeUnit.warnings.join('; ')}`);
near(rcpeUnit.params.Rs, 10, 0.03, 'unit-weighted Rs');
near(rcpeUnit.params.Rct, 200, 0.03, 'unit-weighted Rct');
assert.ok(rcpeUnit.chiSquared > rcpe.chiSquared, 'unit-weighted chi² should be in Ω² units');

// r-cpe-w recovery, including a Warburg coefficient that is only weakly constrained.
const warburgData = synthesize('r-cpe-w', TRUTHS['r-cpe-w'], 20261019);
const warburg = fitEisCircuit(warburgData, {kind: 'r-cpe-w'});
assertFiniteFit(warburg, 'r-cpe-w');
assert.equal(warburg.dof, 80 - 5);
near(warburg.params.Rs, 5, 0.05, 'r-cpe-w Rs');
near(warburg.params.Rct, 150, 0.05, 'r-cpe-w Rct');
near(warburg.params.sigma, 30, 0.20, 'r-cpe-w sigma');
near(warburg.params.n, 0.9, 0.05, 'r-cpe-w n', true);
near(warburg.totalResistance, 155, 0.06, 'r-cpe-w total resistance');

// rq-rq: two distinct time constants, separated by more than a decade.
const rqData = synthesize('rq-rq', TRUTHS['rq-rq'], 20261020);
const rqGuess = initialGuess('rq-rq', rqData);
const halfResistance = (TRUTHS['rq-rq'].R1 + TRUTHS['rq-rq'].R2) / 2;
near(rqGuess.R1, halfResistance, 0.05, 'rq-rq initial R1 half split');
near(rqGuess.R2, halfResistance, 0.05, 'rq-rq initial R2 half split');
const rq = fitEisCircuit(rqData, {kind: 'rq-rq'});
assertFiniteFit(rq, 'rq-rq');
assert.equal(rq.dof, 80 - 7);
near(rq.params.Rs, 8, 0.05, 'rq-rq Rs');
near(rq.params.R1, 140, 0.10, 'rq-rq R1');
near(rq.params.R2, 260, 0.10, 'rq-rq R2');
near(rq.params.Q1, 3e-6, 0.25, 'rq-rq Q1');
near(rq.params.Q2, 3e-4, 0.25, 'rq-rq Q2');
near(rq.params.n1, 0.92, 0.08, 'rq-rq n1', true);
near(rq.params.n2, 0.82, 0.08, 'rq-rq n2', true);
const tau1 = rq.params.R1 * rq.params.Q1, tau2 = rq.params.R2 * rq.params.Q2;
assert.ok(tau2 / tau1 > 10, `rq-rq time constants are not separated: tau1=${tau1}, tau2=${tau2}`);
near(tau2 / tau1, 185.7, 0.30, 'rq-rq tau ratio');
near(rq.totalResistance, 408, 0.04, 'rq-rq total resistance');

// Explicit initial values are honoured, and the caller's data is never mutated.
const seeded = fitEisCircuit(rcpeData, {kind: 'r-cpe', initial: TRUTHS['r-cpe'], maxIterations: 0});
assert.equal(seeded.converged, false);
assert.equal(seeded.iterations, 0);
assert.ok(seeded.warnings.length > 0);
for (const key of Object.keys(TRUTHS['r-cpe'])) {
  near(seeded.params[key], TRUTHS['r-cpe'][key], 1e-12, `seeded initial ${key}`);
}
assert.deepEqual(rcpeData, rcpeSnapshot, 'fitEisCircuit must not mutate the input points');

// Invalid input must fail loudly in Chinese instead of returning NaN silently.
assert.throws(() => fitEisCircuit(rcpeData.slice(0, 3), {kind: 'r-cpe'}), /至少需要 5 个数据点/);
const zeroFrequency = rcpeData.map((point, index) => index === 11 ? {...point, frequency: 0} : point);
assert.throws(() => fitEisCircuit(zeroFrequency, {kind: 'r-cpe'}), /频率需为有限正数/);
const infiniteFrequency = rcpeData.map((point, index) => index === 11 ? {...point, frequency: Infinity} : point);
assert.throws(() => fitEisCircuit(infiniteFrequency, {kind: 'r-cpe'}), /频率需为有限正数/);
const nanReal = rcpeData.map((point, index) => index === 7 ? {...point, zReal: NaN} : point);
assert.throws(() => fitEisCircuit(nanReal, {kind: 'r-cpe'}), /zReal 需为有限数值/);
const nanImaginary = rcpeData.map((point, index) => index === 7 ? {...point, minusZImag: Infinity} : point);
assert.throws(() => fitEisCircuit(nanImaginary, {kind: 'r-cpe'}), /minusZImag 需为有限数值/);
assert.throws(() => fitEisCircuit(rcpeData, {kind: 'r-cpe', maxIterations: -1}), /最大迭代次数/);
assert.throws(() => predictCircuit('r-cpe', TRUTHS['r-cpe'], 0), /频率需为有限正数/);
assert.throws(() => predictCircuit('r-cpe', {...TRUTHS['r-cpe'], Q: -1e-4}, 10), /Q 需大于 0/);
assert.throws(() => predictCircuit('r-cpe', {...TRUTHS['r-cpe'], n: 1.2}, 10), /n 需在/);
assert.throws(() => initialGuess('r-cpe', rcpeData.slice(0, 3)), /至少需要 5 个数据点/);

// Non-convergence is reported, never thrown and never hidden behind NaN parameters.
const forced = fitEisCircuit(rcpeData, {kind: 'r-cpe', maxIterations: 1});
assert.equal(forced.converged, false, 'one iteration must not claim convergence');
assert.ok(forced.warnings.some(warning => /未收敛/.test(warning)), 'non-convergence warning missing');
assert.equal(forced.iterations, 1);
assert.ok(Object.values(forced.params).every(Number.isFinite), 'non-converged parameters must stay finite');
assert.ok(Number.isFinite(forced.chiSquared), 'non-converged chi² must stay finite');

// Indistinguishable branches make J^T J singular: standard errors must be NaN
// with an explanatory warning rather than fabricated finite values.
const singular = fitEisCircuit(rqData, {
  kind: 'rq-rq',
  maxIterations: 0,
  initial: {Rs: 8, R1: 100, Q1: 2e-4, n1: 0.9, R2: 100, Q2: 2e-4, n2: 0.9},
});
assert.ok(Object.values(singular.standardErrors).every(Number.isNaN), 'singular fit must return NaN standard errors');
assert.ok(singular.warnings.some(warning => /奇异|不可辨识/.test(warning)), 'singular-fit warning missing');

// A numerically impossible initial value must fail through the result, not a throw.
const explodedData = rcpeData.map((point, index) => index === 0 ? {...point, frequency: 1e-300} : point);
const exploded = fitEisCircuit(explodedData, {
  kind: 'r-cpe-w',
  initial: {...TRUTHS['r-cpe-w'], sigma: 1e308},
});
assert.equal(exploded.converged, false);
assert.equal(exploded.chiSquared, Infinity);
assert.ok(exploded.warnings.some(warning => /未收敛/.test(warning)));
assert.ok(Object.values(exploded.standardErrors).every(Number.isNaN), 'failed fits must not fake standard errors');

const percent = (actual, expected) => `${(100 * relativeError(actual, expected)).toFixed(3)}%`;
const nError = (actual, expected) => Math.abs(actual - expected).toFixed(4);
console.log([
  'PASS EIS circuit fits (40 log-spaced points, deterministic 0.3% LCG noise):',
  `r-cpe Rs ${percent(rcpe.params.Rs, 10)} Rct ${percent(rcpe.params.Rct, 200)} Q ${percent(rcpe.params.Q, 2e-4)} Δn ${nError(rcpe.params.n, 0.85)} chi² ${rcpe.chiSquared.toExponential(2)} iter ${rcpe.iterations};`,
  `r-cpe-w Rs ${percent(warburg.params.Rs, 5)} Rct ${percent(warburg.params.Rct, 150)} sigma ${percent(warburg.params.sigma, 30)} chi² ${warburg.chiSquared.toExponential(2)} iter ${warburg.iterations};`,
  `rq-rq Rs ${percent(rq.params.Rs, 8)} R1 ${percent(rq.params.R1, 140)} R2 ${percent(rq.params.R2, 260)} Q1 ${percent(rq.params.Q1, 3e-6)} Q2 ${percent(rq.params.Q2, 3e-4)} tau2/tau1 ${(tau2 / tau1).toFixed(1)} chi² ${rq.chiSquared.toExponential(2)} iter ${rq.iterations};`,
  'invalid inputs rejected; forced maxIterations=1 -> converged:false with warnings.',
].join(' '));
