import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const modules = {};
for (const name of ['lsv-math', 'scan-branches', 'data-book']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency ${dependency}`);
    return start + modules[dependency] + end;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { plotCurves, INITIAL_X, INITIAL_Y } = await import(modules['lsv-math']);
const { buildDataBookSource, buildDataBookCsv, dataBookColumns, MAX_BOOKS_PER_SAMPLE, nextDataBookNumber } = await import(modules['data-book']);
const lsvContext = { kind: 'lsv', scan: 'all', xFormula: INITIAL_X, yFormula: INITIAL_Y, xLabel: 'Potential(-IR)vs.RHE(V)', yLabel: 'Current Density (mA cm⁻²)', globalResistance: '0' };
const tafelContext = { kind: 'tafel', scan: 'all', xFormula: 'LOG(ABS(I * 1000))', yFormula: 'E - IR * I + 0.0592 * 13.65 + 0.197 - 1.23', xLabel: 'log₁₀ |I / mA|', yLabel: '过电位 η / V', globalResistance: '5' };
const base = { id: 'a', name: '样品 A', source: 'data.csv', color: '#2374d5', visible: true, unit: 'A', resistance: '', irVoltage: '0', area: '2', compensation: 'raw' };
const points = Object.freeze([0, 1, 2, 1, 0, 1, 2].map((e, index) => Object.freeze({ e: e / 10, current: [-.001, .002, .003, .004, .005, .006, .007][index] })));
const originalPoints = JSON.stringify(points);
function plotted(sample, context = lsvContext) {
  return plotCurves([sample], { x: context.xFormula, y: context.yFormula, resistance: context.globalResistance,
    fraction: '100', irMode: context.kind === 'lsv' ? 'voltage' : 'resistance', voltage: '0' }).curves[0];
}
function values(source, rowIndex) { return Object.fromEntries(source.columns.map((column, index) => [column.key, source.row(rowIndex).cells[index]])); }
function near(actual, expected, message = '') { assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: expected ${expected}, got ${actual}`); }
function assertFiveColumns(source) {
  assert.deepEqual(source.columns.map(column => column.key), ['rawPotential', 'rawCurrent', 'spacer', 'x', 'y']);
  assert.equal(source.columns[2].label, '');
  for (let index = 0; index < source.rowCount; index++) {
    assert.equal(source.row(index).cells.length, 5);
    assert.equal(source.row(index).cells[2], null, 'C must contain no data');
    assert.equal(source.row(index).index, index + 1, 'Original row numbers remain separate headers');
  }
}

const raw = { ...base, points };
const initial = plotted(raw), initialBefore = structuredClone(initial);
const book = buildDataBookSource(initial, lsvContext);
assertFiveColumns(book);
assert.equal(book.rowCount, points.length);
assert.deepEqual(book.columns, dataBookColumns(initial, lsvContext));
assert.deepEqual(values(book, 0), { rawPotential: 0, rawCurrent: -.001, spacer: null, x: initial.plotted[0].x, y: -1 });
assert.equal(book.metadata['原始电流单位'], 'A');
assert.equal(book.metadata['面积 / cm²'], 2);

// D/E are exact applied chart coordinates. Unconfirmed IR input changes the
// status only; A/B never change and formulas are not evaluated twice.
const applied = plotted({ ...raw, irVoltage: '.97' });
const updated = buildDataBookSource(applied, lsvContext);
for (let index = 0; index < points.length; index++) {
  near(values(updated, index).x - values(book, index).x, -.97 * points[index].current, 'LSV IR delta');
  assert.deepEqual(updated.row(index).cells.slice(0, 3), [points[index].e, points[index].current, null]);
  assert.deepEqual(updated.row(index).cells.slice(3), [applied.plotted[index].x, applied.plotted[index].y]);
}
assert.equal(updated.metadata['已应用 IR 参数'], .97);
const draft = buildDataBookSource(applied, { ...lsvContext, irPending: true, globalResistance: '999', xFormula: 'display metadata, not executable code' });
for (let index = 0; index < points.length; index++) assert.deepEqual(draft.row(index), updated.row(index));
assert.match(draft.metadata['IR 状态'], /待确认.*已应用/);
assert.deepEqual(initial, initialBefore);
assert.equal(JSON.stringify(points), originalPoints);

// Per-sample Tafel Rs overrides applied global Rs. D/E keep signed IR results.
const tafel = plotted(raw, tafelContext);
const tafelBook = buildDataBookSource(tafel, tafelContext);
assertFiveColumns(tafelBook);
const globalContext = { ...tafelContext, globalResistance: '12' };
const globalApplied = plotted(raw, globalContext);
const globalBook = buildDataBookSource(globalApplied, globalContext);
for (let index = 0; index < points.length; index++) {
  near(values(globalBook, index).y - values(tafelBook, index).y, -7 * points[index].current, 'Tafel global Rs delta');
  assert.deepEqual(globalBook.row(index).cells.slice(3), [globalApplied.plotted[index].x, globalApplied.plotted[index].y]);
  assert.deepEqual(globalBook.row(index).cells.slice(0, 3), [points[index].e, points[index].current, null]);
}
assert.equal(tafelBook.metadata['全局 Rs / Ω'], 5);
assert.equal(tafelBook.metadata['样品 Rs / Ω'], null);
assert.equal(tafelBook.metadata['已应用 Rs / Ω'], 5);
const individual = plotted({ ...raw, resistance: ' 3 ', irVoltage: '999' }, tafelContext);
const individualBook = buildDataBookSource(individual, tafelContext);
near(values(individualBook, 2).y - values(tafelBook, 2).y, .006);
assert.deepEqual(individualBook.row(2).cells.slice(3), [individual.plotted[2].x, individual.plotted[2].y]);
assert.equal(individualBook.metadata['已应用 Rs / Ω'], 3);

// Imported current keeps its original units and signed numeric value in B.
for (const unit of ['A', 'mA', 'uA', 'nA', 'A/cm2', 'mA/cm2', 'uA/cm2']) {
  const sample = plotted({ ...base, points: [{ e: .1, current: -2 }], unit });
  const source = buildDataBookSource(sample, lsvContext);
  assertFiveColumns(source);
  assert.equal(values(source, 0).rawCurrent, -2);
  assert.equal(source.columns[1].unit, unit.replace('uA', 'μA').replace('cm2', 'cm²'));
  assert.equal(source.metadata['原始电流单位'], unit);
}

// Scan selection, hidden samples and masks cannot remove original BOOK rows.
const withGap = plotted({ ...raw, visible: false, points: points.map((point, index) => index === 1 ? { ...point, current: 0 } : point) }, tafelContext);
assert.equal(withGap.plotted[1], null);
const forward = buildDataBookSource(withGap, { ...tafelContext, scan: 'up', maskedIndices: [2], fitIndices: [0, 1, 2, 3, 4, 5, 6] });
const reverse = buildDataBookSource(withGap, { ...tafelContext, scan: 'down' });
assertFiveColumns(forward);
assert.equal(forward.rowCount, points.length);
for (let index = 0; index < points.length; index++) assert.deepEqual(forward.row(index), reverse.row(index));
assert.deepEqual(forward.row(1).cells, [points[1].e, 0, null, null, null]);
assert.equal(values(forward, 2).x, withGap.plotted[2].x, 'Masking must not erase computed cells or raw rows');
assert.match(forward.metadata['曲线显示'], /隐藏.*全部/);

// Filtered/reordered plots must use original row identity, not array position.
const reordered = { ...initial, plotted: [initial.plotted[6], null, initial.plotted[2], initial.plotted[0], initial.plotted[2]] };
const mapped = buildDataBookSource(reordered, lsvContext);
assert.equal(values(mapped, 0).x, initial.plotted[0].x);
assert.equal(values(mapped, 1).x, null);
assert.equal(values(mapped, 2).x, initial.plotted[2].x);
assert.equal(values(mapped, 6).x, initial.plotted[6].x);
const contradictory = buildDataBookSource({ ...initial, plotted: [...reordered.plotted, { ...initial.plotted[2], x: 100 }] }, lsvContext);
assert.deepEqual(contradictory.row(2).cells.slice(3), [null, null]);
const invalidRaw = { ...initial, points: [{ e: NaN, current: -.001 }, { e: .1, current: Infinity }], plotted: initial.plotted.slice(0, 2) };
const invalidBook = buildDataBookSource(invalidRaw, lsvContext);
assert.deepEqual(invalidBook.row(0).cells, [null, -.001, null, null, null]);
assert.deepEqual(invalidBook.row(1).cells, [.1, null, null, null, null]);
const failed = buildDataBookSource({ ...initial, error: '需要填写电极面积', plotted: [] }, lsvContext);
assert.equal(failed.rowCount, points.length);
assert.deepEqual(failed.row(2).cells, [.2, .003, null, null, null]);
assert.equal(failed.metadata['计算状态'], '需要填写电极面积');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index++) {
    const c = text[index];
    if (quoted) {
      if (c === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++; }
    else cell += c;
  }
  assert.equal(quoted, false);
  return rows;
}
const malicious = { ...withGap, name: '=HYPERLINK("bad"),样品\nA', source: ' \t+unsafe,"quoted".csv' };
const csv = buildDataBookCsv(malicious, { ...tafelContext, scan: 'down', yFormula: '-formula metadata' });
assert.equal(csv.charCodeAt(0), 0xfeff);
const csvRows = parseCsv(csv);
assert.equal(csvRows.length, points.length + 1);
assert.ok(csvRows.every(row => row.length === 5 && row[2] === ''), 'CSV must have exactly A/B, empty C, D/E');
assert.deepEqual(csvRows[0], ['原始电位 / V', '导入电流 / A', '', tafelContext.xLabel, tafelContext.yLabel]);
assert.equal(csvRows[1][1], '-0.001', 'Negative measurements remain numeric');
assert.deepEqual(csvRows[2], ['0.1', '0', '', '', '']);
assert.ok(csv.split('\r\n').slice(0, -1).every(line => line.includes(',,')), 'C must be an unquoted empty CSV field');
assert.ok(!csv.includes(malicious.name) && !csv.includes(malicious.source), 'BOOK CSV contains no extra metadata columns');
const safeHeader = parseCsv(buildDataBookCsv(initial, { ...lsvContext, xLabel: '=HYPERLINK("bad"),X\nheader', yLabel: ' \t+unsafe,Y' }))[0];
assert.equal(safeHeader[3], "'=HYPERLINK(\"bad\"),X\nheader");
assert.equal(safeHeader[4], "' \t+unsafe,Y");
assert.deepEqual(parseCsv(buildDataBookCsv(invalidRaw, lsvContext)).slice(1), [['', '-0.001', '', '', ''], ['0.1', '', '', '', '']]);
const short = plotted({ ...base, points: [{ e: .1, current: .002 }], visible: false });
assert.equal(parseCsv(buildDataBookCsv(short, lsvContext)).length, 2, 'Unequal sample lengths export independently in full');

// BOOK and its export retain every row of a large imported data set.
const long = plotted({ ...base, points: Array.from({ length: 50_000 }, (_, index) => ({ e: index / 1e6, current: (index + 1) / 1e8 })) });
const full = buildDataBookSource(long, lsvContext);
assert.equal(full.rowCount, 50_000);
assert.equal(full.row(49_999).index, 50_000);
const longRows = parseCsv(buildDataBookCsv(long, lsvContext));
assert.equal(longRows.length, 50_001);
assert.ok(longRows.every(row => row.length === 5 && row[2] === ''));
assert.equal(Number(longRows.at(-1)[0]), long.points.at(-1).e);
assert.equal(Number(longRows.at(-1)[1]), long.points.at(-1).current);
assert.equal(Number(longRows.at(-1)[3]), long.plotted.at(-1).x);
assert.equal(Number(longRows.at(-1)[4]), long.plotted.at(-1).y);

assert.equal(MAX_BOOKS_PER_SAMPLE, 10);
assert.equal(nextDataBookNumber([]), 1);
assert.equal(nextDataBookNumber([1, 2, 4]), 3);
assert.equal(nextDataBookNumber([0, -1, 1, 1, 30]), 2);
assert.equal(nextDataBookNumber(Array.from({ length: 10 }, (_, index) => index + 1)), null);
for (const index of [-1, .5, 7, NaN, Infinity]) assert.throws(() => book.row(index), /点序超出范围/);
assert.throws(() => buildDataBookSource(initial, { ...lsvContext, kind: 'other' }), /工作台类型无效/);
assert.throws(() => buildDataBookSource(initial, { ...lsvContext, scan: 'other' }), /扫描方向无效/);
assert.throws(() => buildDataBookSource({ ...initial, unit: 'unsupported' }, lsvContext), /电流单位无效/);
assert.throws(() => buildDataBookSource({ ...initial, points: null }, lsvContext), /完整的原始数据/);
const empty = buildDataBookSource({ ...initial, points: [], plotted: [] }, lsvContext);
assert.equal(empty.rowCount, 0);
assert.throws(() => empty.row(0), /点序超出范围/);
assert.throws(() => buildDataBookCsv({ ...initial, points: [], plotted: [] }, lsvContext), /没有可导出/);
assert.equal(buildDataBookSource({ ...initial, irVoltage: 'NaN' }, lsvContext).metadata['已应用 IR 参数'], null);
assert.equal(JSON.stringify(points), originalPoints);
console.log('PASS: BOOK and CSV expose exactly A/B raw data, empty C, and exact applied LSV/Tafel plot X/Y in D/E; signed original units, IR drafts, per-sample/global Rs, hidden/masked rows, invalid gaps, safe headers, 50,000 full rows and ten-BOOK cap verified.');
