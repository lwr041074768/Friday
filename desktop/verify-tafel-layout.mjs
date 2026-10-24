import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Focused desktop acceptance check. Each run uses its own name and data folder.
const directory = path.dirname(fileURLToPath(import.meta.url));
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const output = path.resolve(option('--output') || path.join(directory, 'output/tafel-layout'));
const runtime = option('--playwright');
if (!runtime) throw Error('Provide --playwright <installed playwright/index.mjs>.');
const { _electron: electron } = await import(pathToFileURL(path.resolve(runtime)).href);
const runId = `${Date.now()}-${process.pid}`;
const isolated = path.join(output, `isolated-app-${runId}`), profile = path.join(output, `profile-${runId}`);
const shots = path.join(output, 'screenshots'), downloads = path.join(output, `downloads-${runId}`), fixtures = path.join(output, 'fixtures');
for (const folder of [shots, downloads, fixtures, profile]) await fs.mkdir(folder, { recursive: true });
await fs.cp(path.join(directory, 'build/app'), isolated, { recursive: true });
const main = path.join(isolated, 'main.cjs'), source = await fs.readFile(main, 'utf8');
const marker = "app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(source.includes(marker), 'Isolated profile marker must still match.');
await fs.writeFile(main, source.replace("app.setName('ScientificPlotStudio');", `app.setName('ScientificPlotStudio-TafelQA-${runId}');`).replace(marker, `app.setPath('userData', ${JSON.stringify(profile)});`));
const e = [.3, .35, .4, .45, .5, .45, .4, .35, .3], currents = [.001, .002, .004, .008, .016, .012, .006, .003, .0015];
const files = [];
for (const name of ['Alpha', 'Beta']) {
  const file = path.join(fixtures, `${name}.csv`);
  await fs.writeFile(file, 'Potential/V,Current/A\n' + e.map((v, i) => `${v},${currents[i]}`).join('\n'));
  files.push(file);
}
const report = { checks: [], geometry: [], screenshots: [], errors: [] };
const app = await electron.launch({ executablePath: path.resolve(option('--electron') || path.join(directory, 'node_modules/electron/dist/electron.exe')), args: [isolated], timeout: 30000 });
let page;
const near = (a, b, label, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${label}: ${a} vs ${b}`);
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  return lines.map(line => { const cells = []; let value = '', quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; } else if (c === ',' && !quoted) { cells.push(value); value = ''; } else value += c; } cells.push(value); return cells; });
}
try {
  page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForLoadState('domcontentloaded'); await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '绘图类型' }).waitFor();
  async function resize(width, height) { await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.show(); w.setContentSize(size.width, size.height); }, { width, height }); await page.waitForTimeout(180); }
  async function go(kind) { await page.locator(`.lsv-tabs a[href="#${kind}"]`).click(); await page.waitForURL(new RegExp(`#${kind}$`)); await page.locator(`#panel-${kind}`).waitFor(); await page.waitForTimeout(180); }
  const panel = kind => page.locator(`#panel-${kind}`);
  const chart = kind => panel(kind).getByTestId('lsv-chart');
  const points = kind => panel(kind).locator('path[data-curve]').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.curve, x: Number(n.dataset.firstX), y: Number(n.dataset.firstY), count: Number(n.dataset.pointCount), d: n.getAttribute('d') })));
  async function importFiles(kind, chosen) {
    await go(kind);
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, chosen);
    await panel(kind).getByRole('button', { name: '导入数据', exact: true }).click();
    await page.getByRole('button', { name: `选择 ${kind === 'lsv' ? 'LSV' : 'Tafel'} 数据文件`, exact: true }).click();
    await page.getByRole('button', { name: /^绘制.*条曲线$/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  async function screenshot(name) {
    const saved = page.getByRole('button', { name: '关闭保存提示', exact: true }); if (await saved.count()) await saved.click();
    await page.getByRole('navigation', { name: '绘图类型' }).scrollIntoViewIfNeeded();
    const file = path.join(shots, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file);
  }
  async function geometry(kind) {
    return panel(kind).evaluate(element => {
      const box = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
      const svg = element.querySelector('[data-testid="lsv-chart"]'), s = box(svg), vb = svg.viewBox.baseVal, clip = svg.querySelector('clipPath rect');
      const scaleX = s.width / vb.width, scaleY = s.height / vb.height;
      const axes = { x: s.x + Number(clip.getAttribute('x')) * scaleX, y: s.y + Number(clip.getAttribute('y')) * scaleY, width: Number(clip.getAttribute('width')) * scaleX, height: Number(clip.getAttribute('height')) * scaleY };
      axes.right = axes.x + axes.width; axes.bottom = axes.y + axes.height;
      const manager = element.querySelector('[data-testid="lsv-sample-manager"]');
      const formulas = [...element.querySelectorAll('.lsv-formula-display')].map(el => ({ text: el.textContent, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight }));
      const rows = [...element.querySelectorAll('.lsv-managed-curve')].map(el => ({ row: box(el.querySelector('.lsv-curve-row')), resistance: el.querySelector('.tafel-curve-resistance') && box(el.querySelector('.tafel-curve-resistance')) }));
      return { viewport: { width: innerWidth, height: innerHeight }, document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }, heading: box(element.querySelector('.lsv-heading')), sidebar: box(element.querySelector('.lsv-controls')), results: box(element.querySelector('.lsv-results')), irConfirm: element.querySelector('.tafel-ir-card button') && box(element.querySelector('.tafel-ir-card button')), headingActions: [...element.querySelectorAll('.lsv-heading-actions button')].map(box), axes, manager: { ...box(manager), placement: manager.dataset.placement }, formulas, rows };
    });
  }
  const day = page.getByRole('button', { name: '切换到白天模式', exact: true }); if (await day.count()) await day.click();
  await resize(1440, 950);
  await importFiles('lsv', [files[0]]);
  const lsvSnapshot = await points('lsv');
  await go('tafel'); await panel('tafel').getByRole('button', { name: '体验示例', exact: true }).click();
  const demoTotal = await points('tafel'); assert.equal(demoTotal.length, 3);
  await page.waitForTimeout(180);
  const demoShot = path.join(shots, 'tafel-demo-1440x950.png'); await page.screenshot({ path: demoShot }); report.screenshots.push(demoShot);
  await panel('tafel').getByRole('combobox', { name: 'Tafel 横轴计算', exact: true }).click();
  await page.getByRole('option', { name: '电流密度 j（需电极面积）', exact: true }).click();
  assert.equal((await points('tafel')).length, 0); assert.match(await panel('tafel').innerText(), /需要填写电极面积/);
  for (const name of ['A', 'B', 'C']) await panel('tafel').getByRole('spinbutton', { name: `模拟样品 ${name}面积`, exact: true }).fill('2');
  const demoDensity = await points('tafel'); assert.equal(demoDensity.length, 3);
  demoDensity.forEach((c, i) => { near(c.x, demoTotal[i].x - Math.log10(2), 'Demo density uses area'); near(c.y, demoTotal[i].y, 'Demo density retains potential'); });
  await panel('tafel').getByRole('combobox', { name: 'Tafel 横轴计算', exact: true }).click(); await page.getByRole('option', { name: '总电流 I（按原公式）', exact: true }).click();
  await panel('tafel').getByRole('button', { name: '返回我的数据', exact: true }).click();
  report.checks.push('demo-total-current-and-density-require-area-and-transform-correctly');
  await importFiles('tafel', files);
  const initial = await points('tafel'); assert.equal(initial.length, 2); near(initial[0].x, 0, 'Known first log current'); near(initial[0].y, .3 + .0592 * 13.65 + .197 - 1.23, 'Known first overpotential');
  await panel('tafel').getByRole('spinbutton', { name: 'IR 电阻 Rs', exact: true }).fill('5');
  await panel('tafel').getByRole('spinbutton', { name: 'Beta电阻', exact: true }).fill('2');
  assert.deepEqual(await points('tafel'), initial, 'Resistance drafts must not alter the plot before confirmation');
  assert.match(await panel('tafel').locator('.tafel-ir-card').innerText(), /有待应用的修改/);
  await panel('tafel').locator('.tafel-ir-card').getByRole('button', { name: '确定', exact: true }).click();
  const applied = await points('tafel'); near(applied[0].y, initial[0].y - .005, 'Global resistance'); near(applied[1].y, initial[1].y - .002, 'Per-curve resistance');
  report.checks.push('global-and-per-curve-resistance-apply-only-on-confirm-and-use-original-current');
  for (const [width, height] of [[1440, 950], [1280, 720], [1000, 800], [1520, 960]]) {
    await resize(width, height); await go('lsv'); const reference = await geometry('lsv'); await go('tafel'); const tafel = await geometry('tafel');
    assert.ok(tafel.document.scrollWidth <= tafel.document.clientWidth + 1, `No page overflow at ${width}x${height}`);
    for (const key of ['x', 'width']) near(tafel.sidebar[key], reference.sidebar[key], `LSV sidebar ${key}`, 1);
    for (const key of ['x', 'y']) near(tafel.heading[key], reference.heading[key], `LSV heading ${key}`, 1);
    assert.ok(tafel.sidebar.width - tafel.heading.width <= 16, 'Heading may reserve a vertical scrollbar on short windows');
    for (const button of tafel.headingActions) assert.ok(button.y >= 0 && button.bottom <= height, 'Heading actions visible initially');
    assert.ok(tafel.irConfirm.bottom <= Math.min(height, tafel.sidebar.bottom) + 1, 'IR confirmation button fully visible initially');
    for (const key of ['x', 'width']) near(tafel.results[key], reference.results[key], `LSV main results ${key}`, 1);
    near(tafel.axes.width, tafel.axes.height, 'Square inner axes', 1);
    assert.ok(tafel.manager.placement === 'left' ? tafel.manager.right <= tafel.axes.x + 1 : tafel.manager.y >= tafel.axes.bottom - 1, 'Manager outside inner plot');
    for (const row of tafel.rows) if (row.resistance) assert.ok(row.resistance.y >= row.row.bottom - 1, 'Rs row below name/unit fields');
    for (const f of tafel.formulas) { assert.ok(f.scrollWidth <= f.clientWidth + 1, 'Formula wraps without horizontal clipping'); assert.ok(f.scrollHeight <= f.clientHeight + 1, 'Formula not vertically clipped'); }
    report.geometry.push({ size: `${width}x${height}`, lsv: reference, tafel });
    await screenshot(`tafel-${width}x${height}`);
  }
  report.checks.push('four-window-sizes-match-lsv-grid-have-square-axes-and-no-overlap-or-clipping');
  await resize(1440, 950);
  const axisSettings = panel('tafel').locator('.tafel-axis-settings'); assert.equal(await axisSettings.getAttribute('open'), null);
  await axisSettings.locator('summary').click(); await panel('tafel').getByRole('textbox', { name: 'X 轴标题', exact: true }).fill('log current / mA'); await panel('tafel').getByRole('textbox', { name: 'Y 轴标题', exact: true }).fill('Overpotential / V');
  assert.match(await chart('tafel').getAttribute('aria-label'), /log current \/ mA.*Overpotential \/ V/);
  await axisSettings.locator('summary').click(); assert.deepEqual(await points('tafel'), applied); report.checks.push('collapsible-custom-axis-titles-preserve-data');
  for (const [button, count, firstIndex] of [['正向 正向扫描', 5, 0], ['反向 反向扫描', 5, 4], ['全部', 9, 0]]) {
    await panel('tafel').getByRole('group', { name: '扫描方向', exact: true }).getByRole('button', { name: button, exact: true }).click();
    const data = await points('tafel'); assert.equal(data[0].count, count); near(data[0].x, Math.log10(currents[firstIndex] * 1000), 'Scan first current'); near(data[0].y, e[firstIndex] - 5 * currents[firstIndex] + .0592 * 13.65 + .197 - 1.23, 'Scan first potential');
  }
  report.checks.push('forward-reverse-and-all-scans-select-original-potential-branches');
  await app.evaluate(({ session }, folder) => { session.defaultSession.on('will-download', (_event, item) => item.setSavePath(folder + '/' + item.getFilename())); }, downloads);
  await panel('tafel').getByRole('button', { name: '导出数据', exact: true }).click(); await panel('tafel').getByRole('button', { name: '导出图形 SVG', exact: true }).click();
  for (let n = 0; n < 50; n++) { if ((await fs.readdir(downloads)).includes('Tafel.svg') && (await fs.readdir(downloads)).includes('Tafel.csv')) break; await page.waitForTimeout(100); }
  const csv = parseCsv(await fs.readFile(path.join(downloads, 'Tafel.csv'), 'utf8')), svg = await fs.readFile(path.join(downloads, 'Tafel.svg'), 'utf8');
  assert.equal(csv.length, 19); assert.equal(csv[0][6], 'log current / mA'); assert.equal(csv[0][7], 'Overpotential / V');
  for (let sample = 0; sample < 2; sample++) for (let i = 0; i < 9; i++) { const row = csv[1 + sample * 9 + i]; near(Number(row[6]), Math.log10(currents[i] * 1000), 'CSV log current'); near(Number(row[7]), e[i] - (sample ? 2 : 5) * currents[i] + .0592 * 13.65 + .197 - 1.23, 'CSV overpotential'); assert.equal(row[8], '1'); assert.equal(row[10], 'all'); }
  assert.match(svg, /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/); assert.match(svg, /Overpotential \/ V/); assert.match(svg, /data-curve=/);
  report.checks.push('csv-and-svg-downloads-readable-and-csv-exactly-preserves-known-data');
  const beforeTheme = await points('tafel'); await page.getByRole('button', { name: '切换到夜晚模式', exact: true }).click(); assert.deepEqual(await points('tafel'), beforeTheme); await screenshot('tafel-night');
  await go('lsv'); assert.deepEqual(await points('lsv'), lsvSnapshot); await screenshot('lsv-unchanged'); report.checks.push('theme-and-tab-navigation-preserve-tafel-and-lsv-data');
  assert.deepEqual(report.errors, []); report.ok = true; report.version = await page.evaluate(() => window.scientificPlot.version);
  await fs.writeFile(path.join(output, 'tafel-layout-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, version: report.version, checks: report.checks, screenshots: report.screenshots, report: path.join(output, 'tafel-layout-report.json') }, null, 2));
} catch (error) {
  report.ok = false; report.failure = error.stack; await fs.writeFile(path.join(output, 'tafel-layout-report.json'), JSON.stringify(report, null, 2));
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  throw error;
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
