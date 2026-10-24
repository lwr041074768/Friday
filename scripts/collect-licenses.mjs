import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Collect exact upstream files from the installed versions in package-lock.json.
// Run after npm ci: node scripts/collect-licenses.mjs
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const thirdParty = path.join(root, 'third-party');
const licenseRoot = path.join(thirdParty, 'licenses');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
if (!lock.packages) throw new Error('A package-lock.json with a packages table is required.');

const cssPackages = new Set(['node_modules/tailwindcss', 'node_modules/tw-animate-css']);
const production = Object.entries(lock.packages)
  .filter(([key, value]) => key.startsWith('node_modules/') && value.dev !== true)
  .sort(([a], [b]) => a.localeCompare(b, 'en'));
const supplementary = [...cssPackages]
  .filter(key => lock.packages[key]?.dev === true)
  .map(key => [key, lock.packages[key]]);

// The published package omits LICENSE. This is an original file from a pinned
// official upstream commit, with the version-linkage limitation kept explicit.
const upstreamLicenses = new Map([['react-remove-scroll-bar@2.3.8', {
  commit: '8ca9ba5ea52de03308fe8ced94f7b159a44d28ff',
  packageVersion: '2.3.7',
  sha256: 'a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84',
}]]);
const refreshUpstream = process.argv.includes('--fetch-upstream');

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function licenseFiles(directory, relative = '') {
  const files = [];
  for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const child = path.join(relative, entry.name);
    // Each nested dependency has its own lock entry and destination.
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      files.push(...await licenseFiles(directory, child));
    } else if (entry.isFile() && /license|licence|copying|notice/i.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

function cell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}

function link(relative) {
  const portable = relative.split(path.sep).join('/');
  const target = portable.split('/').map(encodeURIComponent).join('/');
  return `[${cell(portable)}](${target})`;
}

const rows = [];
const missing = [];
const upstream = [];
let copiedFiles = 0;
for (const [key, metadata] of [...production, ...supplementary]) {
  const source = path.resolve(root, key);
  if (!within(path.join(root, 'node_modules'), source)) throw new Error(`Unsafe dependency path: ${key}`);
  const packageJson = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (packageJson.version !== metadata.version) {
    throw new Error(`${key}: installed version differs from package-lock.json; run npm ci first.`);
  }
  const packageName = packageJson.name ?? key.split('node_modules/').at(-1);
  const suffix = key.slice('node_modules/'.length);
  const destination = path.resolve(licenseRoot, suffix);
  if (!within(licenseRoot, destination)) throw new Error(`Unsafe license destination: ${key}`);
  const files = await licenseFiles(source);
  const links = [];
  for (const relative of files) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, relative), target);
    links.push(link(path.relative(thirdParty, target)));
    copiedFiles++;
  }
  let hasLicenseText = files.some(file => /license|licence|copying/i.test(path.basename(file)));
  const notes = [];
  const fallback = upstreamLicenses.get(`${packageName}@${metadata.version}`);
  if (!hasLicenseText && fallback) {
    const provenancePath = path.join(destination, 'UPSTREAM-SOURCE.json');
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
    if (provenance.name !== packageName || provenance.installedVersion !== metadata.version
      || provenance.sourceCommit !== fallback.commit || provenance.sourcePackageVersion !== fallback.packageVersion
      || provenance.licenseSha256 !== fallback.sha256 || provenance.npmIntegrity !== metadata.integrity) {
      throw new Error(`${packageName}: retained upstream provenance does not match the pinned source or lockfile.`);
    }
    const target = path.join(destination, 'LICENSE');
    if (refreshUpstream) {
      const base = `https://raw.githubusercontent.com/theKashey/react-remove-scroll-bar/${fallback.commit}`;
      const [packageResponse, licenseResponse] = await Promise.all([fetch(`${base}/package.json`), fetch(`${base}/LICENSE`)]);
      if (!packageResponse.ok || !licenseResponse.ok) throw new Error(`${packageName}: pinned official upstream is unavailable.`);
      const sourcePackage = await packageResponse.json();
      const licenseBytes = Buffer.from(await licenseResponse.arrayBuffer());
      if (sourcePackage.name !== packageName || sourcePackage.version !== fallback.packageVersion
        || createHash('sha256').update(licenseBytes).digest('hex') !== fallback.sha256) {
        throw new Error(`${packageName}: official upstream version or original license checksum changed.`);
      }
      await writeFile(target, licenseBytes);
    }
    const retainedBytes = await readFile(target);
    if (createHash('sha256').update(retainedBytes).digest('hex') !== fallback.sha256) {
      throw new Error(`${packageName}: retained original license checksum differs from verified upstream.`);
    }
    links.push(link(path.relative(thirdParty, target)));
    links.push(link(path.relative(thirdParty, provenancePath)));
    hasLicenseText = true;
    notes.push(`安装包缺正文；补充官方固定提交的原 LICENSE（源码版本 ${fallback.packageVersion}），与 v2.3.7 标签相比仅新增 LICENSE。2.3.8 的 npm gitHead 不可访问，未声明取得其精确发布源码；见来源记录。`);
    upstream.push({ packageName, installedVersion: metadata.version, sourcePackageVersion: fallback.packageVersion, sourceCommit: fallback.commit });
  }
  if (!hasLicenseText) missing.push(`${packageName}@${metadata.version}`);
  if (!hasLicenseText) notes.push('缺失原始 LICENSE/COPYING 许可正文；未补写或推测。');
  if (packageName === 'lucide-react') notes.push('原 LICENSE 还包含部分 Feather 图标的 MIT 许可及署名。');
  if (metadata.optional) notes.push('可选依赖。');
  rows.push({
    packageName,
    version: metadata.version,
    spdx: metadata.license ?? packageJson.license ?? '元数据未声明',
    key,
    kind: metadata.dev === true ? '构建时嵌入 CSS' : '锁文件生产依赖',
    links,
    notes,
  });
}

// This exact vendored license is retained in source control. Never reconstruct
// its copyright notice from a generic SPDX template.
const vendorRelative = 'licenses/local/shadcn-tailwind-4.13.0/LICENSE.md';
const vendorLicense = await readFile(path.join(thirdParty, vendorRelative), 'utf8');
if (!vendorLicense.includes('Copyright (c) 2023 shadcn') || !vendorLicense.includes('MIT License')) {
  throw new Error('The retained shadcn vendor license is missing or does not match its original notice.');
}

const text = [
  '# 第三方依赖与原始许可文件',
  '',
  '本清单由 `node scripts/collect-licenses.mjs` 从当前 `package-lock.json` 和安装后的包目录生成。许可文件按原始字节保存，未改写正文或版权署名；从官方上游补充的原文另附来源与版本记录。',
  '',
  `范围：锁文件中所有 \`node_modules/\` 条目且 \`dev !== true\`，共 ${production.length} 个；另收集 ${supplementary.length} 个直接进入页面样式的 CSS 包。这个集合包含类型依赖和可能被构建工具移除的代码，不声称每个包都进入最终 JavaScript。`,
  '',
  'SPDX 栏使用包元数据声明。附带的原始 LICENSE、COPYING、NOTICE 和版权通知文件保留各自完整条款；例如 Lucide 原文还包含 Feather 图标的 MIT 许可。此处不以项目根许可证替代第三方许可证。',
  '',
  '| 包名 | 版本 | SPDX（元数据） | 范围 | 锁文件路径 | 原始许可 / NOTICE | 备注 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(row => `| ${cell(row.packageName)} | ${cell(row.version)} | ${cell(row.spdx)} | ${row.kind} | \`${cell(row.key)}\` | ${row.links.join('<br>') || '**未找到许可文件**'} | ${row.notes.map(cell).join(' ')} |`),
  '',
  '## 本地保留的第三方代码',
  '',
  '| 文件 | 来源 / 版本 | 许可 | 原始许可文件 |',
  '| --- | --- | --- | --- |',
  `| \`src/vendor/shadcn-tailwind-4.13.0.css\` | shadcn Tailwind 样式 4.13.0 | MIT | ${link(vendorRelative)} |`,
  '',
  '## 官方上游补充与版本对应限制',
  '',
  ...upstream.map(item => `- ${cell(item.packageName)}：安装版本 ${item.installedVersion}；许可正文取自官方固定提交 [${item.sourceCommit.slice(0, 12)}](https://github.com/theKashey/react-remove-scroll-bar/blob/${item.sourceCommit}/LICENSE)，该提交的 package.json 为 ${item.sourcePackageVersion}。GitHub 比较确认相对 v2.3.7 仅新增 LICENSE；发布 2.3.8 的 gitHead 不可访问，不能证明取得了该发布快照的许可文件。原文、哈希、npm 完整性信息与限制见 ${link(`licenses/${item.packageName}/UPSTREAM-SOURCE.json`)}。`),
  '',
  '## 缺失正文',
  '',
  ...(missing.length ? missing.map(name => `- ${cell(name)}：安装包未提供可识别的原始 LICENSE/COPYING 正文。`) : ['当前收集范围未发现缺失的原始 LICENSE/COPYING 正文文件。']),
  '',
  '## 复现',
  '',
  '先运行 `npm ci`，再运行 `node scripts/collect-licenses.mjs`。脚本检查安装版本与锁文件一致，按每个锁文件包路径保存独立副本，保留嵌套依赖和同名文件的区别。已有本地 shadcn 原许可和上游补充原文/来源记录必须随源码保留；默认使用这些副本并核对原文 SHA-256。',
  '',
  '使用 `node scripts/collect-licenses.mjs --fetch-upstream` 可重新下载固定提交的补充原文；脚本核对上游 package.json 版本及预先验证的原文 SHA-256，不使用最新分支或通用许可模板。',
  '',
  'Node.js 运行时的许可证与随附第三方声明由本机运行包另外保留，不属于本清单的 npm 包范围。',
  '',
].join('\n');
await mkdir(thirdParty, { recursive: true });
await writeFile(path.join(thirdParty, 'DEPENDENCIES.md'), text, 'utf8');
console.log(JSON.stringify({ productionPackages: production.length, cssPackages: supplementary.length, copiedFiles, retainedUpstreamLicenses: upstream, missingLicenseText: missing }, null, 2));
