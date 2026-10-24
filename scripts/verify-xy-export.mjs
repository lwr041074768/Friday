import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { unzipSync, strFromU8 } from 'fflate';

const require = createRequire(import.meta.url);
const modules = { fflate: pathToFileURL(require.resolve('fflate')).href };
for (const name of ['xy-origin-export', 'xy-origin-session', 'xy-data-export']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    if (!modules[dependency]) throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { buildXyOriginExport } = await import(modules['xy-origin-export']);
const { createXyOriginExportSession } = await import(modules['xy-origin-session']);
const { buildXyDataFile } = await import(modules['xy-data-export']);
const id = '11111111-2222-4333-8444-555555555555';
const base = { color: '#2374d5', visible: true, unit: 'A', resistance: '', area: '', compensation: 'unknown', invalid: 0 };
const xrdCurves = [
  { ...base, id: 'a', name: '=Fe & <Co>\t"样品"', source: 'measured-a.mdi',
    points: [{ e: 10, current: 100 }, { e: 10.02, current: 200 }, { e: 10.04, current: -20 }],
    plotted: [{ x: 10, y: .5, e: 10, current: 100, index: 0 }, null, { x: 10.04, y: -.1, e: 10.04, current: -20, index: 2 }] },
  { ...base, id: 'b', name: '隐藏样品', source: 'measured-b.txt', visible: false,
    points: [{ e: 20.123456789012345, current: 4 }, { e: 21, current: 8 }],
    plotted: [{ x: 20.123456789012345, y: 5.5, e: 20.123456789012345, current: 4, index: 0 }, { x: 21, y: 6, e: 21, current: 8, index: 1 }] },
];
const xrd = { kind: 'xrd', curves: xrdCurves, xLabel: '2θ / °', yLabel: 'Intensity / a.u.', settings: { normalize: true, stack: true, offset: 5 } };
const inputSnapshot = JSON.stringify(xrd);
const payload = buildXyOriginExport(xrd, id);
assert.equal(payload.schema, 'xy-origin/v1');
assert.deepEqual(payload.columns.map(c => c.role), ['x','y','x','y']);
assert.deepEqual(payload.samples[0].rows, [[10,100,10,.5], [10.02,200,null,null], [10.04,-20,10.04,-.1]]);
assert.equal(payload.samples[1].visible, false);
assert.equal(payload.samples[1].rows.length, 2);
assert.equal(payload.samples[1].rows[0][0], 20.123456789012345);
assert.deepEqual(payload.settings, { normalize: true, stack: true, offset: 5 });
assert.match(payload.samples[1].note, /隐藏/);
assert.equal(JSON.stringify(xrd), inputSnapshot);
assert.ok(!('formulas' in payload) && !('scan' in payload), 'XRD must not acquire LSV formulas or scan semantics');
assert.ok(!JSON.stringify(payload).includes('eta10'));

const eisCurves = [
  { ...base, id: 'raw', name: '原始虚部', source: 'a.bin', imaginary: 'raw', points: [{ e: 1, current: -3, frequency: 10000 }, { e: 2, current: .25 }], plotted: [{x:1,y:3,e:1,current:-3,index:0},{x:2,y:-.25,e:2,current:.25,index:1}] },
  { ...base, id: 'negative', name: '已取负虚部', source: 'b.csv', imaginary: 'negative', visible: false, points: [{ e: .123456789012345, current: 4, frequency: .0123456789012345 }, { e: 7, current: -2, frequency: 10 }, { e: 8, current: -1, frequency: NaN }], plotted: [{x:.123456789012345,y:4,e:.123456789012345,current:4,index:0},null,{x:8,y:-1,e:8,current:-1,index:2}] },
];
const eis = { kind: 'eis', curves: eisCurves, xLabel: 'Z′ / Ω', yLabel: '−Z″ / Ω', plotStyle: 'scatter', equalUnits: true };
const ep = buildXyOriginExport(eis, id);
assert.deepEqual(ep.columns.map(c => c.role), ['x','y','y','y','data','x','y']);
assert.deepEqual(ep.samples[0].rows, [[1,-3,-3,3,10000,1,3],[2,.25,.25,-.25,null,2,-.25]]);
assert.deepEqual(ep.samples[1].rows, [[.123456789012345,4,-4,4,.0123456789012345,.123456789012345,4],[7,-2,2,-2,10,null,null],[8,-1,1,-1,null,8,-1]]);
assert.equal(ep.samples[1].imaginary, 'negative');
assert.equal(ep.samples[1].visible, false);
// Origin gets exactly the old B/C/G/H values; ordinary data files stay full.
const eisBefore = JSON.stringify(eis);
const originEis = buildXyOriginExport(eis, id, 'origin');
assert.deepEqual(originEis.columns.map(c => c.key), ['real','importedImaginary','plotX','plotY']);
assert.deepEqual(originEis.columns.map(c => c.role), ['x','y','x','y']);
assert.deepEqual(originEis.columns.map(c => c.unit), ['ohm','ohm','ohm','ohm']);
originEis.samples.forEach((sample, index) => assert.deepEqual(sample.rows, ep.samples[index].rows.map(row => [row[0],row[1],row[5],row[6]])));
assert.equal(originEis.samples[1].visible, false);
assert.deepEqual(originEis.samples[1].rows[1], [7,-2,null,null]);
assert.equal(JSON.stringify(eis), eisBefore);
assert.match(originEis.samples[0].note, /四列/);
assert.doesNotMatch(originEis.samples[0].note, /频率缺失/);

const files = {};
for (const [kind, options] of [['xrd',xrd],['eis',eis]]) {
  for (const format of ['txt','csv','tsv','xlsx']) {
    const file = buildXyDataFile(options, format);
    files[`${kind}.${format}`] = file.bytes;
    if (format !== 'xlsx') {
      const data = strFromU8(file.bytes);
      assert.deepEqual([...file.bytes.slice(0,3)], [239,187,191]);
      assert.ok(data.includes('样品备注'));
      assert.ok(data.includes('隐藏样品') || data.includes('已取负虚部'));
      assert.ok(data.includes(String(kind === 'xrd' ? xrdCurves[1].points[0].e : .0123456789012345)));
      if (kind === 'xrd') assert.ok(data.includes("'=Fe"), 'Spreadsheet metadata must not become a formula');
      if (format === 'tsv' && kind === 'eis') {
        const lines = data.replace(/^\uFEFF/,'').split('\r\n');
        assert.deepEqual(lines[2].split('\t').slice(1,8), ['2','0.25','0.25','-0.25','','2','-0.25']);
        assert.deepEqual(lines[3].split('\t').slice(1,8), ['','','','','','',''], 'Short samples must not be zero padded');
      }
    } else {
      const entries = unzipSync(file.bytes);
      const sheet = strFromU8(entries['xl/worksheets/sheet1.xml']);
      const notes = strFromU8(entries['xl/worksheets/sheet2.xml']);
      assert.ok(!sheet.includes('<f>') && !notes.includes('<f>'));
      assert.ok(strFromU8(entries['xl/workbook.xml']).includes(kind.toUpperCase() + ' 数据'));
      assert.match(sheet, kind === 'xrd' ? /dimension ref="A1:J4"/ : /dimension ref="A1:P4"/);
      if (kind === 'xrd') {
        assert.ok(sheet.includes('&amp; &lt;Co&gt;'));
        assert.doesNotMatch(sheet, /<c r="[DE]3"/);
        assert.doesNotMatch(sheet, /<c r="[G-J]4"/);
        assert.ok(notes.includes('&quot;normalize&quot;:true'));
      } else {
        assert.doesNotMatch(sheet, /<c r="[B-H]4"/);
        assert.match(sheet, /<c r="N2"><v>0\.0123456789012345<\/v><\/c>/);
        assert.match(sheet, /<c r="E3"><v>-0\.25<\/v><\/c>/);
      }
    }
  }
}

const session = createXyOriginExportSession();
const first = session.prepare(xrd); first.downloadRequested = true;
assert.equal(session.prepare(xrd), first);
assert.equal(session.prepare({...xrd, curves:xrdCurves.map(c=>({...c,color:'#000000'}))}), first, 'Color-only changes do not duplicate data downloads');
assert.equal(session.prepare({...xrd, settings:{normalize:true,stack:true,offset:5}}), first);
assert.equal(session.prepare({...xrd, settings:{offset:5,stack:true,normalize:true}}), first, 'Equivalent settings key order must reuse the same download');
const settingsChange = session.prepare({...xrd,settings:{normalize:true,stack:true,offset:6}});
assert.notEqual(settingsChange.payload.requestId, first.payload.requestId);
assert.equal(settingsChange.downloadRequested, false);
const refreshed = session.prepare(xrd, true);
assert.notEqual(refreshed.payload.requestId, first.payload.requestId);
const compactSession = session.prepare(eis);
assert.notEqual(compactSession.payload.requestId, refreshed.payload.requestId);
assert.deepEqual(compactSession.payload.columns.map(c=>c.key),originEis.columns.map(c=>c.key));
assert.deepEqual(compactSession.payload.samples.map(s=>s.rows),originEis.samples.map(s=>s.rows));
assert.throws(()=>buildXyOriginExport({...xrd,curves:[]}), /先导入/);
assert.throws(()=>buildXyOriginExport({...xrd,curves:Array(21).fill(xrdCurves[0])}), /20/);
assert.throws(()=>buildXyOriginExport({...xrd,curves:[{...xrdCurves[0],plotted:xrdCurves[0].plotted.slice(1)}]}), /完整曲线/);
assert.throws(()=>buildXyOriginExport({...xrd,curves:[{...xrdCurves[0],plotted:[{...xrdCurves[0].plotted[0],index:2},null,xrdCurves[0].plotted[2]]}]}), /点序/);
assert.throws(()=>buildXyOriginExport({...xrd,settings:{bad:Infinity}}), /设置值/);
assert.throws(()=>buildXyOriginExport({...xrd,xLabel:'\0'}), /轴标题/);
assert.throws(()=>buildXyOriginExport(xrd, 'not-a-uuid'), /UUID/);
assert.throws(()=>buildXyOriginExport({...xrd,curves:[{...xrdCurves[0],points:Array(500001).fill(xrdCurves[0].points[0])}]}), /500,000/);
const errored = buildXyOriginExport({...xrd,curves:[{...xrdCurves[0],error:'无效设置',plotted:[]}]});
assert.deepEqual(errored.samples[0].rows[0], [10,100,null,null]);
if (process.argv[2]) {
  await mkdir(process.argv[2], {recursive:true});
  for (const [name, bytes] of Object.entries(files)) await writeFile(`${process.argv[2]}/${name}`, bytes);
  await writeFile(`${process.argv[2]}/xrd.lsvdata`, JSON.stringify(payload));
  await writeFile(`${process.argv[2]}/eis.lsvdata`, JSON.stringify(ep));
  await writeFile(`${process.argv[2]}/eis-origin.lsvdata`, JSON.stringify(originEis));
}
console.log('PASS: XRD raw/transformed columns, EIS signed imaginary/frequency, hidden/unequal/gapped samples, full precision, TXT/CSV/TSV/XLSX structure, text metadata safety, session reuse and limits.');
