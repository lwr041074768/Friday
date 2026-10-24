import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

if (process.platform !== 'win32') {
  console.log('SKIP: portable installer integration requires Windows PowerShell.');
  process.exit(0);
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(directory, 'native', 'Install-DesktopUpdate.ps1');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'scientific-plot-update-test-'));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const processes = new Set();
const psLiteral = value => `'${value.replaceAll("'", "''")}'`;
const version = desktopVersion => JSON.stringify({ product: 'Scientific Plot Studio', desktopVersion, platform: 'win32-x64' });
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const resultOf = child => new Promise(resolve => {
  let output = '';
  child.stdout?.on('data', data => { output += data; });
  child.stderr?.on('data', data => { output += data; });
  child.once('exit', code => { processes.delete(child); resolve({ code, output }); });
  child.once('error', error => { processes.delete(child); resolve({ code: -1, output: String(error) }); });
});

try {
  const fixture = path.join(workspace, 'Fixture.exe');
  const fixtureSource = 'using System; using System.IO; using System.Threading; class Program { static void Main() { File.WriteAllText(Path.Combine(Environment.CurrentDirectory, "fixture-started.txt"), "started"); Thread.Sleep(1200); } }';
  const compiler = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -TypeDefinition ${psLiteral(fixtureSource)} -OutputAssembly ${psLiteral(fixture)} -OutputType WindowsApplication`], { windowsHide: true, encoding: 'utf8' });
  assert.equal(compiler.status, 0, `Fixture compiler failed: ${compiler.stdout} ${compiler.stderr}`);
  const exe = new Uint8Array(await fs.readFile(fixture));

  async function scenario(name, { changeArchive, changePlan, success = false, rollback = false, keepParent = false } = {}) {
    const scenarioDirectory = path.join(workspace, name);
    const install = path.join(scenarioDirectory, 'Portable App');
    const cache = path.join(scenarioDirectory, 'cache');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    await fs.mkdir(cache);
    await fs.writeFile(path.join(install, 'ScientificPlotStudio.exe'), exe);
    await fs.writeFile(path.join(install, 'VERSION.json'), version('0.3.1'));
    await fs.writeFile(path.join(install, 'resources', 'app.asar'), 'old application');
    await fs.writeFile(path.join(install, 'user-original.txt'), 'original installation');
    const entries = {
      'Release/ScientificPlotStudio.exe': exe,
      'Release/VERSION.json': strToU8(version('0.3.2')),
      'Release/resources/app.asar': strToU8('new application'),
    };
    changeArchive?.(entries);
    const archive = zipSync(entries);
    const archivePath = path.join(cache, 'update.zip');
    await fs.writeFile(archivePath, archive);
    const operationId = randomUUID();
    const coordinator = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
    processes.add(coordinator);
    coordinator.once('exit', () => processes.delete(coordinator));
    const plan = {
      schema: 'scientific-plot-update-plan/v1', operationId, parentPid: coordinator.pid,
      installDirectory: install,
      stagingDirectory: path.join(scenarioDirectory, `.ScientificPlotStudio-update-${operationId}`),
      backupDirectory: path.join(scenarioDirectory, `Portable App.backup-${operationId}`),
      archivePath, archiveSha256: hash(archive), version: '0.3.2', statusPath: path.join(cache, 'status.json'),
    };
    changePlan?.(plan);
    const planPath = path.join(cache, 'plan.json');
    await fs.writeFile(planPath, JSON.stringify(plan));
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-PlanPath', planPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.add(child);
    const done = resultOf(child);
    let prepared = false;
    let status;
    const deadline = Date.now() + (keepParent ? 145000 : 25000);
    while (Date.now() < deadline) {
      try { status = JSON.parse(await fs.readFile(plan.statusPath, 'utf8')); } catch {}
      if (status?.phase === 'prepared') {
        prepared = true;
        assert.equal(JSON.parse(await fs.readFile(path.join(install, 'VERSION.json'), 'utf8')).desktopVersion, '0.3.1', `${name}: extraction must preserve the running installation`);
        if (!keepParent) coordinator.kill();
      }
      if (child.exitCode !== null) break;
      await delay(40);
    }
    if (child.exitCode === null) { child.kill(); throw new Error(`${name}: installer timed out`); }
    const result = await done;
    coordinator.kill();
    try { status = JSON.parse(await fs.readFile(plan.statusPath, 'utf8')); } catch {}
    if (success) {
      assert.equal(result.code, 0, `${name}: ${result.output}`);
      assert.equal(status?.phase, 'complete');
      assert.ok(prepared, 'Installer must signal prepared before swapping');
      assert.equal(JSON.parse(await fs.readFile(path.join(install, 'VERSION.json'), 'utf8')).desktopVersion, '0.3.2');
      assert.equal(await fs.readFile(path.join(install, 'resources', 'app.asar'), 'utf8'), 'new application');
      assert.equal(await fs.readFile(path.join(install, 'fixture-started.txt'), 'utf8'), 'started');
      assert.equal(await fs.readFile(path.join(plan.backupDirectory, 'user-original.txt'), 'utf8'), 'original installation');
    } else {
      assert.equal(result.code, 1, `${name}: ${result.output}`);
      assert.equal(status?.phase, 'error', `${name}: ${result.output}`);
      assert.equal(JSON.parse(await fs.readFile(path.join(install, 'VERSION.json'), 'utf8')).desktopVersion, '0.3.1');
      assert.equal(await fs.readFile(path.join(install, 'user-original.txt'), 'utf8'), 'original installation');
      assert.equal(prepared, rollback || keepParent, `${name}: only a validated archive may become prepared`);
      if (rollback) assert.match(status.message, /previous installation was restored/);
    }
    console.log(`PASS: ${name}`);
  }

  await scenario('valid-update-keeps-install-path-and-backup', { success: true });
  await scenario('checksum-rejected', { changePlan: plan => { plan.archiveSha256 = '0'.repeat(64); } });
  await scenario('traversal-rejected', { changeArchive: entries => { entries['Release/../outside.txt'] = strToU8('unsafe'); } });
  await scenario('case-insensitive-duplicate-rejected', { changeArchive: entries => { entries['Release/version.JSON'] = strToU8(version('0.3.2')); } });
  await scenario('symlink-rejected', { changeArchive: entries => { entries['Release/link'] = [strToU8('../outside'), { os: 3, attrs: 0o120777 << 16 }]; } });
  await scenario('multiple-root-folders-rejected', { changeArchive: entries => { entries['Other/file.txt'] = strToU8('unsafe'); } });
  await scenario('wrong-platform-rejected', { changeArchive: entries => { entries['Release/VERSION.json'] = strToU8(JSON.stringify({ product: 'Scientific Plot Studio', desktopVersion: '0.3.2', platform: 'linux-x64' })); } });
  await scenario('wrong-version-rejected', { changeArchive: entries => { entries['Release/VERSION.json'] = strToU8(version('0.3.9')); } });
  await scenario('launch-failure-restores-previous-installation', { rollback: true, changeArchive: entries => { entries['Release/ScientificPlotStudio.exe'] = strToU8('not an executable'); } });
  // The real 120-second deadline is exercised only on request to keep normal checks short.
  if (process.argv.includes('--timeout')) await scenario('parent-timeout-preserves-installation', { keepParent: true });
  console.log('PASS: Windows portable update validation, preparation, installation, backup and rollback.');
} finally {
  for (const child of processes) child.kill();
  // Never recursively remove a computed path unless it is our verified temporary root.
  const resolved = path.resolve(workspace);
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith('scientific-plot-update-test-'));
  await delay(1600);
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
