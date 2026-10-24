import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { Zip, ZipDeflate } from 'fflate';
import { execFileSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
const appDirectory = path.join(directory, 'build/app');
const outputFlag = process.argv.indexOf('--out');
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) throw Error('Provide an absolute output directory after --out.');
const releaseDirectory = outputFlag < 0 ? path.join(directory, 'release') : path.resolve(process.argv[outputFlag + 1]);
await fs.mkdir(releaseDirectory, {recursive:true});
// A published desktop package must include the reviewed offline manual.
await fs.access(path.join(directory,'build/docs','科研绘图台使用说明书.pdf'));
const output = await packager({
  dir: appDirectory,
  out: releaseDirectory,
  name: `Friday-${manifest.version}`,
  // Keep the executable identity expected by already released update installers.
  executableName: 'ScientificPlotStudio',
  electronVersion: manifest.devDependencies.electron,
  electronZipDir: path.join(directory, 'build/runtime'),
  platform: 'win32', arch: 'x64',
  appVersion: manifest.version,
  appCopyright: 'Scientific Plot Studio',
  icon: path.join(appDirectory, 'icon.ico'),
  asar: true, prune: false, overwrite: true,
  ignore: /^\/native(?:\/|$)/,
  extraResource: [path.join(appDirectory, 'native'),path.join(directory,'build/docs')],
  win32metadata: { CompanyName: 'Scientific Plot Studio', FileDescription: 'Friday', ProductName: 'Friday', InternalName: 'ScientificPlotStudio' },
});
const result = output[0];
const sourceRoot=path.dirname(directory);
await fs.copyFile(path.join(sourceRoot,'LICENSE'),path.join(result,'APP-LICENSE.txt'));
await fs.cp(path.join(sourceRoot,'third-party'),path.join(result,'third-party'),{recursive:true});
await fs.copyFile(path.join(sourceRoot,'vendor/shadcn-tailwind-4.13.0.LICENSE.md'),path.join(result,'third-party/SHADCN-VENDOR-LICENSE.md'));
let sourceCommit=null,sourceTreeDirty=null;
try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,windowsHide:true,encoding:'utf8'}).trim();sourceTreeDirty=!!execFileSync('git',['status','--porcelain'],{cwd:sourceRoot,windowsHide:true,encoding:'utf8'}).trim();}catch{}
await fs.writeFile(path.join(result,'VERSION.json'),JSON.stringify({product:'Scientific Plot Studio',displayName:'Friday',desktopVersion:manifest.version,electronVersion:manifest.devDependencies.electron,platform:'win32-x64',sourceCommit,sourceTreeDirty,builtAt:new Date().toISOString()},null,2)+'\n');
const instruction = `Friday · Windows 桌面版 ${manifest.version}\r\n\r\n运行 ScientificPlotStudio.exe 即可。请保留整个文件夹，不要只移动 exe。\r\n\r\n支持 LSV / 过电位 / EIS / Cdl / Tafel / pH 依赖性 / XRD / Raman；数据导入、绘图、导出可离线使用。\r\n过电位页面自动汇总 LSV 样品名称与读数，并绘制柱状图。\r\n导出会弹出保存窗口，可选择位置。退出前请保存需要的数据。\r\n\r\nOrigin：本机安装 Origin 后直接点击“导出至Origin”，无需另装网站助手。\r\nEIS 的 Origin 工作表每个样品仅四列。\r\nJADE：当前适配 JADE 9 中文版；打开一张卡片详细窗口后，点击“从 JADE 读取”。\r\nWindows 提示权限时确认即可。\r\n\r\nCtrl+1～5 依次打开 LSV / EIS / Tafel / XRD / Raman。Ctrl+6 打开过电位页面。Ctrl+7 打开 Cdl 页面。Ctrl+8 打开 pH 依赖性页面。\r\n在过电位页面使用 Ctrl+O 或拖入文件时切回 LSV 导入。\r\nCtrl+0 恢复界面缩放。F11 全屏。\r\n\r\nCdl：先选择第一组至第十组中的一组，再一次导入该组全部扫速文件，自动绘制 CV 与拟合。文件名列在组内，名称旁铅笔可重命名。取点、Cdl、R²和面积在同屏查看。导出本组菜单可直接导出至Origin，创建可编辑CV与Cdl拟合图。软件名称旁可切换白天/夜晚，主题偏好在本机保存，夜晚采用纯黑背景和白色文字，科学图纸保持白底。可导出 Origin Excel/TXT、完整原始CSV与SVG；原始单位和面积按实验确认。\r\n`;
await fs.writeFile(path.join(result, '使用说明.txt'), '\uFEFF' + instruction);
await fs.appendFile(path.join(result, '使用说明.txt'), '\r\n项目：顶部可新建、打开、保存和另存为 Fri（.fri）。Ctrl+S 保存，Ctrl+Shift+S 另存为，Ctrl+Shift+O 打开；保存八工作台的导入数据、分析参数和 BOOK 窗口。请保留仪器原件，未保存修改不会自动恢复。LSV/Tafel 每样品最多 10 本浮动 BOOK，A/B 是原始数据，C 留空，D/E 随已确认 IR 更新。\r\n', 'utf8');
await fs.appendFile(path.join(result, '使用说明.txt'), '\r\n更新：点击顶部“检查更新”或“帮助 → 检查更新”，发现新版后选择下载，完成后点击“重启并更新”。重启前请保存项目或导出需要的数据。更新保留原安装路径，并在同级目录保留旧版备份。0.3.0 及更早版本须先手动下载一次新版。\r\n', 'utf8');
await fs.appendFile(path.join(result, '使用说明.txt'), '\r\npH 依赖性：首次导入创建样品1，后续文件加入当前样品，加号新建下一个样品。允许不同文件夹的同名文件和再次导入；每次导入独立保存。核对 pH、面积、单位和补偿状态后输入共同电位，有效 pH 点足够时按样品自动拟合。支持全部 pH、pH 11–14 和逐点勾选；默认只对正电流取对数。固定 RHE 模式须确认参比条件；按各文件 Rs 进行额外 iR 时须确认原数据未补偿。拟合值、残差、取点和完整原始数据可导出 Excel/CSV，正方形图形可导出 PNG/TIFF/SVG/矢量 PDF；导出至 Origin 新建工作簿和可编辑图形。设置及纳入状态随 .fri 保存。\r\n', 'utf8');
await fs.appendFile(path.join(result,'使用说明.txt'),'\r\n拖入文件夹：在 pH 页面拖入10、11等pH文件夹或其父目录，自动查找各目录的LSV并填入pH，加入当前样品的导入列表；在LSV页面拖入文件夹自动找其中唯一LSV。同目录TXT/BIN优先TXT，活化、CV/EIS及结果文件跳过，多份不同LSV会要求选择。确认面积、单位等实验条件后导入。\r\n','utf8');
await fs.appendFile(path.join(result,'使用说明.txt'),'\r\nCV（Ctrl+9）：样品组沿用pH页面，首次导入创建样品1，后续扫速文件加入当前样品，加号创建下一样品。有效面积默认1 cm²。支持选择循环、正反扫自动取峰、图上点选和手动峰位、肩部标记及纳入点选择；拟合点可选全部扫速或通过弹窗指定四个不同扫速。CV与Ks视图采用同尺寸方形图，结果位于右侧。Laviron峰间距图与Ks结果实时更新，温度、电子数和近似筛选参数可调整。Origin格式Excel/CSV保留主图坐标、拟合线、逐扫速Ks、峰位、来源及全部原始CV；页面及条件随.fri保存。\r\n','utf8');
const archive = path.join(releaseDirectory, `Friday-${manifest.version}-Windows-x64.zip`);
await fs.appendFile(path.join(result,'使用说明.txt'),'\r\nEIS 全模型拟合：导入带频率的阻抗数据后，保留“自动选择最佳电路”并点击“拟合”，自动检查112个ZSimpWin电路。支持进度、取消、候选切换以及搜索后的手动拟合。推荐按相同数据和加权比较AICc，ΔAICc≤2时优先参数较少、估计较稳定的模型。独立CSV报告保存参数、候选排名、搜索预算与逐点残差；.fri重开重新计算。\r\n','utf8');
await fs.appendFile(path.join(result,'使用说明.txt'),'\r\nEIS 三视图：同一批不同电位的谱线可切换 Nyquist、原位等高线与原位 Bode。原位视图共用样品组和电位。Bode 默认同时显示 |Z| 模值和 −φ 相位，也可选择单图或 φ 原始相位；频率使用对数轴，曲线保留每个实测频率点。支持完整CSV、SVG/PNG/TIFF/PDF和.fri恢复；导出保留全部组、隐藏曲线、来源和有符号虚部。\r\n','utf8');
const outputStream = createWriteStream(archive);
const completed = new Promise((resolve, reject) => { outputStream.once('finish', resolve); outputStream.once('error', reject); });
const zip = new Zip((error, data, final) => { if (error) outputStream.destroy(error); else { outputStream.write(data); if (final) outputStream.end(); } });
async function addDirectory(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await addDirectory(full);
    else if (entry.isFile()) {
      const name = path.relative(releaseDirectory, full).split(path.sep).join('/');
      const file = new ZipDeflate(name, { level: 6 });
      zip.add(file);
      for await (const data of createReadStream(full)) file.push(data);
      file.push(new Uint8Array(), true);
    }
  }
}
await addDirectory(result); zip.end(); await completed;
console.log(JSON.stringify({ executable: path.join(result, 'ScientificPlotStudio.exe'), archive }));
