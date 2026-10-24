import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Optional arguments are external MDI files or directories. Source data is
// only read: nothing is copied into the project or modified on disk.
const require = createRequire(import.meta.url);
const modules = { fflate: pathToFileURL(require.resolve('fflate')).href };
for (const name of ['chi-lsv-bin', 'chi-eis-bin', 'xrd-mdi', 'lsv-import']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g, (_, start, dependency, end) => {
    assert.ok(modules[dependency], `Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { parseXrdMdi } = await import(modules['xrd-mdi']);
const { parseDataFile, rawPairs } = await import(modules['lsv-import']);
const bytes = text => new TextEncoder().encode(text);
const fixture = (header = '20 .025 10 Cu 1.54059 20.05 3', data = '12.5 -1 19') => bytes(`Synthetic MDI\r\n${header}\r\n${data}\r\n`);
const parsed = parseXrdMdi(fixture(), 'fixture', 'fixture.mdi');
assert.deepEqual(parsed.rows, [[20, 12.5], [20.025, -1], [20.05, 19]]);
assert.equal(parsed.source, 'fixture.mdi');
assert.deepEqual(rawPairs(parsed, 'xrd').map(pair => [pair.e, pair.current]), [[0, 1]]);
assert.deepEqual(parseXrdMdi(fixture(undefined, '12.5 -1 19 -1 0 0 0 0\x1a'), 'fixture', 'fixture.mdi').rows, parsed.rows);
assert.deepEqual(parseXrdMdi(fixture('20.05 -.025 10 Cu 1.54059 20 3'), 'descending', 'descending.mdi').rows.map(row => row[0]), [20.05, 20.025, 20]);
assert.equal(parseXrdMdi(fixture('20 .03 1 CU 1.5406 20.08 3'), 'limit', 'limit.mdi').rows.at(-1)[0], 20.06);
for (const [header, data, reason] of [
  ['20 0 1 CU 1.54 20.05 3', undefined, /步长/],
  ['20 .025 1 CU 1.54 20.05 2.5', undefined, /声明点数/],
  ['20 .025 1 CU 1.54 20.075 3', undefined, /不一致/],
  ['20 .025 1 CU 1.54 20.04 3', undefined, /不一致/],
  ['20 -.025 1 CU 1.54 20.05 3', undefined, /方向/],
  ['20 .025 1 CU 0 20.05 3', undefined, /波长/],
  [undefined, '12.5 19', /不足/],
  [undefined, '12.5 19 20 21 -1', /额外强度/],
  [undefined, '12.5 19 20 -1 1', /额外强度/],
  [undefined, '12.5 19 20 -1 0 0 0 0 0 0 0 0', /额外强度/],
  [undefined, '12.5 NaN 20', /有效数值/],
  [undefined, '12.5 1e999 20', /超出/],
]) assert.throws(() => parseXrdMdi(fixture(header, data), 'invalid', 'invalid.mdi'), reason);
assert.throws(() => parseXrdMdi(new Uint8Array([0x50, 0x45, 0, 0]), 'document', 'document.mdi'), /ASCII/);
const [imported] = await parseDataFile(new File([fixture()], 'UPPER.MDI'), 'xrd');
assert.deepEqual(imported.rows, parsed.rows);
await assert.rejects(parseDataFile(new File([fixture()], 'not-eis.mdi'), 'eis'), /MDI 用于 XRD/);
for (const suffix of ['bin', 'raw', 'png']) {
  await assert.rejects(parseDataFile(new File(['unsupported'], `not-xrd.${suffix}`), 'xrd'), error => /MDI/.test(error.message) && !/BIN/i.test(error.message));
}
assert.equal((await parseDataFile(new File(['2theta,Intensity\n20,12\n21,14'], 'plain.csv'), 'xrd'))[0].rows.length, 2);

const paths = [];
for (const input of process.argv.slice(2)) {
  if ((await stat(input)).isDirectory()) {
    for (const entry of await readdir(input)) if (/\.mdi$/i.test(entry)) paths.push(join(input, entry));
  } else paths.push(input);
}
let accepted = 0, rejected = 0;
for (const path of paths) {
  const original = await readFile(path), text = original.toString('utf8').replace(/[\s\x1a]+$/, '');
  const lines = text.split(/\r\n?|\n/), header = lines[1].trim().split(/\s+/);
  const count = Number(header[6]), step = Number(header[1]), start = Number(header[0]);
  const tokens = lines.slice(2).join(' ').trim().split(/\s+/).map(Number);
  const extra = tokens.slice(count);
  const consistentTail = !extra.length || (extra[0] === -1 && extra.length <= 8 && extra.slice(1).every(n => n === 0));
  if (!consistentTail) {
    assert.throws(() => parseXrdMdi(original, basename(path), basename(path)), /额外强度/);
    await assert.rejects(parseDataFile(new File([original], basename(path)), 'xrd'), /额外强度/);
    rejected++;
    console.log(`Rejected inconsistent count: ${basename(path)} (${count} declared)`);
    continue;
  }
  const table = parseXrdMdi(original, basename(path), basename(path));
  const [fileTable] = await parseDataFile(new File([original], basename(path)), 'xrd');
  assert.deepEqual(fileTable.rows, table.rows, 'Upload pipeline preserves every point');
  assert.equal(table.rows.length, count);
  for (let n = 0; n < count; n++) {
    assert.equal(table.rows[n][1], tokens[n], `${basename(path)}: original intensity ${n}`);
    assert.ok(Math.abs(table.rows[n][0] - (start + n * step)) < 1e-10, `${basename(path)}: scan order/step ${n}`);
  }
  assert.deepEqual(await readFile(path), original, 'Source data remains unchanged');
  accepted++;
}
console.log(`MDI parser and import checks passed; external files: ${accepted} accepted, ${rejected} inconsistent files rejected.`);
