import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { readDroppedData } = require('../desktop/folder-import.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'desktop/output');
await fs.mkdir(output, { recursive: true });
const fixtures = await fs.mkdtemp(path.join(output, 'eis-folder-import-qa-'));
const rows = 'Freq/Hz,Zreal/ohm,Zimag/ohm\r\n1000,2,0.1\r\n10,5,-2\r\n0.1,9,-4\r\n';
const imp = Buffer.alloc(29);
imp.write('IMP', 8, 'ascii');
imp.write('A.C. Impedance', 15, 'ascii');
let checks = 0;
async function file(relative, contents = rows) {
  const target = path.join(fixtures, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
}
async function check(name, run) {
  await run(); checks++;
  console.log(`PASS ${name}`);
}

await check('three samples and fourteen potentials preserve all source paths with one TXT per companion pair', async () => {
  for (const sample of [1, 2, 3]) for (let index = 0; index < 14; index++) {
    const potential = (0.30 + index * 0.01).toFixed(3);
    await file(`operando/${sample}/EIS_${potential}V.txt`);
    await file(`operando/${sample}/EIS_${potential}V.bin`, imp);
  }
  await file('operando/1/CV.txt');
  await file('operando/1/LSV.txt');
  await file('operando/1/Cdl.txt');
  await file('operando/1/EIS_fitted.csv');
  await file('operando/1/分析结果/EIS.txt');
  await file('operando/1/.git/EIS.txt');
  const result = await readDroppedData('eis', [path.join(fixtures, 'operando')]);
  assert.equal(result.length, 42);
  assert.equal(new Set(result.map(item => item.sourcePath)).size, 42);
  assert.ok(result.every(item => item.name.endsWith('.txt')));
  for (const item of result) {
    assert.equal(item.sourcePath, path.resolve(fixtures, item.relativePath));
    assert.match(item.relativePath, /^operando\/[123]\/EIS_0\.\d{3}V\.txt$/);
    assert.equal(Buffer.from(item.data).toString('utf8'), rows);
    assert.ok(item.data instanceof ArrayBuffer && item.lastModified > 0);
  }
});

await check('potential-only IMP names discover binary technique headers and retain local text companions', async () => {
  const txt = await file('numeric/1/0.43V.txt');
  await file('numeric/1/0.43V.bin', imp);
  const bin = await file('numeric/2/0.43V.bin', imp);
  await file('numeric/2/0.50V.bin', Buffer.alloc(29));
  const instrumentTxt = await file('numeric/3/0.51V.txt', 'A.C. Impedance\r\n' + rows);
  const result = await readDroppedData('eis', [path.join(fixtures, 'numeric')]);
  assert.equal(result.length, 3);
  assert.deepEqual(new Set(result.map(item => item.sourcePath)), new Set([txt, bin, instrumentTxt]));
  assert.deepEqual(Buffer.from(result.find(item => item.sourcePath === bin).data), imp);
});

await check('EIS-named directories accept potential filenames and skip neighbouring measurement names', async () => {
  await file('folder-name/Sample A/EIS/0.43V.txt');
  await file('folder-name/Sample A/EIS/0.44V.bin', imp);
  await file('folder-name/Sample A/EIS/CV.txt');
  await file('folder-name/Sample A/EIS/LSV.txt');
  await file('folder-name/Sample A/EIS/Cdl.txt');
  const result = await readDroppedData('eis', [path.join(fixtures, 'folder-name')]);
  assert.deepEqual(result.map(item => item.name), ['0.43V.txt', '0.44V.bin']);
  assert.ok(result.every(item => item.relativePath.includes('/Sample A/EIS/')));
});

await check('direct paired selections de-duplicate by complete source path and allow a subsequent import', async () => {
  const txt = path.join(fixtures, 'numeric/1/0.43V.txt');
  const bin = path.join(fixtures, 'numeric/1/0.43V.bin');
  const other = path.join(fixtures, 'numeric/2/0.43V.bin');
  const result = await readDroppedData('eis', [txt, bin, other, txt]);
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map(item => item.sourcePath)), new Set([txt, other]));
  assert.equal((await readDroppedData('eis', [txt])).length, 1);
});

await check('eighty logical spectra fit in one batch while an eighty-first is rejected', async () => {
  const direct = [];
  for (let index = 0; index < 80; index++) {
    direct.push(await file(`limit/EIS_${index}.txt`));
    direct.push(await file(`limit/EIS_${index}.bin`, imp));
  }
  assert.equal((await readDroppedData('eis', [path.join(fixtures, 'limit')])).length, 80);
  assert.equal((await readDroppedData('eis', direct)).length, 80);
  await file('limit/EIS_extra.txt');
  await assert.rejects(readDroppedData('eis', [path.join(fixtures, 'limit')]), /最多导入 80 个/);
});

await check('unrelated measurements, excluded result folders and unsupported profiles stay filtered', async () => {
  await file('unrelated/CV.txt');
  await file('unrelated/LSV.txt');
  await file('unrelated/Cdl.txt');
  await file('unrelated/分析结果/EIS.txt');
  await assert.rejects(readDroppedData('eis', [path.join(fixtures, 'unrelated')]), /没有找到.*EIS/);
  await assert.rejects(readDroppedData('xrd', [path.join(fixtures, 'operando')]), /不支持/);
});

await check('native folder picker and Explorer drops retain File frequency bytes and acquisition paths', async () => {
  const original = await readDroppedData('eis', [path.join(fixtures, 'numeric')]);
  const calls = [];
  globalThis.__eisImportBridge = {
    getPathForFile: () => path.join(fixtures, 'numeric'),
    readDroppedData: async (profile, paths) => { calls.push({ profile, paths }); return original; },
    chooseEisFolder: async () => original,
  };
  const nativeUrl = 'data:text/javascript;base64,' + Buffer.from('export const desktop=()=>globalThis.__eisImportBridge;').toString('base64');
  const source = await fs.readFile(path.join(root, 'desktop/renderer/native-files.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from ['"]\.\/native['"]/, 'from ' + JSON.stringify(nativeUrl));
  const { chooseEisFolder, resolveDroppedFiles } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  try {
    const picked = await chooseEisFolder();
    const dropped = await resolveDroppedFiles('eis', [new File([], 'numeric')]);
    assert.deepEqual(calls, [{ profile: 'eis', paths: [path.join(fixtures, 'numeric')] }]);
    for (const result of [picked, dropped]) for (const [index, item] of result.entries()) {
      assert.ok(item instanceof File);
      assert.equal(item.measurementSourcePath, original[index].sourcePath);
      assert.equal(item.webkitRelativePath, original[index].relativePath);
      assert.deepEqual(Buffer.from(await item.arrayBuffer()), Buffer.from(original[index].data));
    }
  } finally { delete globalThis.__eisImportBridge; }
});

await check('the dialog infers selectable frequency columns and converts kHz or mHz into Hz', async () => {
  const source = await fs.readFile(path.join(root, 'components/xy-import-dialog.tsx'), 'utf8');
  const ast = ts.createSourceFile('xy-import-dialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['isFrequencyColumn', 'inferredFrequencyUnit', 'inferredFrequencyIndex', 'eisFolderFiles'];
  const helpers = ast.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)).map(statement => statement.getText(ast)).join('\n');
  const code = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const { isFrequencyColumn, inferredFrequencyUnit, inferredFrequencyIndex, eisFolderFiles } = new Function(code + '\nreturn {isFrequencyColumn,inferredFrequencyUnit,inferredFrequencyIndex,eisFolderFiles};')();
  for (const header of ['Freq/Hz', 'Frequency (kHz)', '频率 / mHz', 'f/Hz', 'Hz']) assert.equal(isFrequencyColumn(header), true);
  for (const header of ['Zreal/ohm', 'Phase/deg', '第 3 列']) assert.equal(isFrequencyColumn(header), false);
  assert.equal(2.5 * Number(inferredFrequencyUnit('Frequency/kHz')), 2500);
  assert.equal(2500 * Number(inferredFrequencyUnit('Freq/mHz')), 2.5);
  assert.equal(Number(inferredFrequencyUnit('Freq/Hz')), 1);
  assert.equal(inferredFrequencyIndex({ e: 1, current: 2 }, { headers: ['Freq/Hz', 'Zreal', 'Zimag'] }), 0);
  assert.equal(inferredFrequencyIndex({ e: 0, current: 1 }, { headers: ['Zreal', 'Zimag'] }), -1);
  assert.equal(inferredFrequencyIndex({ e: 0, current: 1 }, { headers: ['Zreal', 'Zimag', '-Zimag', 'Frequency/Hz', 'Zreal2', 'Zimag2', '-Zimag2', 'Frequency2/Hz'] }), 3);
  const browserFiles=[];
  for(const [relative, contents] of [['data/1/0.43V.txt',rows],['data/1/0.43V.bin',imp],['data/2/EIS/0.44V.txt',rows],['data/2/EIS/CV.txt',rows],['data/3/LSV.txt',rows],['data/3/分析结果/EIS.txt',rows]]){
    const file=new File([contents],path.basename(relative));Object.defineProperty(file,'webkitRelativePath',{value:relative});browserFiles.push(file);
  }
  const selected=await eisFolderFiles(browserFiles);
  assert.equal(selected.length,3);
  assert.deepEqual(new Set(selected.map(file=>file.webkitRelativePath)),new Set(['data/1/0.43V.txt','data/1/0.43V.bin','data/2/EIS/0.44V.txt']));
});

await fs.writeFile(path.join(fixtures, 'report.json'), JSON.stringify({ passed: true, checks, fixtures }, null, 2));
console.log(JSON.stringify({ passed: true, checks, fixtures }));
