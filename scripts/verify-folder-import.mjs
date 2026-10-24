import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readDroppedData } = require('../desktop/folder-import.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'desktop/output');
await fs.mkdir(output, { recursive: true });
const fixtures = await fs.mkdtemp(path.join(output, 'folder-import-qa-'));
const rows = 'Potential/V,Current/A\r\n0,0.0001\r\n0.2,0.0003\r\n0.1,0.0002\r\n';
let checks = 0;
async function file(relative, contents = rows) {
  const target = path.join(fixtures, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
}
async function check(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}
function text(item) { return Buffer.from(item.data).toString('utf8'); }

const phRoot = path.join(fixtures, 'Ce-Fe');
for (const ph of [10, 11, 12, 13, 14]) {
  await file(`Ce-Fe/${ph}/LSV.txt`);
  await file(`Ce-Fe/${ph}/LSV.bin`, Buffer.from([0, 1, 255, ph]));
  await file(`Ce-Fe/${ph}/CV.txt`);
  await file(`Ce-Fe/${ph}/EIS.txt`);
  await file(`Ce-Fe/${ph}/活化.bin`);
}
for (const excluded of ['.git', 'node_modules', '__pycache__', '分析结果-已处理', '参照方法', '完整数据', 'activation']) {
  await file(`Ce-Fe/${excluded}/LSV.txt`, 'must not import');
}
await file('Ce-Fe/14/LSV_拟合结果.csv', 'must not import');
await file('Ce-Fe/14/LSV_fitted.csv', 'must not import');

await check('pH parent discovers five numeric subfolders and prefers same-directory TXT', async () => {
  const result = await readDroppedData('ph', [phRoot]);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map(item => item.relativePath), [10, 11, 12, 13, 14].map(ph => `Ce-Fe/${ph}/LSV.txt`));
  for (const item of result) {
    assert.equal(item.name, 'LSV.txt');
    assert.equal(item.sourcePath, path.resolve(fixtures, item.relativePath));
    assert.ok(item.data instanceof ArrayBuffer);
    assert.ok(Number.isFinite(item.lastModified) && item.lastModified > 0);
    assert.equal(text(item), rows, 'Original bytes and acquisition row order must be unchanged');
  }
});

await check('pH accepts multiple numeric folders without losing pH path components', async () => {
  const result = await readDroppedData('ph', [path.join(phRoot, '10'), path.join(phRoot, '12')]);
  assert.deepEqual(result.map(item => item.relativePath), ['10/LSV.txt', '12/LSV.txt']);
});

await check('TXT/BIN preference never crosses directories', async () => {
  await file('mixed/10/LSV.txt');
  const bin = await file('mixed/11/LSV.bin', Buffer.from([1, 0, 255, 7]));
  const result = await readDroppedData('ph', [path.join(fixtures, 'mixed')]);
  assert.equal(result.length, 2);
  assert.equal(result[1].sourcePath, bin);
  assert.deepEqual(Buffer.from(result[1].data), Buffer.from([1, 0, 255, 7]));
});

await check('LSV single directory automatically selects its unique logical LSV', async () => {
  const result = await readDroppedData('lsv', [path.join(phRoot, '14')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'LSV.txt');
});

await check('LSV multiple dropped roots produce one measurement per root', async () => {
  const result = await readDroppedData('lsv', [path.join(phRoot, '11'), path.join(phRoot, '13')]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(item => item.relativePath), ['11/LSV.txt', '13/LSV.txt']);
});

await check('LSV parent ambiguity requires an explicit candidate choice', async () => {
  await assert.rejects(readDroppedData('lsv', [phRoot]), /多个不同的 LSV/);
  let called = 0;
  const result = await readDroppedData('lsv', [phRoot], { selectAmbiguous: async ({ folder, candidates }) => {
    called++;
    assert.equal(folder, phRoot);
    assert.equal(candidates.length, 5);
    assert.ok(candidates.every(candidate => path.isAbsolute(candidate) && candidate.endsWith('LSV.txt')));
    return [candidates[1]];
  } });
  assert.equal(called, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourcePath, path.join(phRoot, '11/LSV.txt'));
});

await check('pH ambiguity is local to a measurement directory', async () => {
  const first = await file('ambiguous/12/LSV_1.txt');
  const second = await file('ambiguous/12/LSV_2.txt', rows + '0.3,0.0004\r\n');
  let called = 0;
  const result = await readDroppedData('ph', [path.join(fixtures, 'ambiguous')], { selectAmbiguous: async ({ folder, candidates }) => {
    called++;
    assert.equal(folder, path.dirname(first));
    assert.deepEqual(candidates, [first, second]);
    return [second];
  } });
  assert.equal(called, 1);
  assert.equal(result[0].sourcePath, second);
});

await check('ambiguity cancellation cancels the complete mixed drop', async () => {
  const result = await readDroppedData('ph', [path.join(phRoot, '10'), path.join(fixtures, 'ambiguous')], { selectAmbiguous: async () => null });
  assert.deepEqual(result, []);
});

await check('ambiguity selection cannot read arbitrary paths', async () => {
  await assert.rejects(readDroppedData('ph', [path.join(fixtures, 'ambiguous')], { selectAmbiguous: async () => [path.join(phRoot, '10/LSV.txt')] }), /不在本次找到/);
});

await check('explicit files preserve supported formats and intentional repeats', async () => {
  const selected = [];
  for (const ext of ['txt', 'bin', 'csv', 'tsv', 'dat', 'xlsx']) selected.push(await file(`explicit/data.${ext}`, Buffer.from([1, 2, 3])));
  const result = await readDroppedData('ph', [...selected, selected[0]]);
  assert.equal(result.length, 7);
  assert.equal(result[0].sourcePath, result[6].sourcePath);
  assert.notEqual(result[0].data, result[6].data);
  assert.deepEqual(Buffer.from(result[6].data), Buffer.from([1, 2, 3]));
});

await check('unrelated CV/EIS directories are rejected with a clear error', async () => {
  await file('not-lsv/CV.txt');
  await file('not-lsv/EIS.txt');
  await file('not-lsv/CV_LSV.txt');
  await assert.rejects(readDroppedData('ph', [path.join(fixtures, 'not-lsv')]), /没有找到.*LSV/);
  await assert.rejects(readDroppedData('lsv', [path.join(fixtures, 'not-lsv')]), /没有找到.*LSV/);
});

await check('unsupported pages and nonabsolute paths are rejected', async () => {
  await assert.rejects(readDroppedData('xrd', [phRoot]), /不支持/);
  await assert.rejects(readDroppedData('ph', ['Ce-Fe/10']), /路径无效/);
});

await check('symbolic directory links are skipped without following external data', async () => {
  const linkedRoot = path.join(fixtures, 'links');
  await fs.mkdir(linkedRoot);
  await fs.symlink(phRoot, path.join(linkedRoot, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readDroppedData('ph', [linkedRoot]), /没有找到.*LSV/);
});

await check('scan depth is bounded', async () => {
  await file('too-deep/' + Array.from({ length: 9 }, (_, index) => `d${index}`).join('/') + '/LSV.txt');
  await assert.rejects(readDroppedData('ph', [path.join(fixtures, 'too-deep')]), /层级超过/);
});

await check('LSV and pH file limits are enforced before reading data', async () => {
  const lsvRoots = [];
  for (let index = 0; index < 121; index++) {
    const target = await file(`many/${index}/LSV.txt`);
    if (index < 11) lsvRoots.push(path.dirname(target));
  }
  await assert.rejects(readDroppedData('lsv', lsvRoots), /最多导入 10 个/);
  await assert.rejects(readDroppedData('ph', [path.join(fixtures, 'many')]), /最多导入 120 个/);
});

await check('single file and total byte limits are enforced', async () => {
  const big = await file('sizes/too-big/LSV.txt', '');
  const handle = await fs.open(big, 'r+');
  await handle.truncate(20 * 1024 * 1024 + 1);
  await handle.close();
  await assert.rejects(readDroppedData('ph', [big]), /20 MB/);
  await fs.unlink(big);
  const many = [];
  for (let index = 0; index < 6; index++) {
    const target = await file(`sizes/batch-${index}/LSV.txt`, '');
    const item = await fs.open(target, 'r+');
    await item.truncate(18 * 1024 * 1024);
    await item.close();
    many.push(target);
  }
  await assert.rejects(readDroppedData('ph', many), /100 MB/);
  for (const target of many) await fs.unlink(target);
});

await check('an instrument shortening or rewriting a file during import is rejected', async () => {
  for (const change of ['shorten', 'rewrite']) {
    const target = await file(`changing/${change}/LSV.txt`);
    const before = await fs.stat(target);
    const originalOpen = fs.open;
    fs.open = async function (source, ...args) {
      const handle = await originalOpen.call(this, source, ...args);
      if (source !== target) return handle;
      const originalRead = handle.read.bind(handle);
      let changed = false;
      handle.read = async (...readArgs) => {
        if (!changed) {
          changed = true;
          // Coordinate a real external write after the reader's initial stat.
          // This avoids timing-dependent races in the regression test.
          if (change === 'shorten') await fs.truncate(target, 10);
          else {
            await fs.writeFile(target, rows.replace('0.0001', '0.0009'));
            const changedTime = new Date(before.mtimeMs + 2000);
            await fs.utimes(target, changedTime, changedTime);
          }
        }
        return originalRead(...readArgs);
      };
      return handle;
    };
    try {
      await assert.rejects(readDroppedData('ph', [target]), /文件发生变化/);
    } finally {
      fs.open = originalOpen;
    }
  }
});

await check('scan entry count is bounded', async () => {
  const scanRoot = path.join(fixtures, 'scan-limit');
  await fs.mkdir(scanRoot);
  for (let index = 0; index < 10001; index += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 10001 - index) }, (_, offset) => fs.writeFile(path.join(scanRoot, `${index + offset}.tmp`), '')));
  }
  await assert.rejects(readDroppedData('ph', [scanRoot]), /条目超过/);
});

await check('CV directories preserve scan-rate batches and prefer same-directory TXT companions', async () => {
  const first = await file('cv-batch/sample-a/CV/5.txt');
  const companion = await file('cv-batch/sample-a/CV/5.bin', 'binary companion');
  await file('cv-batch/sample-a/CV/10.txt');
  const second = await file('cv-batch/sample-b/CV/5.txt');
  await file('cv-batch/sample-b/CV/20.bin', 'standalone BIN');
  await file('cv-batch/sample-a/EIS/EIS.txt');
  await file('cv-batch/sample-a/LSV/LSV.txt');
  await file('cv-batch/sample-a/Cdl/CV5.txt');
  const result = await readDroppedData('cv', [path.join(fixtures, 'cv-batch')]);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(item => item.name).sort(), ['10.txt', '20.bin', '5.txt', '5.txt']);
  assert.ok(result.some(item => item.sourcePath === first));
  assert.ok(result.some(item => item.sourcePath === second));
  assert.ok(result.every(item => path.isAbsolute(item.sourcePath) && item.relativePath.includes('CV/')));
  assert.equal(result.some(item => item.sourcePath === companion), false);
});

await check('CV direct selections de-duplicate companion sources within one batch and retain later imports', async () => {
  const txt = path.join(fixtures, 'cv-batch/sample-a/CV/5.txt');
  const bin = path.join(fixtures, 'cv-batch/sample-a/CV/5.bin');
  const other = path.join(fixtures, 'cv-batch/sample-b/CV/5.txt');
  const result = await readDroppedData('cv', [txt, bin, other, txt]);
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map(item => item.sourcePath)), new Set([txt, other]));
  assert.equal((await readDroppedData('cv', [txt])).length, 1);
  await assert.rejects(readDroppedData('cv', [path.join(fixtures, 'cv-batch/sample-a/EIS')]), /没有找到.*CV/);
});

await fs.writeFile(path.join(fixtures, 'report.json'), JSON.stringify({ passed: true, checks, fixtures }, null, 2));
console.log(JSON.stringify({ passed: true, checks, fixtures }));
