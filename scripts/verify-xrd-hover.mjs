import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const source = await readFile(new URL('../lib/xrd-hover.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildXrdHoverIndex, readXrdHover } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = { id: 'synthetic', name: 'synthetic', visible: true, unit: 'A', resistance: '', area: '', compensation: 'unknown', source: 'mathematical test fixture', invalid: 0 };
function curve(data, patch = {}) {
  const plotted = data.map((entry, position) => entry === null ? null : {
    x: entry[0], y: entry[1], e: entry[2] ?? entry[0], current: entry[3] ?? entry[1], index: position,
  });
  return { ...base, color: '#2374d5', points: [], plotted, ...patch };
}
function query(curves, x, y, options = {}) {
  return readXrdHover(buildXrdHoverIndex(curves), { x, y, scaleX: 10, scaleY: 2, hitRadius: 12, ...options });
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-10, `Expected ${expected}, received ${actual}`); }

// y=2x+3 between real endpoints: x=1.25 gives y=5.5 immediately, rather than snapping to x=1.
const ascending = curve([[1, 5, 1, 100], [2, 7, 2, 200], [3, 9, 3, 300]]);
const interpolated = query([ascending], 1.25, 5.5);
near(interpolated.point.x, 1.25); near(interpolated.point.y, 5.5);
near(interpolated.point.e, 1.25); near(interpolated.point.current, 125);
assert.equal(interpolated.interpolated, true); assert.equal(interpolated.exactIndex, undefined);
assert.deepEqual(interpolated.endpointIndices, [0, 1]);
const exact = query([ascending], 2, 7);
assert.equal(exact.interpolated, false); assert.equal(exact.exactIndex, 1);
assert.strictEqual(exact.point, ascending.plotted[1]);
// Descending acquisition retains endpoint order and original indices.
const descending = curve([[3, 9], [2, 7], [1, 5]]);
const reverse = query([descending], 1.25, 5.5);
near(reverse.point.y, 5.5); assert.deepEqual(reverse.endpointIndices, [1, 2]);
assert.deepEqual(descending.plotted.map(point => point.x), [3, 2, 1]);

// Gaps and nonfinite points must not invent connecting segments.
assert.equal(query([curve([[0, 0], [1, 1], null, [3, 3], [4, 4]])], 2, 2), null);
assert.equal(query([curve([[0, 0], [1, NaN], [2, 2]])], 1, 1, { hitRadius: 1 }), null);
assert.equal(query([ascending], .9, 4.8), null); // No endpoint extrapolation.
assert.equal(query([ascending], 1.25, 20), null); // Outside CSS hit radius.
assert.equal(query([ascending], 1.25, 11.501), null);
const radiusEdge = query([ascending], 1.25, 11.5);
assert.ok(radiusEdge); near(radiusEdge.distancePx, 12);

// Repeated X gives a genuine vertical segment; its source values interpolate with Y.
const duplicate = curve([[1, 0, 1, 0], [1, 10, 1, 100], [2, 20, 2, 200]]);
const vertical = query([duplicate], 1, 4);
near(vertical.point.x, 1); near(vertical.point.y, 4); near(vertical.point.current, 40);
assert.deepEqual(vertical.endpointIndices, [0, 1]); assert.equal(vertical.interpolated, true);
assert.equal(query([duplicate], 1, 10).exactIndex, 1);
const repeatedFlat = curve([[1, 10], [1, 10], [1, 10]]);
assert.equal(query([repeatedFlat], 1, 10).interpolated, false);
const single = curve([[2, 4]]);
assert.equal(query([single], 2.3, 4).point.x, 2); // Singletons retain measured X.
assert.equal(query([single], 5, 4), null);

// Two different branches intersect the same X: choose the closest screen Y, never sort samples.
const nonmonotonic = curve([[0, 0], [2, 4], [0, 10], [2, 20]]);
const branch = query([nonmonotonic], 1, 7);
near(branch.point.y, 7); assert.deepEqual(branch.endpointIndices, [1, 2]);
assert.deepEqual(nonmonotonic.plotted.map(point => point.x), [0, 2, 0, 2]);
const hidden = curve([[0, 5.5], [3, 5.5]], { id: 'hidden', visible: false });
const invalid = curve([[0, 5.5], [3, 5.5]], { id: 'invalid', error: 'invalid' });
const second = curve([[1, 6], [2, 6]], { id: 'second' });
assert.equal(query([ascending, hidden, invalid, second], 1.25, 5.9).curve.id, 'second');
assert.equal(query([ascending], 1.25, 5.5, { bounds: { x0: 1, x1: 2, y0: 6, y1: 20 } }), null);
for (const options of [{ scaleX: 0 }, { scaleY: -1 }, { hitRadius: -1 }, { x: Infinity }])
  assert.equal(query([ascending], 1.25, 5.5, options), null);
const extreme = curve([[-1e308, -1e308], [1e308, 1e308]]);
near(query([extreme], 0, 0, { scaleX: 1e-308, scaleY: 1e-308 }).point.y, 0);
const fineAtLargeX = curve([[1e15, 0], [1e15 + .5, 4]]);
const fineRead = query([fineAtLargeX], 1e15 + .375, 3);
near(fineRead.point.y, 3); assert.equal(fineRead.interpolated, true);

// 500,000 original points: count actual point-array probes during queries, so a fast machine
// cannot hide a full N-point scan behind a timing assertion. Index construction is a one-time pass.
const large = curve(Array.from({ length: 500_000 }, (_, index) => [index, index * 2]));
let probes = 0;
large.plotted = new Proxy(large.plotted, { get(target, key, receiver) {
  if (typeof key === 'string' && /^\d+$/.test(key)) probes++;
  return Reflect.get(target, key, receiver);
} });
const largeIndex = buildXrdHoverIndex([large]);
assert.equal(largeIndex.runCount, 1);
probes = 0; const started = performance.now();
for (let index = 0; index < 1000; index++) {
  const x = 123456.25 + index * 17;
  const result = readXrdHover(largeIndex, { x, y: x * 2, scaleX: .01, scaleY: .005, hitRadius: 12 });
  near(result.point.x, x); near(result.point.y, x * 2);
}
const elapsed = performance.now() - started;
assert.ok(probes < 30_000, `${probes} point probes: expected logarithmic lookup, not an N-point scan.`);
// Repeated X is also indexed: a 50,000-point vertical run must binary-search Y.
let verticalProbes = 0;
const tall = curve(Array.from({ length: 50_000 }, (_, index) => [10, 50_000 - index]));
tall.plotted = new Proxy(tall.plotted, { get(target, key, receiver) {
  if (typeof key === 'string' && /^\d+$/.test(key)) verticalProbes++;
  return Reflect.get(target, key, receiver);
} });
const tallIndex = buildXrdHoverIndex([tall]);
assert.equal(tallIndex.runCount, 1); verticalProbes = 0;
const tallRead = readXrdHover(tallIndex, { x: 10, y: 12345.25, scaleX: 1, scaleY: 1, hitRadius: 12 });
near(tallRead.point.y, 12345.25); assert.equal(tallRead.interpolated, true);
assert.ok(verticalProbes < 30, `${verticalProbes} probes: repeated X must not trigger a linear scan.`);
console.log(`XRD hover passed: precise X interpolation, raw values, exact indices, descending/vertical/nonmonotonic runs, gaps, visibility, bounds, CSS radius. 500,000-point lookup: ${probes} probes over 1,000 queries (${elapsed.toFixed(1)} ms).`);
