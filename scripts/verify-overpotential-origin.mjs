import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { validateOverpotentialRequest } = require('../desktop/policy.cjs');
const modules = {};
for (const name of ['lsv-math', 'scan-branches', 'lsv-target', 'overpotential-data', 'overpotential-axes', 'overpotential-origin-export']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])\.\/([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { prepareOverpotentialOriginExport } = await import(modules['overpotential-origin-export']);
const { defaultOverpotentialAxisSettings } = await import(modules['overpotential-axes']);
const { plotCurves, INITIAL_X, INITIAL_Y } = await import(modules['lsv-math']);
const requestId = '11111111-2222-3333-4444-555555555555';
const colors = ['#e34c46','#388bd4','#a34bc9','#219e79','#e39736','#8473ca','#687993','#2aa5b8','#b05070','#596ecb'];
const raw = Array.from({ length: 10 }, (_, index) => {
  const eta = index === 0 ? -25 : 150 + index * 25;
  const x = 1.23 + eta / 1000;
  const e = x - .059 * 13.65 - .197;
  return {
    id: `sample-${index}`, name: index < 2 ? '重复样品' : index === 3 ? '样品";run fake;\\(x)' : `样品 ${index + 1}`,
    color: colors[index], source: `batch-20261013/sample-${index + 1}.txt`, visible: index !== 2,
    points: [{ e: e - .05, current: 0 }, { e: e + .05, current: index === 4 ? .008 : .02 }],
    unit: 'A', area: '1', compensation: 'raw', resistance: '', irVoltage: '.97', invalid: 0, demo: index === 5,
  };
});
const plot = curves => plotCurves(curves, { x: INITIAL_X, y: INITIAL_Y, resistance: '0', fraction: '100', irMode: 'voltage', voltage: '0' }).curves;
const snapshot = { scan: 'up', demo: false, curves: plot(raw) };
const settings = { ...defaultOverpotentialAxisSettings, xMin: '.25', xMax: '10.75', yMin: '-100', yMax: '450', xMajor: '2', yMajor: '50', xMinor: '3', yMinor: '2' };
const payload = prepareOverpotentialOriginExport(snapshot, settings, requestId);
assert.equal(payload.samples.length, 10);
assert.ok(Math.abs(payload.samples[0].eta10MV - -34.7) < 1e-8);
assert.ok(Math.abs(payload.samples[0].xAt10 - 1.1953) < 1e-8);
assert.ok(Math.abs(payload.samples[0].eAt10 - raw[0].points[0].e - .05) < 1e-8);
assert.doesNotMatch(payload.samples[0].note, /未额外应用软件 iR 校正|软件 iR=0/);
assert.equal(payload.samples[4].eta10MV, null);
assert.equal(payload.samples[4].xAt10, null);
assert.equal(payload.samples[4].eAt10, null);
assert.deepEqual(payload.samples.map(sample => sample.name), snapshot.curves.map(curve => curve.name));
assert.deepEqual(payload.samples.map(sample => sample.source), snapshot.curves.map(curve => curve.source));
assert.deepEqual(payload.samples.map(sample => sample.color), colors);
assert.deepEqual(payload.samples.map(sample => sample.order), [1,2,3,4,5,6,7,8,9,10]);
assert.equal(payload.samples[2].visible, false);
assert.equal(payload.samples[5].demo, true);
assert.equal(payload.samples[0].irVoltage, .97);
for (const irVoltage of ['0', '-1']) {
  const current = { ...snapshot, curves: plot(raw.map(curve => ({ ...curve, irVoltage }))) };
  const before = JSON.stringify(current);
  const changed = prepareOverpotentialOriginExport(current, settings, requestId);
  changed.samples.forEach((sample, index) => {
    const baseline = payload.samples[index];
    assert.equal(sample.eAt10, baseline.eAt10, 'IR does not change source E@10');
    assert.equal(sample.irVoltage, Number(irVoltage), 'Origin records the actual applied chart IR');
    if(baseline.eta10MV === null) {
      assert.equal(sample.eta10MV, null);
      assert.equal(sample.xAt10, null);
    } else {
      const delta = .97 - Number(irVoltage);
      assert.ok(Math.abs(sample.eta10MV - baseline.eta10MV - delta * 10) < 1e-8, 'Origin η follows applied IR exactly once');
      assert.ok(Math.abs(sample.xAt10 - baseline.xAt10 - delta * .01) < 1e-8, 'Origin exports the current chart X@10');
      assert.ok(Math.abs(sample.eta10MV - (sample.xAt10 - 1.23) * 1000) < 1e-8, 'η subtracts equilibrium voltage once, without a second IR correction');
    }
  });
  assert.equal(JSON.stringify(current), before, 'Origin export must not mutate raw, plotted or applied data');
  assert.deepEqual(validateOverpotentialRequest(JSON.stringify(changed)), changed);
}
assert.equal(payload.axes.x.min, .25);
assert.equal(payload.axes.y.max, 450);
assert.deepEqual(payload.axes.x.majorTicks, [1,3,5,7,9]);
assert.equal(payload.axes.y.minorCount, 2);
assert.equal(prepareOverpotentialOriginExport(snapshot, { ...defaultOverpotentialAxisSettings, xMinor: '', yMinor: '' }, requestId).axes.x.minorCount, 1);
assert.deepEqual(validateOverpotentialRequest(JSON.stringify(payload)), payload);
const rejects = [];
for (const mutate of [
  packet => packet.requestId = `${requestId};run evil`,
  packet => packet.schema = 'lsv-origin/v1',
  packet => packet.samples[0].eta10MV = 0,
  packet => packet.samples[4].eta10MV = 0,
  packet => packet.samples[0].order = '1',
  packet => packet.samples[0].name = 'x\0y',
  packet => packet.samples[0].demo = 'false',
  packet => packet.samples[0].color = '#abc;run',
  packet => packet.samples[0].unknownField = 1,
  packet => packet.axes.y.majorTicks = [0,100,50],
  packet => packet.axes.y.minorCount = 11,
  packet => packet.axes.y.min = '0',
  packet => packet.samples.push(packet.samples[0]),
]) {
  const altered = structuredClone(payload); mutate(altered);
  assert.throws(() => validateOverpotentialRequest(JSON.stringify(altered)));
  rejects.push(altered);
}
assert.throws(() => prepareOverpotentialOriginExport({ ...snapshot, curves: [] }, settings, requestId));
assert.throws(() => prepareOverpotentialOriginExport(snapshot, { ...settings, yMajor: '0' }, requestId));
const directory = new URL('../desktop/qa-overpotential-origin/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('fixture.json', directory), JSON.stringify(payload, null, 2));
await writeFile(new URL('rejects.json', directory), JSON.stringify(rejects, null, 2));
console.log('PASS: ordered 10-sample Origin packet, signed/null readings, live labels/colors/IR/source/demo, applied custom axes, and strict native request boundaries.');
