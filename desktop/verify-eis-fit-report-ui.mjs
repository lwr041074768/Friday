import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

delete process.env.ELECTRON_RUN_AS_NODE;
const directory = path.dirname(fileURLToPath(import.meta.url));
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const output = path.resolve(arg('--output') || path.join(directory, `output/eis-fit-report-${Date.now()}`));
const playwright = arg('--playwright');
if (!playwright) throw Error('Provide --playwright <installed playwright/index.mjs>.');
const { _electron: electron } = await import(pathToFileURL(path.resolve(playwright)).href);
const fixtures = path.join(output, 'fixtures'), downloads = path.join(output, 'downloads'), isolated = path.join(output, 'isolated-app'), profile = path.join(output, 'profile');
for (const folder of [fixtures, downloads, profile]) await fs.mkdir(folder, { recursive: true });
await fs.cp(path.join(directory, 'build/app'), isolated, { recursive: true });
const marker = "app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
const main = await fs.readFile(path.join(isolated, 'main.cjs'), 'utf8');
assert.ok(main.includes(marker));
await fs.writeFile(path.join(isolated, 'main.cjs'), main.replace(marker, `app.setPath('userData',${JSON.stringify(profile)});`));

// Independent complex RC reference (n=1 is intentionally avoided because the fit constrains n).
const input = path.join(fixtures, 'EIS-Report-QA.csv'), rows = ['Freq/Hz,Zreal/ohm,Zimag/ohm'];
const expectedRct = 200, expectedRs = 10, q = 2e-4, n = 0.85;
for (let i = 0; i < 60; i++) {
  const f = 1e5 * 10 ** (-6 * i / 59), w = 2 * Math.PI * f, a = 1 + q * expectedRct * w ** n * Math.cos(n * Math.PI / 2), b = q * expectedRct * w ** n * Math.sin(n * Math.PI / 2), denominator = a * a + b * b;
  rows.push(`${f},${expectedRs + expectedRct * a / denominator},${-expectedRct * b / denominator}`);
}
await fs.writeFile(input, rows.join('\n'));
const projectPath = path.join(output, 'eis-fit-roundtrip.fri');
const report = { ok: false, checks: [], screenshots: [], errors: [] };
const executablePath = path.resolve(arg('--electron') || path.join(directory, 'node_modules/electron/dist/electron.exe'));
const launch = () => electron.launch({ executablePath, args: [isolated], timeout: 30000 });
let app, page, panel, card, overlay, exportButton;
async function attach() {
  page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForLoadState('domcontentloaded'); await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow, dialog, session }, folder) => {
    const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); window.focus(); window.setContentSize(1440, 1000);
    dialog.showMessageBox = async () => ({ response: 1 });
    session.defaultSession.on('will-download', (_event, item) => item.setSavePath(folder + '/' + Date.now() + '-' + item.getFilename()));
  }, downloads);
  await page.getByRole('navigation', { name: '绘图类型' }).waitFor();
  const day = page.getByRole('button', { name: '切换到白天模式', exact: true }); if (await day.count()) await day.click();
  await page.locator('.lsv-tabs a[href="#eis"]').click();
  panel = page.locator('#panel-eis'); card = panel.getByTestId('eis-fit-card'); overlay = panel.locator('[data-curve="eis-circuit-fit"]'); exportButton = panel.getByRole('button', { name: '导出拟合报告', exact: true });
  await panel.getByRole('button', { name: '手动选择', exact: true }).click();
}
async function checkAbsent(label) {
  await card.waitFor({ state: 'hidden' }); assert.equal(await overlay.count(), 0, `${label} overlay`); assert.equal(await exportButton.isDisabled(), true, `${label} report disabled`);
  report.checks.push(label);
}
async function fit() {
  await panel.getByRole('button', { name: '拟合', exact: true }).click(); await card.waitFor({ timeout: 20000 });
  assert.equal(await overlay.count(), 1); assert.equal(await exportButton.isEnabled(), true);
  const text = await card.locator('[data-parameter="Rct"]').innerText(), value = Number(text.split('±')[0].trim());
  assert.ok(Math.abs(value - expectedRct) / expectedRct < 0.01, `Rct: ${text}`);
}
async function exportCsv() {
  const existing = new Map(await Promise.all((await fs.readdir(downloads)).map(async name => [name, (await fs.stat(path.join(downloads, name))).mtimeMs])));
  await exportButton.click();
  for (let i = 0; i < 100; i++) {
    for (const name of await fs.readdir(downloads)) if (name.endsWith('-EIS-拟合报告.csv')) {
      const file = path.join(downloads, name), stat = await fs.stat(file);
      if (!existing.has(name) || stat.mtimeMs !== existing.get(name)) return fs.readFile(file, 'utf8');
    }
    await page.waitForTimeout(50);
  }
  throw Error('Fit report CSV was not written.');
}
async function openProject() {
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectPath);
  await page.getByRole('button', { name: '打开项目', exact: true }).click(); await card.waitFor({ timeout: 20000 });
}
try {
  app = await launch(); await attach();
  await checkAbsent('empty-workspace-has-no-fit-or-report');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, input);
  await panel.getByRole('button', { name: '导入数据', exact: true }).click(); await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '选择 EIS 数据文件', exact: true }).click(); await page.getByRole('button', { name: /^绘制.*条曲线$/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await fit(); report.checks.push('real-native-import-fit-and-overlay');
  await panel.getByRole('combobox', { name: 'EIS 等效电路', exact: true }).selectOption('r-cpe-w'); await checkAbsent('model-change-invalidates-fit-and-export');
  await panel.getByRole('combobox', { name: 'EIS 等效电路', exact: true }).selectOption('r-cpe'); await fit();
  await panel.getByRole('combobox', { name: 'EIS 拟合加权', exact: true }).selectOption('unit'); await checkAbsent('weighting-change-invalidates-fit-and-export'); await fit();

  const details = panel.locator('.lsv-curve-details').first(); await details.locator('summary').click();
  await panel.getByRole('combobox', { name: 'EIS-Report-QA虚部符号', exact: true }).click(); await page.getByRole('option', { name: '已取负 −Z″（保持不变）', exact: true }).click();
  await checkAbsent('imaginary-sign-change-invalidates-fit-and-export');
  await panel.getByRole('combobox', { name: 'EIS-Report-QA虚部符号', exact: true }).click(); await page.getByRole('option', { name: '原始 Z″（绘图取负）', exact: true }).click(); await fit();

  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('EIS 生命周期验收');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectPath);
  await page.getByRole('button', { name: '保存项目', exact: true }).click(); await page.getByText('已保存', { exact: true }).waitFor();
  const saved = JSON.parse(await fs.readFile(projectPath, 'utf8'));
  assert.equal(saved.states['eis.analysis.kind'], 'r-cpe'); assert.equal(saved.states['eis.analysis.weighting'], 'unit'); assert.equal(saved.states['eis.analysis.fitRequested'], true);
  assert.equal(saved.states['eis.curves'][0].points.length, 60); assert.ok(saved.states['eis.curves'][0].points[0].current < 0);
  assert.ok(!Object.keys(saved.states).some(key => /^eis\.analysis\./.test(key) && /stored|report|params|statistic/.test(key)), 'stored statistics must not be trusted on restore');
  const goldenTable = await card.getByTestId('eis-fit-table').innerText(), goldenCsv = await exportCsv();
  assert.match(goldenCsv, /频率_Hz/); assert.match(goldenCsv, /拟合值 − 观测值/); assert.match(goldenCsv, /不加权/);
  report.checks.push('fri-saves-fit-request-options-raw-data-and-separate-full-report');
  const shot = path.join(output, 'eis-fit-report.png'); await page.screenshot({ path: shot }); report.screenshots.push(shot);

  await panel.getByRole('button', { name: '删除 EIS-Report-QA', exact: true }).click(); await checkAbsent('curve-delete-invalidates-fit-and-export');
  await openProject(); assert.equal(await card.getByTestId('eis-fit-table').innerText(), goldenTable);
  await page.getByRole('button', { name: '新建', exact: true }).click(); await page.locator('.lsv-tabs a[href="#eis"]').click(); await checkAbsent('new-project-clears-fit-and-export');
  await openProject();

  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
  app = await launch(); await attach(); await checkAbsent('new-process-starts-with-no-stale-fit'); await openProject();
  assert.equal(await panel.getByRole('combobox', { name: 'EIS 拟合加权', exact: true }).inputValue(), 'unit');
  assert.equal(await card.getByTestId('eis-fit-table').innerText(), goldenTable); assert.equal(await exportCsv(), goldenCsv);
  report.checks.push('actual-process-restart-recomputes-same-parameters-and-full-csv');

  await panel.getByRole('combobox', { name: 'EIS 拟合加权', exact: true }).selectOption('modulus'); await checkAbsent('changed-context-before-undo-is-invalid');
  await page.waitForTimeout(450); await page.getByRole('button', { name: '撤销分析操作', exact: true }).click(); await card.waitFor({ timeout: 20000 });
  assert.equal(await panel.getByRole('combobox', { name: 'EIS 拟合加权', exact: true }).inputValue(), 'unit'); assert.equal(await card.getByTestId('eis-fit-table').innerText(), goldenTable);
  await page.getByRole('button', { name: '重做分析操作', exact: true }).click(); await checkAbsent('redo-does-not-resurrect-prior-context-result');
  report.checks.push('undo-recomputes-requested-fit-with-restored-model-context');
  assert.deepEqual(report.errors, []); report.ok = true; report.version = await page.evaluate(() => window.scientificPlot.version);
  await fs.writeFile(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  if (page) { await page.screenshot({ path: path.join(output, 'ui-error.png') }).catch(() => {}); await fs.writeFile(path.join(output, 'ui-error.txt'), await page.locator('body').innerText().catch(() => '')); }
  throw error;
} finally { await app?.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app?.close().catch(() => {}); }
