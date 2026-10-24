import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
const version = manifest.devDependencies.electron;
const artifact = `electron-v${version}-win32-x64.zip`;
const runtime = path.join(directory, 'build/runtime');
const archive = path.join(runtime, artifact);
const expected = require('electron/checksums.json')[artifact];
if (!expected) throw Error('No official checksum for the selected Electron runtime.');
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
await fs.mkdir(runtime, { recursive: true });
let valid = false;
try { valid = await digest(archive) === expected; } catch { /* not downloaded */ }
if (!valid) {
  const url = `https://github.com/electron/electron/releases/download/v${version}/${artifact}`;
  const quote = text => "'" + text.replace(/'/g, "''") + "'";
  console.log(`Downloading official Electron ${version} Windows runtime…`);
  await new Promise((resolve, reject) => {
    const source = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri ${quote(url)} -OutFile ${quote(archive)} -TimeoutSec 600`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`Runtime download failed: ${code}`)));
  });
  if (await digest(archive) !== expected) throw Error('Electron runtime checksum did not match the official npm manifest.');
}
const electronPackage = path.dirname(require.resolve('electron/package.json'));
const { extract } = require('@electron-internal/extract-zip');
await extract(archive, { dir: path.join(electronPackage, 'dist') });
await fs.writeFile(path.join(electronPackage, 'path.txt'), 'electron.exe');
console.log(`Official runtime verified and installed: ${version}`);
