import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = {};
for (const name of ['eis-zsimp-models', 'eis-circuit', 'eis-auto-fit']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    if (!modules[dependency]) throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { ZSIMP_MODELS, zsimpSpec } = await import(modules['eis-zsimp-models']);
const { circuitParameters, initialGuess, predictCircuit } = await import(modules['eis-circuit']);
const { rankEisCircuits, eisAicc } = await import(modules['eis-auto-fit']);
const frequencies = Array.from({ length: 61 }, (_, i) => 10 ** (5 - 7 * i / 60));
function random(seed) { let state = seed >>> 0; return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296); }
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const inv = a => { const d = a[0] ** 2 + a[1] ** 2; return [a[0] / d, -a[1] / d]; };
const parallel = (a, b) => inv(add(inv(a), inv(b)));
const cpe = (q, n, w) => [Math.cos(n * Math.PI / 2) / (q * w ** n), -Math.sin(n * Math.PI / 2) / (q * w ** n)];
const rc = (r, c, w) => [r / (1 + (r * c * w) ** 2), -r * r * c * w / (1 + (r * c * w) ** 2)];
const tests = [
  { expression: 'R(CR)', exact: w => add([10, 0], rc(200, 1e-4, w)), seed: 20261022 },
  { expression: 'R(QR)', exact: w => add([10, 0], parallel([200, 0], cpe(2e-4, .83, w))), seed: 20261023 },
  { expression: 'R(QR)(QR)', exact: w => add([8, 0], add(parallel([140, 0], cpe(3e-6, .92, w)), parallel([260, 0], cpe(3e-4, .82, w)))), seed: 20261024 },
  { expression: 'LR(QR)', exact: w => add([2, 2e-5 * w], parallel([80, 0], cpe(8e-5, .88, w))), seed: 20261025 },
  { expression: 'R(Q(RW))', exact: w => add([5, 0], parallel(cpe(1e-4, .9, w), [150 + 30 / Math.sqrt(2 * w), -30 / Math.sqrt(2 * w)])), seed: 20261026 },
];
function synthesize(test) {
  const rng = random(test.seed);
  return frequencies.map(frequency => {
    const [re, im] = test.exact(2 * Math.PI * frequency), amplitude = Math.hypot(re, im) * .001;
    return { frequency, zReal: re + amplitude * (rng() - .5), minusZImag: -im + amplitude * (rng() - .5) };
  });
}
assert.equal(ZSIMP_MODELS.length, 112);
assert.equal(new Set(ZSIMP_MODELS.map(model => model.value)).size, 112);
assert.ok(eisAicc(.1, 122, 3) < eisAicc(.1, 122, 8), 'equal residuals favour fewer parameters');
assert.equal(eisAicc(.1, 8, 7), Infinity, 'insufficient observations are recorded');
assert.equal(eisAicc(0, 122, 3), eisAicc(1e-30, 122, 3), 'uniform numerical residual floor');

// All models must produce finite predictions at initial parameters over the
// same wide frequency range before they enter the auto-fit library.
const reference = synthesize(tests[1]);
let computable = 0;
for (const model of ZSIMP_MODELS) {
  const guess = initialGuess(model.value, reference), parameters = circuitParameters(model.value);
  assert.equal(parameters.length, model.parameterCount, model.expression);
  assert.equal(zsimpSpec(model.value).transforms.length, parameters.length);
  try {
    for (const f of [.01, 1, 100, 1e5]) {
      const z = predictCircuit(model.value, guess, f);
      assert.ok(Number.isFinite(z.zReal) && Number.isFinite(z.minusZImag), `${model.expression} at ${f}`);
    }
    computable++;
  } catch(error) {
    if (!(process.argv.includes('--allow-pending') && /核验/.test(String(error)))) throw error;
  }
}
console.log(`PASS ${computable} circuit models: parser, parameters, finite impedance across 0.01–100000 Hz`);

const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
for (const test of tests.filter(test => !selected || selected === test.expression)) {
  const points = synthesize(test), snapshot = structuredClone(points);
  let completed = 0;
  const result = await rankEisCircuits(points, { onProgress: progress => { completed = Math.max(completed, progress.completed); } });
  assert.equal(result.attempted, 112);
  assert.equal(completed, 112);
  assert.equal(result.cancelled, false);
  assert.equal(result.pointCount, points.length);
  assert.equal(result.weighting, 'modulus');
  assert.ok(result.best?.converged, `${test.expression}: no converged recommendation`);
  assert.ok(result.candidates.length > 40);
  assert.deepEqual(points, snapshot, 'raw points and their order are preserved');
  assert.ok(result.candidates[0].starts >= 4, 'recommended candidates are refined with multiple starts');
  const actual = result.candidates.find(candidate => candidate.expression === test.expression);
  assert.ok(actual, `true model ${test.expression} missing`);
  assert.ok(actual.fit.converged, `true model ${test.expression} convergence: ${actual.fit.warnings.join('; ')}`);
  assert.ok(actual.rms < .001, `true model ${test.expression} residual ${actual.rms}`);
  // Equivalent topologies can tie: require strong residual recovery and an
  // appropriately small AICc difference rather than a unique physical identity.
  assert.ok(actual.deltaAicc < 12, `${test.expression}: true circuit delta AICc ${actual.deltaAicc}`);
  const best = result.candidates[0];
  assert.ok(best.rms < .001, `${test.expression}: recommended residual ${best.rms}`);
  for (const candidate of result.candidates) {
    assert.equal(candidate.fit.predicted.length, points.length);
    assert.equal(candidate.parameterCount, circuitParameters(candidate.kind).length);
    const reconstructed = candidate.fit.residuals.reduce((sum, residual, i) => sum + (residual.zReal ** 2 + residual.minusZImag ** 2) / (points[i].zReal ** 2 + points[i].minusZImag ** 2), 0);
    assert.ok(Math.abs(reconstructed - candidate.fit.chiSquared) < Math.max(1e-12, reconstructed * 1e-10));
    assert.equal(candidate.aicc, eisAicc(candidate.fit.chiSquared, 2 * points.length, candidate.parameterCount));
    assert.ok(candidate.fit.converged ? candidate.deltaAicc >= 0 : candidate.deltaAicc === Infinity);
    assert.ok(candidate.searchIterations >= candidate.fit.iterations);
  }
  console.log(JSON.stringify({ case: test.expression, best: best.expression, rms: best.rms, trueRank: actual.rank, trueDeltaAicc: actual.deltaAicc, candidates: result.candidates.length, failed: result.failed, seconds: +(result.elapsedMs / 1000).toFixed(2) }));
}

const controller = new AbortController();
const cancelled = await rankEisCircuits(reference, { signal: controller.signal, onProgress: progress => { if (progress.completed === 2) controller.abort(); } });
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.attempted, 2, 'cancellation stops the next model');
await assert.rejects(rankEisCircuits(reference.slice(0, 3)), /至少需要/);
await assert.rejects(rankEisCircuits(reference.map((point, index) => index ? point : { ...point, frequency: 0 })), /频率/);
const short = await rankEisCircuits(reference.slice(0, 5), { maxIterations: 1 });
assert.ok(short.failures.some(failure => failure.reason.includes('自由度不足')));
assert.ok(short.failures.some(failure => failure.reason.includes('未收敛')));
assert.ok(short.candidates.filter(candidate => !candidate.fit.converged).every(candidate => candidate.deltaAicc === Infinity));
console.log('PASS cancellation, validation, and traceable insufficient-data / convergence failures');

const realArg = process.argv.find(arg => arg.startsWith('--real='));
if (realArg) {
  const filename = realArg.slice(7), raw = await readFile(filename, 'utf8');
  const rows = raw.split(/\r?\n/).map(line => line.trim().split(',').map(Number)).filter(row => row.length >= 3 && row.slice(0, 3).every(Number.isFinite) && row[0] > 0);
  const points = rows.map(row => ({ frequency: row[0], zReal: row[1], minusZImag: -row[2] }));
  const snapshot = structuredClone(points), result = await rankEisCircuits(points);
  assert.ok(result.best?.converged, 'real CHI data has a converged recommendation');
  assert.equal(result.attempted, 112);
  assert.deepEqual(points, snapshot);
  assert.ok(points.some(point => point.minusZImag < 0), 'signed inductive response is preserved');
  console.log(JSON.stringify({ real: filename, points: points.length, best: result.candidates[0].expression, rms: result.candidates[0].rms, candidates: result.candidates.length, failed: result.failed, seconds: +(result.elapsedMs / 1000).toFixed(2), top: result.candidates.slice(0, 5).map(c => ({ model: c.expression, aicc: c.aicc, rms: c.rms, stable: c.stable, starts: c.starts })) }));
}
