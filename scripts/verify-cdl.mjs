import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/cdl-math.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { calculateCdl, cdlCvCurves, selectedCdlCvCurves, groupedCdlResults, buildCdlOriginTables, exportCdlTable, exportCdlCsv, demoCdlSamples } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const settings = { e0: .2, currentUnit: 'mA', normalizeArea: false, cycle: 'last', halfDelta: true, throughOrigin: false };
const base = { id: 'sample', name: 'Fixture', color: '#2374d5', visible: true, source: 'source.xlsx / Sheet1', series: [] };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const summarize = (summary, sample = {}, configuration = {}) => calculateCdl([{ ...base, ...sample, summary }], { ...settings, ...configuration }).samples[0];
const rates = [20, 40, 60, 80, 100];
const pairs = rates.map(rateMV => ({ rateMV, anodic: .15 + 12 * rateMV / 1000, cathodic: .15 - 12 * rateMV / 1000 }));

// mA divided by V/s gives mF. The mV/s factor is applied exactly once.
let fitted = summarize(pairs);
near(fitted.fit.cdl, 12); near(fitted.fit.slope, 12); near(fitted.fit.intercept, 0); near(fitted.fit.r2, 1);
assert.equal(fitted.fit.n, 5); assert.equal(fitted.fit.cdlUnit, 'mF'); near(fitted.extracted[0].rateV, .02);
near(summarize(pairs, {}, { halfDelta: false }).fit.slope, 24);
near(summarize(pairs, {}, { halfDelta: false }).fit.cdl, 12);

// Summary input may already be (ja-jc)/2, as the supplied Excel formulas are.
const half = rates.map(rateMV => ({ rateMV, halfDelta: 12 * rateMV / 1000 }));
near(summarize(half).fit.cdl, 12); near(summarize(half, {}, { halfDelta: false }).fit.cdl, 12);
assert.match(summarize(half).warnings.join(), /取点电位未记录/);
assert.match(summarize(half, { summaryPotential: .15 }).warnings.join(), /0\.15 V/);
assert.doesNotMatch(summarize(half, { summaryPotential: .2 }).warnings.join(), /取点电位/);
for (const [unit, scale] of [['A', .001], ['mA', 1], ['uA', 1000], ['nA', 1000000]]) {
  const scaled = pairs.map(point => ({ ...point, anodic: point.anodic * scale, cathodic: point.cathodic * scale }));
  near(summarize(scaled, { unit }, { currentUnit: 'uA' }).fit.cdl, 12);
}
near(summarize(pairs, { areaCM2: .5 }, { normalizeArea: true, areaCM2: 2 }).fit.cdl, 24);
assert.equal(summarize(pairs, {}, { normalizeArea: true }).fit, undefined);
assert.match(summarize(pairs, {}, { normalizeArea: true, areaCM2: -1 }).errors.join(), /面积/);
near(summarize(pairs, { unit: 'mA/cm2', areaCM2: .5 }, { normalizeArea: true }).fit.cdl, 12);
assert.equal(summarize(pairs, { unit: 'mA/cm2' }).fit.cdlUnit, 'mF/cm2');
assert.match(summarize(pairs, { unit: 'mA/cm2' }, { normalizeArea: true }).warnings.join(), /不会再次/);

// Direction is determined from potential, even when both branch currents are positive.
const makeCycle = (rateMV, multiplier = 1, offset = 3) => {
  const amount = 12 * rateMV / 1000 * multiplier;
  return [[.1, offset + amount], [.2, offset + amount], [.3, offset + amount], [.2, offset - amount], [.1, offset - amount]].map(([e, current]) => ({ e, current }));
};
const cvSample = { ...base, series: rates.map(rateMV => ({ id: `cv-${rateMV}`, rateMV, points: makeCycle(rateMV) })) };
let result = calculateCdl([cvSample], settings).samples[0];
near(result.fit.cdl, 12); assert.ok(result.extracted.every(point => point.anodic > 0 && point.cathodic > 0));
const descending = { ...cvSample, series: cvSample.series.map(series => ({ ...series, points: [...series.points].reverse() })) };
near(calculateCdl([descending], settings).samples[0].fit.cdl, -12);

// Multiple cycles use the final complete pair by default, with explicit selection.
const multiple = { ...base, series: rates.map(rateMV => ({ id: `multi-${rateMV}`, rateMV, points: [...makeCycle(rateMV), ...makeCycle(rateMV, 2).slice(1)] })) };
result = calculateCdl([multiple], settings).samples[0];
near(result.fit.cdl, 24); assert.equal(result.cycles[0].count, 2); assert.equal(result.cycles[0].selected, 2);
near(calculateCdl([multiple], { ...settings, cycle: 1 }).samples[0].fit.cdl, 12);
assert.equal(calculateCdl([multiple], { ...settings, cycle: 3 }).samples[0].fit, undefined);
const selectedLast = selectedCdlCvCurves([multiple], settings)[0];
assert.equal(selectedLast.cycle, 2); assert.equal(selectedLast.cycleCount, 2);
assert.equal(selectedLast.plotted.length, 5); assert.equal(selectedLast.plotted[0].index, 4);
assert.equal(selectedLast.plotted.at(-1).index, 8); assert.equal(selectedLast.points.length, 9);
const selectedFirst = cdlCvCurves([multiple], { ...settings, cycle: 1 })[0];
assert.equal(selectedFirst.cycle, 1); assert.equal(selectedFirst.plotted[0].index, 0);
assert.equal(selectedFirst.plotted.at(-1).index, 4); assert.equal(selectedFirst.plotted.length, 5);
assert.equal(cdlCvCurves([multiple], { ...settings, cycle: 3 })[0].plotted.length, 0);
near(result.cycles[0].lastTwo.previousHalfDelta, .24);
near(result.cycles[0].lastTwo.lastHalfDelta, .48);
near(result.cycles[0].lastTwo.relativeChange, 1);
assert.match(result.warnings.join(), /单点重复性/);
const partial = { ...multiple, series: multiple.series.map(series => ({ ...series, points: [...series.points, { e: .15, current: 20 }] })) };
near(calculateCdl([partial], settings).samples[0].fit.cdl, 24);
const override = { ...multiple, series: multiple.series.map(series => ({ ...series, cycle: 1 })) };
near(calculateCdl([override], settings).samples[0].fit.cdl, 12);
// A partial first cycle and a truncated final cycle must not cross-pair adjacent
// sweeps from different acquisition cycles into a fictitious complete cycle.
const startMid = { ...multiple, series: multiple.series.map(series => ({ ...series, points: series.points.slice(1) })) };
near(calculateCdl([startMid], settings).samples[0].fit.cdl, 24);
assert.equal(calculateCdl([startMid], settings).samples[0].cycles[0].count, 1);
const truncated = { ...multiple, series: multiple.series.map(series => ({ ...series, points: series.points.slice(0, -1) })) };
near(calculateCdl([truncated], settings).samples[0].fit.cdl, 12);
assert.equal(calculateCdl([truncated], settings).samples[0].cycles[0].count, 1);

// Actual Excel/Origin CV shape: 101 points, .051 -> .050 -> .051 ...
// .100 -> .099 ... .051. A one-step startup reversal and a terminal
// endpoint offset are accepted without replacing or editing any source point.
const measuredShape = (rateMV, multiplier = 1) => {
  const amplitude = 12 * rateMV / 1000 * multiplier, offset = .2;
  const potential = [.051, ...Array.from({ length: 51 }, (_, index) => .05 + index * .001), ...Array.from({ length: 49 }, (_, index) => .099 - index * .001)];
  return potential.map((e, index) => ({ e, current: offset + (index > 51 ? -amplitude : amplitude) }));
};
const measuredSample = { ...base, series: rates.map(rateMV => ({ id: `measured-${rateMV}`, rateMV, points: measuredShape(rateMV) })) };
assert.equal(measuredSample.series[0].points.length, 101);
let measuredResult = calculateCdl([measuredSample], { ...settings, e0: .075 }).samples[0];
near(measuredResult.fit.cdl, 12); assert.equal(measuredResult.cycles[0].count, 1);
near(measuredResult.extracted[0].rawAnodic, measuredSample.series[0].points[26].current);
near(measuredResult.extracted[0].rawCathodic, measuredSample.series[0].points[76].current);
assert.match(measuredResult.warnings.join(), /采样步/);
const measuredMultiple = { ...measuredSample, series: measuredSample.series.map(series => ({ ...series, points: [...series.points, ...measuredShape(series.rateMV, 2)] })) };
near(calculateCdl([measuredMultiple], { ...settings, e0: .075 }).samples[0].fit.cdl, 24);
assert.equal(calculateCdl([measuredMultiple], { ...settings, e0: .075 }).samples[0].cycles[0].count, 2);
const measuredMidStart = { ...measuredMultiple, series: measuredMultiple.series.map(series => ({ ...series, points: series.points.slice(26) })) };
near(calculateCdl([measuredMidStart], { ...settings, e0: .075 }).samples[0].fit.cdl, 24);
assert.equal(calculateCdl([measuredMidStart], { ...settings, e0: .075 }).samples[0].cycles[0].count, 1);
const measuredMidSingle = { ...measuredSample, series: measuredSample.series.map(series => ({ ...series, points: series.points.slice(26) })) };
assert.equal(calculateCdl([measuredMidSingle], { ...settings, e0: .075 }).samples[0].fit, undefined);
// More than one terminal sampling step is not a complete opposing scan.
const measuredTruncated = { ...measuredSample, series: measuredSample.series.map(series => ({ ...series, points: series.points.slice(0, -2) })) };
assert.equal(calculateCdl([measuredTruncated], { ...settings, e0: .075 }).samples[0].fit, undefined);
const measuredGap = { ...measuredSample, series: measuredSample.series.map(series => ({ ...series, points: series.points.map((point, index) => index === 26 ? { e: NaN, current: NaN } : point) })) };
assert.equal(calculateCdl([measuredGap], { ...settings, e0: .075 }).samples[0].fit, undefined);
assert.match(calculateCdl([measuredGap], { ...settings, e0: .075 }).samples[0].errors.join(), /缺口/);

// Interpolate only neighboring source points. A NaN row retains a visible gap.
const interpolation = { ...cvSample, series: cvSample.series.map(series => ({ ...series, points: series.points.map(point => ({ e: point.e, current: point.current + point.e * 2 })) })) };
near(calculateCdl([interpolation], { ...settings, e0: .15 }).samples[0].fit.cdl, 12);
const gap = { ...cvSample, series: cvSample.series.map(series => ({ ...series, points: [series.points[0], { e: .15, current: series.points[0].current }, { e: NaN, current: NaN }, { e: .25, current: series.points[0].current }, ...series.points.slice(2)] })) };
const missing = calculateCdl([gap], settings).samples[0];
assert.equal(missing.fit, undefined); assert.match(missing.errors.join(), /缺口/);
assert.equal(calculateCdl([cvSample], { ...settings, e0: .4 }).samples[0].fit, undefined);
assert.match(calculateCdl([cvSample], { ...settings, e0: .4 }).samples[0].errors.join(), /超出/);
assert.equal(calculateCdl([{ ...base, series: [{ id: 'oneway', rateMV: 20, points: makeCycle(20).slice(0, 3) }] }], settings).samples[0].fit, undefined);

// Reject duplicate rates; exclusions retain the data but remove only fit points.
assert.equal(summarize(pairs.slice(0, 2)).fit, undefined);
assert.match(summarize([...pairs, pairs[0]]).errors.join(), /重复/);
assert.equal(summarize([...pairs, { ...pairs[0], included: false }]).fit.n, 5);
const excluded = { ...cvSample, series: cvSample.series.map((series, index) => ({ ...series, included: index !== 0 })) };
assert.equal(calculateCdl([excluded], settings).samples[0].fit.n, 4);
assert.equal(cdlCvCurves([excluded], settings).length, 5);
assert.equal(summarize(pairs.map(point => ({ ...point, rateMV: -point.rateMV }))).fit, undefined);

// OLS with intercept and standard errors is independently checked on noisy data.
const noisy = summarize([{ rateMV: 10, halfDelta: .14 }, { rateMV: 20, halfDelta: .28 }, { rateMV: 30, halfDelta: .33 }, { rateMV: 40, halfDelta: .46 }]);
near(noisy.fit.slope, 10.1); near(noisy.fit.intercept, .05);
near(noisy.fit.slopeSE, Math.sqrt(.000735 / .0005));
near(noisy.fit.interceptSE, Math.sqrt(.000735 * (1 / 4 + .025 ** 2 / .0005)));
assert.ok(noisy.fit.r2 > .96 && noisy.fit.r2 < 1);
const origin = summarize(half, {}, { throughOrigin: true }); near(origin.fit.cdl, 12); near(origin.fit.intercept, 0);
assert.equal(origin.fit.r2Definition, 'uncentered'); assert.match(origin.warnings.join(), /过原点/);
assert.ok(Number.isNaN(summarize(rates.map(rateMV => ({ rateMV, halfDelta: 1 }))).fit.r2));
const negative = summarize(rates.map(rateMV => ({ rateMV, halfDelta: -rateMV / 1000 })));
near(negative.fit.cdl, -1); assert.match(negative.warnings.join(), /为负/);

// Plot/export preserve raw order, signed current, hidden samples, and every gap.
const hidden = { ...gap, visible: false, name: '=sample,"quoted"', unit: 'A', areaCM2: 2 };
const before = JSON.stringify(hidden), plotted = cdlCvCurves([hidden], settings);
assert.equal(plotted[0].plotted[2], null); assert.equal(plotted[0].plotted[0].index, 0);
near(plotted[0].plotted[0].y, hidden.series[0].points[0].current * 1000);
assert.deepEqual(plotted[0].points, hidden.series[0].points);
const csv = exportCdlCsv([hidden, { ...base, id: 'summary', summary: half }], settings);
assert.equal(JSON.stringify(hidden), before); assert.ok(csv.includes("'=sample")); assert.ok(csv.includes('NaN')); assert.ok(csv.includes('source.xlsx / Sheet1'));
assert.equal((csv.match(/\r\nraw_cv,/g) ?? []).length, hidden.series.reduce((sum, series) => sum + series.points.length, 0));
assert.equal((csv.match(/\r\nraw_summary,/g) ?? []).length, 5);
assert.ok(csv.includes('settings_json')); assert.ok(csv.includes('series_metadata_json')); assert.ok(csv.includes('Cdl_standard_error'));
near(calculateCdl(demoCdlSamples(), { ...settings, e0: .075 }).samples[0].fit.cdl, 12);
assert.match(calculateCdl([cvSample], { ...settings, e0: NaN }).error, /E₀/);

// Independent electrodes are fitted separately. Matching rate sets are needed
// to report comparable group mean/SD; unequal sets retain each independent fit.
// The group SD uses n-1; neither the fit SE nor the pooled curve is a replicate.
const electrodes = [
  { ...base, id: 'e1', name: 'Electrode 1', groupName: 'Material', replicate: '1', summary: [10, 20, 30].map(rateMV => ({ rateMV, halfDelta: 1 + 2 * rateMV / 1000 })) },
  { ...base, id: 'e2', name: 'Electrode 2', groupName: 'Material', replicate: '2', visible: false, summary: [10, 20, 30].map(rateMV => ({ rateMV, halfDelta: -1 + 6 * rateMV / 1000 })) },
];
let grouped = groupedCdlResults(electrodes, calculateCdl(electrodes, settings));
assert.equal(grouped.length, 1); assert.equal(grouped[0].n, 2);
near(grouped[0].mean, 4); near(grouped[0].sd, Math.sqrt(8));
assert.equal(grouped[0].rates.find(point => point.rateMV === 30).n, 2);
const unequalRates = [electrodes[0], { ...electrodes[1], summary: [30, 40, 50].map(rateMV => ({ rateMV, halfDelta: -1 + 6 * rateMV / 1000 })) }];
const unequalFits = calculateCdl(unequalRates, settings);
near(unequalFits.samples[0].fit.cdl, 2); near(unequalFits.samples[1].fit.cdl, 6);
const unequalGroup = groupedCdlResults(unequalRates, unequalFits)[0];
assert.equal(unequalGroup.mean, undefined); assert.equal(unequalGroup.sd, undefined);
assert.equal(unequalGroup.rates.find(point => point.rateMV === 10).sd, undefined);
assert.match(unequalGroup.errors.join(), /扫速集合不同/); assert.match(unequalGroup.warnings.join(), /部分扫速/);
grouped = groupedCdlResults(electrodes.slice(0, 1), calculateCdl(electrodes.slice(0, 1), settings).samples);
assert.equal(grouped[0].n, 1); assert.equal(grouped[0].sd, undefined);
assert.match(grouped[0].warnings.join(), /不能计算样本 SD/);
const ungrouped = electrodes.map(electrode => ({ ...electrode, name: 'Same name', groupName: undefined }));
assert.equal(groupedCdlResults(ungrouped, calculateCdl(ungrouped, settings)).length, 2);
const mixedUnits = [electrodes[0], { ...electrodes[1], unit: 'mA/cm2' }];
grouped = groupedCdlResults(mixedUnits, calculateCdl(mixedUnits, settings));
assert.equal(grouped[0].mean, undefined); assert.equal(grouped[0].sd, undefined);
assert.match(grouped[0].errors.join(), /单位不同/);
const noFit = [electrodes[0], { ...electrodes[1], summary: electrodes[1].summary.slice(0, 2) }];
grouped = groupedCdlResults(noFit, calculateCdl(noFit, settings));
assert.equal(grouped[0].n, 1); near(grouped[0].mean, 2); assert.equal(grouped[0].sd, undefined);

// An imported group-mean curve is not a fourth independent electrode. Keep its
// fit available to inspect, but exclude it from every replicate statistic/table.
const meanCurve = { ...base, id: 'mean', name: 'Material mean', groupName: 'Material', role: 'meanCurve', summary: [10, 20, 30].map(rateMV => ({ rateMV, halfDelta: 4 * rateMV / 1000 })) };
const withMean = [...electrodes, meanCurve];
const withMeanResult = calculateCdl(withMean, settings);
near(withMeanResult.samples.find(item => item.id === 'mean').fit.cdl, 4);
grouped = groupedCdlResults(withMean, withMeanResult);
assert.equal(grouped[0].replicates.length, 3); assert.equal(grouped[0].electrodeCount, 2); assert.equal(grouped[0].n, 2);
near(grouped[0].mean, 4); near(grouped[0].sd, Math.sqrt(8));
assert.ok(grouped[0].rates.every(point => point.n === 2));
const withMeanTables = buildCdlOriginTables(withMean, settings, withMeanResult);
assert.equal(withMeanTables.replicatePoints.columns.length, 3); assert.equal(withMeanTables.electrodeFits.rows.length, 2);
assert.equal(withMeanTables.summary.columns.filter(column => column.startsWith('Replicate_')).length, 2);
const onlyMeanResult = calculateCdl([meanCurve], settings);
const onlyMean = groupedCdlResults([meanCurve], onlyMeanResult)[0];
assert.equal(onlyMean.n, 0); assert.equal(onlyMean.electrodeCount, 0); assert.equal(onlyMean.mean, undefined); assert.equal(onlyMean.sd, undefined); assert.deepEqual(onlyMean.rates, []);
assert.deepEqual(onlyMean.errors, []); assert.match(onlyMean.warnings.join(), /只有均值曲线/);
const onlyMeanTables = buildCdlOriginTables([meanCurve], settings, onlyMeanResult);
assert.equal(onlyMeanTables.replicatePoints.columns.length, 1); assert.equal(onlyMeanTables.replicatePoints.rows.length, 0); assert.equal(onlyMeanTables.electrodeFits.rows.length, 0);
assert.deepEqual(onlyMeanTables.summary.columns, ['Group', 'Mean_Cdl', 'Sample_SD', 'n', 'Unit']);

// Origin receives clean wide data, with explicit units and empty SD for n=1.
let originTables = buildCdlOriginTables([multiple], settings);
assert.equal(originTables.cv.length, 1); assert.equal(originTables.cv[0].rows.length, 5);
assert.equal(originTables.cv[0].columns.length, 10);
assert.equal(originTables.replicatePoints.rows.length, 5);
assert.equal(originTables.meanPoints.rows[0][2], undefined);
const numericText = exportCdlTable({ name: 'signed', columns: ['E', 'I'], rows: [[-.1, -.2], [undefined, undefined]] }, ',');
assert.ok(numericText.includes('\r\n-0.1,-0.2')); assert.ok(numericText.endsWith('\r\n,'));
assert.ok(exportCdlTable(originTables.cv[0], '\t').includes('\t'));
assert.ok(exportCdlCsv(electrodes, settings).includes('group_sample_SD'));
console.log('Cdl verification passed: signed CV extraction, synchronized full cycle display, gaps/ranges, units/area, already-halved summaries, OLS/SE, independent electrode grouping with sample SD, clean Origin tables, and full source export.');

// Optional source audit fixture is supplied by the caller, never bundled into
// the application. Expected values were independently computed from raw TXT.
if (process.argv[2]) {
  const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const sampleMap = new Map();
  for (const curve of fixture.curves) {
    const id = `${curve.sample}|${curve.replicate}`;
    let sample = sampleMap.get(id);
    if (!sample) {
      sample = { ...base, id, name: `${curve.sample} #${curve.replicate}`, groupName: curve.sample, replicate: curve.replicate, unit: curve.currentUnit, series: [], source: curve.source.path };
      sampleMap.set(id, sample);
    }
    sample.series.push({ id: curve.id, rateMV: curve.scanRate, points: curve.points.map(([e, current]) => ({ e, current })), source: curve.source.path, rateSource: 'TXT header', headerRateMV: curve.source.scanRate_V_s * 1000, fileNameRateMV: curve.source.filenameRate_mV_s, metadata: { sha256: curve.source.sha256 } });
  }
  const sourceSamples = [...sampleMap.values()];
  const configuration = { ...settings, e0: .075, currentUnit: 'A', normalizeArea: true, areaCM2: 1 };
  const calculated = calculateCdl(sourceSamples, configuration);
  assert.equal(sourceSamples.length, 15); assert.equal(fixture.curves.length, 75);
  for (const expected of fixture.expectedFits) {
    const actual = calculated.samples.find(item => item.id === `${expected.sample}|${expected.replicate}`);
    assert.deepEqual(actual.errors, []); assert.equal(actual.fit.n, 5);
    near(actual.fit.cdl, expected.Cdl_mF_cm2); near(actual.fit.intercept, expected.intercept_mA); near(actual.fit.r2, expected.r_squared);
  }
  const graphs = selectedCdlCvCurves(sourceSamples, configuration);
  for (const curve of fixture.curves) {
    const electrode = calculated.samples.find(item => item.id === `${curve.sample}|${curve.replicate}`);
    const point = electrode.extracted.find(item => item.seriesId === curve.id);
    const cycles = electrode.cycles.find(item => item.seriesId === curve.id);
    assert.equal(cycles.count, curve.source.cycles); assert.equal(cycles.selected, curve.lastCycle.index);
    assert.equal(point.cycle, curve.expectedPoint.cycle);
    near(point.rawAnodic, curve.expectedPoint.Ia_A); near(point.rawCathodic, curve.expectedPoint.Ic_A); near(point.halfDelta, curve.expectedPoint.half_delta_mA);
    near(cycles.lastTwo.previousHalfDelta, curve.previousCyclePoint.half_delta_mA); near(cycles.lastTwo.lastHalfDelta, curve.expectedPoint.half_delta_mA);
    near(cycles.lastTwo.relativeChange, Math.abs(curve.expectedPoint.half_delta_mA - curve.previousCyclePoint.half_delta_mA) / Math.abs(curve.previousCyclePoint.half_delta_mA));
    const graph = graphs.find(item => item.seriesId === curve.id);
    assert.equal(graph.plotted.length, curve.lastCycle.points.length);
    assert.equal(graph.plotted[0].index, curve.lastCycle.sourceFirstRow - 1);
    curve.lastCycle.points.forEach(([e, current], index) => { near(graph.plotted[index].x, e); near(graph.plotted[index].y, current * 1000); });
  }
  const grouped = groupedCdlResults(sourceSamples, calculated);
  assert.equal(grouped.length, 5);
  for (const expected of fixture.expectedSummary) {
    const actual = grouped.find(item => item.name === expected.sample);
    assert.equal(actual.n, expected.n); near(actual.mean, expected.mean_mF_cm2); near(actual.sd, expected.sd_mF_cm2);
    assert.ok(actual.rates.every(point => point.n === 3));
  }
  const fifth = calculateCdl(sourceSamples, { ...configuration, cycle: 5 });
  const fifthGraphs = selectedCdlCvCurves(sourceSamples, { ...configuration, cycle: 5 });
  for (const curve of fixture.curves) {
    const point = fifth.samples.find(item => item.id === `${curve.sample}|${curve.replicate}`).extracted.find(item => item.seriesId === curve.id);
    near(point.rawAnodic, curve.expectedCycle5Point.Ia_A); near(point.rawCathodic, curve.expectedCycle5Point.Ic_A);
    assert.equal(fifthGraphs.find(item => item.seriesId === curve.id).cycle, 5);
  }
  originTables = buildCdlOriginTables(sourceSamples, configuration, calculated);
  assert.deepEqual(originTables.meanPoints.rows.map(row => row[0]), [10, 20, 30, 40, 50]);
  assert.equal(originTables.meanPoints.columns.length, 16); assert.equal(originTables.replicatePoints.columns.length, 16);
  assert.equal(originTables.summary.rows.length, 5); assert.equal(originTables.electrodeFits.rows.length, 15); assert.equal(originTables.cv.length, 15);
  assert.deepEqual(originTables.summary.columns, ['Group', 'Replicate_1_Cdl', 'Replicate_2_Cdl', 'Replicate_3_Cdl', 'Mean_Cdl', 'Sample_SD', 'n', 'Unit']);
  for (const expected of fixture.expectedSummary) {
    const row = originTables.summary.rows.find(row => row[0] === expected.sample);
    expected.replicateValues_mF_cm2.forEach((value, index) => near(row[index + 1], value));
    near(row[4], expected.mean_mF_cm2); near(row[5], expected.sd_mF_cm2); assert.equal(row[6], 3); assert.equal(row[7], 'mF/cm2');
  }
  assert.ok(originTables.meanPoints.columns.slice(1, 6).every(column => column.includes('_half_delta_Y_')));
  assert.ok(originTables.meanPoints.columns.slice(6, 11).every(column => column.includes('_SD_')));
  assert.ok(originTables.meanPoints.columns.slice(11, 16).every(column => column.endsWith('_n')));
  assert.ok(originTables.cv.every(table => table.rows.length === 100 && table.columns.length === 10));
  const auditCsv = exportCdlCsv(sourceSamples, configuration, calculated);
  const rawCount = fixture.curves.reduce((sum, curve) => sum + curve.points.length, 0);
  assert.equal((auditCsv.match(/\r\nraw_cv,/g) ?? []).length, rawCount);
  assert.equal((auditCsv.match(/\r\ngroup,/g) ?? []).length, 5);
  console.log(`Source audit passed: 75 raw TXT curves, 15 independently fitted electrodes, 5 mean/sample-SD groups, all ${rawCount} original rows, and CV/export matching the selected source cycle.`);
}
