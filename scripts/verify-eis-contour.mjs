import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const compile = async file => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const { inferEisIdentity, prepareEisSpectra, buildEisContourGrid, buildEisContourCsv, gridCsv } = await compile('lib/eis-contour.ts');
const { plotEisCurves } = await compile('lib/eis-data.ts');
const checks = [];
const base = { color: '#2374d5', visible: true, unit: 'A', resistance: '', area: '', compensation: 'unknown', imaginary: 'raw', eisGroup: 'one', source: 'source.bin' };
function curve(potential, points, patch = {}) { return { ...base, id: `p-${potential}`, name: `EIS-${potential}`, eisPotential: String(potential), points, ...patch }; }
const point = (f, z, real = 3) => ({ frequency: f, current: z, e: real });
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

assert.deepEqual(inferEisIdentity('EIS-0.43', 'C:\\data\\sample-A\\EIS-0.43.bin'), { group: 'C:/data/sample-A', potential: '0.43' });
assert.deepEqual(inferEisIdentity('EIS-0.510.bin', ''), { group: '样品1', potential: '0.51' });
assert.deepEqual(inferEisIdentity('EIS-0,45V', ''), { group: '样品1', potential: '0.45' });
assert.equal(inferEisIdentity('EIS-005.bin', '').potential, '0.05');
assert.equal(inferEisIdentity('EIS-0', '').potential, '0');
assert.equal(inferEisIdentity('sample-0.43V', '').potential, '0.43');
for (const label of ['样品1', '样品20261023', '2026-10-23', 'Sample-0.43', 'EIS-20261023', 'EIS-1-20261023', 'CoFe2O4']) assert.equal(inferEisIdentity(label, label + '.bin').potential, '', label);
const explicit = curve('', [point(1, -1)], { eisGroup: '', eisPotential: '', name: 'EIS-0.43' });
assert.equal(prepareEisSpectra([explicit])[0].eisPotential, '');
assert.equal(prepareEisSpectra([explicit])[0].eisGroup, '');
checks.push('explicit-potential-patterns-only-and-explicit-metadata-preserved');

const original = freeze([
  curve(.51, [point(100, 100), point(10, -10), point(1, -1)]),
  curve(.43, [point(1, -1), point(10, -10), point(100, -100)]),
  curve(.6, [point(.1, -1), point(1, -10), point(10, -100)]),
  curve(.43, [point(1, -5), point(100, -5)], { visible: false }),
  curve(.45, [point(1, -9), point(100, -9)], { eisGroup: 'other' }),
  curve('', [point(1, -1), point(100, -1)], { eisPotential: '' }),
]);
const before = JSON.stringify(original), grid = buildEisContourGrid(original, 'one');
assert.equal(grid.error, undefined);
assert.deepEqual(grid.y, [.43, .51, .6]);
assert.equal(grid.x[0], 0); assert.equal(grid.x.at(-1), 1);
assert.equal(grid.rows[0].source, 'source.bin');
assert.deepEqual(grid.rows[1].frequency, [100, 10, 1]);
grid.x.forEach((x, col) => assert.ok(Math.abs(grid.values[0][col] - x) < 1e-12));
assert.match(grid.note, /1 条未知电位/);
assert.equal(JSON.stringify(original), before);
assert.deepEqual(plotEisCurves(original)[0].plotted.map(p => p.y), [-100, 10, 1]);
const negConvention = original.map(c => ({ ...c, imaginary: 'negative', points: c.points.map(p => ({ ...p, current: -p.current })) }));
assert.deepEqual(buildEisContourGrid(negConvention, 'one').values, grid.values);
const modulus = buildEisContourGrid([curve(.1, [point(1, -4), point(10, -4)]), curve(.4, [point(1, 4), point(10, 4)])], 'one', 'log-modulus');
assert.ok(Math.abs(modulus.min - Math.log10(5)) < 1e-12);
checks.push('signed-imaginary-convention-irregular-potential-common-log-frequency-and-input-immutability');

const duplicate = buildEisContourGrid([original[0], { ...original[1], eisPotential: '.510' }], 'one');
assert.match(duplicate.error, /重复测量/);
assert.match(buildEisContourGrid([curve(.1, [point(1, -1), point(1, -2)]), original[0]], 'one').error, /重复频率/);
assert.match(buildEisContourGrid([curve(.1, [point(1, -1), point(10, -2), point(2, -3)]), original[0]], 'one').error, /严格递增或递减/);
assert.match(buildEisContourGrid([curve(.1, [point(0, -1), point(-1, -2)]), original[0]], 'one').error, /正的有效频率/);
assert.match(buildEisContourGrid([curve(.1, [point(1, -1), point(10, -2)]), curve(.2, [point(100, -1), point(1000, -2)])], 'one').error, /共同的正频率/);
assert.match(buildEisContourGrid([original[0], curve('bad', [point(1, -1), point(10, -2)])], 'one').error, /电位/);
checks.push('duplicate-potential-duplicate-frequency-invalid-order-and-no-overlap-explained');

const gapPoints = [point(1, -1), point(10, -10), point(11, NaN), point(12, -12), point(100, -100), point(undefined, -3), point(1000, -1000)];
const gapGrid = buildEisContourGrid([curve(.1, gapPoints), curve(.2, [point(1, -1), point(1000, -1000)])], 'one');
assert.equal(gapGrid.error, undefined);
gapGrid.x.forEach((x, col) => { const f = 10 ** x; if (f > 10.000001 && f < 11.999999 || f > 100.000001 && f < 999.99999) assert.ok(Number.isNaN(gapGrid.values[0][col]), `gap crossed at ${f}`); });
const narrow = gapGrid.x.findIndex(x => x === Math.log10(11));
assert.ok(narrow >= 0 && Number.isNaN(gapGrid.values[0][narrow]));
const zeroGrid = buildEisContourGrid([curve(.1, [point(1, -1), point(10, 0), point(100, -100)]), curve(.2, [point(1, -1), point(100, -100)])], 'one');
assert.ok(zeroGrid.x.some((x, col) => x === 1 && Number.isNaN(zeroGrid.values[0][col])));
const missing = buildEisContourGrid([curve(.1, [point(1, 0), point(10, 0)]), curve(.2, [point(1, 0), point(10, 0)])], 'one');
assert.match(missing.error, /零值和缺失点/);
checks.push('internal-narrow-gaps-missing-frequency-and-zero-imaginary-remain-missing');

const malicious = curve(.1, [point(1, 4), point(undefined, NaN)], { name: '=formula,"quoted"\nline', source: '\t@source', eisGroup: '+group', visible: false, imaginary: 'negative' });
const exported = buildEisContourCsv([malicious]);
assert.ok(exported.includes('"\'=formula,""quoted""\nline"'));
assert.ok(exported.includes("'\t@source")); assert.ok(exported.includes("'+group"));
assert.match(exported, /,0,p-0.1,1,1,3,4,negative,-4,4,0,log-imag,/);
assert.match(exported, /,0,p-0.1,2,,3,,negative,,,,log-imag,,0/);
const display = gridCsv(gapGrid);
assert.match(display, /display_interpolated/); assert.doesNotMatch(display, /NaN|Infinity/);
assert.equal(display.trim().split('\r\n').length, gapGrid.x.length * gapGrid.y.length + 1);
assert.throws(() => buildEisContourCsv([]), /导入/);
checks.push('complete-hidden-source-rows-csv-escaping-formula-guard-and-separate-grid-export');

console.log(JSON.stringify({ok:true,fixture:'synthetic',checks},null,2));
