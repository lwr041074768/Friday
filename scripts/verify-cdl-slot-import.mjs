import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(project, 'desktop/output/cdl-slot-qa'));
const modules = { fflate: pathToFileURL(require.resolve('fflate')).href };
for (const name of ['lsv-math', 'chi-lsv-bin', 'chi-eis-bin', 'xrd-mdi', 'lsv-import', 'cdl-import', 'cdl-math', 'cdl-slot-import']) {
  const source = await readFile(path.join(project, 'lib', `${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const code = compiled.outputText.replace(/(from\s*["'])(?:\.\/|@\/lib\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { importCdlSlot, mergeCdlSlotSamples } = await import(modules['cdl-slot-import']);
const { cdlPendingTable } = await import(modules['cdl-import']);
const { calculateCdl, groupedCdlResults } = await import(modules['cdl-math']);
const settings = { e0: .075, currentUnit: 'A', normalizeArea: false, cycle: 'last', halfDelta: true, throughOrigin: false };
const slot = { slotId: 'slot-1', slotName: '第一组数据' };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
function file(rate, { source, name = `Cdl-${rate}mV.txt`, multiplier = 1, header = true, unit = 'A', missing = false } = {}) {
  const amplitude = .012 * rate / 1000 * multiplier;
  const potential = [.05, .075, .1, .075, .05];
  const rows = potential.map((e, i) => `${e},${i < 3 ? amplitude + 1e-5 : -amplitude + 1e-5},${i * .001}`);
  if (missing) rows.splice(2, 0, '');
  const prefix = header ? `CHI760E\nCyclic Voltammetry\nScan Rate (V/s) = ${rate / 1000}\n` : '';
  const f = new File([`${prefix}Potential/V,Current/${unit},Charge/C\n${rows.join('\n')}\n`], name);
  if (source) Object.defineProperty(f, 'measurementSourcePath', { value: source });
  return f;
}

// Bare Cdl-rate filenames entered in one active slot form one electrode.
const rates = [16, 20, 30, 40, 50, 60];
const imported = await importCdlSlot(rates.map(rate => file(rate)), slot);
assert.equal(imported.needsMapping, undefined);
assert.equal(imported.samples.length, 1);
assert.equal(imported.samples[0].replicate, '1');
assert.equal(imported.samples[0].groupName, slot.slotName);
assert.equal(imported.samples[0].areaCM2, 1, 'New slot electrodes default to 1 cm²');
assert.deepEqual(imported.samples[0].series.map(series => series.rateMV), rates);
assert.ok(imported.files.every(entry => entry.status === 'imported'));
near(calculateCdl(imported.samples, settings).samples[0].fit.cdl, 12);
assert.equal(imported.samples[0].series[0].metadata.originalHeaders[2], 'Charge/C');
assert.equal(imported.samples[0].series[0].points[3].originalRow[2], .003);
assert.equal(cdlPendingTable({ name: 'manual', source: 'manual.csv', headers: ['Potential/V', 'Current/A'], rows: [[.05, .001], [.1, .002]] }).area, '1', 'Manual and pasted Cdl tables default to 1 cm²');

// Reimport appends raw sweeps and excludes duplicate rates, retaining Cdl.
const again = await importCdlSlot([file(20)], { ...slot, existingSamples: imported.samples });
const merged = mergeCdlSlotSamples(imported.samples, again.samples);
assert.equal(merged[0].series.length, 7);
assert.equal(merged[0].series.at(-1).included, false);
assert.equal(imported.samples[0].series.length, 6, 'Merge does not mutate original arrays');
near(calculateCdl(merged, settings).samples[0].fit.cdl, 12);

// Defaults apply to new electrodes; old blank/custom metadata survives an
// append, including when the file needs a manual unit/column confirmation.
for (const previousArea of [undefined, 2]) {
  const existing = structuredClone(imported.samples);
  if (previousArea === undefined) delete existing[0].areaCM2;
  else existing[0].areaCM2 = previousArea;
  const before = structuredClone(existing);
  const addition = await importCdlSlot([file(70)], { ...slot, existingSamples: existing });
  assert.equal(addition.needsMapping, undefined);
  assert.equal(addition.samples[0].areaCM2, previousArea);
  const continued = mergeCdlSlotSamples(existing, addition.samples);
  assert.equal(continued[0].areaCM2, previousArea);
  assert.equal(continued[0].series.length, 7);
  assert.deepEqual(existing, before, 'Appending must not change old raw data or area metadata');
  const mapping = await importCdlSlot([file(70, { header: false, unit: '' })], { ...slot, existingSamples: existing });
  assert.equal(mapping.needsMapping?.kind, 'mapping');
  assert.equal(mapping.needsMapping.pending[0].area, previousArea === undefined ? '' : String(previousArea));
  assert.deepEqual(existing, before, 'Preparing manual mapping must not rewrite old metadata');
}
const explicitArea = await importCdlSlot([file(20)], { ...slot, areaCM2: .25 });
assert.equal(explicitArea.samples[0].areaCM2, .25, 'An explicit import area takes priority over the default');
const explicitMismatch = await importCdlSlot([file(70)], { ...slot, existingSamples: imported.samples, areaCM2: 2 });
assert.equal(explicitMismatch.needsMapping?.kind, 'mapping', 'Explicit metadata changes still need confirmation');
assert.equal(explicitMismatch.needsMapping.pending[0].area, '2', 'An explicit import area takes priority over saved metadata');
assert.equal(imported.samples[0].areaCM2, 1, 'Explicit mismatch does not rewrite existing electrodes');

// Numeric parent folders preserve independently prepared electrodes.
const folders = await importCdlSlot([1, 2].flatMap(rep => [10, 20, 30].map(rate => file(rate, { source: `E:/tests/Material/${rep}/Cdl/Cdl-${rate}mV.txt`, multiplier: rep }))), slot);
assert.equal(folders.needsMapping, undefined);
assert.equal(folders.samples.length, 2);
assert.deepEqual(folders.samples.map(sample => sample.replicate), ['1', '2']);
const previousFolders = structuredClone(folders.samples);
delete previousFolders[0].areaCM2; previousFolders[1].areaCM2 = 2;
const perElectrode = await importCdlSlot([1, 2, 3].map(rep => file(40, { source: `E:/tests/Material/${rep}/Cdl/Cdl-40mV.txt`, multiplier: rep })), { ...slot, existingSamples: previousFolders });
assert.equal(perElectrode.needsMapping, undefined);
assert.deepEqual(perElectrode.samples.map(sample => sample.areaCM2), [undefined, 2, 1], 'Areas match electrode identity; a new replicate receives the default');
assert.deepEqual(mergeCdlSlotSamples(previousFolders, perElectrode.samples).map(sample => sample.areaCM2), [undefined, 2, 1]);
const groups = groupedCdlResults(folders.samples, calculateCdl(folders.samples, settings));
assert.equal(groups[0].n, 2); near(groups[0].mean, 18); near(groups[0].sd, Math.sqrt(72));

// Two real materials must never pool into rep1 or yield a manufactured SD.
for (const nested of [true, false]) {
  const mixed = await importCdlSlot(['A', 'B'].flatMap(material => [10, 20, 30].map(rate => file(rate, { source: `E:/tests/${material}/${nested ? '1/' : ''}Cdl/Cdl-${rate}mV.txt` }))), slot);
  assert.equal(mixed.samples.length, 0); assert.equal(mixed.needsMapping.kind, 'mixedGroups');
}
const namedMaterials = await importCdlSlot(['A', 'B'].map(material => file(20, { name: `${material}-20mV.txt` })), slot);
assert.equal(namedMaterials.needsMapping.kind, 'mixedGroups');

// The acquisition header wins over a filename; 80 is never changed to 8.
const conflict = await importCdlSlot([file(80, { name: 'Cdl-8mV.txt' })], slot);
assert.equal(conflict.samples[0].series[0].rateMV, 80);
assert.equal(conflict.files[0].rateMV, 80); assert.match(conflict.warnings.join(' '), /80/);

// Explicit mA is absolute current; J alone must not imply cm^-2.
const ma = await importCdlSlot([file(20, { header: false, unit: 'mA' })], slot);
assert.equal(ma.samples[0].unit, 'mA');
const unknownUnit = await importCdlSlot([file(20, { header: false, unit: '' })], slot);
assert.equal(unknownUnit.needsMapping.kind, 'mapping'); assert.equal(unknownUnit.samples.length, 0);
const manualUnit = await importCdlSlot([file(20, { header: false, unit: '' })], { ...slot, unit: 'mA' });
assert.equal(manualUnit.samples[0].unit, 'mA');
const noRate = await importCdlSlot([file(20, { header: false, name: 'unknown.txt' })], slot);
assert.equal(noRate.needsMapping.kind, 'mapping');
const anonymous = await importCdlSlot([new File(['0.05,1\n0.1,2\n0.05,1'], 'Cdl-20mV.csv')], { ...slot, unit: 'mA' });
assert.equal(anonymous.needsMapping.kind, 'mapping');

// Preserve source gaps; prefer a sibling TXT to an opaque same-stem BIN.
const gap = await importCdlSlot([file(20, { missing: true })], slot);
assert.equal(gap.samples[0].series[0].points.length, 6);
assert.ok(Number.isNaN(gap.samples[0].series[0].points[2].e));
const binary = new File([new Uint8Array([0, 1, 2])], 'Cdl-20mV.bin');
const paired = await importCdlSlot([binary, file(20)], slot);
assert.equal(paired.files[0].status, 'skipped'); assert.equal(paired.samples[0].series.length, 1);

// Optional read-only QA: node verify-cdl-slot-import.mjs <output> <fixture.json>.
// Default checks above use generated files and require no laboratory records.
const fixturePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
let realSourceVerification = { skipped: 'No external source fixture supplied; synthetic import checks completed.' };
if (fixturePath) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const material = fixture.curves[0]?.sample;
  const selected = fixture.curves.filter(curve => curve.sample === material);
  const realFiles = await Promise.all(selected.map(async curve => {
    const source = curve.source.path;
    const f = new File([await readFile(source)], path.basename(source.replaceAll('\\', '/')));
    Object.defineProperty(f, 'measurementSourcePath', { value: source });
    return f;
  }));
  const real = await importCdlSlot(realFiles, slot);
  assert.equal(real.needsMapping, undefined);
  assert.equal(real.samples.length, new Set(selected.map(curve => String(curve.replicate))).size);
  const fitted = calculateCdl(real.samples, settings);
  assert.ok(fitted.samples.every(sample => sample.fit));
  realSourceVerification = { material, electrodes: real.samples.length, files: realFiles.length, results: fitted.samples.map(sample => ({ name: sample.name, Cdl: sample.fit.cdl, unit: sample.fit.cdlUnit, n: sample.fit.n })) };
}
await mkdir(output, { recursive: true });
const report = { ok: true, checks: 22, areaDefaults: { newElectrode: 1, legacyBlankPreserved: true, customPreserved: true, explicitImportPreferred: true, mappingPreservesArea: true, matchingByElectrode: true }, exampleRates: rates, exampleCdl_mF: 12, realSourceVerification };
await writeFile(path.join(output, 'slot-import-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
