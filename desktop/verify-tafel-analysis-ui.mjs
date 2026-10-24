import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Desktop acceptance: a copied app and a unique profile keep the real install untouched.
const directory = path.dirname(fileURLToPath(import.meta.url));
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const runtime = option('--playwright');
if (!runtime) throw Error('Provide --playwright <installed playwright/index.mjs>.');
const { _electron: electron } = await import(pathToFileURL(path.resolve(runtime)).href);
const output = path.resolve(option('--output') || path.join(directory, 'output/tafel-analysis'));
const runId = `${Date.now()}-${process.pid}`;
const isolated = path.join(output, `isolated-app-${runId}`), profile = path.join(output, `profile-${runId}`);
const shots = path.join(output, 'screenshots'), downloads = path.join(output, `downloads-${runId}`), fixtures = path.join(output, 'fixtures');
for (const folder of [shots, downloads, fixtures, profile]) await fs.mkdir(folder, { recursive: true });
await fs.cp(path.join(directory, 'build/app'), isolated, { recursive: true });
const main = path.join(isolated, 'main.cjs'), source = await fs.readFile(main, 'utf8');
const marker = "app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(source.includes(marker), 'Isolated profile marker must still match.');
await fs.writeFile(main, source.replace("app.setName('ScientificPlotStudio');", `app.setName('ScientificPlotStudio-TafelAnalysisQA-${runId}');`).replace(marker, `app.setPath('userData', ${JSON.stringify(profile)});`));

// Synthetic imported measurements, rather than production math, supply our oracle.
const conversion = .0592 * 13.65 + .197 - 1.23;
const xs = [0, .25, .5, .75, 1, 1.25, 1.5, 1.75, 2];
const noise = [0, .001, -.001, .001, .005, -.001, .001, -.001, 0];
const measurements = xs.map((x, index) => ({ x, y: .1 + .06 * x + noise[index], e: .1 + .06 * x + noise[index] - conversion, current: 10 ** x / 1000, index }));
const negative = xs.map((x, index) => ({ x, y: .3 - .04 * x, e: .3 - .04 * x - conversion, current: 10 ** x / 1000, index }));
const mixed = [...measurements.slice(0, 5), ...measurements.slice(0, 4).reverse()].map((point, index) => ({ ...point, index }));
const bipolar=measurements.map((point,index)=>({...point,current:index<4?-point.current:point.current}));
const files = {};
for (const [name, values] of [['Alpha', measurements], ['Beta', measurements], ['Negative', negative], ['Mixed', mixed],['Bipolar',bipolar]]) {
  const file = path.join(fixtures, `${name}.csv`);
  await fs.writeFile(file, 'Potential/V,Current/A\n' + values.map(point => `${point.e},${point.current}`).join('\n'));
  files[name] = file;
}
function regression(points) {
  const n = points.length, meanX = points.reduce((sum, point) => sum + point.x, 0) / n, meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  const xx = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0), yy = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const xy = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0), slope = xy / xx, intercept = meanY - slope * meanX;
  const sse = points.reduce((sum, point) => sum + (point.y - intercept - slope * point.x) ** 2, 0), variance = sse / (n - 2);
  return { n, slope, intercept, slopeSE: Math.sqrt(variance / xx), interceptSE: Math.sqrt(variance * (1 / n + meanX ** 2 / xx)), sse, r: xy / Math.sqrt(xx * yy), r2: 1 - sse / yy, adjustedR2: 1 - sse / yy * (n - 1) / (n - 2), tafelSlope: slope * 1000 };
}
function parseCsv(csv) {
  return csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(line => {
    const cells = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { cells.push(value); value = ''; } else value += c;
    }
    cells.push(value); return cells;
  });
}
const report = { checks: [], screenshots: [], expected: regression(measurements.filter(point => point.index !== 4)), errors: [] };
const near = (actual, expected, label, tolerance = 1e-9) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const app = await electron.launch({ executablePath: path.resolve(option('--electron') || path.join(directory, 'node_modules/electron/dist/electron.exe')), args: [isolated], timeout: 30000 });
let page;
try {
  page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForLoadState('domcontentloaded'); await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '绘图类型' }).waitFor();
  const panel = kind => page.locator(`#panel-${kind}`), tafel = panel('tafel');
  const chart = kind => panel(kind).getByTestId('lsv-chart');
  const paths = kind => panel(kind).locator('path[data-curve]');
  const points = kind => paths(kind).evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.curve, count: Number(node.dataset.pointCount), d: node.getAttribute('d') })));
  const result = () => tafel.getByTestId('tafel-fit-table');
  const bounds = kind => chart(kind).evaluate(svg => ['xMin', 'xMax', 'yMin', 'yMax'].map(key => Number(svg.dataset[key])));
  async function resize(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); window.setContentSize(size.width, size.height); }, { width, height });
    await page.waitForTimeout(180);
  }
  async function go(kind) {
    await page.locator(`.lsv-tabs a[href="#${kind}"]`).click(); await page.waitForURL(new RegExp(`#${kind}$`)); await panel(kind).waitFor();
  }
  async function importFiles(kind, names) {
    await go(kind);
    await app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: chosen }); }, names.map(name => files[name]));
    await panel(kind).getByRole('button', { name: '导入数据', exact: true }).click();
    await page.getByRole('button', { name: `选择 ${kind === 'lsv' ? 'LSV' : 'Tafel'} 数据文件`, exact: true }).click();
    await page.getByRole('button', { name: /^绘制.*条曲线$/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  async function sample(name) {
    await tafel.getByRole('combobox', { name: '分析样品', exact: true }).selectOption({ label: name });
  }
  async function range(lower, upper) {
    await tafel.getByRole('spinbutton', { name: '拟合区间下限', exact: true }).fill(String(lower));
    await tafel.getByRole('spinbutton', { name: '拟合区间上限', exact: true }).fill(String(upper));
    await tafel.getByRole('spinbutton', { name: '拟合区间上限', exact: true }).blur();
  }
  async function fit() { await tafel.getByRole('button', { name: '线性拟合', exact: true }).click(); }
  async function dataPosition(kind, x, y) {
    return chart(kind).evaluate((svg, point) => {
      const clip = svg.querySelector('clipPath rect'), box = svg.getBoundingClientRect(), matrix = svg.getScreenCTM();
      if (!clip || !matrix) throw Error('Chart axes mapping unavailable.');
      const left = Number(clip.getAttribute('x')), top = Number(clip.getAttribute('y')), width = Number(clip.getAttribute('width')), height = Number(clip.getAttribute('height'));
      const px = left + (point.x - Number(svg.dataset.xMin)) / (Number(svg.dataset.xMax) - Number(svg.dataset.xMin)) * width;
      const py = top + height - (point.y - Number(svg.dataset.yMin)) / (Number(svg.dataset.yMax) - Number(svg.dataset.yMin)) * height;
      return { x: matrix.a * px + matrix.c * py + matrix.e, y: matrix.b * px + matrix.d * py + matrix.f, svg: { width: box.width, height: box.height } };
    }, { x, y });
  }
  async function dragBox(kind, rectangle) {
    await chart(kind).scrollIntoViewIfNeeded();
    const first = await dataPosition(kind, rectangle.x0, rectangle.y0), last = await dataPosition(kind, rectangle.x1, rectangle.y1);
    await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(last.x, last.y, { steps: 12 }); await page.mouse.up();
  }
  async function maskOutlier() {
    if (await chart('tafel').getAttribute('data-analysis-mode') !== 'mask') await tafel.getByRole('button', { name: '框选屏蔽', exact: true }).click();
    await dragBox('tafel', { x0: .92, x1: 1.08, y0: .16, y1: .17 });
  }
  async function exportFile(kind, name) {
    const destination = path.join(downloads, name);
    await app.evaluate(({ session }, target) => { session.defaultSession.once('will-download', (_event, item) => item.setSavePath(target)); }, destination);
    await tafel.getByRole('button', { name: kind === 'csv' ? '导出数据' : '导出图形 SVG', exact: true }).click();
    for (let i = 0; i < 60; i++) { try { await fs.access(destination); return await fs.readFile(destination, 'utf8'); } catch {} await page.waitForTimeout(100); }
    throw Error(`Download did not finish: ${name}`);
  }
  async function screenshot(name) {
    const dismiss = page.getByRole('button', { name: '关闭保存提示', exact: true }); if (await dismiss.count()) await dismiss.click();
    const file = path.join(shots, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file);
  }
  async function displayedRows() {
    return result().locator('tr').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent.trim())));
  }
  const numeric = text => [...String(text).replaceAll('−', '-').matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)].map(match => Number(match[0]));
  async function assertFit(expected) {
    await result().waitFor();
    const rows = await displayedRows(); report.lastFitRows = rows;
    const value = expression => { const row = rows.find(cells => expression.test(cells[0])); assert.ok(row, `Result row ${expression} present: ${JSON.stringify(rows)}`); return numeric(row.slice(1).join(' ')); };
    const slope = value(/^斜率/), intercept = value(/^截距/);
    near(slope[0], expected.slope, 'Displayed slope', 2e-6); near(intercept[0], expected.intercept, 'Displayed intercept', 2e-6);
    near(slope[1], expected.slopeSE, 'Displayed slope standard error', 2e-6); near(intercept[1], expected.interceptSE, 'Displayed intercept standard error', 2e-6);
    near(value(/^(?:有效点数|数据点数|点数|n\b)/i)[0], expected.n, 'Displayed n', 0);
    near(value(/^(?:R²|R平方|R 平方|R\^2)/)[0], expected.r2, 'Displayed R squared', 2e-6);
    near(value(/^Tafel\s*斜率/)[0], expected.tafelSlope, 'Signed Tafel slope mV/dec', .002);
    assert.equal(await tafel.getByTestId('tafel-fit-line').count(), 1, 'One fitted line is present');
  }

  const day = page.getByRole('button', { name: '切换到白天模式', exact: true }); if (await day.count()) await day.click();
  await resize(1920, 1080);
  await importFiles('lsv', ['Alpha']); const originalLsv = await points('lsv'), originalLsvBounds = await bounds('lsv');
  await importFiles('tafel', ['Alpha', 'Beta']); await sample('Alpha');
  const original = await points('tafel'), originalBounds = await bounds('tafel'); assert.equal(original.length, 2); assert.deepEqual(original.map(curve => curve.count), [9, 9]);
  await maskOutlier();
  let masked = await points('tafel'); assert.deepEqual(masked.map(curve => curve.count), [8, 9], 'Mask changes only the selected sample even when a second curve overlaps');
  assert.deepEqual(await bounds('tafel'), originalBounds, 'Mask rectangle must not zoom or rescale axes');
  assert.ok((masked[0].d.match(/M/g) || []).length >= 2, 'A masked point leaves a gap rather than joining across it');
  const maskedCsv = parseCsv(await exportFile('csv', 'masked.csv')), headers = maskedCsv[0];
  const maskColumn = headers.findIndex(header => /屏蔽/.test(header)); assert.ok(maskColumn >= 0, 'Export has a mask flag');
  const alpha = maskedCsv.slice(1).filter(row => row[0] === 'Alpha'), beta = maskedCsv.slice(1).filter(row => row[0] === 'Beta');
  assert.equal(alpha.length, 9); assert.equal(beta.length, 9);
  for (const rows of [alpha, beta]) rows.forEach((row, i) => { near(Number(row[2]), i + 1, 'Preserved raw order', 0); near(Number(row[3]), measurements[i].e, 'Preserved raw potential'); near(Number(row[4]), measurements[i].current, 'Preserved raw current'); });
  assert.deepEqual(alpha.map(row => Number(row[maskColumn])), [0, 0, 0, 0, 1, 0, 0, 0, 0]); assert.ok(beta.every(row => Number(row[maskColumn]) === 0));
  report.checks.push('rectangle-masks-only-target-sample-leaves-gap-preserves-view-and-complete-raw-csv-with-mask-flags');
  await tafel.getByRole('button', { name: '撤销屏蔽', exact: true }).click(); assert.deepEqual((await points('tafel')).map(({id,count})=>({id,count})), original.map(({id,count})=>({id,count}))); assert.deepEqual(await bounds('tafel'),originalBounds);
  await maskOutlier(); await tafel.getByRole('button', { name: '恢复全部', exact: true }).click(); assert.deepEqual((await points('tafel')).map(({id,count})=>({id,count})), original.map(({id,count})=>({id,count}))); assert.deepEqual(await bounds('tafel'),originalBounds);
  report.checks.push('mask-undo-and-restore-return-original-curve-data');
  await maskOutlier();
  await tafel.getByRole('button', { name: '选择拟合区域', exact: true }).click(); await range(0, 2);
  const guides = tafel.getByTestId('tafel-range-guides').getByRole('slider');
  assert.equal(await guides.count(), 2, 'Two fitting range guides are displayed');
  const lowerBefore = Number(await tafel.getByRole('spinbutton', { name: '拟合区间下限', exact: true }).inputValue());
  const guideBox = await tafel.getByRole('slider', { name: '拟合区间左边界', exact: true }).locator('rect').first().boundingBox(); assert.ok(guideBox);
  await page.mouse.move(guideBox.x + guideBox.width / 2, guideBox.y + guideBox.height / 2); await page.mouse.down(); await page.mouse.move(guideBox.x + guideBox.width / 2 + 20, guideBox.y + guideBox.height / 2, { steps: 6 }); await page.mouse.up();
  assert.ok(Number(await tafel.getByRole('spinbutton', { name: '拟合区间下限', exact: true }).inputValue()) > lowerBefore, 'Dragging left guide updates its numeric bound');
  assert.deepEqual(await bounds('tafel'), originalBounds, 'Guide dragging does not zoom axes');
  await range(0, 2); await fit(); await assertFit(report.expected);
  await screenshot('tafel-fit-wide');
  const wide = await tafel.evaluate(element => {
    const rect = element.querySelector('svg[data-testid="lsv-chart"] clipPath rect'), svg = element.querySelector('svg[data-testid="lsv-chart"]'), matrix = svg.getScreenCTM(), results = element.querySelector('[data-testid="tafel-fit-table"]').getBoundingClientRect();
    return { axesRight: matrix.a * (Number(rect.getAttribute('x')) + Number(rect.getAttribute('width'))) + matrix.e, results: { x: results.x, y: results.y, width: results.width, right: results.right }, viewportWidth: innerWidth };
  });
  assert.ok(wide.results.x >= wide.axesRight, 'Wide-screen result table is in the blank area to the right of axes');
  assert.ok(wide.results.right <= wide.viewportWidth + 1, 'Result table stays inside the viewport'); report.wideGeometry = wide;
  report.checks.push('draggable-two-line-range-and-numeric-bounds-drive-fit-with-known-n-slope-intercept-errors-r2-and-signed-mv-per-dec');
  const exportedSvg = await exportFile('svg', 'fit.svg');
  assert.match(exportedSvg, /data-testid="tafel-fit-line"/); assert.match(exportedSvg, /data-testid="tafel-fit-export-table"/); assert.match(exportedSvg, /Tafel/);
  assert.doesNotMatch(exportedSvg, /data-plot-transient|data-testid="tafel-range-guides"/); report.checks.push('svg-exports-fitting-line-and-result-table-without-transient-guides');
  await range(.01, .26); await fit(); assert.equal(await result().count(), 0); assert.match(await tafel.innerText(), /至少.*3|不足|少于.*3/);
  await range(0, 2); await fit(); await result().waitFor();
  await tafel.getByRole('spinbutton', { name: 'IR 电阻 Rs', exact: true }).fill('1'); await tafel.locator('.tafel-ir-card').getByRole('button', { name: '确定', exact: true }).click();
  assert.equal(await result().count(), 0, 'Applying Rs invalidates the fit');
  await tafel.getByRole('spinbutton', { name: 'IR 电阻 Rs', exact: true }).fill('0'); await tafel.locator('.tafel-ir-card').getByRole('button', { name: '确定', exact: true }).click(); await range(0, 2); await fit();
  await tafel.getByRole('group', { name: '扫描方向', exact: true }).getByRole('button', { name: '正向 正向扫描', exact: true }).click(); assert.equal(await result().count(), 0, 'Changing scan direction invalidates the fit');
  await tafel.getByRole('group', { name: '扫描方向', exact: true }).getByRole('button', { name: '全部', exact: true }).click(); await range(0, 2); await fit();
  await tafel.getByRole('combobox', { name: 'Tafel 横轴计算', exact: true }).click(); await page.getByRole('option', { name: '电流密度 j（需电极面积）', exact: true }).click(); assert.equal(await result().count(), 0, 'Changing current basis invalidates the fit');
  await tafel.getByRole('combobox', { name: 'Tafel 横轴计算', exact: true }).click(); await page.getByRole('option', { name: '总电流 I（按原公式）', exact: true }).click(); await range(0, 2); await fit();
  await tafel.getByRole('button', { name: '恢复全部', exact: true }).click(); assert.equal(await result().count(), 0, 'Restoring masks invalidates the fit');
  report.checks.push('insufficient-points-rejected-and-changes-to-rs-basis-scan-or-mask-clear-stale-results');
  await importFiles('tafel', ['Negative', 'Mixed','Bipolar']); await sample('Negative'); await range(0, 2); await fit(); await assertFit(regression(negative));
  report.checks.push('negative-slope-remains-negative-in-v-per-dec-and-mv-per-dec');
  await sample('Mixed'); await range(0, 2); await fit(); assert.equal(await result().count(), 0); assert.match(await tafel.innerText(), /正向|反向/);
  report.checks.push('mixed-forward-reverse-fit-requires-a-single-scan-direction');
  await sample('Bipolar');await range(0,2);await fit();assert.equal(await result().count(),0);assert.match(await tafel.innerText(),/正、负电流/);report.checks.push('opposite-current-polarities-cannot-be-combined-by-absolute-log-transform');
  await sample('Alpha'); await range(0, 2); await fit(); await result().waitFor();
  await resize(1280, 800); await screenshot('tafel-fit-compact');
  assert.ok(await tafel.evaluate(element => { const box = element.querySelector('[data-testid="tafel-fit-table"]').getBoundingClientRect(); return box.width > 0 && box.right <= innerWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; }), 'Compact results remain readable without horizontal page overflow');
  await resize(1920, 1080); await go('lsv'); assert.deepEqual(await points('lsv'), originalLsv); assert.deepEqual(await bounds('lsv'), originalLsvBounds);
  const beforeZoom = await bounds('lsv');
  // A screen-based rectangle checks LSV's existing drag interaction without depending on its formulas.
  const clip = await chart('lsv').locator('clipPath rect').evaluate(rect => { const svg = rect.ownerSVGElement, m = svg.getScreenCTM(); return { x: m.a * Number(rect.getAttribute('x')) + m.e, y: m.d * Number(rect.getAttribute('y')) + m.f, width: m.a * Number(rect.getAttribute('width')), height: m.d * Number(rect.getAttribute('height')) }; });
  await page.mouse.move(clip.x + clip.width * .2, clip.y + clip.height * .2); await page.mouse.down(); await page.mouse.move(clip.x + clip.width * .7, clip.y + clip.height * .7, { steps: 8 }); await page.mouse.up();
  assert.notDeepEqual(await bounds('lsv'), beforeZoom, 'LSV rectangle drag still zooms');
  await panel('lsv').getByRole('button', { name: '复位', exact: true }).click(); assert.deepEqual(await bounds('lsv'), originalLsvBounds); assert.deepEqual(await points('lsv'), originalLsv);
  report.checks.push('lsv-data-and-original-rectangle-zoom-remain-unchanged');
  assert.deepEqual(report.errors, []); report.ok = true; report.version = await page.evaluate(() => window.scientificPlot.version);
  await fs.writeFile(path.join(output, 'tafel-analysis-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, version: report.version, checks: report.checks, screenshots: report.screenshots, report: path.join(output, 'tafel-analysis-report.json') }, null, 2));
} catch (error) {
  report.ok = false; report.failure = error.stack; await fs.writeFile(path.join(output, 'tafel-analysis-report.json'), JSON.stringify(report, null, 2));
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  throw error;
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
