import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Use a copied build with its own profile and process identity. Never operate
// on the user's running ScientificPlotStudio or its saved data.
const directory = path.dirname(fileURLToPath(import.meta.url));
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const runtime = option('--playwright');
if (!runtime) throw Error('Provide --playwright <installed playwright/index.mjs>.');
const { _electron: electron } = await import(pathToFileURL(path.resolve(runtime)).href);
const output = path.resolve(option('--output') || path.join(directory, 'output/data-book-correction'));
const runId = `${Date.now()}-${process.pid}`;
const isolated = path.join(output, `isolated-app-${runId}`), profile = path.join(output, `profile-${runId}`);
const shots = path.join(output, 'screenshots'), downloads = path.join(output, `downloads-${runId}`), fixtures = path.join(output, 'fixtures');
for (const folder of [shots, downloads, fixtures, profile]) await fs.mkdir(folder, { recursive: true });
await fs.cp(path.join(directory, 'build/app'), isolated, { recursive: true });
const main = path.join(isolated, 'main.cjs'), source = await fs.readFile(main, 'utf8');
const marker = "app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(source.includes(marker), 'Isolated profile marker must still match.');
await fs.writeFile(main, source.replace("app.setName('Friday');", `app.setName('ScientificPlotStudio-DataBookQA-${runId}');`).replace(marker, `app.setPath('userData', ${JSON.stringify(profile)});`));

const e = [.3, .35, .4, .45, .5, .45, .4, .35, .3], currentA = [.001, .002, .004, .008, .016, .012, .006, .003, .0015];
const raw = {
  Alpha: e.map((potential, index) => ({ e: potential, current: currentA[index] })),
  Beta: e.map((potential, index) => ({ e: potential + .02, current: 2 * currentA[index] * 1000 })),
  Large: Array.from({ length: 5000 }, (_, index) => ({ e: index === 3099 ? null : .4 + index * .0001, current: index === 0 ? -.001 : index === 2344 ? 0 : .001 + index * .000001 })),
  '模拟样品': Array.from({ length: 50 }, (_, index) => ({ e: .3 + index * .004, current: .001 * 10 ** (index / 25) })),
};
const files = {};
for (const [name, values] of Object.entries(raw)) {
  const file = path.join(fixtures, `${name}.csv`), unit = name === 'Beta' ? 'mA' : 'A';
  await fs.writeFile(file, `Potential/V,Current/${unit}\n` + values.map(point => `${point.e ?? ''},${point.current}`).join('\n'));
  files[name] = file;
}
const conversion = .0592 * 13.65 + .197 - 1.23, lsvConversion = .059 * 13.65 + .197;
const report = { checks: [], screenshots: [], geometry: [], errors: [] };
const near = (actual, expected, label, tolerance = 1e-10) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
function parseCsv(text) {
  return text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/).map(line => {
    const cells = []; let value = '', quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
      else if (character === ',' && !quoted) { cells.push(value); value = ''; } else value += character;
    }
    cells.push(value); return cells;
  });
}
const app = await electron.launch({ executablePath: path.resolve(option('--electron') || path.join(directory, 'node_modules/electron/dist/electron.exe')), args: [isolated], timeout: 30000 });
let page;
try {
  page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForLoadState('domcontentloaded'); await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '绘图类型' }).waitFor();
  const panel = kind => page.locator(`#panel-${kind}`), tafel = panel('tafel');
  const chart = kind => panel(kind).getByTestId('lsv-chart');
  const add = (kind, name) => panel(kind).getByRole('button', { name: `为 ${name} 添加 BOOK`, exact: true });
  const label = (name, number = 1) => `BOOK ${number} · ${name}`;
  const book = (kind, name, number = 1) => panel(kind).locator(`section.data-book-window[aria-label="${label(name, number)}"]`);
  const row = (kind, name, index, number = 1) => book(kind, name, number).locator(`tr[aria-rowindex="${index + 1}"]`);
  const cell = (kind, name, index, key, number = 1) => row(kind, name, index, number).locator(`td[data-column="${key}"]`);
  const value = async (kind, name, index, key, number = 1) => {
    const title = await cell(kind, name, index, key, number).getAttribute('title');
    return title === '无计算值' || title === '' || title === null ? null : Number(title);
  };
  async function resize(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); window.setContentSize(size.width, size.height); }, { width, height });
    await page.waitForTimeout(200);
  }
  async function go(kind) { await page.locator(`.lsv-tabs a[href="#${kind}"]`).click(); await page.waitForURL(new RegExp(`#${kind}$`)); await panel(kind).waitFor(); }
  async function importFiles(kind, names) {
    await go(kind);
    await app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: chosen }); }, names.map(name => files[name]));
    await panel(kind).getByRole('button', { name: '导入数据', exact: true }).click();
    await page.getByRole('button', { name: `选择 ${kind === 'lsv' ? 'LSV' : 'Tafel'} 数据文件`, exact: true }).click();
    await page.getByRole('button', { name: /^绘制.*条曲线$/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  async function reopen(kind, name, number = 1) { await panel(kind).getByRole('button', { name: `打开 ${label(name, number)}`, exact: true }).click(); await book(kind, name, number).waitFor(); }
  async function close(kind, name, number = 1) { await book(kind, name, number).getByRole('button', { name: `关闭 ${label(name, number)}`, exact: true }).click(); await book(kind, name, number).waitFor({ state: 'hidden' }); }
  async function screenshot(name, target) {
    const dismiss = page.getByRole('button', { name: '关闭保存提示', exact: true }); if (await dismiss.count()) await dismiss.click();
    const file = path.join(shots, `${name}.png`); await (target || page).screenshot({ path: file }); report.screenshots.push(file);
  }
  async function exportBook(kind, name, number = 1) {
    const destination = path.join(downloads, `${kind}-${name}-${number}.csv`);
    await app.evaluate(({ session }, target) => { session.defaultSession.once('will-download', (_event, item) => item.setSavePath(target)); }, destination);
    await book(kind, name, number).getByRole('button', { name: '导出 CSV', exact: true }).click();
    for (let count = 0; count < 60; count++) { try { const csv = await fs.readFile(destination, 'utf8'); if (csv.endsWith('\n')) return parseCsv(csv); } catch {} await page.waitForTimeout(100); }
    throw Error(`Download did not finish: ${destination}`);
  }
  async function jump(kind, name, index, number = 1) {
    await book(kind, name, number).getByRole('spinbutton', { name: `${label(name, number)} 跳转到原始行`, exact: true }).fill(String(index));
    await book(kind, name, number).getByRole('button', { name: '跳转', exact: true }).click(); await row(kind, name, index, number).waitFor();
  }
  const bounds = kind => chart(kind).evaluate(svg => ['xMin', 'xMax', 'yMin', 'yMax'].map(key => Number(svg.dataset[key])));
  const pathState = kind => panel(kind).locator('path[data-curve]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.curve, d: node.getAttribute('d'), count: node.dataset.pointCount })));
  const scrollState = () => page.evaluate(() => ({ x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  async function box(locator) { const rectangle = await locator.boundingBox(); assert.ok(rectangle); return rectangle; }
  async function drag(locator, dx, dy) {
    const rectangle = await box(locator), x = rectangle.x + rectangle.width / 2, y = rectangle.y + rectangle.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up();
  }
  async function checkTable(kind, name, number = 1) {
    const target = book(kind, name, number);
    assert.equal(await target.getByRole('table').getAttribute('aria-colcount'), '6', 'Five displayed columns plus separate row index');
    assert.deepEqual(await target.locator('thead tr').first().locator('th strong').allTextContents(), ['A(X1)', 'B(Y1)', 'C', 'D(X2)', 'E(Y2)']);
    assert.deepEqual(await row(kind, name, 1, number).locator('td').evaluateAll(nodes => nodes.map(node => node.dataset.column)), ['rawPotential', 'rawCurrent', 'spacer', 'x', 'y']);
    assert.equal((await cell(kind, name, 1, 'spacer', number).innerText()).trim(), '', 'C is visibly empty');
    const layout = await target.locator('.data-book-table-viewport').evaluate(viewport => {
      const head = [...viewport.querySelectorAll('thead tr:first-child th')], data = [...viewport.querySelector('tbody tr[aria-rowindex]').children];
      return { scroll: viewport.scrollWidth, width: viewport.clientWidth, columns: head.map((node, index) => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width, rowX: data[index].getBoundingClientRect().x })) };
    });
    assert.ok(layout.scroll <= layout.width + 1, 'A through E fit without horizontal scrolling in a normal BOOK');
    layout.columns.forEach((column, index) => near(column.x, column.rowX, `Header and row ${index} align`, 1));
    for (let index = 2; index < layout.columns.length; index++) near(layout.columns[index].width, layout.columns[1].width, 'C is a real equal-width blank column', 1);
  }

  const day = page.getByRole('button', { name: '切换到白天模式', exact: true }); if (await day.count()) await day.click();
  await resize(1440, 1000); await importFiles('tafel', ['Alpha', 'Beta', 'Large']);
  await page.evaluate(() => window.scrollTo(0, 0));
  await add('tafel','Alpha').scrollIntoViewIfNeeded();
  const axesBeforeAdd = await bounds('tafel'), curvesBeforeAdd = await pathState('tafel'), scrollBeforeAdd = await scrollState();
  await add('tafel', 'Alpha').click(); await book('tafel', 'Alpha').waitFor();
  assert.match(await book('tafel', 'Alpha').getAttribute('class'), /is-floating/, 'New BOOK floats immediately');
  assert.deepEqual(await scrollState(), scrollBeforeAdd, 'Opening BOOK neither scrolls nor adds page height');
  await checkTable('tafel', 'Alpha');
  const firstBook = await box(book('tafel', 'Alpha')); await close('tafel', 'Alpha');
  await add('tafel', 'Alpha').click(); await book('tafel', 'Alpha', 2).waitFor();
  const secondBook = await box(book('tafel', 'Alpha', 2));
  assert.ok(Math.abs(firstBook.x - secondBook.x) > 1 || Math.abs(firstBook.y - secondBook.y) > 1, 'New BOOKs stagger instead of covering identical geometry');
  await close('tafel', 'Alpha', 2); await add('tafel', 'Beta').click(); await book('tafel', 'Beta').waitFor();
  near(await value('tafel', 'Beta', 1, 'rawCurrent'), 2, 'B preserves imported mA rather than converting its displayed raw value');
  near(await value('tafel', 'Beta', 1, 'x'), Math.log10(2), 'D uses correctly converted current in Tafel formula');
  await close('tafel', 'Beta');
  assert.deepEqual(await bounds('tafel'), axesBeforeAdd); assert.deepEqual(await pathState('tafel'), curvesBeforeAdd);
  report.checks.push('exact-AB-empty-C-DE-layout-default-floating-real-blank-column-stagger-no-page-scroll-no-axes-mutation');

  await tafel.getByRole('spinbutton', { name: 'IR 电阻 Rs', exact: true }).fill('5');
  await tafel.getByRole('spinbutton', { name: 'Beta电阻', exact: true }).fill('2');
  for (const number of [1, 2]) {
    await reopen('tafel', 'Alpha', number); await checkTable('tafel', 'Alpha', number);
    near(await value('tafel', 'Alpha', 1, 'y', number), .3 + conversion, 'Unconfirmed Rs does not update E');
    await close('tafel', 'Alpha', number);
  }
  await reopen('tafel', 'Beta'); near(await value('tafel', 'Beta', 1, 'y'), .32 + conversion, 'Unconfirmed sample Rs does not update E'); await close('tafel', 'Beta');
  await tafel.locator('.tafel-ir-card').getByRole('button', { name: '确定', exact: true }).click();
  for (const number of [1, 2]) {
    await reopen('tafel', 'Alpha', number);
    for (let index = 1; index <= raw.Alpha.length; index++) {
      near(await value('tafel', 'Alpha', index, 'rawPotential', number), raw.Alpha[index - 1].e, 'A remains immutable');
      near(await value('tafel', 'Alpha', index, 'rawCurrent', number), raw.Alpha[index - 1].current, 'B remains immutable');
      near(await value('tafel', 'Alpha', index, 'x', number), Math.log10(raw.Alpha[index - 1].current * 1000), 'D is applied formula X');
      near(await value('tafel', 'Alpha', index, 'y', number), raw.Alpha[index - 1].e - raw.Alpha[index - 1].current * 5 + conversion, 'E follows confirmed Rs');
    }
    await close('tafel', 'Alpha', number);
  }
  await reopen('tafel', 'Beta'); near(await value('tafel', 'Beta', 1, 'y'), .32 - .004 + conversion, 'Independent mA sample uses its own Rs'); near(await value('tafel', 'Beta', 1, 'rawCurrent'), 2, 'B remains raw mA after Rs'); await close('tafel', 'Beta');
  await tafel.getByRole('group', { name: '扫描方向', exact: true }).getByRole('button', { name: '正向 正向扫描', exact: true }).click();
  await reopen('tafel', 'Alpha'); assert.equal(await book('tafel', 'Alpha').getByRole('table').getAttribute('aria-rowcount'), '10'); near(await value('tafel', 'Alpha', 9, 'rawCurrent'), .0015, 'BOOK retains reverse scan source rows'); await close('tafel', 'Alpha');
  await tafel.getByRole('group', { name: '扫描方向', exact: true }).getByRole('button', { name: '全部', exact: true }).click();
  report.checks.push('raw-AB-immutable-applied-IR-only-calculated-DE-live-across-two-BOOKs-and-independent-sample-units');

  for (let number = 3; number <= 10; number++) { await add('tafel', 'Alpha').click(); await book('tafel', 'Alpha', number).waitFor(); await close('tafel', 'Alpha', number); }
  assert.ok(await add('tafel', 'Alpha').isDisabled(), 'Eleventh BOOK is blocked'); assert.ok(await add('tafel', 'Beta').isEnabled(), 'Other sample has independent allowance');
  await reopen('tafel', 'Alpha', 10); await book('tafel', 'Alpha', 10).getByRole('button', { name: '移除 BOOK 10 · Alpha 视图', exact: true }).click(); await book('tafel', 'Alpha', 10).getByRole('button', { name: '移除', exact: true }).click();
  assert.ok(await add('tafel', 'Alpha').isEnabled(), 'Removing only a view releases a slot'); await add('tafel', 'Alpha').click(); await book('tafel', 'Alpha', 10).waitFor(); near(await value('tafel', 'Alpha', 1, 'rawCurrent', 10), .001, 'Replacement view preserves source'); await close('tafel', 'Alpha', 10);
  report.checks.push('independent-ten-BOOK-cap-hide-reopen-and-view-removal-slot-release');

  await reopen('tafel', 'Alpha');
  const axesBefore = await bounds('tafel'), curveBefore = await pathState('tafel'), scrollBeforeMove = await scrollState(), geometryBefore = await box(book('tafel', 'Alpha'));
  await drag(book('tafel', 'Alpha').getByRole('button', { name: '移动 BOOK 1 · Alpha，可拖动或按方向键', exact: true }), -70, 90);
  const geometryAfter = await box(book('tafel', 'Alpha'));
  assert.ok(Math.abs(geometryAfter.x - geometryBefore.x) >= 10 || Math.abs(geometryAfter.y - geometryBefore.y) >= 10, 'Dragging title moves window');
  await drag(book('tafel', 'Alpha').getByRole('button', { name: '调整 BOOK 1 · Alpha 大小', exact: true }), -35, -40);
  const resized = await box(book('tafel', 'Alpha')); assert.ok(resized.width < geometryAfter.width && resized.height < geometryAfter.height, 'Resize grip changes size');
  assert.ok(resized.x >= 0 && resized.y >= 0 && resized.x + resized.width <= 1441 && resized.y + resized.height <= 1001, 'Window stays within viewport');
  await book('tafel', 'Alpha').getByRole('button', { name: '最小化 BOOK 1 · Alpha', exact: true }).click();
  const minimized = await box(book('tafel', 'Alpha')); assert.ok(minimized.height < 70, 'Minimize leaves only titlebar'); assert.ok(await book('tafel', 'Alpha').getByRole('table').isHidden());
  await book('tafel', 'Alpha').getByRole('button', { name: '展开 BOOK 1 · Alpha', exact: true }).click();
  const expanded = await box(book('tafel', 'Alpha')); near(expanded.x, resized.x, 'Minimize restore x', 1); near(expanded.height, resized.height, 'Minimize restores height', 1);
  await book('tafel', 'Alpha').getByRole('button', { name: '最大化 BOOK 1 · Alpha', exact: true }).click();
  const maximized = await box(book('tafel', 'Alpha')); assert.ok(maximized.width > 1400 && maximized.height > 950, 'Maximize fills application viewport');
  await book('tafel', 'Alpha').getByRole('button', { name: '还原 BOOK 1 · Alpha', exact: true }).click();
  const restored = await box(book('tafel', 'Alpha')); for (const key of ['x', 'y', 'width', 'height']) near(restored[key], resized[key], `Maximize restore ${key}`, 1);
  await close('tafel', 'Alpha'); await reopen('tafel', 'Alpha'); const reopened = await box(book('tafel', 'Alpha')); for (const key of ['x', 'y', 'width', 'height']) near(reopened[key], resized[key], `Reopen preserves ${key}`, 1);
  assert.deepEqual(await bounds('tafel'), axesBefore, 'Window interactions do not zoom axes'); assert.deepEqual(await pathState('tafel'), curveBefore, 'Window interactions do not change curves'); assert.deepEqual(await scrollState(), scrollBeforeMove, 'Window interactions do not scroll page');
  report.geometry.push({ before: geometryBefore, moved: geometryAfter, resized, minimized, maximized, restored });
  await page.getByRole('button', { name: '切换到夜晚模式', exact: true }).click(); await screenshot('tafel-book-floating-dark');
  await go('lsv'); assert.equal(await page.locator('.data-book-window:visible').count(), 0, 'Floating BOOK hides with workspace'); await go('tafel'); const returned = await box(book('tafel', 'Alpha')); near(returned.x, resized.x, 'Navigation retains x', 1); near(returned.y, resized.y, 'Navigation retains y', 1);
  await page.getByRole('button', { name: '切换到白天模式', exact: true }).click(); await close('tafel', 'Alpha');
  report.checks.push('Origin-like-title-drag-resize-minimize-maximize-restore-close-reopen-and-theme-navigation-preserve-geometry');

  await add('tafel', 'Large').click(); await book('tafel', 'Large').waitFor(); await checkTable('tafel', 'Large');
  assert.equal(await book('tafel', 'Large').getByRole('table').getAttribute('aria-rowcount'), '5001'); assert.ok(await book('tafel', 'Large').locator('tbody tr:not(.data-book-spacer)').count() < 100, 'Large BOOK virtualizes rows');
  near(await value('tafel', 'Large', 1, 'rawCurrent'), -.001, 'Signed raw current stays signed'); near(await value('tafel', 'Large', 1, 'y'), .405 + conversion, 'Signed negative current produces correct iR correction');
  await jump('tafel', 'Large', 4000); near(await value('tafel', 'Large', 4000, 'rawPotential'), raw.Large[3999].e, 'Jump preserves source order');
  await jump('tafel', 'Large', 2345); assert.equal(await value('tafel', 'Large', 2345, 'x'), null, 'Zero-current logarithm remains a gap'); near(await value('tafel', 'Large', 2345, 'rawCurrent'), 0, 'Raw zero is preserved');
  await jump('tafel', 'Large', 3100); assert.equal(await value('tafel', 'Large', 3100, 'rawPotential'), null, 'Missing raw potential is preserved');
  await jump('tafel', 'Large', 1);
  const csv = await exportBook('tafel', 'Large'); assert.equal(csv.length, 5001, 'CSV exports all original rows plus one header'); assert.equal(csv[0].length, 5, 'CSV has exactly five columns'); assert.equal(csv[0][2], '', 'CSV column C has no descriptive header');
  assert.match(csv[0][0], /原始.*电位/); assert.match(csv[0][1], /导入.*电流|原始.*电流/);
  for (let index = 0; index < raw.Large.length; index++) {
    const cells = csv[index + 1], expected = raw.Large[index]; assert.equal(cells.length, 5); assert.equal(cells[2], '', 'Every CSV spacer cell is blank');
    if (expected.e === null) assert.equal(cells[0], ''); else near(Number(cells[0]), expected.e, 'CSV A is full-precision source');
    near(Number(cells[1]), expected.current, 'CSV B is full-precision signed source');
    if (expected.e === null || expected.current === 0) { assert.equal(cells[3], ''); assert.equal(cells[4], ''); }
    else { near(Number(cells[3]), Math.log10(Math.abs(expected.current * 1000)), 'CSV D is full calculated X'); near(Number(cells[4]), expected.e - expected.current * 5 + conversion, 'CSV E is full calculated Y'); }
  }
  report.checks.push('5000-row-virtualized-BOOK-jump-and-exact-five-column-complete-CSV-retain-all-raw-rows-gaps-zero-and-signed-current');

  await resize(1280, 800); await screenshot('tafel-book-compact');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Compact view has no horizontal page overflow');
  const compact = await box(book('tafel', 'Large')); assert.ok(compact.x >= 0 && compact.y >= 0 && compact.x + compact.width <= 1281 && compact.y + compact.height <= 801); await checkTable('tafel', 'Large'); await close('tafel', 'Large');
  await importFiles('lsv', ['Alpha', 'Beta']); await add('lsv', 'Alpha').click(); await checkTable('lsv', 'Alpha'); near(await value('lsv', 'Alpha', 1, 'x'), .3 + lsvConversion, 'LSV D uses existing X formula'); await close('lsv', 'Alpha');
  await add('lsv', 'Beta').click(); const lsvBeta = await value('lsv', 'Beta', 1, 'x'); near(await value('lsv', 'Beta', 1, 'rawCurrent'), 2, 'LSV B preserves raw mA'); await close('lsv', 'Beta');
  const alphaIr = panel('lsv').getByRole('group', { name: 'Alpha IR 调整', exact: true }); await alphaIr.getByRole('spinbutton', { name: 'Alpha IR', exact: true }).fill('.1');
  await reopen('lsv', 'Alpha'); near(await value('lsv', 'Alpha', 1, 'x'), .3 + lsvConversion, 'LSV unconfirmed IR does not affect D'); await close('lsv', 'Alpha');
  await alphaIr.getByRole('button', { name: '确定', exact: true }).click(); await reopen('lsv', 'Alpha'); near(await value('lsv', 'Alpha', 1, 'x'), .3 - .1 * .001 + lsvConversion, 'LSV D follows confirmed IR expression'); near(await value('lsv', 'Alpha', 1, 'rawPotential'), .3, 'LSV A remains raw'); await close('lsv', 'Alpha');
  await reopen('lsv', 'Beta'); near(await value('lsv', 'Beta', 1, 'x'), lsvBeta, 'LSV IR changes only selected sample'); await screenshot('lsv-book-compact'); await close('lsv', 'Beta');
  report.checks.push('1280x800-compact-floating-book-stays-visible-and-LSV-calculated-DE-follow-applied-per-sample-IR-only');

  // Clean daylight documentation image uses only a labelled synthetic sample.
  await resize(1520, 1000); await page.reload(); await page.getByRole('navigation', { name: '绘图类型' }).waitFor(); await page.keyboard.press('Escape'); await importFiles('tafel', ['模拟样品']);
  await tafel.getByRole('spinbutton', { name: 'IR 电阻 Rs', exact: true }).fill('5'); await tafel.locator('.tafel-ir-card').getByRole('button', { name: '确定', exact: true }).click();
  await add('tafel', '模拟样品').click(); await book('tafel', '模拟样品').waitFor(); await checkTable('tafel', '模拟样品');
  await drag(book('tafel', '模拟样品').getByRole('button', { name: '移动 BOOK 1 · 模拟样品，可拖动或按方向键', exact: true }), -170, 140);
  await screenshot('data-book-example'); await screenshot('data-book-example-table', book('tafel', '模拟样品'));
  assert.deepEqual(report.errors, [], 'Renderer produces no errors'); report.ok = true; report.version = await page.evaluate(() => window.scientificPlot.version);
  await fs.writeFile(path.join(output, 'data-book-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, version: report.version, checks: report.checks, screenshots: report.screenshots, report: path.join(output, 'data-book-report.json') }, null, 2));
} catch (error) {
  report.ok = false; report.failure = error.stack; await fs.writeFile(path.join(output, 'data-book-report.json'), JSON.stringify(report, null, 2));
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText().catch(() => '')); }
  throw error;
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
