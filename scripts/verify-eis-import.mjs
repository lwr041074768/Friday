import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const modules = { fflate: pathToFileURL(require.resolve('fflate')).href };
for (const name of ['chi-lsv-bin', 'chi-eis-bin', 'xrd-mdi', 'lsv-import', 'eis-data']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    if (!modules[dependency]) throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { parseText, parseDataFile, rawPairs, rawPointsFor, axisRole, eisImaginaryConvention, isBodeColumn } = await import(modules['lsv-import']);
const { parseChiEisBin } = await import(modules['chi-eis-bin']);
const { plotEisCurves, buildEisCsv } = await import(modules['eis-data']);
const chi = parseText('Init E (V) = 0.415\nFreq/Hz, Z\'/ohm, Z"/ohm, Z/ohm, Phase/deg\n100000,1,0.3,1.04,16.7\n100,2,-0.7,2.12,-19.3', 'CHI', 'fixture.txt', 'eis');
assert.deepEqual(chi.headers, ['Freq/Hz', "Z'/ohm", 'Z"/ohm', 'Z/ohm', 'Phase/deg']);
assert.deepEqual(rawPairs(chi, 'eis').map(p => [p.e, p.current]), [[1, 2]]);
assert.equal(axisRole('−Z″ / Ω', 'eis'), 'y');
assert.equal(axisRole("Z'' / kΩ", 'eis'), 'y');
assert.equal(eisImaginaryConvention('CoFe2O4 -Zimag/ohm'), 'negative');
assert.equal(eisImaginaryConvention('−Z″ / Ω'), 'negative');
assert.equal(eisImaginaryConvention('Z"/ohm'), 'raw');
assert.equal(isBodeColumn('Z/ohm'), true);
const wide = parseText('Zreal1,-Zimag1,Zreal2,-Zimag2\n1,-0.2,2,0.3\n2,0.5,3,0.6\n,,,4,0.4', 'Origin', 'fixture.csv', 'eis');
assert.deepEqual(rawPairs(wide, 'eis').map(p => [p.e, p.current]), [[0, 1], [2, 3]]);
assert.equal(rawPointsFor(wide, rawPairs(wide, 'eis')[0]).skipped, 1);
const base = { color: '#2374d5', visible: true, unit: 'A', resistance: '', area: '', compensation: 'unknown', source: 'source.txt' };
const curves = [
  { ...base, id: 'one', name: '=metadata,"quoted"', imaginary: 'raw', points: [{ e: 1, current: .3, frequency: 1e5 }, { e: 2, current: -.7, frequency: 100 }] },
  { ...base, id: 'two', name: '样品二', imaginary: 'negative', visible: false, points: [{ e: 3, current: -.3 }, { e: 4, current: .7 }, { e: 5, current: .1 }] },
];
const before = JSON.stringify(curves), plotted = plotEisCurves(curves);
assert.deepEqual(plotted[0].plotted.map(p => p.y), [-.3, .7]);
assert.deepEqual(plotted[1].plotted.map(p => p.y), [-.3, .7, .1]);
const csv = buildEisCsv(curves);
assert.equal(JSON.stringify(curves), before);
assert.ok(csv.includes('100000'));
assert.ok(csv.includes("'=metadata"));
assert.ok(csv.includes('样品二,source.txt,已取负 −Z″,否'));
const roundTrip = parseText(csv, 'Roundtrip', 'export.csv', 'eis');
assert.deepEqual(rawPairs(roundTrip, 'eis').map(p => [p.e, p.current]), [[0, 1], [4, 5]]);
assert.equal(roundTrip.rows.length, 3);
assert.equal(rawPairs(parseText(buildEisCsv([curves[0]]), 'one', 'one.csv', 'eis'), 'eis').length, 1);
assert.throws(() => buildEisCsv([]));
assert.throws(() => parseChiEisBin(new Uint8Array(2914), 'bad', 'bad.bin'));
assert.equal(rawPairs(parseText('Frequency,Phase\n100,40\n10,50', 'bode', 'bode.txt', 'eis'), 'eis').length, 0);
// Shared CSV parsing still supports quoted sample names and embedded delimiters.
const quoted = parseText('"Potential/V","Current/A"\n"0.1","0.002"\n"0.2","0.003"');
assert.equal(quoted.rows[0][0], .1);

async function verifyBinPair(txtPath, binPath) {
  const txt = parseText(await readFile(txtPath, 'utf8'), 'Actual TXT', basename(txtPath), 'eis');
  const bytes = await readFile(binPath);
  const [bin] = await parseDataFile(new File([bytes], basename(binPath)), 'eis');
  assert.equal(bin.rows.length, txt.rows.length);
  for (let n = 0; n < txt.rows.length; n++) for (let col = 0; col < 3; col++) {
    const expected = txt.rows[n][col], actual = bin.rows[n][col];
    assert.ok(Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * .00051), `${binPath}: BIN/TXT mismatch row ${n}, col ${col}`);
  }
  console.log(`Actual BIN/TXT: ${new TextDecoder().decode(bytes.subarray(61, 66))}, ${bin.rows.length} points match.`);
  return { txt, bin, bytes };
}

if (process.argv[2] && process.argv[3]) {
  const { txt, bin, bytes } = await verifyBinPair(process.argv[2], process.argv[3]);
  assert.equal(txt.rows.length, 77);
  assert.equal(txt.rows.filter(row => row[2] > 0).length, 22);
  const rejected = (change, reason) => {
    const copy = new Uint8Array(bytes), view = new DataView(copy.buffer);
    change(copy, view);
    assert.throws(() => parseChiEisBin(copy, 'invalid', 'invalid.bin'), reason);
  };
  rejected((copy) => copy.set(new TextEncoder().encode('X9999'), 61), /头部标识“X9999”尚未验证/);
  rejected((_, view) => view.setUint32(0, 0, true), /文件格式标记/);
  rejected((_, view) => view.setUint32(4, 2, true), /IMP 交流阻抗/);
  rejected((_, view) => view.setUint32(29, 1, true), /带备注或扩展字段/);
  rejected((_, view) => view.setUint32(650, 660, true), /仪器字段或头部布局/);
  rejected((_, view) => view.setUint32(606, 50001, true), /超过 50,000 点/);
  rejected((_, view) => view.setUint32(614, 78, true), /点数与数据长度不一致/);
  rejected((_, view) => view.setFloat32(1682 + 8, NaN, true), /第 1 点含有无效数值/);
  rejected((_, view) => view.setFloat32(1682 + 12, Infinity, true), /第 1 点含有无效数值/);
  rejected((_, view) => { view.setFloat32(1682, 0, true); view.setFloat32(1682 + 4, 0, true); }, /第 1 点的频率字段/);
  rejected((_, view) => view.setFloat32(1682 + 4, 1, true), /第 1 点的频率字段/);
  rejected((_, view) => { const first = view.getFloat32(1682, true); view.setFloat32(1698, first, true); view.setFloat32(1702, first, true); }, /第 2 点不符合.*递减顺序/);
  assert.throws(() => parseChiEisBin(new Uint8Array(bytes.subarray(0, -1)), 'short', 'short.bin'), /点数与数据长度不一致/);
  assert.throws(() => parseChiEisBin(new Uint8Array([...bytes, 0]), 'extra', 'extra.bin'), /点数与数据长度不一致/);
  const padded = new Uint8Array(bytes.length + 17); padded.set(bytes, 17);
  assert.deepEqual(parseChiEisBin(padded.subarray(17), 'view', 'view.bin').rows, bin.rows);
  for (const binPath of process.argv.slice(5)) await verifyBinPair(binPath.replace(/\.bin$/i, '.txt'), binPath);
  if (process.argv[4]) {
    const origin = parseText(await readFile(process.argv[4], 'utf8'), 'Origin', 'Origin.csv', 'eis');
    const pairs = rawPairs(origin, 'eis');
    assert.equal(pairs.length, 6);
    assert.deepEqual(pairs.map(p => rawPointsFor(origin, p).points.filter(v=>Number.isFinite(v.e)&&Number.isFinite(v.current)).length), [81, 85, 82, 85, 85, 85]);
  }
  console.log('Actual EIS: TXT/BIN 77 points match; 22 inductive points preserved; six Origin XY pairs match.');
}
console.log('EIS import, signed Nyquist, wide export, malformed BIN rejection and shared text regression checks passed.');
