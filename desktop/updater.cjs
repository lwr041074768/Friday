// Only this main-process module accesses the public release channel. The
// renderer never supplies a URL, a version, or a filesystem destination.
const https = require('node:https');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');

const REPOSITORY = 'https://gitee.com/lwr2571166871/lwr';
const API = 'https://gitee.com/api/v5/repos/lwr2571166871/lwr/releases';
const MAXIMUM_ZIP = 512 * 1024 * 1024;
function versionParts(value) {
  if (typeof value !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) throw Error('更新版本号无效。');
  return value.split('.').map(Number);
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
function safeUrl(value) {
  const url = new URL(value);
  const hosts = ['gitee.com', 'gitee.cn', 'giteeusercontent.com'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw Error('更新下载地址不属于已配置的 Gitee 更新源。');
  return url;
}
function releaseUrl(tag, filename) {
  return `${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}
async function openResponse(value, redirects = 0) {
  const url = safeUrl(value);
  if (redirects > 5) throw Error('更新下载跳转次数过多。');
  return new Promise((resolve, reject) => {
    let headerTimeout;
    const request = https.get(url, { headers: { 'User-Agent': 'ScientificPlotStudio-Updater', Accept: 'application/json, application/octet-stream', 'Cache-Control': 'no-cache' } }, response => {
      clearTimeout(headerTimeout);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location) return reject(Error('更新下载跳转地址缺失。'));
        openResponse(new URL(response.headers.location, url).href, redirects + 1).then(resolve, reject);
      } else if (response.statusCode !== 200) {
        response.resume(); reject(Error(`更新源返回 HTTP ${response.statusCode}，请稍后重试。`));
      } else resolve(response);
    });
    headerTimeout = setTimeout(() => request.destroy(Error('连接更新源超时，请检查网络后重试。')), 60_000);
    request.setTimeout(30_000, () => request.destroy(Error('连接更新源超时，请检查网络后重试。')));
    request.on('error', error => { clearTimeout(headerTimeout); reject(error); });
  });
}
async function getJson(url) {
  const response = await openResponse(url), chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) { response.destroy(); throw Error('更新清单过大。'); }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('更新源没有返回有效的版本清单，请稍后重试。'); }
}
function validateManifest(manifest, release) {
  const version = release.tag_name.slice('desktop-v'.length);
  versionParts(version);
  if (manifest?.product !== 'Scientific Plot Studio' || manifest.version !== version || manifest.tag !== release.tag_name) throw Error('发行版与更新清单的版本不一致。');
  const desktop = manifest.desktop;
  const expectedName = `ScientificPlotStudio-${version}-Windows-x64.zip`;
  function asset(value, filename) {
    if (!value || value.filename !== filename || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAXIMUM_ZIP || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw Error('更新文件的名称、大小或 SHA256 校验信息无效。');
  }
  asset(desktop, expectedName);
  if (!Array.isArray(desktop.parts) || !desktop.parts.length || desktop.parts.length > 20) throw Error('更新清单缺少有效的下载分卷。');
  desktop.parts.forEach((part, i) => asset(part, `${expectedName}.${String(i + 1).padStart(3, '0')}`));
  if (desktop.parts.reduce((sum, part) => sum + part.size, 0) !== desktop.size) throw Error('更新分卷总大小与完整文件不一致。');
  const assets = Array.isArray(release.assets) ? release.assets : release.assets?.links;
  // Refuse partially published releases before downloading any large asset.
  if (!Array.isArray(assets) || !['release-manifest.json', ...desktop.parts.map(part => part.filename)].every(name => assets.some(item => item.name === name))) throw Error('新版的更新文件尚未上传完整，请稍后重试。');
  return { ...manifest, desktop: { ...desktop, sha256: desktop.sha256.toLowerCase(), parts: desktop.parts.map(part => ({ ...part, sha256: part.sha256.toLowerCase() })) } };
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}
async function downloadFile(url, target, size, hash, progress) {
  const response = await openResponse(url);
  const stream = createWriteStream(target, { flags: 'wx' });
  // A permanent handler also covers errors raised before a drain/finish wait.
  let writeError;
  stream.on('error', error => { writeError = error; response.destroy(error); });
  let bytes = 0;
  const digest = createHash('sha256');
  try {
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > size) throw Error('更新文件超过清单中的大小，已停止下载。');
      digest.update(chunk);
      if (!stream.write(chunk)) await once(stream, 'drain');
      if (writeError) throw writeError;
      progress(bytes);
    }
    stream.end(); await once(stream, 'finish');
    if (bytes !== size || digest.digest('hex') !== hash) throw Error('更新文件校验失败，请重新下载。');
  } catch (error) { response.destroy(); stream.destroy(); await finished(stream).catch(() => {}); throw error; }
}

function createUpdater({ currentVersion, cacheDirectory, notify = () => {}, fetchJson = getJson, transfer = downloadFile }) {
  versionParts(currentVersion);
  let state = { phase: 'idle', currentVersion }, selected = null, archive = null, busy = false;
  function emit(next) { state = { ...state, ...next }; notify({ ...state }); return { ...state }; }
  function fail(error, retryAction) { return emit({ phase: 'error', error: error?.message || '更新未完成，请重试。', retryAction }); }
  async function check() {
    if (busy || ['ready', 'installing'].includes(state.phase)) return { ...state };
    busy = true; selected = null; archive = null;
    emit({ phase: 'checking', error: undefined, retryAction: undefined, version: undefined, notes: undefined, publishedAt: undefined, percent: undefined, downloadedBytes: undefined, totalBytes: undefined });
    try {
      const releases = [];
      for (let page = 1; page <= 5; page++) {
        const batch = await fetchJson(`${API}?per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw Error('更新源返回的发行版列表无效。');
        releases.push(...batch);
        if (batch.length < 100) break;
      }
      const candidates = releases.filter(item => /^desktop-v\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(item.tag_name) && !item.prerelease && !item.draft).sort((a, b) => compareVersions(b.tag_name.slice(9), a.tag_name.slice(9)));
      if (!candidates.length) throw Error('更新源暂未提供正式桌面版，请稍后重试。');
      const latest = candidates[0], version = latest.tag_name.slice(9);
      if (compareVersions(version, currentVersion) <= 0) return emit({ phase: 'current', version: currentVersion });
      const manifest = validateManifest(await fetchJson(releaseUrl(latest.tag_name, 'release-manifest.json')), latest);
      selected = { manifest, release: latest };
      return emit({ phase: 'available', version, notes: typeof latest.body === 'string' ? latest.body.slice(0, 12000) : '', publishedAt: latest.created_at, totalBytes: manifest.desktop.size });
    } catch (error) { return fail(error, 'check'); }
    finally { busy = false; }
  }
  async function download() {
    if (busy || ['ready', 'installing'].includes(state.phase)) return { ...state };
    if (!selected) return fail(Error('请先检查更新。'), 'check');
    busy = true; archive = null;
    emit({ phase: 'downloading', error: undefined, retryAction: undefined, downloadedBytes: 0, percent: 0 });
    let folder, createdFiles = [];
    try {
      await fs.mkdir(cacheDirectory, { recursive: true });
      folder = await fs.mkdtemp(path.join(cacheDirectory, 'download-'));
      const { manifest } = selected, target = path.join(folder, manifest.desktop.filename);
      let completed = 0, lastNotice = 0;
      const files = [];
      for (const part of manifest.desktop.parts) {
        const file = path.join(folder, part.filename); files.push(file); createdFiles.push(file);
        await transfer(releaseUrl(manifest.tag, part.filename), file, part.size, part.sha256, bytes => {
          if (Date.now() - lastNotice < 150 && bytes !== part.size) return;
          lastNotice = Date.now();
          emit({ downloadedBytes: completed + bytes, percent: Math.min(99, Math.floor((completed + bytes) / manifest.desktop.size * 100)) });
        });
        completed += part.size;
      }
      const handle = await fs.open(target, 'wx');
      createdFiles.push(target);
      try { for (const file of files) for await (const chunk of createReadStream(file)) await handle.writeFile(chunk); }
      finally { await handle.close(); }
      if ((await fs.stat(target)).size !== manifest.desktop.size || await sha256(target) !== manifest.desktop.sha256) throw Error('完整更新包校验失败，请重新下载。');
      for (const file of files) await fs.unlink(file);
      archive = { path: target, sha256: manifest.desktop.sha256, version: manifest.version };
      return emit({ phase: 'ready', percent: 100, downloadedBytes: completed });
    } catch (error) {
      // Remove only files created by this attempt, never an installation or a
      // caller-provided directory. Failed retries do not accumulate big parts.
      for (const file of createdFiles) await fs.unlink(file).catch(() => {});
      if (folder) await fs.rmdir(folder).catch(() => {});
      return fail(error, 'download');
    }
    finally { busy = false; }
  }
  return {
    getState: () => ({ ...state }), check, download,
    getArchive: () => archive && { ...archive },
    installing: () => emit({ phase: 'installing', error: undefined, retryAction: undefined }),
    installFailed: error => fail(error, 'install'),
    invalidateArchive: error => { archive = null; return fail(error, 'download'); },
    installCancelled: () => emit({ phase: 'ready', error: undefined, retryAction: undefined }),
  };
}
module.exports = { createUpdater, compareVersions, validateManifest, safeUrl, releaseUrl, getJson, sha256 };
