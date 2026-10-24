import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
if (!option('--playwright')) throw Error('Provide --playwright <installed playwright/index.mjs>.');
const { _electron: electron } = await import(pathToFileURL(path.resolve(option('--playwright'))).href);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ScientificPlotStudio-Update-Main-Test-'));
const isolated = path.join(temporary, 'app'), profile = path.join(temporary, 'profile');
const archive = path.join(temporary, 'fixture.zip');
const archiveBytes = Buffer.from('tiny archive fixture; all tests stop before installer launch');
const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
const exported = path.join(temporary, 'held-export.csv');
const checks = [];
let app;

try {
  await fs.cp(path.join(directory, 'build/app'), isolated, { recursive: true });
  await fs.mkdir(profile);
  await fs.writeFile(archive, archiveBytes);
  const main = path.join(isolated, 'main.cjs');
  const source = await fs.readFile(main, 'utf8');
  const profileMarker = "app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
  const fixtureMarker = 'if (!app.requestSingleInstanceLock())';
  const processMarker = "const { execFile, spawn } = require('node:child_process');";
  const nameMarker = "app.setName('ScientificPlotStudio');";
  for (const marker of [profileMarker, fixtureMarker, processMarker, nameMarker, 'let window, originBusy = false, jadeBusy = null, exportBusy = 0;', 'const pendingDownloads = new Set();', 'let filePickerBusy = false;']) {
    assert.ok(source.includes(marker), `Rebuild the application before running main-process regression: missing ${marker}`);
  }
  // Only a copied app/profile is modified. Keep production IPC handlers intact;
  // deny child-process launches so a failed assertion can never start an updater.
  const processFixture = `const execFile = (...args) => { globalThis.__updateMainFixture.nativeSpawns++; queueMicrotask(() => args.at(-1)(Error('Regression fixture refuses all native launches.'), '', '')); };
const spawn = (...args) => { globalThis.__updateMainFixture.helperSpawns++; throw Error('Regression fixture refuses all helper launches.'); };`;
  const fixture = `
Object.defineProperty(app, 'isPackaged', { configurable: true, get: () => true });
const originalFixtureWrite = fs.writeFile.bind(fs);
const updateMainFixture = globalThis.__updateMainFixture = {
  helperSpawns: 0, nativeSpawns: 0, dialogs: [], saveDialogs: 0, holdWrite: false, writeEntered: false, releaseWrite: null,
  archive: { path: ${JSON.stringify(archive)}, sha256: ${JSON.stringify(archiveSha256)}, version: '99.0.0' },
  reset() {
    originBusy = false; jadeBusy = null; exportBusy = 0; pendingDownloads.clear(); filePickerBusy = false; updatePreparing = false;
    this.dialogs = []; this.holdWrite = false; this.writeEntered = false; this.releaseWrite = null;
    updater.installCancelled();
  },
  busy(kind) {
    if (kind === 'origin') originBusy = true;
    if (kind === 'jade') jadeBusy = '00000000-0000-4000-8000-000000000000';
    if (kind === 'export') exportBusy = 1;
    if (kind === 'download') pendingDownloads.add({ fixture: true });
    if (kind === 'picker') filePickerBusy = true;
  },
  preparing(value) { updatePreparing = value; },
  snapshot() { return { state: updater.getState(), originBusy, jadeBusy, exportBusy, downloads: pendingDownloads.size, filePickerBusy, updatePreparing, helperSpawns: this.helperSpawns, nativeSpawns: this.nativeSpawns, dialogs: this.dialogs, saveDialogs: this.saveDialogs, writeEntered: this.writeEntered }; },
};
updater.getArchive = () => ({ ...updateMainFixture.archive });
updater.installCancelled();
dialog.showMessageBox = async (_window, options) => { updateMainFixture.dialogs.push(options); return { response: 0 }; };
dialog.showSaveDialog = async () => { updateMainFixture.saveDialogs++; return { canceled: false, filePath: ${JSON.stringify(exported)} }; };
fs.writeFile = async (file, ...args) => {
  if (updateMainFixture.holdWrite && path.resolve(String(file)) === ${JSON.stringify(exported)}) {
    updateMainFixture.writeEntered = true;
    await new Promise(resolve => { updateMainFixture.releaseWrite = resolve; });
  }
  return originalFixtureWrite(file, ...args);
};
`;
  await fs.writeFile(main, source.replace(profileMarker, `app.setPath('userData', ${JSON.stringify(profile)});`)
    .replace(nameMarker, "app.setName('ScientificPlotStudio-Update-Main-Test');")
    .replace(processMarker, processFixture).replace(fixtureMarker, fixture + '\n' + fixtureMarker));
  app = await electron.launch({ executablePath: path.resolve(option('--electron') || path.join(directory, 'node_modules/electron/dist/electron.exe')), args: [isolated], timeout: 30000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: '绘图类型' }).waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const snapshot = () => app.evaluate(() => globalThis.__updateMainFixture.snapshot());
  const reset = () => app.evaluate(() => globalThis.__updateMainFixture.reset());
  const install = () => page.evaluate(() => window.scientificPlot.installUpdate());

  for (const kind of ['origin', 'jade', 'export', 'download', 'picker']) {
    await reset();
    await app.evaluate((_electron, kind) => globalThis.__updateMainFixture.busy(kind), kind);
    assert.deepEqual(await install(), { started: false });
    const state = await snapshot();
    assert.equal(state.state.phase, 'error'); assert.equal(state.state.retryAction, 'install');
    assert.match(state.state.error, kind === 'origin' || kind === 'jade' ? /Origin 或 JADE 连接仍在进行/ : /数据导入或导出仍在进行/);
    assert.equal(state.dialogs.length, 0, 'Busy operations must be rejected before restart confirmation.');
    assert.equal(state.helperSpawns, 0); assert.equal(state.updatePreparing, false);
    checks.push(`installation-blocked-during-${kind}`);
  }

  await reset();
  await page.evaluate(() => { const curve = document.createElement('div'); curve.id = 'fixture-unsaved-curve'; curve.className = 'lsv-managed-curve'; document.body.append(curve); });
  assert.deepEqual(await install(), { started: false });
  let state = await snapshot();
  assert.equal(state.dialogs.length, 1); assert.equal(state.state.phase, 'ready');
  assert.match(state.dialogs[0].detail, /当前绘图数据.*先取消并导出/);
  assert.equal(state.dialogs[0].buttons[0], '取消，先保存数据');
  assert.equal(state.helperSpawns, 0); assert.equal(state.updatePreparing, false);
  await page.evaluate(() => document.getElementById('fixture-unsaved-curve').remove());
  checks.push('cancel-restart-with-unsaved-data-keeps-ready-archive-and-app');

  await reset();
  await app.evaluate(() => { globalThis.__updateMainFixture.holdWrite = true; });
  await page.evaluate(() => {
    window.__pendingFixtureExport = window.scientificPlot.saveDataFile({ filename: 'held-export.csv', mime: 'text/csv', text: 'x,y\n1,2\n' });
  });
  await app.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if (globalThis.__updateMainFixture.writeEntered) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('The native export never reached its asynchronous file write.');
  });
  assert.equal((await snapshot()).exportBusy, 1, 'The production export IPC must hold its busy flag while writing.');
  assert.deepEqual(await install(), { started: false });
  state = await snapshot(); assert.match(state.state.error, /数据导入或导出仍在进行/); assert.equal(state.dialogs.length, 0);
  await app.evaluate(() => globalThis.__updateMainFixture.releaseWrite());
  assert.deepEqual(await page.evaluate(() => window.__pendingFixtureExport), { saved: true, fileName: path.basename(exported) });
  assert.equal((await snapshot()).exportBusy, 0, 'Completed writes must release the production export guard.');
  assert.equal(await fs.readFile(exported, 'utf8'), 'x,y\n1,2\n');
  assert.equal((await snapshot()).helperSpawns, 0);
  checks.push('real-native-save-write-blocks-update-until-write-completes');

  await reset();
  await app.evaluate(() => globalThis.__updateMainFixture.preparing(true));
  const blocked = await page.evaluate(async () => {
    const api = window.scientificPlot;
    const calls = [
      () => api.exportOrigin('{}'), () => api.exportOverpotential('{}'), () => api.exportCdl('{}'),
      () => api.readJade('00000000-0000-4000-8000-000000000000'),
      () => api.saveDataFile({ filename: 'blocked.csv', mime: 'text/csv', text: 'x,y\n1,2' }),
      () => api.chooseDataFiles('lsv'), () => api.chooseCdlFolder(),
    ];
    const errors = [];
    for (const call of calls) { try { await call(); errors.push(null); } catch (error) { errors.push(error.message); } }
    return errors;
  });
  assert.equal(blocked.length, 7); for (const error of blocked) assert.match(error, /正在准备更新/);
  state = await snapshot(); assert.equal(state.helperSpawns, 0); assert.equal(state.saveDialogs, 1);
  assert.equal(state.originBusy, false); assert.equal(state.jadeBusy, null); assert.equal(state.filePickerBusy, false); assert.equal(state.exportBusy, 0);
  await reset();
  checks.push('confirmed-preparation-blocks-new-native-import-export-and-picker-work');

  const updates = path.join(profile, 'Updates');
  let entries = []; try { entries = await fs.readdir(updates); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.deepEqual(entries, [], 'Rejected or canceled updates must not create installation plans.');
  assert.equal((await snapshot()).nativeSpawns, 0, 'Preparation gates must reject work before any native process launch.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: checks.length, names: checks, isolatedProfile: true, helperSpawns: (await snapshot()).helperSpawns }));
} finally {
  if (app) {
    await app.evaluate(({ app }) => { globalThis.__updateMainFixture?.releaseWrite?.(); app.exit(0); }).catch(() => {});
    await app.close().catch(() => {});
  }
  const resolved = path.resolve(temporary);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^ScientificPlotStudio-Update-Main-Test-/);
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
