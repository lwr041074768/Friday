import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { unzipSync, strFromU8 } from 'fflate';

const require = createRequire(import.meta.url);
const modules = { fflate: pathToFileURL(require.resolve('fflate')).href };
for (const name of ['lsv-math', 'scan-branches', 'lsv-target', 'lsv-origin-export', 'lsv-data-export']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    if (!modules[dependency]) throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { plotCurves, INITIAL_X, INITIAL_Y } = await import(modules['lsv-math']);
const { buildLsvDataFile } = await import(modules['lsv-data-export']);
const { buildOriginExport } = await import(modules['lsv-origin-export']);
const base = { color: '#2374d5', visible: true, unit: 'A', resistance: '', irVoltage: '.97', area: '1', compensation: 'raw' };
const raw = [
  { ...base, id: 'one', name: '=HYPERLINK("bad"),硒\t铁\n&<>', source: 'one,"source".txt', points: [{ e: .2, current: .001 }, { e: .3, current: .005 }, { e: .5, current: .02 }, { e: .4, current: .015 }, { e: .3, current: .005 }] },
  { ...base, id: 'two', name: '样品2 & <Fe>', source: 'two.csv', irVoltage: '.1', visible: false, points: [{ e: .123456789012345, current: .002 }, { e: .4, current: .02 }] },
];
const curves = plotCurves(raw, { x: INITIAL_X, y: INITIAL_Y, resistance: '0', fraction: '100', irMode: 'voltage', voltage: '0' }).curves;
curves[0].plotted[1] = null;
const original = JSON.stringify(curves);
const files = Object.fromEntries(['txt', 'csv', 'tsv', 'xlsx'].map(format => [format, buildLsvDataFile(curves, 'all', format)]));
assert.equal(JSON.stringify(curves), original, 'Export must not mutate current samples or their IR');
for (const format of ['txt', 'csv', 'tsv']) {
  assert.deepEqual([...files[format].bytes.slice(0, 3)], [239, 187, 191]);
  const text = strFromU8(files[format].bytes);
  assert.ok(text.includes('样品备注'));
  assert.ok(text.includes('0.123456789012345'));
  assert.ok(text.includes("'=HYPERLINK"));
  assert.ok(text.includes('全部扫描段'));
  assert.ok(text.includes('该样品当前隐藏'));
}
const parts = unzipSync(files.xlsx.bytes);
const sheet = strFromU8(parts['xl/worksheets/sheet1.xml']);
const notes = strFromU8(parts['xl/worksheets/sheet2.xml']);
assert.match(sheet, /dimension ref="A1:J6"/);
assert.match(sheet, /<c r="B3"><v>0.3<\/v><\/c>/);
assert.doesNotMatch(sheet, /<c r="[DE]3"/);
assert.match(sheet, /<c r="G2"><v>0.123456789012345<\/v><\/c>/);
assert.doesNotMatch(sheet, /<c r="[G-J][4-6]"/);
assert.ok(!sheet.includes('<f>') && !notes.includes('<f>'), 'Metadata must remain text');
assert.ok(sheet.includes('&amp;&lt;&gt;'));
assert.ok(notes.includes('该样品当前隐藏'));
assert.ok(notes.includes('全部扫描段'));
// Branch selection uses original potential/index, not corrected X or viewport.
const up = buildOriginExport(curves, 'up');
assert.deepEqual(up.samples[0].rows.map(row => row.slice(0, 2)), raw[0].points.slice(0, 3).map(point => [point.e, point.current]));
assert.deepEqual(up.samples[0].rows[1], [.3, .005, null, null]);
assert.equal(up.samples[1].rows.length, 2, 'Hidden samples retain their selected branch');
const down = buildOriginExport([curves[0]], 'down');
assert.deepEqual(down.samples[0].rows.map(row => row.slice(0, 2)), raw[0].points.slice(2).map(point => [point.e, point.current]));
assert.throws(() => buildOriginExport(curves, 'down'), /样品2.*没有反向扫描段/);
assert.throws(() => buildOriginExport([curves[1]], 'down'), /没有反向扫描段/);
const cyclic = plotCurves([{...base, id:'cycles',name:'多循环',source:'cycles.txt',points:[0,1,2,1,0,1,2,1,0].map((e,index)=>({e,current:index/1000}))}], {x:INITIAL_X,y:INITIAL_Y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves[0];
cyclic.plotted[3] = null;
// A derived X reversal must not reverse the meaning of the raw scan direction.
cyclic.plotted[1].x = -100;
const cyclicUp = buildOriginExport([cyclic], 'up').samples[0];
const cyclicDown = buildOriginExport([cyclic], 'down').samples[0];
assert.deepEqual(cyclicUp.rows.map(row=>row[1]), [0,.001,.002,null,.004,.005,.006]);
assert.deepEqual(cyclicDown.rows.map(row=>row[1]), [.002,.003,.004,null,.006,.007,.008]);
assert.deepEqual(cyclicDown.rows[1], [1,.003,null,null]);
assert.deepEqual(cyclicDown.rows[3], [null,null,null,null]);
assert.equal(cyclicUp.rows[1][2], -100);
for (const scan of ['up','down']) {
  for (const format of ['txt','csv','tsv']) {
    const text=strFromU8(buildLsvDataFile([cyclic],scan,format).bytes);
    const separator=format==='csv'?',':'\t';
    const table=text.split('\r\n\r\n样品备注')[0].replace(/^\uFEFF/,'').split('\r\n');
    assert.equal(table.length,8);
    assert.equal(table[4],separator.repeat(4),'Disconnected cycles need a blank data row');
    const rowValues=table.slice(1).map(line=>line.split(separator).slice(1).map(v=>v===''?null:Number(v)));
    assert.deepEqual(rowValues,scan==='up'?cyclicUp.rows:cyclicDown.rows);
  }
  const xml=strFromU8(unzipSync(buildLsvDataFile([cyclic],scan,'xlsx').bytes)['xl/worksheets/sheet1.xml']);
  assert.match(xml,/dimension ref="A1:E8"/);
  assert.match(xml,/<row r="5"><\/row>/);
}
assert.equal(JSON.stringify(curves),original,'Scan export must not modify raw or applied data');

// η metadata uses current IR-corrected chart X/Y in every format; the full raw
// and chart tables retain immutable source data and applied IR for Origin.
const baselinePoints=Object.freeze([[.2,0],[.25,5],[.3,20],[.35,22],[.4,5],[.45,6],[.47,8],[.4817,12],[.5,20],[.55,30],[.52,20],[.49,12],[.46,8],[.4,0]].map(([e,j])=>Object.freeze({e,current:j/1000})));
const sourceBefore=JSON.stringify(baselinePoints);
for(const irVoltage of ['0','.97','-1']) {
  const applied=plotCurves([{...base,id:'baseline',name:'baseline',source:'baseline.csv',points:baselinePoints,irVoltage}],{x:INITIAL_X,y:INITIAL_Y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves;
  for(const scan of ['all','up','down']) {
    const payload=buildOriginExport(applied,scan);
    const sample=payload.samples[0];
    const expected=(scan==='down'?247.35:248.2)-Number(irVoltage)*10;
    assert.ok(Math.abs(sample.eta10MV-expected)<1e-8,'LSV Origin η metadata must use current chart IR exactly once');
    assert.equal(sample.ir,Number(irVoltage));
    assert.match(sample.note,/X 已包含当前应用的 IR，不再次扣除 IR/);
    assert.doesNotMatch(sample.note,/未额外应用软件 iR 校正|软件 iR=0/);
    for(const format of ['txt','csv','tsv','xlsx']) {
      const file=buildLsvDataFile(applied,scan,format);
      if(format==='xlsx') {
        const exported=unzipSync(file.bytes);
        const metadata=strFromU8(exported['xl/worksheets/sheet2.xml']);
        assert.match(metadata,/按当前 IR 校正曲线/);
        assert.equal(Number(/<c r="F2"><v>([^<]+)<\/v><\/c>/.exec(metadata)[1]),sample.eta10MV);
        assert.equal(Number(/<c r="E2"><v>([^<]+)<\/v><\/c>/.exec(metadata)[1]),Number(irVoltage));
        const chart=strFromU8(exported['xl/worksheets/sheet1.xml']);
        assert.equal(Number(/<c r="D3"><v>([^<]+)<\/v><\/c>/.exec(chart)[1]),sample.rows[1][2]);
      } else {
        const exported=strFromU8(file.bytes);
        assert.match(exported,/按当前 IR 校正曲线/);
        assert.ok(exported.includes(String(sample.eta10MV)));
        assert.ok(exported.includes(String(sample.rows[1][2])),'Delimited tables retain current IR-corrected X at full precision');
      }
    }
  }
  const firstNonzero=applied[0].plotted[1];
  assert.ok(Math.abs(firstNonzero.x-(.25-Number(irVoltage)*.005+.059*13.65+.197))<1e-10);
}
assert.equal(JSON.stringify(baselinePoints),sourceBefore,'Exports must not change frozen imported source points');
const sourceGap=plotCurves([{...base,id:'source-gap',name:'source-gap',source:'gap.csv',points:baselinePoints.map((point,index)=>index===6?{...point,current:NaN}:point)}],{x:INITIAL_X,y:INITIAL_Y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves;
assert.equal(buildOriginExport(sourceGap,'all').samples[0].eta10MV,null,'Invalid source/chart points cannot become an invented η result');
const correctedSource=plotCurves([{...base,id:'compensated',name:'compensated',source:'instrument-corrected.csv',compensation:'corrected',points:baselinePoints}],{x:INITIAL_X,y:INITIAL_Y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves;
const compensatedExport=buildOriginExport(correctedSource,'all').samples[0];
assert.equal(compensatedExport.eta10MV,null);
assert.match(compensatedExport.note,/原数据已补偿.*避免重复补偿/);
assert.ok(compensatedExport.rows.every(row=>row[2]===null&&row[3]===null),'An invalid double-compensated chart has no available derived columns or η');
const correctedZeroIR=plotCurves([{...base,id:'compensated',name:'compensated',source:'instrument-corrected.csv',compensation:'corrected',points:baselinePoints,irVoltage:'0'}],{x:INITIAL_X,y:INITIAL_Y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves;
const correctedZeroExport=buildOriginExport(correctedZeroIR,'all').samples[0];
assert.ok(Math.abs(correctedZeroExport.eta10MV-248.2)<1e-8,'Already-compensated data can be exported with additional software IR=0');
assert.equal(correctedZeroExport.compensation,'corrected');
assert.throws(() => buildLsvDataFile([], 'all', 'csv'));
assert.throws(() => buildLsvDataFile([{ ...curves[0], plotted: curves[0].plotted.slice(1) }], 'all', 'xlsx'), /完整曲线/);
const ten = Array.from({ length: 10 }, (_, index) => ({ ...curves[1], id: String(index), name: `样品${index}` }));
assert.match(strFromU8(unzipSync(buildLsvDataFile(ten, 'up', 'xlsx').bytes)['xl/worksheets/sheet1.xml']), /dimension ref="A1:AX3"/);
const excessive = Array.from({ length: 10 }, () => ({ ...curves[1], points: Array(50001).fill(curves[1].points[0]), plotted: Array(50001).fill(curves[1].plotted[0]) }));
assert.throws(() => buildLsvDataFile(excessive, 'all', 'csv'), /500,000/);
if (process.argv[2]) {
  await mkdir(process.argv[2], { recursive: true });
  for (const [format, file] of Object.entries(files)) await writeFile(`${process.argv[2]}/fixture.${format}`, file.bytes);
}
console.log('PASS: selected forward/reverse scans, full all-scan data, multiple cycles and blank separators, live IR-corrected η metadata in TXT/CSV/TSV/XLSX/Origin, current chart columns, frozen source data, source compensation/gaps, hidden samples, precision, metadata escaping and export limits.');
