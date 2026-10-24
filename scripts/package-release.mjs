import { readFile, writeFile, mkdir, cp, readdir, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const runtimeDirectory = option('--runtime-dir');
if (!runtimeDirectory || process.platform !== 'win32') throw new Error('Build on Windows: --runtime-dir <verified official extracted Node Windows x64 directory>');
const output = path.resolve(option('--output') || path.join(root, 'release'));
const outputRelative = path.relative(root, output);
if (outputRelative === '' || (!outputRelative.startsWith('..' + path.sep) && !path.isAbsolute(outputRelative) &&
    outputRelative.split(path.sep)[0] !== 'release')) {
  throw new Error('Use an output directory outside the repository or inside its ignored release/ directory.');
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const appVersion = pkg.version;
const helperVersion = '2.6.0';
const nodeVersion = execFileSync(path.join(runtimeDirectory, 'node.exe'), ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (nodeVersion !== 'v24.15.0') throw new Error('This release is pinned to official Node.js v24.15.0 Windows x64.');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()) {
  throw new Error('Commit the reviewed source before packaging a release.');
}
await access(path.join(root, 'dist', 'index.html'));
await access(path.join(runtimeDirectory, 'LICENSE'));
await mkdir(output, { recursive: true });
const directoryName = `scientific-plot-studio-${appVersion}-windows-x64`;
const packageRoot = path.join(output, directoryName);
try { await access(packageRoot); throw new Error(`Output already exists; choose a fresh output directory: ${packageRoot}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(packageRoot);
await cp(path.join(root, 'dist'), path.join(packageRoot, 'app'), { recursive: true });
await mkdir(path.join(packageRoot, 'runtime'));
await cp(path.join(runtimeDirectory, 'node.exe'), path.join(packageRoot, 'runtime', 'node.exe'));
await cp(path.join(runtimeDirectory, 'LICENSE'), path.join(packageRoot, 'runtime', 'NODE-LICENSE.txt'));
await mkdir(path.join(packageRoot, 'desktop'));
for (const name of ['server.mjs', 'Install.ps1']) await cp(path.join(root, 'desktop', name), path.join(packageRoot, 'desktop', name));
// Windows PowerShell 5.1 reads UTF-8 with BOM correctly even on Chinese Windows.
for (const name of ['Install.ps1']) {
  const target = path.join(packageRoot, 'desktop', name);
  await writeFile(target, '\ufeff' + await readFile(target, 'utf8'));
}
for (const name of ['启动.cmd', '停止.cmd', '安装.cmd']) {
  const data = (await readFile(path.join(root, 'desktop', name), 'utf8')).replace(/\r?\n/g, '\r\n');
  await writeFile(path.join(packageRoot, name), data);
}
for (const name of ['LICENSE', 'README.md', 'CHANGELOG.md', 'third-party', 'docs']) {
  await cp(path.join(root, name), path.join(packageRoot, name), { recursive: true });
}
const manifest = { product: 'Scientific Plot Studio', appVersion, originHelperVersion: helperVersion,
  nodeVersion: nodeVersion.replace(/^v/, ''), platform: 'windows-x64', sourceCommit, builtAt: new Date().toISOString() };
await writeFile(path.join(packageRoot, 'VERSION.json'), JSON.stringify(manifest, null, 2) + '\n');
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
execFileSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'desktop', 'Build-Launcher.ps1'),
  '-OutputPath', path.join(packageRoot, 'ScientificPlotStudio.exe')], { encoding: 'utf8', windowsHide: true });

async function zipTree(base, prefix = '', include = () => true, extraEntries = {}) {
  const entries = {};
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativeName = relative ? `${relative}/${entry.name}` : entry.name;
      if (!include(relativeName, entry)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in release: ${target}`);
      if (entry.isDirectory()) await walk(target, relativeName);
      else if (entry.isFile()) entries[prefix + relativeName] = new Uint8Array(await readFile(target));
    }
  }
  await walk(base);
  Object.assign(entries, extraEntries);
  return zipSync(entries, { level: 6 });
}
const assets = [];
const desktopName = `${directoryName}.zip`;
await writeFile(path.join(output, desktopName), await zipTree(packageRoot, directoryName + '/'));
assets.push(desktopName);
const helperName = `origin-helper-${helperVersion}-windows.zip`;
const helperFiles = {};
for (const entry of await readdir(path.join(root, 'public', 'origin-helper'))) {
  if (entry.endsWith('.zip')) continue;
  helperFiles[`origin-helper-${helperVersion}/${entry}`] = new Uint8Array(await readFile(path.join(root, 'public', 'origin-helper', entry)));
}
helperFiles[`origin-helper-${helperVersion}/LICENSE`] = strToU8(await readFile(path.join(root, 'LICENSE'), 'utf8'));
helperFiles[`origin-helper-${helperVersion}/VERSION.json`] = strToU8(JSON.stringify({ product: 'Scientific Plot Studio Origin Helper', version: helperVersion, sourceCommit }, null, 2));
await writeFile(path.join(output, helperName), zipSync(helperFiles, { level: 6 }));
assets.push(helperName);
const sourceName = `scientific-plot-studio-${appVersion}-source.zip`;
const excluded = new Set(['node_modules', 'dist', '.git', '.runtime', 'release']);
await writeFile(path.join(output, sourceName), await zipTree(root, `scientific-plot-studio-${appVersion}-source/`, relative =>
  !excluded.has(relative.split('/')[0]) && !relative.split('/').some(name => name.startsWith('.env')) && !relative.endsWith('.log'), {
    [`scientific-plot-studio-${appVersion}-source/VERSION.json`]: strToU8(JSON.stringify(manifest, null, 2) + '\n'),
  }));
assets.push(sourceName);
let sums = '';
for (const name of assets) {
  const file = path.join(output, name);
  const info = await stat(file);
  if (info.size > 100 * 1024 * 1024) throw new Error(`${name} exceeds ordinary Gitee release single-asset limit.`);
  sums += createHash('sha256').update(await readFile(file)).digest('hex') + '  ' + name + '\n';
  console.log(`${name}: ${(info.size / 1024 / 1024).toFixed(2)} MiB`);
}
await writeFile(path.join(output, 'SHA256SUMS.txt'), sums);
console.log(`Release staged: ${output}`);
