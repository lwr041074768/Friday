import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, stat, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDirectory = path.join(root, 'app');
const stateDirectory = path.join(root, '.runtime');
const statePath = path.join(stateDirectory, 'status.json');
const appId = 'ScientificPlotStudio';
const rootHash = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex');
const manifest = JSON.parse(await readFile(path.join(root, 'VERSION.json'), 'utf8'));
const version = manifest.appVersion;
const noOpen = process.argv.includes('--no-open');
const timeout = () => AbortSignal.timeout(1500);
let ownedState;
let startupLock;
const lockPath = path.join(stateDirectory, 'start.lock');

async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; }
}

async function healthy(state) {
  if (!state || state.appId !== appId || state.rootHash !== rootHash || state.version !== version ||
      !Number.isInteger(state.port) || state.port < 40428 || state.port > 40438) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/__plotstudio/health`, { signal: timeout(), redirect: 'error' });
    const body = await response.json();
    return response.ok && body.appId === appId && body.version === version && body.rootHash === rootHash &&
      body.instanceId === state.instanceId && body.pid === state.pid;
  } catch { return false; }
}

function openBrowser(port) {
  if (noOpen) return;
  const url = `http://127.0.0.1:${port}/`;
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const command = process.platform === 'win32' ? path.join(systemRoot, 'explorer.exe') : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

async function removeOwnedState() {
  const current = await readState();
  if (ownedState && current?.instanceId === ownedState.instanceId) await unlink(statePath).catch(() => {});
}

async function acquireStartupLock() {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      startupLock = await open(lockPath, 'wx');
      await startupLock.writeFile(JSON.stringify({ pid: process.pid }));
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await readState();
      if (await healthy(current)) { openBrowser(current.port); return false; }
      try {
        const lockText = await readFile(lockPath, 'utf8');
        const lock = JSON.parse(lockText);
        if (!Number.isInteger(lock?.pid) || lock.pid <= 0) throw new Error('Invalid startup lock.');
        if (Number.isInteger(lock.pid) && lock.pid > 0) {
          let running = true;
          try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
          if (!running && await readFile(lockPath, 'utf8') === lockText) await unlink(lockPath);
        }
      } catch {
        // A crash before the PID write can leave an empty lock. Only reclaim
        // invalid, unchanged content after the startup timeout has elapsed.
        try {
          const text = await readFile(lockPath, 'utf8');
          let valid = false;
          try { const lock = JSON.parse(text); valid = Number.isInteger(lock.pid) && lock.pid > 0; } catch {}
          const info = await stat(lockPath);
          if (!valid && Date.now() - info.mtimeMs > 30000 && await readFile(lockPath, 'utf8') === text) await unlink(lockPath);
        } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Another startup is still in progress. Retry shortly.');
}

async function releaseStartupLock() {
  if (startupLock) { await startupLock.close(); startupLock = null; await unlink(lockPath).catch(() => {}); }
}

async function main() {
  await mkdir(stateDirectory, { recursive: true });
  const existing = await readState();
  if (process.argv.includes('--stop')) {
    if (await healthy(existing)) {
      const response = await fetch(`http://127.0.0.1:${existing.port}/__plotstudio/stop`, {
        method: 'POST', headers: { Authorization: `Bearer ${existing.stopToken}` }, signal: timeout(), redirect: 'error',
      });
      if (!response.ok) throw new Error('The local plotting service refused the stop request.');
    }
    return;
  }
  if (await healthy(existing)) { openBrowser(existing.port); return; }
  if (!await acquireStartupLock()) return;
  await stat(path.join(appDirectory, 'index.html'));
  const instanceId = randomBytes(16).toString('hex');
  const stopToken = randomBytes(32).toString('hex');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.ps1': 'text/plain; charset=utf-8', '.cs': 'text/plain; charset=utf-8' };
  const server = http.createServer(async (request, response) => {
    const port = ownedState?.port;
    if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) {
      response.writeHead(403); response.end('Invalid host'); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname); }
    catch { response.writeHead(400); response.end('Invalid path'); return; }
    if (pathname === '/__plotstudio/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ appId, version, rootHash, instanceId, pid: process.pid, port })); return;
    }
    if (pathname === '/__plotstudio/stop') {
      const origin = request.headers.origin;
      const allowedOrigin = !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
      if (request.method !== 'POST' || !allowedOrigin || request.headers.authorization !== `Bearer ${stopToken}`) {
        response.writeHead(403); response.end('Stop request denied'); return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('Stopped');
      server.close(async () => { await removeOwnedState(); });
      server.closeIdleConnections();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    if (pathname.includes('\\') || pathname.includes('\0')) { response.writeHead(400); response.end(); return; }
    const target = path.resolve(appDirectory, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(appDirectory + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const info = await stat(target);
      if (!info.isFile()) { response.writeHead(404); response.end(); return; }
      const data = request.method === 'HEAD' ? null : await readFile(target);
      response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(data);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  let selectedPort;
  for (let port = 40428; port <= 40438; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError); server.once('listening', onListening); server.listen(port, '127.0.0.1');
      });
      selectedPort = port; break;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  if (!selectedPort) throw new Error('Ports 40428-40438 are occupied. Close another plotting service and retry.');
  ownedState = { appId, version, rootHash, instanceId, stopToken, pid: process.pid, port: selectedPort };
  const temporaryState = path.join(stateDirectory, instanceId + '.tmp');
  await writeFile(temporaryState, JSON.stringify(ownedState, null, 2), { mode: 0o600 });
  await rename(temporaryState, statePath);
  await releaseStartupLock();
  server.on('error', async error => {
    await writeFile(path.join(stateDirectory, 'error.log'), String(error));
    await removeOwnedState(); process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(async () => { await removeOwnedState(); }); server.closeIdleConnections();
  });
  console.log(JSON.stringify({ appId, version, port: selectedPort, pid: process.pid }));
  openBrowser(selectedPort);
}

main().catch(async error => {
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(path.join(stateDirectory, 'error.log'), String(error.stack || error));
  await removeOwnedState(); await releaseStartupLock(); console.error(error.message); process.exit(1);
});
