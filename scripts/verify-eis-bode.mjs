import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modules = {};
for (const name of ['eis-contour', 'eis-data', 'eis-bode']) {
  const source = fs.readFileSync(path.join(root, 'lib', name + '.ts'), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])\.\/([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { buildEisBode, buildEisBodeCsv } = await import(modules['eis-bode']);
const { plotEisCurves } = await import(modules['eis-data']);
const checks = [];
const base = { color: '#2374d5', visible: true, unit: 'A', resistance: '', area: '', compensation: 'unknown', imaginary: 'raw', eisGroup: 'one', source: 'source.bin' };
let serial = 0;
const curve = (potential, points, patch = {}) => ({ ...base, id: `s-${++serial}`, name: `EIS-${potential}`, eisPotential: String(potential), points, ...patch });
const point = (frequency, real, imaginary) => ({ frequency, e: real, current: imaginary });
const near = (actual, expected, message, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
function csvRows(text) {
  const rows = []; let field = '', row = [], quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(field); field = ''; }
    else if (!quoted && (c === '\r' || c === '\n')) { row.push(field); if (row.some(x => x !== '')) rows.push(row); row = []; field = ''; if (c === '\r' && text[i + 1] === '\n') i++; }
    else field += c;
  }
  assert.equal(quoted, false);
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const frequencies = [.1, 1, 10, 100, 1000], r = 8, c = .002, l = .2;
const resistor = curve(.1, frequencies.map(f => point(f, r, 0)));
const capacitor = curve(.2, frequencies.map(f => point(f, 0, -1 / (2 * Math.PI * f * c))));
const parallelRC = curve(.3, frequencies.map(f => { const wrc = 2 * Math.PI * f * r * c; return point(f, r / (1 + wrc * wrc), -r * wrc / (1 + wrc * wrc)); }));
const seriesRL = curve(.4, frequencies.map(f => point(f, r, 2 * Math.PI * f * l)));
const circuits = freeze([seriesRL, capacitor, resistor, parallelRC]), original = JSON.stringify(circuits);
const result = buildEisBode(circuits, 'one');
assert.equal(result.error, undefined);
assert.deepEqual(result.series.map(s => s.potential), ['0.1', '0.2', '0.3', '0.4']);
assert.equal(result.xMin, .1); assert.equal(result.xMax, 1000);
assert.equal(result.logXMin, -1); assert.equal(result.logXMax, 3);
frequencies.forEach((f, i) => {
  const [rp, cp, rcp, rlp] = result.series.map(s => s.points[i]), wrc = 2 * Math.PI * f * r * c, wl = 2 * Math.PI * f * l;
  near(rp.magnitude, r, 'R magnitude'); near(rp.phase, 0, 'R phase');
  near(cp.magnitude, 1 / (2 * Math.PI * f * c), 'C magnitude'); near(cp.phase, -90, 'C phase'); near(cp.negativePhase, 90, 'C negative phase');
  near(rcp.magnitude, r / Math.sqrt(1 + wrc * wrc), 'parallel RC magnitude'); near(rcp.phase, -Math.atan(wrc) * 180 / Math.PI, 'parallel RC phase');
  near(rlp.magnitude, Math.sqrt(r * r + wl * wl), 'series RL magnitude'); near(rlp.phase, Math.atan(wl / r) * 180 / Math.PI, 'series RL phase');
  near(rlp.negativePhase, -Math.atan(wl / r) * 180 / Math.PI, 'RL signed inductive negative phase');
  near(rlp.logMagnitude, Math.log10(rlp.magnitude), 'log magnitude'); assert.equal(rlp.index, i);
});
assert.equal(JSON.stringify(circuits), original);
checks.push('known-R-C-parallelRC-seriesRL-equations-and-physical-Hz-ohm-bounds');

const quadrants = curve(.5, [point(1000, 1, 1), point(100, -1, 1), point(10, -1, -1), point(1, 1, -1), point(.1, 0, 0)]);
const quadrantData = buildEisBode([quadrants], 'one');
assert.deepEqual(quadrantData.series[0].points.map(p => p.phase), [45, 135, -135, -45, null]);
assert.deepEqual(quadrantData.series[0].points.map(p => p.negativePhase), [-45, -135, 135, 45, null]);
assert.deepEqual(quadrantData.series[0].points.map(p => p.frequency), [1000, 100, 10, 1, .1]);
assert.equal(quadrantData.series[0].points[4].magnitude, 0); assert.equal(quadrantData.series[0].points[4].logMagnitude, null);
assert.equal(quadrantData.magMin, Math.sqrt(2)); assert.equal(quadrantData.phaseMin, -135); assert.equal(quadrantData.phaseMax, 135);
const negativeInput = { ...quadrants, imaginary: 'negative', points: quadrants.points.map(p => ({ ...p, current: -p.current })) };
assert.deepEqual(buildEisBode([negativeInput], 'one').series[0].points, quadrantData.series[0].points);
assert.deepEqual(plotEisCurves([quadrants])[0].plotted.map(p => p.y), [-1, -1, 1, 1, -0]);
checks.push('atan2-quadrants-inductive-sign-zeroZ-separate-null-phase-and-negative-imaginary-input');

const gaps = curve(.6, [point(100, 3, -4), point(10, NaN, -4), point(1, 3, NaN), point(undefined, 3, -4), point(0, 3, -4), point(-1, 3, -4), point(Infinity, 3, -4), point(NaN, 3, -4), point(.01, 3, -4)]);
const gapped = buildEisBode([gaps], 'one').series[0].points;
assert.equal(gapped.length, 9); assert.equal(gapped[0].index, 0); assert.equal(gapped[8].index, 8);
assert.deepEqual(gapped.slice(1, 8), Array(7).fill(null));
const unknown = curve('', [point(1, 2, -2)], { name: '未标定电位的样品', eisPotential: '' });
const duplicate = curve(.1, [point(10, 3, -4)], { name: '重复测量B' });
const hidden = curve(.15, [point(1, 6, -8)], { visible: false });
const other = curve(.1, [point(1, 1, -1)], { eisGroup: 'other' });
const mixed = [unknown, resistor, duplicate, hidden, other, gaps];
const shown = buildEisBode(mixed, 'one');
assert.equal(shown.error, undefined); assert.equal(shown.series.length, 4);
assert.deepEqual(shown.series.map(s => s.id), [resistor.id, duplicate.id, gaps.id, unknown.id]);
assert.match(shown.series[1].label, /0.1 V.*重复测量B/); assert.equal(shown.series.at(-1).label, unknown.name); assert.equal(shown.series.at(-1).potential, '');
assert.match(buildEisBode([curve(.1, [point(1, 0, 0)])], 'one').error, /非零有效阻抗/);
assert.match(buildEisBode(mixed, 'missing').error, /可见 EIS/);
checks.push('original-order-index-null-gaps-hidden-group-unknown-duplicate-potential-and-unequal-length');

const attack = curve('', [point(2, 0, 0), point(undefined, 3, -4)], { name: '=formula,"quoted"\nline', source: '\t@source', eisGroup: '+group', visible: false, eisPotential: '=potential' });
const [headers, ...exported] = csvRows(buildEisBodeCsv([...mixed, attack]));
const at = (row, key) => row[headers.indexOf(key)];
assert.equal(exported.length, [...mixed, attack].reduce((n, item) => n + item.points.length, 0));
assert.ok(exported.some(row => at(row, 'group') === 'other'));
assert.ok(exported.some(row => at(row, 'curve_id') === hidden.id && at(row, 'visible') === '0'));
const zero = exported.find(row => at(row, 'curve_id') === attack.id && at(row, 'source_point') === '1');
assert.equal(at(zero, 'sample_name'), "'=formula,\"quoted\"\nline"); assert.equal(at(zero, 'source'), "'\t@source"); assert.equal(at(zero, 'potential_V'), "'=potential");
assert.equal(at(zero, 'magnitude_Ohm'), '0'); assert.equal(at(zero, 'phase_deg'), ''); assert.equal(at(zero, 'negative_phase_deg'), ''); assert.equal(at(zero, 'log10_magnitude_Ohm'), ''); assert.equal(at(zero, 'valid_phase'), '0');
const noFrequency = exported.find(row => at(row, 'curve_id') === attack.id && at(row, 'source_point') === '2');
assert.equal(at(noFrequency, 'frequency_Hz'), ''); assert.equal(at(noFrequency, 'magnitude_Ohm'), '5'); near(Number(at(noFrequency, 'phase_deg')), -53.13010235415598, 'CSV computed phase without plotting frequency'); assert.equal(at(noFrequency, 'valid_frequency'), '0');
const signed = exported.find(row => at(row, 'curve_id') === gaps.id && at(row, 'source_point') === '1');
assert.equal(at(signed, 'raw_Zimag_Ohm'), '-4'); assert.equal(at(signed, 'minus_Zimag_Ohm'), '4');
assert.throws(() => buildEisBodeCsv([]), /导入/);
checks.push('complete-all-group-hidden-raw-point-and-both-phase-CSV-with-escaping-and-formula-guard');

console.log(JSON.stringify({ok:true,fixture:'synthetic',checks},null,2));
