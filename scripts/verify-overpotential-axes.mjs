import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/overpotential-axes.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { resolveOverpotentialAxes, defaultOverpotentialAxisSettings } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const settings = patch => ({ ...defaultOverpotentialAxisSettings, ...patch });
const rows = values => values.map(etaMV => ({ reading: { etaMV } }));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected}, received ${actual}`);

// Ten imported sample positions stay 1..10, including samples without a reading.
const samples = rows([210, 225, 240, undefined, 270, 285, 300, 315, 330, 345]);
const original = structuredClone(samples);
const ten = resolveOverpotentialAxes(samples);
assert.deepEqual(ten.x.majorTicks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.deepEqual(ten.x.minorTicks, [.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]);
assert.equal(ten.x.min, .5);
assert.equal(ten.x.max, 10.5);
assert.equal(ten.y.min, 0);
assert.ok(ten.y.max > 345);
assert.ok(ten.y.majorTicks.includes(0));

// Signed values determine the default domain without absolute values or clipping.
const signed = resolveOverpotentialAxes(rows([-120, 0, 275]));
assert.ok(signed.y.min < -120);
assert.ok(signed.y.max > 275);
assert.ok(signed.y.majorTicks.some(value => value < 0));
assert.ok(signed.y.majorTicks.includes(0));
const negativeOnly = resolveOverpotentialAxes(rows([-20, -90]));
assert.ok(negativeOnly.y.min < -90);
assert.equal(negativeOnly.y.max, 0);

// Missing/invalid measurements cannot poison an otherwise empty default scale.
const empty = resolveOverpotentialAxes([]);
assert.deepEqual([empty.x.min, empty.x.max, empty.y.min, empty.y.max], [.5, 1.5, 0, 100]);
const missing = resolveOverpotentialAxes(rows([undefined, NaN, Infinity]));
assert.deepEqual([missing.y.min, missing.y.max], [0, 100]);
assert.equal(missing.x.max, 3.5);
assert.deepEqual(resolveOverpotentialAxes(rows([0])).y, empty.y);

// Viewport cropping and alternate label spacing leave every source row intact.
const crop = resolveOverpotentialAxes(samples, settings({ xMin: '2.5', xMax: '7.5', yMin: '-50', yMax: '250', xMajor: '2', yMajor: '50', xMinor: '2', yMinor: '4' }));
assert.deepEqual(crop.x.majorTicks, [3, 5, 7]);
assert.deepEqual(crop.y.majorTicks, [-50, 0, 50, 100, 150, 200, 250]);
assert.deepEqual([crop.x.min, crop.x.max, crop.y.min, crop.y.max], [2.5, 7.5, -50, 250]);
assert.equal(crop.x.minorTicks.length, 4);
assert.equal(crop.y.minorTicks.length, 24);
near(crop.x.minorTicks[0], 11 / 3);
assert.deepEqual(samples, original);
const noMinor = resolveOverpotentialAxes(samples, settings({ xMinor: '0', yMinor: '0' }));
assert.deepEqual(noMinor.x.minorTicks, []);
assert.deepEqual(noMinor.y.minorTicks, []);
const decimal = resolveOverpotentialAxes(rows([.003]), settings({ yMin: '-.005', yMax: '.005', yMajor: '.002', yMinor: '1' }));
assert.deepEqual(decimal.y.majorTicks, [-.004, -.002, 0, .002, .004]);
const hugeStep = resolveOverpotentialAxes(samples, settings({ yMin: '1', yMax: '2', yMajor: '10' }));
assert.deepEqual(hugeStep.y.majorTicks, []);
const decimalBoundary = resolveOverpotentialAxes([], settings({ yMin: '0.1', yMax: '0.3', yMajor: '.1', yMinor: '0' }));
assert.deepEqual(decimalBoundary.y.majorTicks, [.1, .2, .3]);
const nearZeroCrop = resolveOverpotentialAxes([], settings({ yMin: '0.0000000001', yMax: '2', yMajor: '1', yMinor: '0' }));
assert.deepEqual(nearZeroCrop.y.majorTicks, [1, 2]);

for (const patch of [
  { xMin: 'NaN' }, { yMax: 'Infinity' }, { yMin: 'hello' }, { yMajor: '0x10' },
  { xMin: '5', xMax: '5' }, { yMin: '10', yMax: '1' },
  { xMajor: '0' }, { xMajor: '1.5' }, { xMajor: '-1' }, { yMajor: '-2' }, { yMajor: '0' },
  { xMinor: '-1' }, { yMinor: '11' }, { yMinor: '1.1' }, { yMinor: '1000000000' },
  { xMin: '0', xMax: '1e10' }, { yMin: '0', yMax: '100', yMajor: '1e-20' },
  { yMin: '0', yMax: '100', yMajor: '1e-300', yMinor: '10' },
  { yMin: '-1e308', yMax: '1e308', yMajor: '1' },
]) assert.throws(() => resolveOverpotentialAxes(samples, settings(patch)), Error, JSON.stringify(patch));

// Values near the tick limit run a bounded loop; too many minor subdivisions fail.
const bounded = resolveOverpotentialAxes([], settings({ xMin: '.5', xMax: '499.5', xMinor: '1' }));
assert.equal(bounded.x.majorTicks.length + bounded.x.minorTicks.length, 999);
assert.throws(() => resolveOverpotentialAxes([], settings({ xMin: '.5', xMax: '500.5', xMinor: '1' })), /超过 1000/);
assert.throws(() => resolveOverpotentialAxes([], settings({ yMin: '10000000000000000', yMax: '10000000000000100', yMajor: '.1' })), /刻度/);

console.log('PASS: ten categories, signed/zero/missing readings, independent viewport ranges, category major spacing, minor subdivisions, malformed settings, finite numeric bounds and bounded tick generation.');
