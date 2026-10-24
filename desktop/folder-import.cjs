const fs = require('node:fs/promises');
const path = require('node:path');

const SUPPORTED = /\.(?:txt|bin|csv|tsv|dat|xlsx)$/i;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 10000;
const MAX_DEPTH = 8;

function excludedDirectory(name) {
  return /^(?:\.|node_modules$|__pycache__$|分析结果|参照方法|完整数据|活化|activation)/i.test(name);
}

function excludedFile(name) {
  return /(?:活化|activation|分析结果|参照方法|完整数据|拟合结果|拟合数据|残差)/i.test(name)
    || /(?:^|[\s_.-])(?:fitted|fit-results?|residuals?|export)(?:[\s_.-]|$)/i.test(name);
}

function lsvFile(name) {
  if (!SUPPORTED.test(name) || excludedFile(name)) return false;
  const stem = name.replace(/\.[^.]+$/, '').normalize('NFKC');
  // Folder imports are deliberately conservative: a CV/EIS file must never
  // become an LSV merely because it happens to contain two numeric columns.
  if (/(?:^|[^a-z])(?:cv|eis|cdl)(?=$|[^a-z])|循环伏安|阻抗/i.test(stem)) return false;
  return /(?:^|[^a-z])lsv(?=$|[^a-z])|线性扫描/i.test(stem);
}

function cvFile(name, relative) {
  if (!SUPPORTED.test(name) || excludedFile(name)) return false;
  const source = relative.replaceAll('\\', '/').normalize('NFKC');
  // A scan-rate file may be named 5.txt inside a CV directory. Match its
  // measurement path while keeping neighbouring techniques out of the batch.
  if (/(?:^|[^a-z])(?:lsv|eis|cdl)(?=$|[^a-z])|阻抗|双电层|线性扫描/i.test(source)) return false;
  return /(?:^|[^a-z])cv(?=$|[^a-z])|循环伏安/i.test(source);
}

async function eisFile(file, relative) {
  const name = path.basename(file);
  if (!SUPPORTED.test(name) || excludedFile(name)) return false;
  const stem = name.replace(/\.[^.]+$/, '').normalize('NFKC');
  if (/(?:^|[^a-z])(?:lsv|cv|cdl)(?=$|[^a-z])|循环伏安|双电层|线性扫描/i.test(stem)) return false;
  const source = relative.replaceAll('\\', '/').normalize('NFKC');
  if (/(?:^|[^a-z])(?:eis|imp)(?=$|[^a-z])|impedance|阻抗/i.test(source)) return true;
  // Some instrument exports are named only by potential. Inspect their
  // technique header so neighbouring CV/LSV measurements stay out of the batch.
  if (!/\.(?:bin|txt)$/i.test(name)) return false;
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (/\.bin$/i.test(name)) return bytesRead >= 29 && buffer.subarray(8, 11).toString('ascii') === 'IMP'
      && buffer.subarray(15, 29).toString('ascii') === 'A.C. Impedance';
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    return /A\.C\.\s*Impedance|Electrochemical\s+Impedance/i.test(header);
  } finally { await handle.close(); }
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function contained(root, selected) {
  const relative = path.relative(root, selected);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw Error('文件路径超出所选文件夹。');
  }
  return relative;
}

function withoutBinaryCompanions(candidates) {
  const text = new Set(candidates.filter(file => /\.txt$/i.test(file)).map(file => pathKey(file.replace(/\.txt$/i, ''))));
  return candidates.filter(file => !/\.bin$/i.test(file) || !text.has(pathKey(file.replace(/\.bin$/i, ''))));
}

/** Read original files from an Electron drop. Directory discovery filters by technique;
 * direct file drops retain the existing supported-format behavior. Every drop
 * is independent, including re-imports of the same source path.
 *
 * selectAmbiguous({folder, candidates}) may return candidate paths or null to
 * cancel the entire drop. No files are returned until all selections succeed.
 */
async function readDroppedData(profile, paths, { selectAmbiguous } = {}) {
  if (!['ph', 'lsv', 'cv', 'eis'].includes(profile)) throw Error('此页面不支持拖入文件夹。');
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_SCAN_ENTRIES
      || paths.some(value => typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value))) {
    throw Error('拖入的文件路径无效。');
  }
  if (selectAmbiguous !== undefined && typeof selectAmbiguous !== 'function') throw Error('文件选择方式无效。');

  const selected = [];
  const maximum = profile === 'eis' ? 80 : ['ph', 'cv'].includes(profile) ? 120 : 10;
  const technique = profile === 'cv' ? 'CV' : profile === 'eis' ? 'EIS' : 'LSV';
  let scanned = 0;
  let cancelled = false;

  async function choose(folder, candidates) {
    if (candidates.length <= 1) return candidates;
    if (!selectAmbiguous) throw Error(`文件夹中有多个不同的 LSV 文件，请选择要导入的文件：${folder}`);
    const choice = await selectAmbiguous({ folder, candidates: [...candidates] });
    if (choice === null || Array.isArray(choice) && choice.length === 0) {
      cancelled = true;
      return [];
    }
    const allowed = new Map(candidates.map(file => [pathKey(file), file]));
    if (!Array.isArray(choice) || choice.some(file => typeof file !== 'string' || !path.isAbsolute(file) || !allowed.has(pathKey(file)))) {
      throw Error('选择的文件不在本次找到的 LSV 文件中，请重新拖入文件夹。');
    }
    return [...new Set(choice.map(file => allowed.get(pathKey(file))))];
  }

  function add(sourcePath, relativePath) {
    selected.push({ sourcePath, relativePath: relativePath.replaceAll('\\', '/') });
    if (profile !== 'eis' && selected.length > maximum) throw Error(`本次最多导入 ${maximum} 个文件，请分批拖入。`);
  }

  for (const input of paths) {
    const root = path.resolve(input);
    const stat = await fs.lstat(root);
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) {
      if (SUPPORTED.test(root) && !excludedFile(path.basename(root))) {
        add(root, root.split(/[\\/]/).slice(-4).join('/'));
      }
      continue;
    }
    if (!stat.isDirectory() || excludedDirectory(path.basename(root))) continue;

    const folders = new Map();
    async function visit(folder, depth) {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      scanned += entries.length;
      if (scanned > MAX_SCAN_ENTRIES) throw Error(`文件夹条目超过 ${MAX_SCAN_ENTRIES.toLocaleString()} 个，请拖入更小的原始数据文件夹。`);
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      const candidates = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(folder, entry.name);
        contained(root, file);
        if (entry.isDirectory()) {
          if (excludedDirectory(entry.name)) continue;
          if (depth >= MAX_DEPTH) throw Error(`文件夹层级超过 ${MAX_DEPTH} 层，请直接拖入存放 ${technique} 的子文件夹。`);
          await visit(file, depth + 1);
        } else if (entry.isFile()) {
          const relative = [path.basename(root), contained(root, file)].join('/');
          if (profile === 'eis' ? await eisFile(file, relative) : profile === 'cv' ? cvFile(entry.name, relative) : lsvFile(entry.name)) candidates.push(file);
        }
      }
      if (profile === 'eis') {
        const names = new Map(entries.filter(entry => entry.isFile()).map(entry => [entry.name.toLowerCase(), entry.name]));
        for (const file of [...candidates]) if (/\.bin$/i.test(file)) {
          const textName = names.get(path.basename(file).replace(/\.bin$/i, '.txt').toLowerCase());
          if (textName && !candidates.includes(path.join(folder, textName))) candidates.push(path.join(folder, textName));
        }
      }
      const logical = withoutBinaryCompanions(candidates);
      if (logical.length) folders.set(folder, logical);
    }
    await visit(root, 0);
    if (!folders.size) throw Error(`文件夹中没有找到名称或路径包含 ${technique} 的曲线文件：${root}。请确认文件名称，或直接拖入原始数据文件。`);

    if (profile === 'cv' || profile === 'eis') {
      for (const candidates of folders.values()) for (const file of candidates) add(file, [path.basename(root), contained(root, file)].join('/'));
      continue;
    }

    // pH roots can contain one measurement directory per pH. In LSV, a dropped
    // root is one sample, so several distinct curves require an explicit choice.
    const batches = profile === 'ph' ? [...folders] : [[root, [...folders.values()].flat()]];
    for (const [folder, candidates] of batches) {
      const choices = await choose(folder, candidates);
      if (cancelled) return [];
      for (const file of choices) add(file, [path.basename(root), contained(root, file)].join('/'));
    }
  }
  if (profile === 'cv' || profile === 'eis') {
    const preferred = new Set(withoutBinaryCompanions(selected.map(item => item.sourcePath)).map(pathKey));
    const seen = new Set();
    for (let i = selected.length - 1; i >= 0; i--) {
      const key = pathKey(selected[i].sourcePath);
      if (!preferred.has(key) || seen.has(key)) selected.splice(i, 1);
      else seen.add(key);
    }
  }
  if (selected.length > maximum) throw Error(`本次最多导入 ${maximum} 个文件，请分批拖入。`);
  if (!selected.length) throw Error(`没有找到可导入的 ${technique} 数据文件。`);

  // Check the complete selection before reading so a large batch is atomic.
  let totalBytes = 0;
  for (const item of selected) {
    const stat = await fs.lstat(item.sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw Error(`文件已移动或不是原始文件：${item.sourcePath}`);
    if (stat.size > MAX_FILE_BYTES) throw Error(`${path.basename(item.sourcePath)}：单个文件不能超过 20 MB。`);
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw Error('本次文件总大小超过 100 MB，请分批拖入。');
  }

  const files = [];
  totalBytes = 0;
  for (const item of selected) {
    const handle = await fs.open(item.sourcePath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw Error(`${path.basename(item.sourcePath)}：单个文件不能超过 20 MB。`);
      const buffer = Buffer.alloc(stat.size);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const probe = Buffer.alloc(1);
      const extra = (await handle.read(probe, 0, 1, null)).bytesRead;
      const after = await handle.stat();
      if (size !== stat.size || extra || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
        throw Error(`导入时文件发生变化，请稍后重试：${item.sourcePath}`);
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) throw Error('本次文件总大小超过 100 MB，请分批拖入。');
      files.push({ name: path.basename(item.sourcePath), data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + size), lastModified: stat.mtimeMs, ...item });
    } finally {
      await handle.close();
    }
  }
  return files;
}

module.exports = { readDroppedData };
