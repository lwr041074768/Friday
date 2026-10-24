import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdater, compareVersions, validateManifest, safeUrl, releaseUrl } = require('./updater.cjs');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ScientificPlotStudio-Updater-Test-'));
const checks = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const parts = [Buffer.from('first tiny ZIP segment\n'), Buffer.from('second tiny ZIP segment\n')];

function fixture(version = '0.3.1') {
  const filename = `ScientificPlotStudio-${version}-Windows-x64.zip`;
  const desktop = { filename, size: parts.reduce((sum, part) => sum + part.length, 0), sha256: digest(Buffer.concat(parts)),
    parts: parts.map((bytes, i) => ({ filename: `${filename}.${String(i + 1).padStart(3, '0')}`, size: bytes.length, sha256: digest(bytes) })) };
  const manifest = { product: 'Scientific Plot Studio', version, tag: `desktop-v${version}`, desktop };
  const release = { tag_name: manifest.tag, prerelease: false, draft: false, body: 'A reviewed desktop update.', created_at: '2026-10-16T00:00:00Z',
    assets: ['release-manifest.json', ...desktop.parts.map(part => part.filename)].map(name => ({ name, browser_download_url: releaseUrl(manifest.tag, name) })) };
  return { manifest, release };
}

function harness({ version = '0.3.0', releases, manifest, fetchFailure = false, corruptOnce = false, blockTransfer } = {}) {
  const data = fixture();
  const stats = { fetches: [], transfers: [], notices: [] };
  let failed = false, corrupted = false;
  const updater = createUpdater({ currentVersion: version, cacheDirectory: path.join(temporary, `cache-${Math.random().toString(36).slice(2)}`),
    notify: state => stats.notices.push(state),
    fetchJson: async url => {
      stats.fetches.push(url);
      if (fetchFailure && !failed) { failed = true; throw Error('simulated offline connection'); }
      return clone(url.includes('/releases?') ? (releases ?? [data.release]) : (manifest ?? data.manifest));
    },
    transfer: async (url, target, expectedSize, expectedHash, progress) => {
      stats.transfers.push({ url, target, expectedSize, expectedHash });
      if (blockTransfer) await blockTransfer();
      const index = Number(new URL(url).pathname.split('.').at(-1)) - 1;
      let bytes = parts[index];
      assert.ok(bytes, 'only the selected release chunk URLs may be downloaded');
      if (corruptOnce && !corrupted) { corrupted = true; bytes = Buffer.from('corrupted download'); }
      // The injected transport enforces the same size/hash contract as a network transfer.
      await fs.writeFile(target, bytes, { flag: 'wx' });
      if (bytes.length !== expectedSize || digest(bytes) !== expectedHash) throw Error('simulated transfer checksum failure');
      progress(bytes.length);
    },
  });
  return { updater, stats };
}

async function test(name, run) { await run(); checks.push(name); }

try {
  await test('numeric-semver-order-and-input-validation', () => {
    assert.equal(compareVersions('0.10.0', '0.9.99'), 1);
    assert.equal(compareVersions('1.0.0', '0.999999.999999'), 1);
    assert.equal(compareVersions('0.3.1', '0.3.1'), 0);
    assert.equal(compareVersions('0.3.0', '0.3.1'), -1);
    for (const bad of ['0.3', 'v0.3.1', '0.3.1-beta', '0.3.NaN', '1000000.0.0', null]) assert.throws(() => compareVersions(bad, '0.3.1'));
  });

  await test('public-gitee-manifest-shape-and-uppercase-checksums', () => {
    const { manifest, release } = fixture();
    manifest.desktop.sha256 = manifest.desktop.sha256.toUpperCase();
    for (const part of manifest.desktop.parts) part.sha256 = part.sha256.toUpperCase();
    const checked = validateManifest(manifest, release);
    assert.equal(checked.desktop.sha256, digest(Buffer.concat(parts)));
    assert.equal(checked.desktop.parts[0].sha256, digest(parts[0]));
  });

  await test('manifest-version-name-size-hash-and-incomplete-assets-rejected', () => {
    const mutations = [
      m => { m.product = 'another product'; }, m => { m.version = '0.3.2'; }, m => { m.tag = 'desktop-v0.3.2'; },
      m => { m.desktop.filename = '../ScientificPlotStudio.exe'; }, m => { m.desktop.filename = 'ScientificPlotStudio-0.3.2-Windows-x64.zip'; },
      m => { m.desktop.size = 0; }, m => { m.desktop.size = -1; }, m => { m.desktop.size = 1.5; }, m => { m.desktop.size = 513 * 1024 * 1024; },
      m => { m.desktop.sha256 = 'not-a-checksum'; }, m => { m.desktop.parts = []; }, m => { m.desktop.parts = null; },
      m => { m.desktop.parts = Array.from({ length: 21 }, () => clone(m.desktop.parts[0])); },
      m => { m.desktop.parts[0].filename = `${m.desktop.filename}.002`; }, m => { m.desktop.parts[0].filename = '../escape.zip.001'; },
      m => { m.desktop.parts[0].size += 1; }, m => { m.desktop.parts[0].sha256 = '0'.repeat(63); },
    ];
    for (const mutate of mutations) { const { manifest, release } = fixture(); mutate(manifest); assert.throws(() => validateManifest(manifest, release)); }
    for (const absent of ['release-manifest.json', fixture().manifest.desktop.parts[0].filename]) {
      const { manifest, release } = fixture(); release.assets = release.assets.filter(asset => asset.name !== absent);
      assert.throws(() => validateManifest(manifest, release), /上传完整/);
    }
  });

  await test('filters-browser-prerelease-draft-and-sorts-all-desktop-candidates', async () => {
    const data = fixture('0.10.0');
    const { updater, stats } = harness({ version: '0.8.0', manifest: data.manifest, releases: [
      { tag_name: 'v1.0.0' }, fixture('0.9.9').release, { ...fixture('9.0.0').release, prerelease: true },
      { ...fixture('8.0.0').release, draft: true }, { tag_name: 'desktop-v7.0.0-beta' }, data.release,
    ] });
    assert.equal((await updater.check()).phase, 'available');
    assert.equal(updater.getState().version, '0.10.0');
    assert.match(stats.fetches.at(-1), /desktop-v0\.10\.0\/release-manifest\.json$/);
    assert.equal(stats.transfers.length, 0, 'checking must not download binary assets');
    assert.equal(updater.getArchive(), null);
  });

  await test('current-or-older-remote-does-not-fetch-manifest-or-download', async () => {
    for (const version of ['0.3.1', '0.3.2']) {
      const { updater, stats } = harness({ version });
      assert.equal((await updater.check()).phase, 'current');
      assert.equal(updater.getState().version, version);
      assert.equal(stats.fetches.length, 1); assert.equal(stats.transfers.length, 0);
    }
  });

  await test('failed-check-is-retryable-and-invalid-source-cannot-download', async () => {
    const { updater, stats } = harness({ fetchFailure: true });
    assert.equal((await updater.download()).retryAction, 'check');
    assert.equal((await updater.check()).phase, 'error');
    assert.equal(updater.getState().retryAction, 'check');
    assert.equal((await updater.check()).phase, 'available');
    assert.equal(stats.transfers.length, 0);
    const malformed = harness({ releases: [fixture().release], manifest: { product: 'Scientific Plot Studio' } });
    assert.equal((await malformed.updater.check()).phase, 'error');
    assert.equal((await malformed.updater.download()).retryAction, 'check');
    assert.equal(malformed.stats.transfers.length, 0);
    assert.equal((await harness({ releases: [{ tag_name: 'v1.0.0' }] }).updater.check()).phase, 'error');
  });

  await test('download-joins-and-verifies-two-chunks-only-after-explicit-action', async () => {
    const { updater, stats } = harness();
    assert.equal(updater.getState().phase, 'idle');
    await updater.check(); assert.equal(stats.transfers.length, 0);
    assert.equal((await updater.download()).phase, 'ready');
    assert.equal(stats.transfers.length, 2);
    const archive = updater.getArchive();
    assert.equal(archive.version, '0.3.1'); assert.equal(archive.sha256, digest(Buffer.concat(parts)));
    assert.deepEqual(await fs.readFile(archive.path), Buffer.concat(parts));
    assert.equal(updater.getState().percent, 100);
    assert.deepEqual(await fs.readdir(path.dirname(archive.path)), [path.basename(archive.path)], 'verified chunks should be removed after joining');
    await updater.download(); await updater.check(); assert.equal(stats.transfers.length, 2);
  });

  await test('corrupt-transfer-and-whole-archive-hash-fail-with-download-retry', async () => {
    const { updater, stats } = harness({ corruptOnce: true });
    await updater.check(); assert.equal((await updater.download()).phase, 'error');
    assert.equal(updater.getState().retryAction, 'download'); assert.equal(updater.getArchive(), null);
    assert.equal((await updater.download()).phase, 'ready'); assert.equal(stats.transfers.length, 3);
    const data = fixture(); data.manifest.desktop.sha256 = '0'.repeat(64);
    const whole = harness({ manifest: data.manifest, releases: [data.release] });
    await whole.updater.check(); assert.equal((await whole.updater.download()).phase, 'error');
    assert.equal(whole.updater.getState().retryAction, 'download'); assert.equal(whole.updater.getArchive(), null);
  });

  await test('concurrent-and-duplicate-operations-do-not-duplicate-transfers', async () => {
    let releaseTransfer, enteredTransfer;
    const blocked = new Promise(resolve => { releaseTransfer = resolve; });
    const entered = new Promise(resolve => { enteredTransfer = resolve; });
    const { updater, stats } = harness({ blockTransfer: async () => { enteredTransfer(); await blocked; } });
    const checksInFlight = await Promise.all([updater.check(), updater.check(), updater.check()]);
    assert.equal(updater.getState().phase, 'available'); assert.equal(stats.fetches.length, 2);
    assert.ok(checksInFlight.some(state => state.phase === 'checking'));
    const first = updater.download(); await entered;
    assert.equal((await updater.download()).phase, 'downloading');
    assert.equal((await updater.check()).phase, 'downloading');
    assert.equal(stats.transfers.length, 1);
    releaseTransfer(); assert.equal((await first).phase, 'ready'); assert.equal(stats.transfers.length, 2);
  });

  await test('url-whitelist-rejects-http-lookalikes-userinfo-and-unexpected-port', () => {
    for (const value of [
      'http://gitee.com/lwr2571166871/lwr', 'https://gitee.com.evil.example/payload', 'https://foruda.gitee.com.evil.example/payload',
      'https://evilgitee.com/payload', 'https://gitee.cn.evil.example/payload', 'https://giteeusercontent.com.evil.example/payload',
      'https://gitee.com@evil.example/payload', 'https://user:secret@gitee.com/payload', 'https://gitee.com:444/payload', 'file:///C:/payload',
    ]) assert.throws(() => safeUrl(value));
    for (const value of [releaseUrl('desktop-v0.3.1', 'release-manifest.json'), 'https://gitee.com/api/v5/repos/lwr2571166871/lwr/releases', 'https://foruda.gitee.com/attach_file/123/release-manifest.json']) assert.equal(safeUrl(value).protocol, 'https:');
  });

  console.log(JSON.stringify({ passed: true, checks: checks.length, names: checks }));
  if (process.argv.includes('--live')) {
    const live = [];
    for (const currentVersion of ['0.3.1', '0.2.9']) {
      const updater = createUpdater({ currentVersion, cacheDirectory: path.join(temporary, `live-${currentVersion}`), transfer: async () => { throw Error('Live verification must not download any binary.'); } });
      await updater.check(); const state = updater.getState();
      live.push({ currentVersion, ...state });
      console.log(JSON.stringify({ liveCheck: true, ...live.at(-1) }));
      assert.equal(state.phase, currentVersion === '0.3.1' ? 'current' : 'available');
      if (currentVersion === '0.2.9') assert.equal(state.version, '0.3.0');
      assert.equal(updater.getArchive(), null);
    }
  }
} finally {
  // The resolved target is the unique temporary directory created by this test.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.match(path.basename(temporary), /^ScientificPlotStudio-Updater-Test-/);
  await fs.rm(temporary, { recursive: true, force: true });
}
