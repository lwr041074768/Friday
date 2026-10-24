import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/tafel-auto.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  autoTafelWindow, tQuantile, slopeConfidence, exchangeCurrentDensity,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function near(actual, expected, relative = 1e-12, absolute = 0, label = '') {
  assert.ok(Number.isFinite(actual), `${label} should be finite; received ${actual}`);
  const tolerance = Math.max(absolute, Math.abs(expected) * relative);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected} ± ${tolerance}; received ${actual}`);
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function straightLine(count = 201, amplitude = 0, seed = 42) {
  const random = lcg(seed);
  return Array.from({ length: count }, (_, k) => {
    const x = -2.5 + (2.5 * k) / (count - 1);
    return { x, y: 0.35 - 0.12 * x + (random() * 2 - 1) * amplitude, index: k };
  });
}

// ---------------------------------------------------------------------------
// Synthetic Tafel curve: a clean 120 mV/dec middle section with curved tails.
// ---------------------------------------------------------------------------
const random = lcg(20261018);
const synthetic = [];
for (let k = 0; k <= 350; k++) {
  const x = Math.round((-3 + k * 0.01) * 100) / 100;
  const line = 0.35 - 0.12 * x;
  let y = line;
  if (x < -2.5) y = line + 0.10 * Math.sqrt((-2.5 - x) / 0.5);
  else if (x > 0) y = 0.35 + 0.10 * Math.sqrt(x / 0.5);
  synthetic.push({ x, y: y + (random() * 2 - 1) * 0.0005, index: k });
}
const syntheticSnapshot = JSON.stringify(synthetic);
const syntheticResult = autoTafelWindow(synthetic);
assert.equal(syntheticResult.reason, undefined);
const best = syntheticResult.best;
assert.ok(best, 'synthetic curve should yield a window');
assert.ok(Math.abs(best.slope - (-0.12)) <= 0.12 * 0.05,
  `synthetic slope ${best.slope} should be within 5% of -0.12`);
assert.ok(best.rSquared > 0.99, `synthetic R² ${best.rSquared} should exceed 0.99`);
// The curved tails occupy x < -2.5 and x > 0; the selected window must stay
// inside the straight middle section.
assert.ok(best.min >= -2.5, `window starts inside the low-current tail: ${best.min}`);
assert.ok(best.max <= 0, `window ends inside the high-current tail: ${best.max}`);
assert.ok(best.indices.every(index => index >= 50 && index <= 300),
  'selected original rows must stay inside the straight middle section');
assert.equal(JSON.stringify(synthetic), syntheticSnapshot, 'autoTafelWindow must not mutate input');

assert.ok(syntheticResult.candidates.length > 0 && syntheticResult.candidates.length <= 5);
assert.equal(syntheticResult.candidates[0].score, best.score);
const candidateKeys = new Set();
for (let i = 0; i < syntheticResult.candidates.length; i++) {
  const fit = syntheticResult.candidates[i];
  if (i > 0) assert.ok(syntheticResult.candidates[i - 1].score >= fit.score, 'candidates must be score-descending');
  const expectedScore = fit.rSquared - 0.15 * (0.3 / (fit.max - fit.min)) - 0.002 / Math.sqrt(fit.n);
  near(fit.score, expectedScore, 1e-12, 0, 'candidate score formula');
  for (const value of [fit.intercept, fit.slope, fit.interceptSE, fit.slopeSE, fit.residualSD, fit.rSquared]) {
    assert.ok(Number.isFinite(value), 'candidate metrics must be finite');
  }
  assert.equal(fit.n, fit.indices.length);
  assert.equal(new Set(fit.indices).size, fit.indices.length, 'candidate indices must be unique');
  candidateKeys.add(fit.indices.join(','));
}
assert.equal(candidateKeys.size, syntheticResult.candidates.length, 'candidates must be deduplicated');

// ---------------------------------------------------------------------------
// t distribution critical values
// ---------------------------------------------------------------------------
assert.ok(Math.abs(tQuantile(0.95, 1) - 12.706) < 5e-4);
assert.ok(Math.abs(tQuantile(0.95, 10) - 2.228) < 5e-4);
assert.ok(Math.abs(tQuantile(0.95, 30) - 2.042) < 5e-4);
assert.ok(Math.abs(tQuantile(0.95, 1000) - 1.962) < 5e-4);
near(tQuantile(0.95, 2), 4.302652729911275, 1e-10, 0, 't(0.95,2)');
near(tQuantile(0.99, 10), 3.169272672616952, 1e-10, 0, 't(0.99,10)');
near(tQuantile(0.9, 10), 1.8124611228107335, 1e-10, 0, 't(0.9,10)');
near(tQuantile(0.999, 1), 636.6192487687414, 1e-9, 0, 't(0.999,1)');
assert.ok(tQuantile(0.8, 10) < tQuantile(0.9, 10));
assert.ok(tQuantile(0.9, 10) < tQuantile(0.95, 10));
assert.ok(tQuantile(0.95, 10) < tQuantile(0.99, 10));
assert.ok(Number.isFinite(tQuantile(0.8, 1)) && Number.isFinite(tQuantile(0.999, 1000)));
assert.throws(() => tQuantile(0.5, 10), RangeError);
assert.throws(() => tQuantile(0.95, 0), RangeError);
assert.throws(() => tQuantile(Number.NaN, 10), RangeError);
assert.throws(() => tQuantile(0.95, Number.NaN), RangeError);

// ---------------------------------------------------------------------------
// Exchange current density from an exact line: j0 = 10^(0.35/0.12)
// ---------------------------------------------------------------------------
const exactLine = Array.from({ length: 51 }, (_, k) => {
  const x = -2.5 + k * 0.05;
  return { x, y: 0.35 - 0.12 * x, index: k };
});
const exactResult = autoTafelWindow(exactLine);
assert.ok(exactResult.best);
near(exactResult.best.slope, -0.12, 1e-12, 0, 'exact slope');
near(exactResult.best.intercept, 0.35, 1e-12, 0, 'exact intercept');
const expectedJ0 = 10 ** (0.35 / 0.12);
const exactJ0 = exchangeCurrentDensity(exactResult.best);
assert.ok(exactJ0);
near(exactJ0.log10, 35 / 12, 1e-12, 0, 'exact log10(j0)');
near(exactJ0.value, expectedJ0, 1e-9, 0, 'exact j0');
const directJ0 = exchangeCurrentDensity({ slope: -0.12, intercept: 0.35 });
assert.ok(directJ0);
near(directJ0.value, expectedJ0, 1e-9, 0, 'direct j0');
assert.equal(exchangeCurrentDensity({ slope: 0, intercept: 0.35 }), null);
assert.equal(exchangeCurrentDensity({ slope: Number.NaN, intercept: 0.35 }), null);
assert.equal(exchangeCurrentDensity({ slope: -0.12, intercept: Number.POSITIVE_INFINITY }), null);
assert.equal(exchangeCurrentDensity({ slope: Number.NEGATIVE_INFINITY, intercept: 0.35 }), null);

// ---------------------------------------------------------------------------
// Confidence intervals: contain the true slope, widen with noise and with level
// ---------------------------------------------------------------------------
const lowNoise = autoTafelWindow(straightLine(201, 0.0005, 11)).best;
const highNoise = autoTafelWindow(straightLine(201, 0.005, 11)).best;
assert.ok(lowNoise && highNoise);
const lowCI = slopeConfidence(lowNoise, 0.95);
const highCI = slopeConfidence(highNoise, 0.95);
assert.ok(lowCI.low < -0.12 && lowCI.high > -0.12, `low-noise CI must contain -0.12: ${JSON.stringify(lowCI)}`);
assert.ok(highCI.low < -0.12 && highCI.high > -0.12, `high-noise CI must contain -0.12: ${JSON.stringify(highCI)}`);
assert.ok(highCI.high - highCI.low > 5 * (lowCI.high - lowCI.low),
  '10x noise should widen the confidence interval substantially');
near((lowCI.high - lowCI.low) / (2 * lowNoise.slopeSE), tQuantile(0.95, lowNoise.n - 2),
  1e-12, 0, 'CI half-width / slopeSE');
const wideCI = slopeConfidence(lowNoise, 0.99);
assert.ok(wideCI.high - wideCI.low > lowCI.high - lowCI.low, '99% interval must be wider than 95%');
assert.deepEqual(slopeConfidence({ slope: -0.12, slopeSE: 0.01, n: 2 }), { low: NaN, high: NaN });
assert.deepEqual(slopeConfidence({ slope: -0.12, slopeSE: NaN, n: 10 }), { low: NaN, high: NaN });
assert.deepEqual(slopeConfidence({ slope: -0.12, slopeSE: 0.01, n: 10 }, 0.5), { low: NaN, high: NaN });

// ---------------------------------------------------------------------------
// Boundary cases
// ---------------------------------------------------------------------------
const fivePoints = Array.from({ length: 5 }, (_, k) => ({ x: -2 + k, y: 0.3 - 0.1 * k, index: k }));
const tooFew = autoTafelWindow(fivePoints);
assert.equal(tooFew.best, null);
assert.match(tooFew.reason, /有效点不足 6 个/);

const constant = Array.from({ length: 20 }, (_, k) => ({ x: -2 + (2 * k) / 19, y: 5, index: k }));
const constantResult = autoTafelWindow(constant);
assert.equal(constantResult.best, null);
assert.match(constantResult.reason, /R² 无定义/);

const sameX = Array.from({ length: 20 }, (_, k) => ({ x: 1, y: 0.1 * k, index: k }));
const sameXResult = autoTafelWindow(sameX);
assert.equal(sameXResult.best, null);
assert.match(sameXResult.reason, /X 值没有变化/);

const duplicatedX = Array.from({ length: 20 }, (_, k) => {
  const x = Math.floor(k / 2) * 0.2 - 1;
  return { x, y: 0.3 - 0.1 * x, index: k };
});
const duplicatedXResult = autoTafelWindow(duplicatedX);
assert.ok(duplicatedXResult.best);
near(duplicatedXResult.best.slope, -0.1, 1e-12, 0, 'repeated-x slope');

const withInvalid = [
  ...straightLine(20, 0, 7),
  { x: NaN, y: 1, index: 100 },
  { x: 1, y: NaN, index: 101 },
  { x: Infinity, y: 1, index: 102 },
  { x: 1, y: 1, index: -1 },
  { x: 1, y: 1, index: 2.5 },
];
const invalidResult = autoTafelWindow(withInvalid);
assert.ok(invalidResult.best);
assert.ok(invalidResult.best.indices.every(index => Number.isInteger(index) && index >= 0 && index < 20));
assert.ok(Number.isFinite(invalidResult.best.slope));

const duplicatedIndex = [
  ...straightLine(20, 0, 7),
  ...straightLine(20, 0, 7).map(point => ({ ...point, y: point.y + 1 })),
];
const duplicatedIndexResult = autoTafelWindow(duplicatedIndex);
assert.ok(duplicatedIndexResult.best);
assert.equal(new Set(duplicatedIndexResult.best.indices).size, duplicatedIndexResult.best.indices.length);
assert.equal(duplicatedIndexResult.best.n, 20);

const limitedByPoints = autoTafelWindow(straightLine(20, 0, 7), { minPoints: 30 });
assert.equal(limitedByPoints.best, null);
assert.match(limitedByPoints.reason, /有效点不足 30 个/);
const limitedBySpan = autoTafelWindow(straightLine(20, 0, 7), { minSpan: 10 });
assert.equal(limitedBySpan.best, null);
assert.match(limitedBySpan.reason, /跨度/);
const optionFit = autoTafelWindow(straightLine(20, 0, 7), { minPoints: 10, minSpan: 1, level: 0.99 }).best;
assert.ok(optionFit);
assert.ok(optionFit.n >= 10 && optionFit.max - optionFit.min >= 1 - 1e-12);

// Above 4000 points the scan must down-sample instead of exploding. Keep the
// whole call comfortably below two seconds.
const huge = Array.from({ length: 5000 }, (_, k) => {
  const x = -3 + (3.5 * k) / 4999;
  return { x, y: 0.35 - 0.12 * x, index: k };
});
const started = performance.now();
const hugeResult = autoTafelWindow(huge);
const elapsed = performance.now() - started;
assert.ok(elapsed < 2000, `5000-point scan took ${elapsed.toFixed(1)} ms (limit 2000 ms)`);
assert.ok(hugeResult.best);
assert.ok(hugeResult.best.indices.length <= 4000);
assert.ok(hugeResult.best.indices.every(index => Number.isInteger(index) && index >= 0 && index < 5000));
assert.ok(hugeResult.best.indices[0] === 0 && hugeResult.best.indices.at(-1) === 4999,
  'down-sampling must keep both endpoints');
assert.ok(hugeResult.best.rSquared > 0.99);

console.log(`PASS: tQuantile(0.95,1)=${tQuantile(0.95, 1).toFixed(4)}, tQuantile(0.95,10)=${tQuantile(0.95, 10).toFixed(4)}, tQuantile(0.95,1000)=${tQuantile(0.95, 1000).toFixed(4)}; synthetic slope=${best.slope.toFixed(6)} V/dec (${(best.slope * 1000).toFixed(2)} mV/dec), R²=${best.rSquared.toFixed(6)}, window=[${best.min}, ${best.max}], n=${best.n}; j0=${exactJ0.value.toPrecision(10)} (log10=${exactJ0.log10.toFixed(6)}); 95% CI=[${lowCI.low.toFixed(6)}, ${lowCI.high.toFixed(6)}] (width ${(lowCI.high - lowCI.low).toExponential(3)}), high-noise width ${(highCI.high - highCI.low).toExponential(3)}; insufficient/constant/duplicate-x/NaN/5000-point (${elapsed.toFixed(0)} ms) checks passed.`);
