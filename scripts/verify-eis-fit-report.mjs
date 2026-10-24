import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrls = new Map();
async function moduleUrl(file) {
  if (moduleUrls.has(file.href)) return moduleUrls.get(file.href);
  const loading = (async () => {
    let code = transpile(await readFile(file, 'utf8'));
    const dependencies = [...code.matchAll(/(?:from\s+|import\s+)(["'])(\.[^"']+)\1/g)];
    for (const [, quote, relative] of dependencies) {
      const dependency = new URL(relative.endsWith('.ts') ? relative : relative + '.ts', file);
      code = code.replaceAll(quote + relative + quote, JSON.stringify(await moduleUrl(dependency)));
    }
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  })();
  moduleUrls.set(file.href, loading);
  return loading;
}
const circuitUrl = await moduleUrl(new URL('../lib/eis-circuit.ts', import.meta.url));
const { collectEisFitPoints, createEisFitReport, buildEisFitReportCsv, eisResidualSummary, eisResistanceLabel } = await import(await moduleUrl(new URL('../lib/eis-fit-report.ts', import.meta.url)));
const { predictCircuit, fitEisCircuit } = await import(circuitUrl);

const curve = {
  id: 'sample-eis', name: '=Sample A', source: '+instrument, "original".csv', imaginary: 'raw', visible: true,
  color: '#123456', unit: 'A', resistance: '', area: '', compensation: 'unknown',
  points: [
    { e: NaN, current: -1, frequency: 1000 },
    ...Array.from({ length: 6 }, (_, i) => ({ e: 1 + i, current: -2 + i, frequency: 100 / (i + 1) })),
    { e: 8, current: -3 }, { e: 9, current: -4, frequency: 0 },
  ],
};
const before = structuredClone(curve);
const collected = collectEisFitPoints(curve);
assert.deepEqual(collected.indices, [1, 2, 3, 4, 5, 6]);
assert.equal(collected.missing, 3);
assert.deepEqual(collected.points.map(p => p.minusZImag), [2, 1, -0, -1, -2, -3], 'keep signed negative/inductive values');
const predicted = collected.points.map((point, i) => ({ zReal: point.zReal + (i % 2 ? -0.25 : 0.5), minusZImag: point.minusZImag + (i % 2 ? 0.75 : -0.125) }));
const residuals = predicted.map((point, i) => ({ zReal: point.zReal - collected.points[i].zReal, minusZImag: point.minusZImag - collected.points[i].minusZImag }));
const fit = { kind: 'r-cpe-w', params: { Rs: 1, Rct: 5, Q: 0.01, n: 0.8, sigma: 2 }, standardErrors: { Rs: 0.1, Rct: 0.2, Q: NaN, n: 0.01, sigma: 0.3 }, predicted, residuals, chiSquared: 0.0123, iterations: 12, converged: true, n: 6, dof: 7, totalResistance: 6, warnings: ['测试：Q 标准误差不可估计'] };
const report = createEisFitReport(curve, fit, 'modulus');
const csv = buildEisFitReportCsv(report, curve);
assert.ok(csv.startsWith('\uFEFF'));
assert.ok(csv.includes('"\'=Sample A"'));
assert.ok(csv.includes('"\'+instrument, ""original"".csv"'));
assert.ok(csv.includes('"Rs + Rct（不含扩散阻抗）",6,"Ω"'));
assert.ok(csv.includes('"拟合值 − 观测值；逐点残差与 RMS 为未加权 Ω 值"'));
assert.ok(csv.includes('"Q","CPE 系数 Q",0.01,,"S·s^n"'), 'unavailable SE is empty, not zero');
const data = csv.slice(csv.indexOf('"原始点序（从1开始）"')).trimEnd().split('\r\n').slice(1).map(line => line.split(',').map(Number));
assert.equal(data.length, 6);
for (let i = 0; i < data.length; i++) assert.deepEqual(data[i], [i + 2, collected.points[i].frequency, collected.points[i].zReal, collected.points[i].minusZImag, predicted[i].zReal, predicted[i].minusZImag, residuals[i].zReal, residuals[i].minusZImag].map(value => value === 0 ? 0 : value));
const expectedRms = Math.sqrt(residuals.reduce((sum, r) => sum + r.zReal ** 2 + r.minusZImag ** 2, 0) / 6);
assert.equal(eisResidualSummary(fit).rms, expectedRms);
assert.equal(eisResistanceLabel('rq-rq'), 'Rs + R1 + R2');
assert.equal(eisResistanceLabel('r-cpe'), 'Rs + Rct');
assert.deepEqual(curve, before, 'report creation/export never modifies imported points');

// Every changed input used for fitting must reject the previously generated report.
for (const changed of [
  { ...curve, id: 'other' }, { ...curve, name: 'renamed' }, { ...curve, source: 'other.csv' },
  { ...curve, visible: false }, { ...curve, imaginary: 'negative' },
  { ...curve, points: curve.points.slice(1) },
  { ...curve, points: curve.points.map((point, i) => i === 1 ? { ...point, current: point.current + 0.1 } : point) },
  { ...curve, points: curve.points.map((point, i) => i === 2 ? { ...point, frequency: 99 } : point) },
]) assert.throws(() => buildEisFitReportCsv(report, changed), /重新拟合/);
assert.throws(() => createEisFitReport(curve, { ...fit, n: 7 }, 'unit'), /重新拟合/);
assert.throws(() => createEisFitReport(curve, { ...fit, converged: false }, 'unit'), /重新拟合/);
assert.throws(() => createEisFitReport(curve, { ...fit, predicted: predicted.slice(1) }, 'unit'), /重新拟合/);
assert.throws(() => createEisFitReport(curve, { ...fit, residuals: residuals.map((r, i) => i ? r : { ...r, zReal: -r.zReal }) }, 'unit'), /重新拟合/);

// Actual solver output passes the report contract with a gap and original row mapping.
const frequencies = Array.from({ length: 40 }, (_, i) => 10 ** (5 - 6 * i / 39));
const truth = { Rs: 2, Rct: 18, Q: 0.002, n: 0.87 };
const synthetic = frequencies.map(frequency => predictCircuit('r-cpe', truth, frequency));
const realCurve = { ...curve, name: 'Synthetic', source: 'synthetic fixture', points: synthetic.map((point, i) => ({ e: point.zReal, current: -point.minusZImag, frequency: frequencies[i] })) };
realCurve.points.splice(3, 0, { e: NaN, current: NaN, frequency: NaN });
const solverResult = fitEisCircuit(collectEisFitPoints(realCurve).points, { kind: 'r-cpe', weighting: 'unit' });
assert.equal(solverResult.converged, true);
assert.ok(buildEisFitReportCsv(createEisFitReport(realCurve, solverResult, 'unit'), realCurve).includes('"不加权"'));
const alreadyNegative = { ...realCurve, imaginary: 'negative', points: realCurve.points.map(point => ({ ...point, current: -point.current })) };
assert.deepEqual(collectEisFitPoints(realCurve), collectEisFitPoints(alreadyNegative));

// Catalog models retain source checks and can export even when their DC limit diverges.
const { ZSIMP_MODELS, zsimpSpec } = await import(await moduleUrl(new URL('../lib/eis-zsimp-models.ts', import.meta.url)));
assert.equal(ZSIMP_MODELS.length, 112);
const catalogModel = ZSIMP_MODELS.find(model => model.expression === 'R(QR)');
assert.ok(catalogModel);
const catalogParams = Object.fromEntries(zsimpSpec(catalogModel.value).parameters.map(parameter => [parameter.key,
  parameter.key.endsWith('_n') ? 0.87 : parameter.key.includes('Y0') ? 0.002 : parameter.key === 'R1' ? 2 : 18]));
const catalogFit = { ...fit, kind: catalogModel.value, params: catalogParams, standardErrors: Object.fromEntries(Object.keys(catalogParams).map(key => [key, NaN])), totalResistance: NaN };
const selection = { mode: 'auto', attempted: 112, total: 112, failed: 0, elapsedMs: 1234, selectedRank: 1,
  searchBudget: { screeningStarts: 2, screeningIterations: 85, refinementStarts: 3, refinementIterations: 240, refinedModels: 1 },
  candidates: [{ kind: catalogFit.kind, label: catalogModel.label, expression: catalogModel.expression, rank: 1, aicc: -25, deltaAicc: 0, score: -25, stable: false, converged: true, rms: 0.01, parameterCount: Object.keys(catalogParams).length, warnings: ['QA'], starts: 5, successfulStarts: 3, searchIterations: 250, refined: true }] };
const catalogCsv = buildEisFitReportCsv(createEisFitReport(curve, catalogFit, 'modulus', selection), curve);
assert.match(catalogCsv, /自动选择最佳电路/); assert.match(catalogCsv, /候选排名/); assert.match(catalogCsv, /R\(QR\)/);
assert.ok(!catalogCsv.includes('NaN')); assert.ok(!catalogCsv.includes('"直流极限电阻"'));
assert.throws(() => createEisFitReport(curve, catalogFit, 'modulus', { ...selection, selectedRank: 2 }), /重新拟合/);
assert.ok(catalogCsv.includes('"粗筛初值次数_每模型",2'));
assert.ok(catalogCsv.includes('"粗筛每次最大迭代",85'));
assert.ok(catalogCsv.includes('"精修初值次数_每模型",3'));
assert.ok(catalogCsv.includes('"精修每次最大迭代",240'));
assert.ok(catalogCsv.includes('"完成精修模型数",1'));
assert.ok(catalogCsv.includes('"初值尝试次数","初值收敛次数","累计搜索迭代次数","已精修"'));
assert.ok(catalogCsv.includes(',5,3,250,"是","QA"'));
assert.equal(buildEisFitReportCsv(createEisFitReport(curve, catalogFit, 'modulus', { ...selection, elapsedMs: 9876 }), curve), catalogCsv, 'runtime timing does not change deterministic report contents');
for (const malformed of [
  { ...selection, searchBudget: undefined },
  { ...selection, searchBudget: { ...selection.searchBudget, refinedModels: 0 } },
  { ...selection, searchBudget: { ...selection.searchBudget, screeningIterations: -1 } },
  ...[
    { starts: 4 }, { successfulStarts: 6 }, { searchIterations: 891 }, { searchIterations: 1 }, { refined: false },
  ].map(patch => ({ ...selection, candidates: [{ ...selection.candidates[0], ...patch }] })),
]) assert.throws(() => createEisFitReport(curve, catalogFit, 'modulus', malformed), /重新拟合/);

// Preserve the actual search allocation and completed work from the automatic engine.
const { rankEisCircuits } = await import(await moduleUrl(new URL('../lib/eis-auto-fit.ts', import.meta.url)));
const budgetCurve = { ...realCurve, points: realCurve.points.filter(point => Number.isFinite(point.frequency)).filter((_, index) => index % 4 === 0) };
const auto = await rankEisCircuits(collectEisFitPoints(budgetCurve).points, { maxIterations: 60, starts: 2 });
assert.ok(auto.best?.converged, 'automatic engine produces a converged fit for the report integration');
const actualSelection = { mode: 'auto', attempted: auto.attempted, total: auto.total, failed: auto.failed, elapsedMs: auto.elapsedMs, searchBudget: auto.searchBudget,
  selectedRank: auto.candidates.find(candidate => candidate.kind === auto.best.kind).rank,
  candidates: auto.candidates.map(({ fit: candidateFit, ...candidate }) => ({ ...candidate, converged: candidateFit.converged })) };
const actualCsv = buildEisFitReportCsv(createEisFitReport(budgetCurve, auto.best, 'modulus', actualSelection), budgetCurve);
assert.ok(actualCsv.includes('"粗筛每次最大迭代",60'));
assert.ok(actualCsv.includes('"精修初值次数_每模型",2'));
assert.equal(actualSelection.searchBudget.refinedModels, actualSelection.candidates.filter(candidate => candidate.refined).length);
for (const candidate of actualSelection.candidates) {
  const expectedTail = `,${candidate.starts},${candidate.successfulStarts},${candidate.searchIterations},"${candidate.refined ? '是' : '否'}",`;
  const row = actualCsv.split('\r\n').find(line => line.startsWith(`${candidate.rank},"${candidate.kind}"`));
  assert.ok(row?.includes(expectedTail), `${candidate.kind} retains its real search work`);
}

console.log('PASS: EIS fit reports preserve source/units/weighting, signed fitted-minus-observed residuals and original rows/gaps; stale/malformed reports rejected, NaN SE preserved as unavailable, raw data unchanged, actual search budgets and candidate work exported, deterministic contents retained.');
