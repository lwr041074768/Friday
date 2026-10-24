import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const value = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const output = path.resolve(value('--output') || path.join(directory, 'output/updater-ui'));
const playwright = value('--playwright');
if (!playwright) throw Error('Provide --playwright <installed playwright/index.mjs>.');
const { _electron: electron } = await import(pathToFileURL(path.resolve(playwright)).href);
const screenshots = path.join(output, 'screenshots');
const isolated = path.join(output, 'isolated-app');
const profile = path.join(output, `profile-${Date.now()}`);
for (const folder of [screenshots, profile]) await fs.mkdir(folder, { recursive: true });
await fs.cp(path.join(directory, 'build/app'), isolated, { recursive: true });

// Replace only updater IPC in an isolated copy. Tests cannot contact a release
// server, launch an installer, or modify the user's actual application profile.
const sourcePath = path.join(isolated, 'main.cjs');
const source = await fs.readFile(sourcePath, 'utf8');
const profileMarker = "app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
const fixtureMarker = 'if (!app.requestSingleInstanceLock())';
assert.ok(source.includes(profileMarker), 'Main-process profile marker is required.');
assert.ok(source.includes(fixtureMarker), 'Main-process startup marker is required.');
const fixture = `
const updateUiFixture = globalThis.__updateUiFixture = {
  state: { phase: 'idle', currentVersion: app.getVersion() },
  calls: { state: 0, check: 0, download: 0, install: 0 },
  checkResult: { phase: 'current', currentVersion: app.getVersion(), version: app.getVersion() },
  holdCheck: true,
  installMode: 'cancel',
  emit(next) {
    this.state = { ...this.state, ...next };
    if (window && !window.isDestroyed()) window.webContents.send('studio:update-state', this.state);
    return this.state;
  },
  finishCheck(next) {
    const state = this.emit(next || this.checkResult);
    this.resolveCheck?.(state); this.resolveCheck = null;
  },
  finishDownload(next) {
    const state = this.emit(next);
    this.resolveDownload?.(state); this.resolveDownload = null;
  },
};
for (const channel of ['studio:update-state', 'studio:update-check', 'studio:update-download', 'studio:update-install']) ipcMain.removeHandler(channel);
ipcMain.handle('studio:update-state', () => { updateUiFixture.calls.state++; return updateUiFixture.state; });
ipcMain.handle('studio:update-check', async () => {
  updateUiFixture.calls.check++;
  updateUiFixture.emit({ phase: 'checking', error: undefined, retryAction: undefined });
  if (updateUiFixture.holdCheck) return new Promise(resolve => { updateUiFixture.resolveCheck = resolve; });
  return updateUiFixture.emit(updateUiFixture.checkResult);
});
ipcMain.handle('studio:update-download', async () => {
  updateUiFixture.calls.download++;
  updateUiFixture.emit({ phase: 'downloading', downloadedBytes: 0, totalBytes: 104857600, percent: 0, error: undefined, retryAction: undefined });
  return new Promise(resolve => { updateUiFixture.resolveDownload = resolve; });
});
ipcMain.handle('studio:update-install', () => {
  updateUiFixture.calls.install++;
  if (updateUiFixture.installMode === 'cancel') { updateUiFixture.emit({ phase: 'ready' }); return { started: false }; }
  if (updateUiFixture.installMode === 'fail') { updateUiFixture.emit({ phase: 'error', retryAction: 'install', error: '测试：更新准备失败，可重试。' }); return { started: false }; }
  updateUiFixture.emit({ phase: 'installing', error: undefined, retryAction: undefined });
  return { started: true };
});
`;
await fs.writeFile(sourcePath, source.replace(profileMarker, `app.setPath('userData', ${JSON.stringify(profile)});`).replace(fixtureMarker, fixture + '\n' + fixtureMarker));

const app = await electron.launch({
  executablePath: path.resolve(value('--electron') || path.join(directory, 'node_modules/electron/dist/electron.exe')),
  args: [isolated], timeout: 30000,
});
const report = { checks: [], screenshots: [], layouts: [], mocked: 'Only updater IPC is intercepted; real Electron preload, renderer, menu, modal, and theme are exercised.' };
let page;
try {
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '绘图类型' }).waitFor();
  const trigger = page.getByRole('button', { name: '检查更新', exact: true });
  const dialog = page.locator('dialog.desktop-update-dialog');
  const heading = title => dialog.getByRole('heading', { name: title, exact: true });
  const calls = () => app.evaluate(() => ({ ...globalThis.__updateUiFixture.calls }));
  async function screenshot(name) {
    const file = path.join(screenshots, `${name}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  }
  async function resize(width) {
    await app.evaluate(({ BrowserWindow }, width) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); window.focus(); window.setContentSize(width, 920); }, width);
    await page.waitForFunction(width => innerWidth === width, width);
  }
  async function checkLayout(width) {
    await resize(width);
    const layout = await page.locator('.lsv-header').evaluate(header => ({
      viewport: innerWidth, width: header.clientWidth, scroll: header.scrollWidth,
      children: [...header.children].map(node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; }),
    }));
    assert.ok(layout.scroll <= layout.width + 1, `Header overflows at ${width}px: ${JSON.stringify(layout)}`);
    for (const box of layout.children) assert.ok(box.left >= 0 && box.right <= layout.viewport + 1, `Header child leaves viewport at ${width}px.`);
    for (let index = 1; index < layout.children.length; index++) assert.ok(layout.children[index].left >= layout.children[index - 1].right - 1, `Header items overlap at ${width}px.`);
    report.layouts.push(layout);
  }
  const dayToggle = page.getByRole('button', { name: '切换到白天模式', exact: true });
  if (await dayToggle.count()) await dayToggle.click();
  await checkLayout(1000);
  await screenshot('01-header-1000-day');
  await checkLayout(1520);
  assert.equal((await calls()).check, 0, 'Startup must not automatically check releases.');
  assert.equal((await calls()).download, 0);
  assert.equal(await dialog.isVisible(), false);
  report.checks.push('manual-only-check-and-header-fits-1000-and-1520');

  await trigger.click();
  await heading('正在检查更新').waitFor();
  assert.equal((await calls()).check, 1);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '帮助').submenu.items.find(item => item.label === '检查更新…').click());
  assert.equal((await calls()).check, 1, 'Busy checks must not be duplicated by the menu.');
  assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Native modal must keep keyboard focus inside.');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.classList.contains('desktop-update-trigger'));
  await trigger.click();
  await heading('正在检查更新').waitFor();
  assert.equal((await calls()).check, 1, 'Reopening a busy check must reuse it.');
  await app.evaluate(() => globalThis.__updateUiFixture.finishCheck());
  await heading('当前已是最新版本').waitFor();
  assert.equal(await dialog.locator('dd').count(), 2);
  await screenshot('02-current-1520-day');
  report.checks.push('current-version-native-focus-trap-esc-return-focus-and-busy-deduplication');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const notes = '修复数据导入问题\n<img src=x onerror="window.__updateNotesExecuted=true">\n<script>window.__updateNotesExecuted=true</script>\n保留所有原始数据。';
  await app.evaluate((_electron, notes) => {
    const fixture = globalThis.__updateUiFixture;
    fixture.holdCheck = false;
    fixture.checkResult = { phase: 'available', currentVersion: fixture.state.currentVersion, version: '99.0.0', publishedAt: '2026-10-16T03:00:00Z', notes };
  }, notes);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '帮助').submenu.items.find(item => item.label === '检查更新…').click());
  await heading('发现新版本').waitFor();
  assert.equal((await calls()).check, 2);
  assert.equal((await calls()).download, 0, 'Finding a release must not start a download.');
  assert.equal(await dialog.locator('.desktop-update-notes p').textContent(), notes);
  assert.equal(await dialog.locator('.desktop-update-notes img, .desktop-update-notes script').count(), 0);
  assert.equal(await page.evaluate(() => window.__updateNotesExecuted), undefined);
  assert.equal(await dialog.locator('dd').last().textContent(), 'v99.0.0');
  await screenshot('03-available-1520-day');
  await checkLayout(1000);
  await screenshot('04-available-1000-day');
  report.checks.push('help-menu-check-available-version-release-date-plaintext-notes-no-auto-download');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换到夜晚模式', exact: true }).click();
  await trigger.click();
  await heading('发现新版本').waitFor();
  assert.equal((await calls()).check, 2, 'An available release should reopen without a redundant network check.');
  const night = await dialog.evaluate(node => { const style = getComputedStyle(node); return { background: style.backgroundColor, color: style.color }; });
  assert.equal(night.background, 'rgb(0, 0, 0)');
  assert.equal(night.color, 'rgb(255, 255, 255)');
  await screenshot('05-available-1000-night');
  await checkLayout(1520);
  await screenshot('06-available-1520-night');
  report.checks.push('day-and-night-dialog-and-compact-header');

  await app.evaluate(() => globalThis.__updateUiFixture.emit({ phase: 'error', error: '测试：无法获取版本信息。', retryAction: 'check' }));
  await dialog.getByRole('alert').waitFor();
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
  await heading('发现新版本').waitFor();
  assert.equal((await calls()).check, 3);
  report.checks.push('check-failure-retry-action');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dialog.getByRole('button', { name: '下载更新', exact: true }).click();
  await heading('正在下载更新').waitFor();
  assert.equal((await calls()).download, 1);
  await app.evaluate(() => globalThis.__updateUiFixture.emit({ phase: 'downloading', downloadedBytes: 41943040, totalBytes: 104857600, percent: 40 }));
  await page.waitForFunction(() => document.querySelector('.desktop-update-progress progress')?.value === 40);
  assert.match(await dialog.locator('.desktop-update-progress').innerText(), /40%/);
  assert.match(await dialog.locator('.desktop-update-progress').innerText(), /40\.0 MB \/ 100\.0 MB/);
  assert.equal(await dialog.locator('.desktop-update-spinner').evaluate(node => getComputedStyle(node).animationName), 'none');
  await screenshot('07-downloading-night');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await trigger.click();
  await heading('正在下载更新').waitFor();
  assert.equal(await dialog.locator('progress').getAttribute('value'), '40');
  assert.equal((await calls()).check, 3);
  assert.equal((await calls()).download, 1);
  report.checks.push('download-progress-background-reopen-preserves-transfer-and-reduced-motion');

  await app.evaluate(() => globalThis.__updateUiFixture.finishDownload({ phase: 'error', retryAction: 'download', error: '测试：下载中断。' }));
  await dialog.getByRole('button', { name: '重新下载', exact: true }).click();
  await heading('正在下载更新').waitFor();
  assert.equal((await calls()).download, 2);
  assert.equal((await calls()).check, 3);
  await app.evaluate(() => globalThis.__updateUiFixture.finishDownload({ phase: 'ready', downloadedBytes: 104857600, totalBytes: 104857600, percent: 100, error: undefined, retryAction: undefined }));
  await heading('更新已准备就绪').waitFor();
  await screenshot('08-ready-night');
  await dialog.getByRole('button', { name: '重启并更新', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.desktop-update-actions .desktop-update-primary')?.disabled);
  await heading('更新已准备就绪').waitFor();
  assert.equal((await calls()).install, 1, 'Canceled native confirmation must return to ready.');
  await app.evaluate(() => { globalThis.__updateUiFixture.installMode = 'fail'; });
  await dialog.getByRole('button', { name: '重启并更新', exact: true }).click();
  await heading('更新未完成').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(), /更新准备失败/);
  assert.equal((await calls()).install, 2);
  await screenshot('09-install-error-night');
  await app.evaluate(() => { globalThis.__updateUiFixture.installMode = 'success'; });
  await dialog.getByRole('button', { name: '重试安装', exact: true }).click();
  await heading('正在准备更新').waitFor();
  assert.equal((await calls()).install, 3);
  assert.equal(await dialog.getByRole('button', { name: '关闭更新窗口', exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'Confirmed installation must retain the modal lock.');
  assert.equal(await dialog.evaluate(node => node.matches(':modal')), true);
  await page.locator('.lsv-tabs a').first().evaluate(node => node.focus());
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'The installing modal must prevent focus returning to the workbench.');
  await screenshot('10-installing-locked-night');
  report.checks.push('download-retry-ready-install-confirmation-cancel-install-retry-and-confirmed-restart-lock');

  assert.deepEqual(errors, []);
  report.ok = true;
  report.errors = errors;
  report.calls = await calls();
  report.version = await page.evaluate(() => window.scientificPlot.version);
  await fs.writeFile(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, version: report.version, checks: report.checks, calls: report.calls, screenshots: report.screenshots.length, output }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'ui-error.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'ui-error.txt'), await page.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
}
