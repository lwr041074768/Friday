import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { unzipSync, strFromU8 } from 'fflate';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(project, 'desktop/output/cdl-data-export'));
// Optional external fixture paths can be supplied after the output directory.
// The default suite is self-contained and uses analytically defined CV data.
const fixturePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const legacyPath = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
const modules = { fflate: pathToFileURL(require.resolve('fflate')).href };
for (const name of ['cdl-math', 'cdl-data-export']) {
  const source = await readFile(path.join(project, 'lib', `${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const code = compiled.outputText.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { calculateCdl } = await import(modules['cdl-math']);
const { buildCdlOriginXlsx } = await import(modules['cdl-data-export']);
function syntheticLoop(rateMV, cdl, intercept = 0, multiplier = 1) {
  const amplitude = (cdl * rateMV / 1000 + intercept) * multiplier;
  const potential = [.051, ...Array.from({ length: 51 }, (_, index) => .05 + index * .001), ...Array.from({ length: 49 }, (_, index) => .099 - index * .001)];
  return potential.map((e, index) => [e, (.01 + (index > 51 ? -amplitude : amplitude)) / 1000]);
}
function syntheticFixture() {
  const curves = [], expectedFits = [], expectedSummary = [];
  for (let group = 0; group < 5; group++) {
    const sample = `Synthetic group ${group + 1}`, mean = 4 + group * 2, values = [];
    for (let replicate = 1; replicate <= 3; replicate++) {
      const cdl = mean + (replicate - 2) * .5, intercept = replicate * .001;
      values.push(cdl);
      expectedFits.push({ sample, replicate: String(replicate), Cdl_mF: cdl, intercept_mA: intercept, r_squared: 1 });
      for (const scanRate of [10, 20, 30, 40, 50]) {
        const id = `g${group + 1}-r${replicate}-${scanRate}`;
        const loops = Array.from({ length: 6 }, (_, index) => syntheticLoop(scanRate, cdl, intercept, (index + 1) / 6));
        const source = { path: `synthetic/group-${group + 1}/replicate-${replicate}/CV-${scanRate}.txt`, filenameRate_mV_s: scanRate, cycles: 6, sha256: `synthetic-${id}` };
        curves.push({ id, sample, replicate: String(replicate), scanRate, source, points: loops.flat(), lastCycle: { index: 6, points: loops[5].slice(1) }, expectedPoint: { half_delta_mA: cdl * scanRate / 1000 + intercept }, expectedCycle5Point: { half_delta_mA: (cdl * scanRate / 1000 + intercept) * 5 / 6 } });
      }
    }
    expectedSummary.push({ sample, mean_mF_cm2: mean, sd_mF_cm2: .5, replicateValues_mF_cm2: values });
  }
  return { curves, expectedFits, expectedSummary };
}
const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, 'utf8')) : syntheticFixture();
const legacySlopes = [4.30375, 4.0185, 3.973325, 6.0205, 5.44075, 4.406855];
const legacy = legacyPath ? JSON.parse(await readFile(legacyPath, 'utf8')) : legacySlopes.map((cdl, index) => ({ id: `legacy-${index}`, name: `Synthetic legacy ${index + 1}`, color: '#2374d5', visible: true, source: 'synthetic legacy CV', unit: 'A', series: [10, 20, 30, 40, 50].map(rateMV => ({ id: `legacy-${index}-${rateMV}`, rateMV, points: syntheticLoop(rateMV, cdl).map(([e, current]) => ({ e, current })) })) }));
const near = (actual, expected, tolerance = 1e-10) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (source, key) => decode(new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(source)?.[1] ?? '');
const columnNumber = address => [...address.match(/^[A-Z]+/)[0]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;

// Independent OOXML readback: numeric cells are read from <v>, never text-cast.
function readWorkbook(bytes) {
  const parts = unzipSync(bytes), workbook = strFromU8(parts['xl/workbook.xml']);
  const relations = strFromU8(parts['xl/_rels/workbook.xml.rels']);
  const sheets = [...workbook.matchAll(/<sheet\s([^>]+)\/>/g)].map(match => {
    const name = attr(match[1], 'name'), id = attr(match[1], 'r:id');
    const target = [...relations.matchAll(/<Relationship\s([^>]+)\/>/g)].find(row => attr(row[1], 'Id') === id);
    assert.ok(target, `Missing relation for ${name}`);
    const xml = strFromU8(parts[`xl/${attr(target[1], 'Target')}`]);
    assert.doesNotMatch(xml, /<f(?:\s|>)/, 'Origin workbook must have no formulas');
    assert.doesNotMatch(xml, /<mergeCells|<conditionalFormatting|<drawing/, 'Pure data must remain flat tables');
    const rows = [];
    for (const row of xml.matchAll(/<row\s([^>]+)>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const cell of row[2].matchAll(/<c\s([^>]+)>([\s\S]*?)<\/c>/g)) {
        const address = attr(cell[1], 'r'), type = attr(cell[1], 't');
        if (type === 'inlineStr') values[columnNumber(address)] = decode(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell[2])?.[1] ?? '');
        else {
          assert.ok(type === '' || type === 'n', `Non-numeric number cell ${address}: ${type}`);
          const numeric = /<v>([^<]+)<\/v>/.exec(cell[2]);
          assert.ok(numeric, `Missing numeric value for ${address}`);
          values[columnNumber(address)] = Number(numeric[1]);
          assert.ok(Number.isFinite(values[columnNumber(address)]));
        }
      }
      rows[Number(attr(row[1], 'r')) - 1] = values;
    }
    return { name, rows, xml };
  });
  const names = sheets.map(sheet => sheet.name);
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length, 'Sheet names unique ignoring case');
  assert.ok(names.every(name => name.length <= 31 && !/[\[\]:*?/\\]/.test(name) && !/^'|'$/.test(name)), 'Excel sheet names valid');
  assert.deepEqual(names.slice(0, 3), ['Cdl拟合均值', 'Cdl拟合平行样', 'Cdl数值']);
  return sheets;
}

function tableRecords(sheet) {
  return sheet.rows.slice(1).map(values => Object.fromEntries(sheet.rows[0].map((column, index) => [column, values[index]])));
}

const grouped = new Map();
for (const curve of fixture.curves) {
  const key = `${curve.sample}|${curve.replicate}`;
  const sample = grouped.get(key) ?? { id: key, name: `${curve.sample} rep${curve.replicate}`, groupName: curve.sample, replicate: curve.replicate, unit: 'A', areaCM2: 1, visible: curve.sample !== fixture.expectedSummary.at(-1).sample, color: '#2374d5', source: path.dirname(curve.source.path), series: [] };
  sample.series.push({ id: curve.id, rateMV: curve.scanRate, included: true, rateSource: 'CHI header', headerRateMV: curve.scanRate, fileNameRateMV: curve.source.filenameRate_mV_s, source: curve.source.path, metadata: curve.source, points: curve.points.map(([e, current]) => ({ e, current })) });
  grouped.set(key, sample);
}
const real = [...grouped.values()];
const settings = { e0: .075, currentUnit: 'A', normalizeArea: true, areaCM2: 1, cycle: 'last', halfDelta: true, throughOrigin: false };
const sourceBefore = JSON.stringify(real);
const workbookBytes = buildCdlOriginXlsx(real, settings);
assert.equal(JSON.stringify(real), sourceBefore, 'Export leaves immutable source arrays and metadata unchanged');
const realSheets = readWorkbook(workbookBytes);
assert.equal(realSheets.length, 20, '3 main + independent fits + 15 electrode CV + 1 settings/source');
const summaryRecords = tableRecords(realSheets[2]);
const fitRecords = tableRecords(realSheets[3]);
for (const expected of fixture.expectedFits) {
  const record = fitRecords.find(row => row.Group === expected.sample && row.Replicate === expected.replicate);
  assert.ok(record);
  near(record.Cdl, expected.Cdl_mF); near(record.Fit_intercept, expected.intercept_mA); near(record.Fit_R_squared, expected.r_squared);
  assert.equal(record.Fit_n_rates, 5); assert.equal(record.Cdl_unit, 'mF/cm2');
}
for (const expected of fixture.expectedSummary) {
  const record = summaryRecords.find(row => row.Group === expected.sample);
  near(record.Mean_Cdl, expected.mean_mF_cm2); near(record.Sample_SD, expected.sd_mF_cm2);
  assert.equal(record.n, 3);
  expected.replicateValues_mF_cm2.forEach((value, index) => near(record[`Replicate_${index + 1}_Cdl`], value));
}
const meanRows = realSheets[0].rows;
assert.deepEqual(meanRows.slice(1).map(row => row[0]), [10, 20, 30, 40, 50]);
for (const expected of fixture.expectedSummary) {
  const meanColumn = meanRows[0].findIndex(column => column === `${expected.sample}_half_delta_Y_mA/cm²`);
  const sdColumn = meanRows[0].findIndex(column => column === `${expected.sample}_SD_mA/cm²`);
  assert.ok(meanColumn > 0 && sdColumn > 0);
  for (const row of meanRows.slice(1)) {
    const values = fixture.curves.filter(curve => curve.sample === expected.sample && curve.scanRate === row[0]).map(curve => curve.expectedPoint.half_delta_mA);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
    near(row[meanColumn], mean); near(row[sdColumn], sd);
  }
}
const sourceSheet = realSheets.find(sheet => sheet.name === '计算设置与来源');
const sourceRecords = tableRecords(sourceSheet);
for (const [index, sample] of real.entries()) {
  const sheet = realSheets[index + 4];
  assert.equal(sheet.rows[0].length, 10);
  assert.equal(sheet.rows.length, 101, 'Each complete selected loop has all 100 original ordered points');
  for (const [rateIndex, series] of [...sample.series].sort((a, b) => a.rateMV - b.rateMV).entries()) {
    const reference = fixture.curves.find(curve => curve.id === series.id);
    assert.ok(sheet.rows[0][rateIndex * 2].endsWith(`cycle${reference.lastCycle.index}`));
    for (const [pointIndex, [e, current]] of reference.lastCycle.points.entries()) {
      near(sheet.rows[pointIndex + 1][rateIndex * 2], e); near(sheet.rows[pointIndex + 1][rateIndex * 2 + 1], current * 1000);
    }
    const metadata = sourceRecords.find(row => row.Record_type === 'cv_series' && row.Series_ID === series.id);
    assert.equal(metadata.Selected_cycle, reference.lastCycle.index);
    assert.equal(metadata.Complete_cycle_count, reference.source.cycles);
    assert.equal(metadata.Source, reference.source.path);
    assert.equal(metadata.Visible, sample.visible ? 'yes' : 'no');
    const detail = JSON.parse(metadata.Information);
    assert.equal(detail.originalPointCount, reference.points.length);
    assert.equal(detail.selectedPointCount, reference.lastCycle.points.length);
    assert.equal(detail.metadata.sha256, reference.source.sha256);
  }
}
assert.ok(realSheets.slice(4, -1).some(sheet => sheet.rows.slice(1).some(row => row.some(value => typeof value === 'number' && value < 0))), 'Negative CV current signs survive as numeric cells');
assert.ok(sourceSheet.xml.includes('完整原始循环') && sourceSheet.xml.includes('样本 SD') && sourceSheet.xml.includes('×1000'));

// Changing to cycle 5 changes both the CV sheet and extracted fit values.
const cycle5Bytes = buildCdlOriginXlsx(real, { ...settings, cycle: 5 });
const cycle5Sheets = readWorkbook(cycle5Bytes), cycle5Calculated = calculateCdl(real, { ...settings, cycle: 5 });
for (const sample of real) {
  const calculated = cycle5Calculated.samples.find(result => result.id === sample.id);
  for (const point of calculated.extracted) {
    const curve = fixture.curves.find(item => item.id === point.seriesId);
    near(point.halfDelta, curve.expectedCycle5Point.half_delta_mA);
    assert.equal(point.cycle, 5);
  }
}
for (const sheet of cycle5Sheets.slice(4, -1)) assert.ok(sheet.rows[0].every(column => column.endsWith('cycle5')));
const rawCount = real.reduce((sum, sample) => sum + sample.series.reduce((subtotal, series) => subtotal + series.points.length, 0), 0);
assert.ok(rawCount > fixture.curves.length * 100, 'Origin workbook is intentionally selected-loop output, not a full raw-loop archive');

// Legacy six-sample CV input: retain all samples and full selected measured shape.
assert.equal(legacy.length, 6);
const legacySettings = { ...settings, normalizeArea: false };
const legacyBytes = buildCdlOriginXlsx(legacy, legacySettings);
const legacySheets = readWorkbook(legacyBytes);
assert.equal(legacySheets.length, 11);
const legacyElectrodes = tableRecords(legacySheets[3]);
legacyElectrodes.forEach((record, index) => near(record.Cdl, legacySlopes[index]));
const legacyGroups = tableRecords(legacySheets[2]);
assert.ok(legacyGroups.every(record => record.n === 1 && record.Sample_SD === undefined), 'n=1 sample SD stays empty');
for (const [index, sample] of legacy.entries()) {
  const sheet = legacySheets[index + 4];
  assert.equal(sheet.rows.length, 101, 'Startup fragment excluded; all 100 selected-loop points kept');
  for (const [seriesIndex, series] of [...sample.series].sort((a, b) => a.rateMV - b.rateMV).entries()) {
    for (const [pointIndex, point] of series.points.slice(1).entries()) {
      near(sheet.rows[pointIndex + 1][seriesIndex * 2], point.e);
      near(sheet.rows[pointIndex + 1][seriesIndex * 2 + 1], point.current * 1000);
    }
  }
}

// Undefined points are gaps, unequal curve lengths remain blank, names remain literal text.
const oddName = "'=HYPERLINK(\"x\")：[Ce]/*?\\" + '长名称'.repeat(20);
const names = [oddName, oddName, oddName.toUpperCase()];
const shape = (length, gap) => Array.from({ length }, (_, index) => {
  const e = index <= (length - 1) / 2 ? index / ((length - 1) / 2) : 2 - index / ((length - 1) / 2);
  return { e, current: index === gap ? NaN : (index <= (length - 1) / 2 ? .2 : -.2) };
});
const edge = names.map((name, index) => ({ id: `edge-${index}`, name, color: '#2374d5', visible: false, source: '=source & <metadata>', unit: 'mA', series: [{ id: `edge-${index}-10`, rateMV: 10, included: true, points: shape(101, 20) }, { id: `edge-${index}-20`, rateMV: 20, included: true, points: shape(201) }] }));
const edgeBytes = buildCdlOriginXlsx(edge, { ...settings, currentUnit: 'mA', normalizeArea: false, e0: .5 });
const edgeSheets = readWorkbook(edgeBytes);
for (const sheet of edgeSheets.slice(4, -1)) {
  assert.equal(sheet.rows.length, 202);
  assert.equal(sheet.rows[21][0], undefined); assert.equal(sheet.rows[21][1], undefined);
  assert.equal(sheet.rows[102][0], undefined); assert.equal(sheet.rows[102][1], undefined);
  assert.equal(typeof sheet.rows[102][2], 'number');
}
assert.ok(tableRecords(edgeSheets[3]).some(row => row.Electrode === oddName), 'Literal formula-like names kept as inline strings');
const summaryOnly = legacy.map(sample => ({ ...sample, series: [], summaryPotential: .075, summary: sample.series.map(series => ({ rateMV: series.rateMV, halfDelta: (series.points[26].current - series.points[76].current) / 2 })) }));
assert.equal(readWorkbook(buildCdlOriginXlsx(summaryOnly, legacySettings)).length, 5, 'Summary-only input exports three core sheets, independent fits and source metadata, no fake CV');
assert.throws(() => buildCdlOriginXlsx([], settings), /先导入/);
assert.throws(() => buildCdlOriginXlsx(Array.from({ length: 61 }, (_, index) => ({ ...legacy[0], id: `limit-${index}` })), settings), /60/);
const sixty = Array.from({ length: 60 }, (_, index) => ({ ...legacy[0], id: `sixty-${index}`, name: oddName, series: legacy[0].series }));
assert.equal(readWorkbook(buildCdlOriginXlsx(sixty, legacySettings)).length, 65, 'Supports 60 electrode CV sheets with unique valid names');

await mkdir(output, { recursive: true });
const realPath = path.join(output, 'cdl-origin-fixture.xlsx'), legacyOutputPath = path.join(output, 'cdl-origin-legacy-six.xlsx');
const exportedFixturePath = path.join(output, 'reference-fixture.json');
await writeFile(exportedFixturePath, JSON.stringify(fixture));
await writeFile(realPath, workbookBytes);
await writeFile(legacyOutputPath, legacyBytes);
await writeFile(path.join(output, 'cdl-origin-cycle5.xlsx'), cycle5Bytes);

// A second reader independently opens the final ZIP package when bundled Python
// has openpyxl. This only reads exported files; OOXML assertions above always run.
const python = process.env.CDL_EXPORT_PYTHON ?? 'python';
const pythonCode = `import json,sys,math\nfrom pathlib import Path\nfrom openpyxl import load_workbook\nf=json.loads(Path(sys.argv[3]).read_text(encoding='utf-8'))\nfor file,count in [(sys.argv[1],20),(sys.argv[2],11)]:\n w=load_workbook(file,data_only=False,read_only=True)\n assert len(w.sheetnames)==count\n assert w.sheetnames[:3]==['Cdl拟合均值','Cdl拟合平行样','Cdl数值']\n assert all(c.data_type!='f' for s in w for row in s for c in row)\n rows=list(w['Cdl数值'].values); records=[dict(zip(rows[0],row)) for row in rows[1:]]\n if count==20:\n  for expected in f['expectedSummary']:\n   r=next(r for r in records if r['Group']==expected['sample'])\n   assert math.isclose(r['Mean_Cdl'],expected['mean_mF_cm2'],abs_tol=1e-10)\n   assert math.isclose(r['Sample_SD'],expected['sd_mF_cm2'],abs_tol=1e-10)\n  assert all(s.max_row==101 and s.max_column==10 for s in list(w)[4:-1])\n else:\n  assert all(r['Sample_SD'] is None for r in records)\n w.close()\nprint('openpyxl independently validated typed XLSX, expected Cdl means/SD, selected-loop counts, n=1 blanks and no formulas')`;
const pythonEnvironment = { ...process.env, PYTHONIOENCODING: 'utf-8' };
const readerProbe = spawnSync(python, ['-c', 'import openpyxl'], { encoding: 'utf8', env: pythonEnvironment });
const independentlyRead = readerProbe.status === 0 ? spawnSync(python, ['-c', pythonCode, realPath, legacyOutputPath, exportedFixturePath], { encoding: 'utf8', env: pythonEnvironment }) : undefined;
if (!independentlyRead) console.log('Optional Python/openpyxl reader unavailable; independent OOXML readback completed.');
else {
  assert.equal(independentlyRead.status, 0, independentlyRead.stderr);
  console.log(independentlyRead.stdout.trim());
}
await writeFile(path.join(output, 'cdl-xlsx-export-verification.json'), JSON.stringify({ status: 'PASS', fixtureKind: fixturePath ? 'external' : 'synthetic analytical CV', fixturePath: fixturePath ?? exportedFixturePath, fixtureElectrodes: real.length, fixtureGroups: fixture.expectedSummary.length, primaryCVs: fixture.curves.length, selectedPointsPerCV: 100, legacyElectrodes: legacy.length, maxElectrodesTested: 60, rawLoopPointCount: rawCount, fixtureWorkbookSheets: realSheets.length, noFormulas: true, numericReadback: true, originalSourceUntouched: JSON.stringify(real) === sourceBefore, independentReader: independentlyRead?.status === 0 ? 'openpyxl + OOXML' : 'OOXML', expectedSummary: fixture.expectedSummary }, null, 2));
console.log(`PASS (${fixturePath ? 'external' : 'synthetic analytical CV'}): typed pure-value Origin XLSX; 15 electrodes/5 groups reproduce independent Cdl and SD; all 75 selected ordered CV curves, synchronized cycle-5 selection, hidden electrodes, source metadata, legacy 6, n=1 blanks, gaps/unequal lengths, signed currents, formula-like text, unique sheet names and 60-electrode limit.`);
