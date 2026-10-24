import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/tafel-analysis.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {indicesInRectangle, withTafelMasks, fitTafelLine} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const options = {scan: 'up', basis: 'current'};
function curve(xy, patch = {}) {
  return {id: 'a', name: 'synthetic A', color: '#2374d5', visible: true, unit: 'A', resistance: '', area: '', compensation: 'raw', source: 'synthetic', invalid: 0,
    points: xy.map(([x, y]) => ({e: x, current: y})),
    plotted: xy.map(([x, y], index) => ({x, y, index, e: x, current: y})), ...patch};
}
function near(actual, expected, relative = 1e-12, absolute = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= Math.max(absolute, Math.abs(expected) * relative), `Expected ${expected}; received ${actual}`);
}
const range = {min: -10, max: 10};
const exact = fitTafelLine(curve([[-2, -.04], [-1, .02], [0, .08], [1, .14], [2, .20]]), range, options);
near(exact.intercept, .08); near(exact.slope, .06); near(exact.slopeMvPerDec, 60);
assert.equal(exact.n, 5); assert.deepEqual(exact.indices, [0, 1, 2, 3, 4]);
near(exact.rSquared, 1); near(exact.pearsonR, 1); near(exact.adjustedRSquared, 1); near(exact.slopeSE, 0);

// Manually derived fixture: Sxx=10, Sxy=20, Syy=40.14, SSE=.14.
// The error vector [.1,-.2,.2,-.2,.1] has zero sum and zero covariance with X.
const noisy = fitTafelLine(curve([[0, 1.1], [1, 2.8], [2, 5.2], [3, 6.8], [4, 9.1]]), range, options);
near(noisy.intercept, 1); near(noisy.slope, 2); near(noisy.sse, .14);
near(noisy.residualSD, Math.sqrt(.14 / 3)); near(noisy.slopeSE, Math.sqrt(.14 / 30));
near(noisy.interceptSE, Math.sqrt(.14 / 3 * .6));
near(noisy.rSquared, 40 / 40.14); near(noisy.pearsonR, Math.sqrt(40 / 40.14));
near(noisy.adjustedRSquared, 1 - (.14 / 40.14) * 4 / 3);
assert.equal(noisy.scan, 'up'); assert.equal(noisy.basis, 'current');

// NIST StRD Norris calibration data, with certified parameter/uncertainty values.
// Source: https://www.itl.nist.gov/div898/strd/lls/data/LINKS/DATA/Norris.dat
// Source columns are Y then X. The model includes an intercept and no weights.
const norrisYX = [
  [.1,.2],[338.8,337.4],[118.1,118.2],[888,884.6],[9.2,10.1],[228.1,226.5],
  [668.5,666.3],[998.5,996.3],[449.1,448.6],[778.9,777],[559.2,558.2],[.3,.4],
  [.1,.6],[778.1,775.5],[668.8,666.9],[339.3,338],[448.9,447.5],[10.8,11.6],
  [557.7,556],[228.3,228.1],[998,995.8],[888.8,887.6],[119.6,120.2],[.3,.3],
  [.6,.3],[557.6,556.8],[339.3,339.1],[888,887.2],[998.5,999],[778.9,779],
  [10.2,11.1],[117.6,118.3],[228.9,229.2],[668.4,669.1],[449.2,448.9],[.2,.5],
];
const norris = fitTafelLine(curve(norrisYX.map(([y,x]) => [x,y])), {min: 0, max: 1000}, options);
assert.equal(norris.n, 36);
near(norris.intercept, -.262323073774029); near(norris.slope, 1.00211681802045);
near(norris.interceptSE, .232818234301152); near(norris.slopeSE, .000429796848199937);
near(norris.residualSD, .884796396144373); near(norris.sse, 26.6173985294224);
near(norris.rSquared, .999993745883712);

const original = curve([[-2,-2], [-1,-1], [0,0], [1,1], [2,2]]);
original.plotted.splice(2, 0, null);
const before = structuredClone(original);
const rectangle = {x0: 1, x1: -1, y0: 1, y1: -1};
assert.deepEqual(indicesInRectangle(original, rectangle), [1, 2, 3]);
assert.deepEqual(indicesInRectangle(original, {x0: 0, x1: 0, y0: 0, y1: 0}), [2]);
assert.throws(() => indicesInRectangle(original, {...rectangle, y1: Infinity}), /有限数值/);
const second = curve([[0,0],[1,1],[2,2]], {id: 'b', visible: false});
const masked = withTafelMasks([original, second], {a: [1, 3]});
assert.deepEqual(masked[0].plotted.map(p => p?.index ?? null), [0, null, null, 2, null, 4]);
assert.deepEqual(masked[1], second); assert.equal(masked[1].visible, false);
assert.strictEqual(masked[0].points, original.points); assert.strictEqual(masked[1].points, second.points);
assert.deepEqual(original, before); assert.equal(masked[0].invalid, original.invalid);
const maskedFit = fitTafelLine(masked[0], {min: 2, max: -2}, options);
assert.deepEqual(maskedFit.indices, [0, 2, 4]); assert.deepEqual(maskedFit.range, {min: -2, max: 2});
assert.deepEqual(fitTafelLine(original, range, {...options, maskedIndices: [1, 3]}).indices, [0, 2, 4]);

// Raw index, rather than filtered array position, controls masks and duplicate scans.
const sparse = curve([[0, 0], [1, 2], [2, 4]]);
sparse.plotted.forEach((p, i) => {p.index = [4, 9, 14][i];});
sparse.plotted.push(null, sparse.plotted[1]);
assert.deepEqual(indicesInRectangle(sparse, {x0: 0, x1: 2, y0: 0, y1: 4}), [4, 9, 14]);
assert.deepEqual(fitTafelLine(sparse, range, options).indices, [4, 9, 14]);
assert.deepEqual(withTafelMasks([sparse], {a: [9]})[0].plotted.map(p => p?.index ?? null), [4, null, 14, null, null]);

const negative = fitTafelLine(curve([[-1,.3],[0,.2],[1,.1]]), range, {...options, scan: 'down', basis: 'density'});
near(negative.slopeMvPerDec, -100); near(negative.pearsonR, -1);
assert.equal(negative.scan, 'down'); assert.equal(negative.basis, 'density');
const constant = fitTafelLine(curve([[0, 5],[1, 5],[2, 5],[3, 5]]), range, options);
assert.equal(constant.slope, 0); assert.equal(constant.sse, 0);
assert.equal(constant.interceptSE, 0); assert.equal(constant.slopeSE, 0);
assert.equal(constant.pearsonR, null); assert.equal(constant.rSquared, null); assert.equal(constant.adjustedRSquared, null);

// Shifted coordinates retain exact slope, intercept and SSE at a large X offset.
const shifted = fitTafelLine(curve([0, 1, 2, 3, 4].map(dx => [1e12 + dx, 2 * (1e12 + dx) + 3])), {min: 1e12, max: 1e12 + 4}, options);
assert.equal(shifted.slope, 2); assert.equal(shifted.intercept, 3); assert.equal(shifted.sse, 0);
const shiftedNoisy = fitTafelLine(curve([[0, 1.1], [1, 2.8], [2, 5.2], [3, 6.8], [4, 9.1]].map(([x,y]) => [x + 1e12, y])), {min: 1e12, max: 1e12 + 4}, options);
near(shiftedNoisy.slope, noisy.slope); near(shiftedNoisy.sse, noisy.sse);

const nonfinite = curve([[0,0],[1,1],[2,2],[Infinity,3],[3,NaN]]);
assert.equal(fitTafelLine(nonfinite, range, options).n, 3);
assert.deepEqual(indicesInRectangle(nonfinite, {x0: -1, x1: 4, y0: -1, y1: 4}), [0,1,2]);
assert.throws(() => fitTafelLine(curve([[1,1],[1,2],[1,3]]), range, options), /X 值没有有效变化/);
assert.throws(() => fitTafelLine(curve([[0,0],[1,1]]), range, options), /至少需要 3/);
assert.throws(() => fitTafelLine(original, {min: 10,max: 20}, options), /至少需要 3/);
assert.throws(() => fitTafelLine(original, {min: 0,max: NaN}, options), /有限数值/);
assert.throws(() => fitTafelLine(curve([[-1e308,-1e308],[0,0],[1e308,1e308]]), {min: -1e308,max: 1e308}, options), /数值范围过大/);
assert.throws(() => fitTafelLine(curve([[0,0],[1,1e308],[2,1e308]]), range, options), /数值范围过大/);
console.log('PASS: Tafel OLS matches NIST Norris coefficients, standard errors, SSE, residual SD and R²; exact/noisy/negative/constant/large-offset fits, normalized inclusive bounds, masks by raw row, immutable source data, gaps, duplicate scan junctions and invalid/overflow rejection.');
