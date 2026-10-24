import { readFile, access } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Provide the extracted release directory.');
const node = path.join(root, 'runtime', 'node.exe');
const script = path.join(root, 'desktop', 'server.mjs');
const statePath = path.join(root, '.runtime', 'status.json');
const child = spawn(node, [script, '--no-open'], { cwd: root, windowsHide: true, stdio: 'pipe' });
let diagnostic = '';
child.stderr.on('data', chunk => { diagnostic += chunk; });
let state;
try {
  for (let i = 0; i < 100; i++) {
    try { state = JSON.parse(await readFile(statePath, 'utf8')); if (state.pid === child.pid) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(state?.pid, child.pid, `Service start: ${diagnostic}`);
  const base = `http://127.0.0.1:${state.port}`;
  const health = await (await fetch(base + '/__plotstudio/health')).json();
  assert.equal(health.version, '1.0.0');
  assert.equal(health.instanceId, state.instanceId);
  assert.equal(health.stopToken, undefined);
  const htmlResponse = await fetch(base + '/');
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  for (const asset of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) {
    assert.equal((await fetch(base + asset[1])).status, 200, asset[1]);
  }
  const helper = await fetch(base + '/origin-helper/lsv-origin-helper.zip?v=2.6');
  assert.equal(helper.status, 200);
  assert.equal(helper.headers.get('content-type'), 'application/zip');
  assert.equal((await fetch(base + '/VERSION.json')).status, 404);
  assert.equal((await fetch(base + '/.runtime/status.json')).status, 404);
  assert.equal((await fetch(base + '/__plotstudio/stop', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  execFileSync(node, [script, '--no-open'], { cwd: root, windowsHide: true });
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).pid, child.pid, 'Duplicate startup reuses own service');
  execFileSync(node, [script, '--stop'], { cwd: root, windowsHide: true });
  await new Promise(resolve => child.once('exit', resolve));
  await assert.rejects(access(statePath));
  console.log('PASS: startup, page/assets/helper, version, private files, stop authorization, duplicate startup, clean shutdown');
} finally {
  if (child.exitCode === null) {
    try { execFileSync(node, [script, '--stop'], { cwd: root, windowsHide: true }); } catch {}
    child.kill();
  }
}
