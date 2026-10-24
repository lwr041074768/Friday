import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const modules = {};
for (const name of ['lsv-math', 'scan-branches', 'tafel-analysis', 'tafel-auto', 'tafel-derived', 'tafel-data-export']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
  code = code.replace(/(from\s*["'])\.\/([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], dependency);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {fitTafelLine} = await import(modules['tafel-analysis']);
const {selectScan} = await import(modules['scan-branches']);
const {buildTafelCsv, buildTafelFitCsv} = await import(modules['tafel-data-export']);
const {tafelDerivedMetrics} = await import(modules['tafel-derived']);
const options = {scan: 'up', basis: 'current'};
const formulas = {x: 'LOG(ABS(I * 1000))', y: 'E - IR * I'};
const axes = {x: 'log10 current', y: 'eta V'};
function curve(xy, patch = {}) {
  return {id: 'a', name: 'A, "one"', color: '#2374d5', visible: true, unit: 'A', resistance: '2', area: '1', compensation: 'raw', source: 'fixture A.txt', invalid: 0,
    points: xy.map(([x,y], i) => ({e: .2 + .01 * i, current: (i+1)/1000})),
    plotted: xy.map(([x,y], index) => ({x, y, index, e: .2 + .01 * index, current: (index+1)/1000})), ...patch};
}
// Minimal RFC 4180 parser, including quoted comma, quote and newline metadata.
function parse(text) {
  const rows = []; let row = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i=0; i<text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i+1] === '"') {value += '"'; i++;}
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {row.push(value); value = '';}
    else if (char === '\r' && !quoted && text[i+1] === '\n') {row.push(value); rows.push(row); row = []; value = ''; i++;}
    else value += char;
  }
  return rows;
}
const first = curve([[0,1.1],[1,2.8],[2,5.2],[3,6.8],[4,9.1],[5,11],[6,13]]);
first.points[2] = {e: NaN, current: NaN}; first.plotted[2] = null; first.invalid = 1;
const hidden = curve([[0,.3],[1,.2],[2,.1]], {id: 'b', name: '\t=HYPERLINK("test")', source: '@unsafe\nfile.csv', visible: false});
const saved = structuredClone([first, hidden]);
const fit = fitTafelLine(first, {min: 0,max: 6}, {...options, maskedIndices: [1,5]});
const rawCsv = buildTafelCsv([first,hidden], 'up', formulas, axes, {masks: {a:[1,5],b:[0]}, fit});
assert.ok(rawCsv.startsWith('\uFEFF'));
const rows = parse(rawCsv), header = rows.shift(), col = name => header.indexOf(name);
assert.equal(rows.length, 10); assert.equal(header.length, 45); rows.forEach(row => assert.equal(row.length, header.length));
assert.deepEqual(header.slice(0,16), ['样品','源文件','原始点序','原始电位_V','导入电流','导入电流单位',axes.x,axes.y,'在所选扫描段内','可见','扫描选择','X公式','Y公式','样品Rs_ohm','面积_cm2','补偿状态']);
assert.equal(rows[1][6], '1'); assert.equal(rows[1][7], '2.8'); // masked X/Y remain for provenance
assert.equal(rows[1][col('屏蔽')], '1'); assert.equal(rows[1][col('参与拟合')], '0');
assert.equal(rows[2][3], ''); assert.equal(rows[2][4], ''); assert.equal(rows[2][6], ''); assert.equal(rows[2][7], '');
assert.equal(rows[0][col('参与拟合')], '1'); assert.equal(rows[3][col('参与拟合')], '1');
assert.equal(rows[0][col('拟合点数_n')], String(fit.n)); assert.equal(rows[0][col('斜率_b_V_per_dec')], String(fit.slope));
assert.equal(rows[0][col('截距标准误差_V')], String(fit.interceptSE));
assert.equal(rows[7][9], '0'); assert.equal(rows[7][col('屏蔽')], '1'); assert.equal(rows[7][col('参与拟合')], '0');
assert.ok(rows[7][0].startsWith("'\t=")); assert.ok(rows[7][1].startsWith("'@unsafe\n"));
assert.ok(rows[7].slice(col('拟合样品'),col('全局Rs_ohm')).every(v => v === ''));
assert.deepEqual([first,hidden], saved);
const withGlobal=parse(buildTafelCsv([first], 'up', formulas, axes, {masks:{},fit:null,globalResistance:'7.5'}));
assert.equal(withGlobal[1][col('全局Rs_ohm')],'7.5');assert.equal(withGlobal[1][col('有效Rs_ohm')],first.resistance.trim()||'7.5');

// Stale result removal clears all fit context, while masks remain explicit.
const cleared = parse(buildTafelCsv([first], 'up', formulas, axes, {masks:{a:[1]},fit:null}));
assert.equal(cleared[2][col('屏蔽')], '1');
cleared.slice(1).forEach(row => {assert.equal(row[col('参与拟合')], '0'); assert.ok(row.slice(col('拟合样品'),col('全局Rs_ohm')).every(v => v === ''));});
cleared.slice(1).forEach(row => assert.ok(row.slice(35).every(value => value === ''), 'stale derived metrics must also clear'));
const baseline = parse(buildTafelCsv([first,hidden], 'up', formulas, axes));
baseline.slice(1).forEach((row,i) => assert.deepEqual(row.slice(0,16), rows[i].slice(0,16)));

const reportCsv = buildTafelFitCsv(fit,first), report = parse(reportCsv);
assert.ok(reportCsv.startsWith('\uFEFF'));
const metric = name => report.find(row => row[0] === name);
assert.deepEqual(metric('有效点数 n'), ['有效点数 n',String(fit.n),'','']);
assert.deepEqual(metric('斜率 b'), ['斜率 b',String(fit.slope),String(fit.slopeSE),'V/dec']);
assert.deepEqual(metric('Tafel斜率'), ['Tafel斜率',String(fit.slopeMvPerDec),String(fit.slopeSEmvPerDec),'mV/dec']);
assert.deepEqual(metric('截距 a'), ['截距 a',String(fit.intercept),String(fit.interceptSE),'V']);
assert.equal(metric('权重')[1], '不加权'); assert.equal(metric('参数误差说明')[1], '标准误差（1 SE）');
const detailHeader = report.findIndex(row => row[0] === '原始点序');
const detail = report.slice(detailHeader+1);
assert.deepEqual(detail.map(row => +row[0]), fit.indices.map(index => index+1));
let sse = 0;
detail.forEach(row => {assert.ok(Math.abs(+row[2] - +row[3] - +row[4]) < 1e-12); sse += (+row[4]) ** 2;});
assert.ok(Math.abs(sse - fit.sse) < 1e-12);
const negativeFit = fitTafelLine(hidden, {min:0,max:2}, {...options,scan:'down',basis:'density'});
const negativeRows = parse(buildTafelFitCsv(negativeFit,hidden));
assert.ok(+negativeRows.find(row => row[0] === 'Tafel斜率')[1] < 0);
assert.equal(negativeRows.find(row => row[0] === '横轴计算')[1], '电流密度');
assert.equal(negativeRows.find(row => row[0] === '扫描选择')[1], 'down');
assert.ok(negativeRows.find(row => row[0] === '样品')[1].startsWith("'\t="));
assert.ok(negativeRows.find(row => row[0] === '源文件')[1].startsWith("'@"));

// Report lookup uses original row indices after scan filtering, not array offsets.
const cyclic = curve([[0,0],[1,1],[2,2],[3,3],[2,2],[1,1],[0,0]]);
cyclic.points.forEach((p,i) => {p.e = [0,1,2,3,2,1,0][i];});
const down = selectScan([cyclic],'down').curves[0];
const downFit = fitTafelLine(down,{min:0,max:3},{...options,scan:'down'});
const downReport = parse(buildTafelFitCsv(downFit,down));
assert.deepEqual(downReport.slice(downReport.findIndex(row => row[0] === '原始点序')+1).map(row => +row[0]), [4,5,6,7]);

const large = curve([[0,1.1],[1,2.8],[2,5.2],[3,6.8],[4,9.1]].map(([x,y]) => [x+1e12,y]));
const largeFit = fitTafelLine(large,{min:1e12,max:1e12+4},options);
const largeReport = parse(buildTafelFitCsv(largeFit,large));
const largeDetails = largeReport.slice(largeReport.findIndex(row => row[0] === '原始点序')+1);
assert.ok(Math.abs(largeDetails.reduce((n,row) => n + (+row[4]) ** 2,0) - largeFit.sse) < 1e-12);
const constant = curve([[0,5],[1,5],[2,5]]), constantFit = fitTafelLine(constant,{min:0,max:2},options);
assert.equal(parse(buildTafelFitCsv(constantFit,constant)).find(row => row[0] === 'R平方(COD)')[1], '不可用');

assert.throws(() => buildTafelFitCsv(fit,hidden), /样品不一致/);
const missing = structuredClone(first); missing.plotted[fit.indices[0]] = null;
assert.throws(() => buildTafelFitCsv(fit,missing), /坐标缺失或无效/);
assert.throws(() => buildTafelFitCsv({...fit,indices:[0,0,3,4]},first), /点序或点数不完整/);
assert.throws(() => buildTafelFitCsv({...fit,slope:Infinity},first), /统计值无效/);
assert.throws(() => buildTafelFitCsv({...fit,indices:[0,3,4,99]},first), /坐标缺失或无效/);
const invalidCoordinates = structuredClone(first); invalidCoordinates.plotted[fit.indices[0]].x = Infinity;
assert.throws(() => buildTafelFitCsv(fit,invalidCoordinates), /坐标缺失或无效/);

// Independent numeric regression: X=log10(I/mA), η=.12+.06X. Therefore
// η=0 -> X=-2 -> I0=.01 mA, never 10 mA. Orthogonal residuals leave a/b exact.
const near = (actual, expected, tolerance=1e-11) => assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)), `${actual} != ${expected}`);
const calibrated = curve([-4,-3,-2,-1,0].map((x,index)=>[x,.12+.06*x+[.001,-.002,.002,-.002,.001][index]]));
const calibrationFit = fitTafelLine(calibrated,{min:-4,max:0},options);
const expectedSlopeSE = Math.sqrt(14e-6 / 3 / 10);
const t95df3 = 3.182446305284263; // independent two-sided 95% Student-t reference
near(calibrationFit.slope,.06); near(calibrationFit.intercept,.12); near(calibrationFit.slopeSE,expectedSlopeSE);
for (const basis of ['current','density']) {
  const currentFit = {...calibrationFit,basis};
  const derived = tafelDerivedMetrics(currentFit);
  near(derived.exchange.value,.01); assert.notEqual(derived.exchange.value,10);
  assert.equal(derived.exchange.symbol,basis==='current'?'I₀':'j₀');
  assert.equal(derived.exchange.unit,basis==='current'?'mA':'mA cm⁻²');
  assert.equal(derived.slopeCI.level,.95); assert.equal(derived.slopeCI.dof,3);
  near(derived.slopeCI.low,(.06-t95df3*expectedSlopeSE)*1000);
  near(derived.slopeCI.high,(.06+t95df3*expectedSlopeSE)*1000);
  const raw = parse(buildTafelCsv([calibrated],'up',formulas,axes,{masks:{},fit:currentFit}));
  const rawMetric = key=>raw[1][raw[0].indexOf(key)];
  near(+rawMetric('交换电流数值'),derived.exchange.value);
  assert.equal(rawMetric('交换电流单位'),derived.exchange.unit);
  assert.equal(rawMetric('交换电流量'),derived.exchange.symbol);
  near(+rawMetric('斜率置信区间下限_mV_per_dec'),derived.slopeCI.low);
  near(+rawMetric('斜率置信区间上限_mV_per_dec'),derived.slopeCI.high);
  const report = parse(buildTafelFitCsv(currentFit,calibrated)), get=key=>report.find(row=>row[0]===key);
  near(+get(derived.exchange.label)[1],derived.exchange.value);
  assert.equal(get(derived.exchange.label)[3],derived.exchange.unit);
  near(+get('斜率95%置信区间下限')[1],derived.slopeCI.low);
  near(+get('斜率95%置信区间上限')[1],derived.slopeCI.high);
  assert.match(get('派生结果说明')[1],/不含选区和实验参数不确定度/);
}
for (const [slope,intercept,expectedStatus] of [[0,.12,/不适用/],[.001,-1,/溢出/],[.001,1,/下溢/]]) {
  const result=tafelDerivedMetrics({...calibrationFit,slope,intercept});
  assert.equal(result.exchange.value,null); assert.match(result.exchange.status,expectedStatus);
  const report=buildTafelFitCsv({...calibrationFit,slope,intercept},calibrated);
  assert.ok(!report.includes('Infinity')&&!report.includes('NaN'));
  const derivedRow=parse(report).find(row=>row[0]===result.exchange.label);
  assert.equal(derivedRow[1],'');
}
console.log('PASS: complete signed Tafel CSV and exact fitted rows; I0=.01 mA (not10), density j0 units, shared screen/export derived values and independent t95 slope interval; zero slope/exponent overflow/underflow remain explicit without fabricated numeric values.');
