const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { validateOriginRequest, validateOverpotentialRequest, validateCdlRequest, validatePhRequest, validateId, resolveAsset, psLiteral, windowsArgument } = require('./policy.cjs');
const { createUpdater, sha256 } = require('./updater.cjs');
const { renderVectorPdf } = require('./vector-pdf.cjs');
const { readDroppedData } = require('./folder-import.cjs');

app.setName('Friday');
app.setAppUserModelId('research.scientificplotstudio.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));
protocol.registerSchemesAsPrivileged([{ scheme: 'plot-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window, originBusy = false, jadeBusy = null, exportBusy = 0;
const pendingDownloads = new Set();
let projectFile = null, projectStatus = null;
const pendingProjects = new Map();
let closeConfirmed = false;
let updatePreparing = false;
const cancelledJade = new Set();
const rendererDirectory = path.join(__dirname, 'renderer');
const nativeDirectory = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(__dirname, 'native');
const workDirectory = path.join(app.getPath('userData'), 'NativeOperations');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const updateDirectory = path.join(app.getPath('userData'), 'Updates');
const recoveryDirectory = path.join(app.getPath('userData'), 'Recovery');
const recoveryFile = path.join(recoveryDirectory, 'autosave.fri');
const recoveryMeta = path.join(recoveryDirectory, 'autosave.json');
const updater = createUpdater({ currentVersion: app.getVersion(), cacheDirectory: updateDirectory, notify: state => {
  if (window && !window.isDestroyed()) window.webContents.send('studio:update-state', state);
} });
const WEB_URL = 'https://gitee.com/lwr2571166871/lwr';
const DOCUMENT_URLS = new Set(["https://arxiv.org/pdf/2012.00801","https://www.rsc.org/suppdata/c8/qi/c8qi00905h/c8qi00905h1.pdf","https://github.com/garrettj403/SciencePlots/wiki/Gallery","https://matplotlib.org/stable/gallery/style_sheets/style_sheets_reference.html","https://seaborn.pydata.org/tutorial/aesthetics.html","https://matplotlib.org/stable/gallery/shapes_and_collections/hatch_style_reference.html","https://matplotlib.org/stable/gallery/lines_bars_and_markers/bar_label_demo.html","https://matplotlib.org/stable/gallery/lines_bars_and_markers/barh.html","https://matplotlib.org/stable/gallery/lines_bars_and_markers/bar_colors.html","https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.bar.html","https://plotly.com/python/bar-charts/","https://github.com/nanxstats/ggsci/blob/master/vignettes/ggsci.Rmd"]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('调用来源无效。');
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'plot-app:' || url.host !== 'studio' || !['/', '/index.html'].includes(url.pathname)) throw Error('调用页面无效。');
}
function invoke(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => { trusted(event); return handler(...args); });
}
invoke('studio:figure-pdf', async request => {
  if (exportBusy || updatePreparing) throw Error('导出或更新仍在进行，请稍后导出 PDF。');
  exportBusy++;
  try { return await renderVectorPdf(request, { BrowserWindow, session }); }
  finally { exportBusy--; }
});
invoke('studio:project-status', state => {
  if(!state||typeof state.dirty!=='boolean'||typeof state.hasData!=='boolean')throw Error('项目状态无效。');
  projectStatus={dirty:state.dirty,hasData:state.hasData};
});
invoke('studio:project-confirm',async action=>{
  if(!['open','new'].includes(action))throw Error('项目操作无效。');
  if(originBusy||jadeBusy||exportBusy||filePickerBusy||updatePreparing)throw Error('本机操作仍在进行，请等待完成后切换项目。');
  const result=await dialog.showMessageBox(window,{type:'question',title:action==='new'?'新建项目':'打开项目',message:'当前项目有尚未保存的修改。',detail:'继续将替换当前工作台数据。需要保留时，请先取消并保存项目。',buttons:['取消',action==='new'?'新建项目':'打开项目'],defaultId:0,cancelId:0});
  return result.response===1;
});
invoke('studio:project-open',async()=>{
  if(originBusy||jadeBusy||exportBusy||filePickerBusy||updatePreparing)throw Error('本机操作仍在进行，请等待完成后打开项目。');
  const result=await dialog.showOpenDialog(window,{title:'打开 Friday 项目',properties:['openFile'],filters:[{name:'Fri',extensions:['fri']},{name:'旧版电催化项目',extensions:['ecproj']}]});
  if(result.canceled||!result.filePaths[0])return null;
  const selected=result.filePaths[0],stat=await fs.stat(selected);
  if(!stat.isFile()||stat.size>256*1024*1024||!['.fri','.ecproj'].includes(path.extname(selected).toLowerCase()))throw Error('请选择不超过 256 MB 的 .fri 项目文件，也可打开旧版 .ecproj 项目。');
  const text=await fs.readFile(selected,'utf8'),token=randomUUID();pendingProjects.set(token,selected);
  if(pendingProjects.size>8)pendingProjects.delete(pendingProjects.keys().next().value);
  return {text,token,fileName:path.basename(selected)};
});
invoke('studio:project-accept',token=>{validateId(token);const selected=pendingProjects.get(token);if(!selected)throw Error('项目打开请求已失效，请重新选择文件。');projectFile=selected;pendingProjects.delete(token);});
invoke('studio:project-reset-path',()=>{if(originBusy||jadeBusy||exportBusy||filePickerBusy||updatePreparing)throw Error('本机操作仍在进行，请等待完成后新建项目。');projectFile=null;pendingProjects.clear();});
invoke('studio:recovery-save',async request=>{
  if(updatePreparing)throw Error('正在准备更新，暂不写入自动恢复副本。');
  if(!request||typeof request.text!=='string'||Buffer.byteLength(request.text,'utf8')>256*1024*1024)throw Error('自动恢复内容无效或超过 256 MB。');
  let document;try{document=JSON.parse(request.text);}catch{throw Error('自动恢复内容不是有效 JSON。');}
  if(document.schema!=='electrocatalysis-project/v1'||document.application!=='Scientific Plot Studio')throw Error('自动恢复内容格式无效。');
  await fs.mkdir(recoveryDirectory,{recursive:true});
  const temporary=recoveryFile+'.'+randomUUID()+'.tmp';
  try{const handle=await fs.open(temporary,'wx');try{await handle.writeFile(request.text,'utf8');await handle.sync();}finally{await handle.close();}await fs.rename(temporary,recoveryFile);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
  await fs.writeFile(recoveryMeta,JSON.stringify({savedAt:new Date().toISOString(),name:String(document.name||'').slice(0,120),bytes:Buffer.byteLength(request.text,'utf8')}),'utf8').catch(()=>{});
  return {saved:true};
});
invoke('studio:recovery-info',async()=>{
  try{
    const stat=await fs.stat(recoveryFile);
    if(!stat.isFile()||stat.size>256*1024*1024)return null;
    let meta={};try{meta=JSON.parse(await fs.readFile(recoveryMeta,'utf8'));}catch{/* metadata is optional */}
    return {savedAt:typeof meta.savedAt==='string'?meta.savedAt:stat.mtime.toISOString(),name:typeof meta.name==='string'?meta.name:'',bytes:stat.size};
  }catch{return null;}
});
invoke('studio:recovery-read',async()=>{
  try{const text=await fs.readFile(recoveryFile,'utf8');if(Buffer.byteLength(text,'utf8')>256*1024*1024)throw Error('自动恢复副本超过 256 MB。');return {text};}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
});
invoke('studio:recovery-clear',async()=>{await fs.unlink(recoveryFile).catch(()=>{});await fs.unlink(recoveryMeta).catch(()=>{});return {cleared:true};});
invoke('studio:project-save',async request=>{
  if(updatePreparing)throw Error('正在准备更新，请稍后保存项目。');
  if(!request||typeof request.text!=='string'||Buffer.byteLength(request.text,'utf8')>256*1024*1024||typeof request.saveAs!=='boolean')throw Error('项目内容无效或超过 256 MB。');
  let document;try{document=JSON.parse(request.text);}catch{throw Error('项目内容不是有效 JSON。');}
  if(document.schema!=='electrocatalysis-project/v1'||document.application!=='Scientific Plot Studio'||typeof document.name!=='string')throw Error('项目格式标识无效。');
  let selected=projectFile;exportBusy++;
  try{
    if(request.saveAs||!selected||path.extname(selected).toLowerCase()==='.ecproj'){
      const filename=(document.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim()||'Friday项目').slice(0,100)+'.fri';
      const defaultPath=selected?selected.replace(/\.(?:ecproj|fri)$/i,'.fri'):path.join(app.getPath('documents'),filename);
      const result=await dialog.showSaveDialog(window,{title:'保存 Friday 项目',defaultPath,properties:['showOverwriteConfirmation','createDirectory'],filters:[{name:'Fri',extensions:['fri']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      selected=result.filePath;
    }
    if(!path.extname(selected))selected+='.fri';
    if(path.extname(selected).toLowerCase()!=='.fri')throw Error('Friday 项目文件请使用 .fri 扩展名。');
    const temporary=selected+'.'+randomUUID()+'.tmp';
    try{const handle=await fs.open(temporary,'wx');try{await handle.writeFile(request.text,'utf8');await handle.sync();}finally{await handle.close();}await fs.rename(temporary,selected);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
    projectFile=selected;return {saved:true,fileName:path.basename(selected)};
  }finally{exportBusy--;}
});
invoke('studio:update-state', () => updater.getState());
invoke('studio:update-check', () => updater.check());
invoke('studio:update-download', () => updater.download());
invoke('studio:update-install', async () => {
  if (updatePreparing) return { started: false };
  const archive = updater.getArchive();
  if (!archive || !['ready', 'error'].includes(updater.getState().phase)) throw Error('请先完成更新包下载。');
  updatePreparing = true;
  let installChild, installStarted = false;
  try {
    if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') throw Error('自动安装只适用于正式的 Windows x64 便携版。');
    if (originBusy || jadeBusy) throw Error('Origin 或 JADE 连接仍在进行，请等待完成后更新。');
    if (exportBusy || pendingDownloads.size || filePickerBusy) throw Error('数据导入或导出仍在进行，请等待完成后更新。');
    const hasData = await window.webContents.executeJavaScript("Boolean(document.querySelector('.lsv-managed-curve, .xrd-reference-managed, #panel-cdl [data-cdl-has-data=\"true\"]'))");
    const confirmation = await dialog.showMessageBox(window, { type: 'question', title: '重启并更新 Friday', message: `安装 v${archive.version} 并重启软件？`, detail: hasData ? '当前绘图数据会随重启关闭，请先取消并导出需要的数据。确认后将准备更新包，再关闭并重启软件。' : '下载文件已校验。确认后将准备更新包，再关闭并重启软件。', buttons: [hasData ? '取消，先保存数据' : '取消', '重启并更新'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) { updater.installCancelled(); return { started: false }; }
    updater.installing();
    const installDirectory = path.dirname(process.execPath), parent = path.dirname(installDirectory), operationId = randomUUID();
    const folder = path.join(updateDirectory, `install-${operationId}`);
    await fs.mkdir(folder, { recursive: true });
    const helper = path.join(folder, 'Install-DesktopUpdate.ps1'), statusPath = path.join(folder, 'status.json'), planPath = path.join(folder, 'plan.json');
    await fs.copyFile(path.join(nativeDirectory, 'Install-DesktopUpdate.ps1'), helper);
    if (await sha256(archive.path) !== archive.sha256) {
      const error = Error('更新包在下载后发生变化，请重新下载。'); error.retryDownload = true; throw error;
    }
    await fs.writeFile(planPath, JSON.stringify({ schema: 'scientific-plot-update-plan/v1', operationId, parentPid: process.pid, installDirectory, stagingDirectory: path.join(parent, `.ScientificPlotStudio-update-${operationId}`), backupDirectory: path.join(parent, `${path.basename(installDirectory)}.backup-${operationId}`), archivePath: archive.path, archiveSha256: archive.sha256, version: archive.version, statusPath }), 'utf8');
    const child = installChild = spawn(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', helper, '-PlanPath', planPath], { detached: true, stdio: 'ignore', windowsHide: true });
    let childError, childExit;
    child.on('error', error => { childError = error; });
    child.on('exit', code => { childExit = code; });
    child.unref();
    let prepared = false;
    for (let attempt = 0; attempt < 720; attempt++) {
      if (childError) throw childError;
      let status;
      try { status = await readJson(statusPath, 65536); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (status && status.operationId !== operationId) throw Error('更新程序返回的操作标识不一致。');
      if (status?.phase === 'error') throw Error(status.message || '更新准备失败，当前版本保持可用。');
      if (status?.phase === 'prepared') { prepared = true; break; }
      if (childExit !== undefined) throw Error('更新程序提前结束，当前版本保持可用。');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!prepared) { child.kill(); throw Error('准备更新超时，当前版本保持可用，请重试。'); }
    const bounds = window.getNormalBounds();
    await fs.writeFile(path.join(app.getPath('userData'), 'window.json'), JSON.stringify({ width: bounds.width, height: bounds.height, maximized: window.isMaximized() })).catch(() => {});
    await log(`Update prepared version=${archive.version} operation=${operationId}`);
    closeConfirmed = true;
    installStarted = true;
    setImmediate(() => app.quit());
    return { started: true };
  } catch (error) { if (error.retryDownload) updater.invalidateArchive(error); else updater.installFailed(error); return { started: false }; }
  finally { if (!installStarted && installChild) installChild.kill(); updatePreparing = false; }
});
async function log(message) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.appendFile(path.join(app.getPath('userData'), 'desktop.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {});
}
function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true, timeout: 600_000, maxBuffer: 64 * 1024,
      env: { ...process.env, PLOT_DESKTOP_WORK_DIRECTORY: workDirectory, ...options.env },
    }, (error, stdout, stderr) => {
      if (error) reject(Error(error.killed ? '本机连接程序等待超时，请检查 Origin 或 JADE 的窗口后重试。' : (stderr.trim() || error.message).slice(0, 2000)));
      else resolve(stdout);
    });
  });
}
async function readJson(file, maximum = 2 * 1024 * 1024) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maximum) throw Error('本机返回文件大小无效。');
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
async function reportUpdateFailure() {
  const entries = await fs.readdir(updateDirectory, { withFileTypes: true }).catch(() => []);
  const operations = await Promise.all(entries.filter(entry => entry.isDirectory() && /^install-[0-9a-f-]{36}$/.test(entry.name)).map(async entry => {
    const folder = path.join(updateDirectory, entry.name);
    const stat = await fs.stat(folder);
    return { folder, time: stat.mtimeMs };
  }));
  const latest = operations.sort((a, b) => b.time - a.time)[0];
  if (!latest || !window || window.isDestroyed()) return;
  let status, plan;
  try {
    status = await readJson(path.join(latest.folder, 'status.json'), 65536);
    plan = await readJson(path.join(latest.folder, 'plan.json'), 65536);
    await fs.access(path.join(latest.folder, 'reported'));
    return;
  } catch (error) { if (error.code !== 'ENOENT' || !status || !plan) return; }
  if (status.operationId !== plan.operationId || path.resolve(plan.installDirectory).toLowerCase() !== path.dirname(process.execPath).toLowerCase() || status.phase !== 'error') return;
  await fs.writeFile(path.join(latest.folder, 'reported'), new Date().toISOString());
  await dialog.showMessageBox(window, { type: 'warning', title: '上次更新未完成', message: '上次更新未完成，当前版本仍可继续使用。', detail: `请重新检查更新后重试。旧版备份位置：${plan.backupDirectory}\n\n${String(status.message || '').slice(0, 1200)}` });
}

invoke('studio:origin', async text => {
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再连接 Origin。');
  if (originBusy) throw Error('上一份数据还在导入 Origin，请等待完成。');
  const payload = validateOriginRequest(text);
  originBusy = true;
  const operation = randomUUID();
  const folder = path.join(workDirectory, 'OriginTransfers');
  const file = path.join(folder, `lsv-origin-${payload.requestId}.lsvdata`);
  const progress = path.join(workDirectory, 'Logs', `${operation}.status.json`);
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(file, text, 'utf8');
    let processError;
    try {
      await runPowerShell(['-File', path.join(nativeDirectory, 'Import-LsvOrigin.ps1'), '-RequestUri', `lsv-origin://import/${payload.requestId}`, '-PayloadPath', file], { env: { LSV_ORIGIN_OPERATION_ID: operation } });
    } catch (cause) { processError = cause; }
    let state;
    try { state = await readJson(progress, 128 * 1024); } catch { throw processError || Error('Origin 未返回导入结果。请确认本机已经安装 Origin。'); }
    if (state.operationId !== operation || state.done !== true || state.failed !== false || state.stage !== 'complete' || typeof state.bookName !== 'string' || !state.bookName) {
      throw Error(typeof state.message === 'string' ? state.message.slice(0, 4096) : 'Origin 导入未完成。');
    }
    await log(`Origin complete operation=${operation} kind=${payload.kind || 'lsv'} samples=${payload.samples.length}`);
    return { bookName: state.bookName, message: `已在 Origin 新建 ${state.bookName}，${payload.samples.length} 个样品的数据已逐点核对。` };
  } finally { originBusy = false; }
});

invoke('studio:overpotential-origin', async text => {
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再连接 Origin。');
  if (originBusy) throw Error('上一份数据还在导入 Origin，请等待完成。');
  const payload = validateOverpotentialRequest(text);
  originBusy = true;
  const operation = randomUUID();
  const folder = path.join(workDirectory, 'OverpotentialTransfers');
  const file = path.join(folder, `overpotential-origin-${payload.requestId}.json`);
  const statusFile = path.join(workDirectory, 'Logs', `overpotential-${operation}.status.json`);
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(file, text, 'utf8');
    let processError;
    try {
      await runPowerShell(['-File', path.join(nativeDirectory, 'Import-OverpotentialOrigin.ps1'), '-PayloadPath', file, '-RequestId', payload.requestId, '-OperationId', operation, '-StatusPath', statusFile]);
    } catch (cause) { processError = cause; }
    let state;
    try { state = await readJson(statusFile, 128 * 1024); } catch { throw processError || Error('Origin 未返回过电位导出结果。请确认本机已安装 Origin。'); }
    if (state.schema !== 'overpotential-origin-status/v1' || state.operationId !== operation || state.requestId !== payload.requestId || state.done !== true || state.failed !== false || state.stage !== 'complete' || typeof state.bookName !== 'string' || !state.bookName || typeof state.graphName !== 'string' || !state.graphName) throw Error(typeof state.message === 'string' ? state.message.slice(0, 4096) : '过电位导出至 Origin 未完成。');
    await log(`Overpotential Origin complete operation=${operation} samples=${payload.samples.length}`);
    return { bookName: state.bookName, graphName: state.graphName, message: `已在 Origin 新建 ${state.bookName} 和柱状图 ${state.graphName}，${payload.samples.length} 个样品的数据与坐标轴已核对。` };
  } finally { originBusy = false; }
});

invoke('studio:cdl-origin', async text => {
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再连接 Origin。');
  if (originBusy) throw Error('上一份数据还在导入 Origin，请等待完成。');
  const payload=validateCdlRequest(text);originBusy=true;
  const operation=randomUUID(),folder=path.join(workDirectory,'CdlTransfers'),file=path.join(folder,`cdl-origin-${payload.requestId}.json`),statusFile=path.join(workDirectory,'Logs',`cdl-${operation}.status.json`);
  try {
    await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,text,'utf8');
    let processError;
    try { await runPowerShell(['-File',path.join(nativeDirectory,'Import-CdlOrigin.ps1'),'-PayloadPath',file,'-RequestId',payload.requestId,'-OperationId',operation,'-StatusPath',statusFile]); } catch(cause){processError=cause;}
    let state;
    try {state=await readJson(statusFile,128*1024);}catch{throw processError||Error('Origin 未返回 Cdl 导出结果，请确认本机已经安装 Origin。');}
    if(state.schema!=='cdl-origin-status/v1'||state.operationId!==operation||state.requestId!==payload.requestId||state.done!==true||state.failed!==false||state.stage!=='complete'||typeof state.bookName!=='string'||!state.bookName||typeof state.cvGraphName!=='string'||typeof state.fitGraphName!=='string')throw Error(typeof state.message==='string'?state.message.slice(0,4096):'Cdl 导出至 Origin 未完成。');
    await log(`Cdl Origin complete operation=${operation} electrodes=${payload.electrodeCount} sheets=${payload.sheets.length}`);
    return {bookName:state.bookName,cvGraphName:state.cvGraphName,fitGraphName:state.fitGraphName,message:`已在 Origin 新建 ${state.bookName}，${state.cvGraphName?'CV 图、':''}${state.fitGraphName?'Cdl 图、':''}工作表数据已逐点核对。请在 Origin 中保存工程。`};
  } finally {originBusy=false;}
});

invoke('studio:ph-origin', async text => {
  if(updatePreparing)throw Error('正在准备更新，请等待软件重启后再连接 Origin。');
  if(originBusy)throw Error('上一份数据还在导入 Origin，请等待完成。');
  const packet=validatePhRequest(text);originBusy=true;
  const operation=randomUUID(),folder=path.join(workDirectory,'PhTransfers'),file=path.join(folder,`ph-origin-${packet.requestId}.json`),statusFile=path.join(workDirectory,'Logs',`ph-${operation}.status.json`);
  try{
    await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,text,'utf8');let processError;
    try{await runPowerShell(['-File',path.join(nativeDirectory,'Import-PhOrigin.ps1'),'-PayloadPath',file,'-RequestId',packet.requestId,'-OperationId',operation,'-StatusPath',statusFile]);}catch(cause){processError=cause;}
    let state;try{state=await readJson(statusFile,128*1024);}catch{throw processError||Error('Origin 未返回 pH 导出结果。');}
    if(state.schema!=='ph-origin-status/v1'||state.requestId!==packet.requestId||state.operationId!==operation||state.stage!=='complete'||state.done!==true||state.failed!==false||!state.bookName||typeof state.rawGraphName!=='string'||typeof state.fitGraphName!=='string')throw Error(typeof state.message==='string'?state.message.slice(0,4096):'pH 导出至 Origin 未完成。');
    return {bookName:state.bookName,rawGraphName:state.rawGraphName,fitGraphName:state.fitGraphName,message:`已在 Origin 新建 ${state.bookName}，完整原始数据、取点、拟合及可编辑图形已核对。请在 Origin 中保存工程。`};
  }finally{originBusy=false;}
});

invoke('studio:jade', async requestId => {
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再连接 JADE。');
  validateId(requestId);
  if (jadeBusy) throw Error('上一次 JADE 读取尚未结束，请先完成或取消 Windows 权限提示，再重试。');
  jadeBusy = requestId;
  const folder = path.join(workDirectory, 'JadeResults');
  const file = path.join(folder, `jade-${requestId}.json`);
  try {
    await fs.mkdir(folder, { recursive: true });
    // Only reviewed bundled code is elevated. IDs and paths are validated or
    // selected by the main process; renderer content never becomes shell code.
    const argumentsList = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(nativeDirectory, 'Read-JadeCard.ps1'), '-RequestUri', `lsv-origin://jade/${requestId}`, '-ReturnWindow', '1', '-ResultDirectory', folder].map(windowsArgument).join(' ');
    const launcher = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ${psLiteral(powershell)} -ArgumentList ${psLiteral(argumentsList)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; if($p.ExitCode -ne 0){exit 1}`;
    let processError;
    try { await runPowerShell(['-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')]); } catch (cause) { processError = cause; }
    if (cancelledJade.has(requestId)) throw Error('已取消本次 JADE 读取。');
    let packet;
    try { packet = await readJson(file); } catch { throw processError || Error('未收到 JADE 数据。请在 JADE 9 中文版中打开一张标准卡片详细窗口。'); }
    if (packet.schema !== 'jade-card/v1' || packet.requestId !== requestId) throw Error('JADE 返回的数据不属于本次读取。');
    if (typeof packet.error === 'string') throw Error(packet.error.slice(0, 4096));
    if (typeof packet.text !== 'string' || packet.text.length > 1_000_000 || !/^\d{2}-\d{3}-\d{4}$/.test(packet.cardNumber) || !(packet.wavelength > 0 && packet.wavelength <= 10)) throw Error('JADE 返回的卡片格式无效。');
    await log(`JADE complete request=${requestId} card=${packet.cardNumber}`);
    if (window && !window.isDestroyed()) { window.restore(); window.focus(); }
    return 'SCIENTIFIC_PLOT_JADE_V1\n' + JSON.stringify(packet);
  } finally {
    await fs.unlink(file).catch(() => {});
    cancelledJade.delete(requestId); jadeBusy = null;
  }
});
invoke('studio:cancel-jade', requestId => { validateId(requestId); if (jadeBusy === requestId) cancelledJade.add(requestId); });
invoke('studio:data-folder', async () => { await fs.mkdir(workDirectory, { recursive: true }); await shell.openPath(workDirectory); });
invoke('studio:save-data-file', async request => {
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再导出数据。');
  if (!request || typeof request.filename !== 'string' || typeof request.mime !== 'string') throw Error('导出内容无效。');
  const extension = path.extname(request.filename).toLowerCase();
  const types={'.csv':'text/csv','.txt':'text/plain','.svg':'image/svg+xml','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  if (path.basename(request.filename) !== request.filename || /[\\/:*?"<>|\x00-\x1f]/.test(request.filename) || request.filename.length > 180 || !types[extension]) throw Error('导出文件名无效。');
  if(request.mime.split(';')[0].trim().toLowerCase()!==types[extension])throw Error('导出格式无效。');
  let contents;
  if(extension==='.xlsx'){
    if(request.text!==undefined || !(request.bytes instanceof ArrayBuffer) || request.bytes.byteLength>256*1024*1024)throw Error('Excel 导出数据无效或过大。');
    contents=Buffer.from(request.bytes);
    if(contents.length<4 || contents[0]!==0x50 || contents[1]!==0x4b || contents[2]!==3 || contents[3]!==4)throw Error('Excel 导出格式无效。');
  }else{
    if(request.bytes!==undefined || typeof request.text!=='string' || Buffer.byteLength(request.text,'utf8')>256*1024*1024)throw Error('导出内容无效或过大。');
    contents=request.text;
  }
  const labels={'.csv':'CSV 数据','.txt':'Origin 制表符数据','.svg':'SVG 矢量图','.xlsx':'Excel 工作簿'};
  exportBusy++;
  try {
  const result = await dialog.showSaveDialog(window, { title: '保存科研绘图数据或图形', defaultPath: path.join(app.getPath('documents'), request.filename), properties: ['showOverwriteConfirmation', 'createDirectory'], filters: [{ name: labels[extension], extensions: [extension.slice(1)] }] });
  if (result.canceled || !result.filePath) return { saved: false };
  await fs.writeFile(result.filePath, contents, typeof contents==='string'?'utf8':undefined);
  const fileName = path.basename(result.filePath);
  if (window && !window.isDestroyed()) window.webContents.send('studio:download', fileName);
  return { saved: true, fileName };
  } finally { exportBusy--; }
});
let filePickerBusy = false;
invoke('studio:read-dropped-data',async(profile,paths)=>{
  if(updatePreparing)throw Error('正在准备更新，请等待软件重启后再导入数据。');
  if(filePickerBusy)throw Error('正在读取其他文件，请稍后再拖入。');
  filePickerBusy=true;
  try{
    return await readDroppedData(profile,paths,{selectAmbiguous:async({folder})=>{
      const result=await dialog.showOpenDialog(window,{
        title:'文件夹中有多份 LSV，请选择需要导入的文件',defaultPath:folder,
        properties:['openFile','multiSelections'],filters:[{name:'LSV 实验数据',extensions:['txt','bin','csv','tsv','dat','xlsx']}],
      });
      return result.canceled?null:result.filePaths;
    }});
  }finally{filePickerBusy=false;}
});
async function chooseDataFiles(profile) {
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再导入数据。');
  if (!['lsv', 'eis', 'cdl', 'cv', 'xrd', 'raman', 'ph'].includes(profile)) throw Error('绘图类型无效。');
  if (filePickerBusy) return [];
  filePickerBusy = true;
  try {
    await log(`Import picker opening profile=${profile}`);
    const title = profile === 'raman' ? 'Raman' : profile === 'cdl' ? 'Cdl' : profile.toUpperCase();
    const extensions = profile === 'xrd' ? ['mdi', 'txt', 'csv', 'tsv', 'dat', 'xlsx'] : profile === 'raman' ? ['txt', 'csv', 'tsv', 'dat', 'xlsx'] : ['txt', 'bin', 'csv', 'tsv', 'dat', 'xlsx'];
    const result = await dialog.showOpenDialog(window, {
      title: `选择 ${title} 数据文件`,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: `${title} 实验数据`, extensions }, { name: '全部文件', extensions: ['*'] }],
    });
    if (result.canceled) { await log(`Import picker cancelled profile=${profile}`); return []; }
    const maximum=profile==='cdl'?500:profile==='eis'?160:['ph','cv'].includes(profile)?120:10;
    if (result.filePaths.length > maximum) throw Error(`一次最多选择 ${maximum} 个文件。`);
    if (profile === 'cv' || profile === 'eis') return await readDroppedData(profile, result.filePaths);
    const files = [];
    let totalBytes=0;
    for (const selected of result.filePaths) {
      const stat = await fs.stat(selected);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw Error(`${path.basename(selected)}：单个文件不能超过 20 MB。`);
      totalBytes+=stat.size;if(totalBytes>100*1024*1024)throw Error('本次文件总大小超过 100 MB，请分批导入。');
      const buffer = await fs.readFile(selected);
      const relativePath=['cdl','ph'].includes(profile)?selected.split(/[\\/]/).slice(-4).join('/'):undefined;
      files.push({ name: path.basename(selected), data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), lastModified: stat.mtimeMs,relativePath,...(['cdl','ph'].includes(profile)?{sourcePath:selected}:{}) });
    }
    await log(`Import files read profile=${profile} files=${files.length} bytes=${files.reduce((n, f) => n + f.data.byteLength, 0)}`);
    return files;
  } finally { filePickerBusy = false; }
}
invoke('studio:choose-lsv-files', () => chooseDataFiles('lsv'));
invoke('studio:choose-data-files', chooseDataFiles);
invoke('studio:choose-cdl-folder',async()=>{
  if (updatePreparing) throw Error('正在准备更新，请等待软件重启后再导入数据。');
  if(filePickerBusy)return [];
  filePickerBusy=true;
  try{
    const result=await dialog.showOpenDialog(window,{title:'选择 Cdl 数据文件夹',properties:['openDirectory']});
    if(result.canceled || !result.filePaths[0])return [];
    const root=path.resolve(result.filePaths[0]),files=[];let totalBytes=0;
    async function visit(folder,depth){
      if(depth>8)return;
      const entries=await fs.readdir(folder,{withFileTypes:true}),names=new Set(entries.map(entry=>entry.name.toLowerCase()));
      for(const entry of entries){
        if(entry.isSymbolicLink())continue;
        const selected=path.join(folder,entry.name),relative=path.relative(root,selected);
        if(relative.startsWith('..') || path.isAbsolute(relative))throw Error('文件路径超出所选文件夹。');
        if(entry.isDirectory()){if(!/^(?:\.|node_modules|__pycache__)/i.test(entry.name))await visit(selected,depth+1);continue;}
        if(!entry.isFile() || !/\.(?:txt|csv|tsv|dat|xlsx|bin)$/i.test(entry.name) || !/(?:cdl|cv|电容|双电层)/i.test(relative))continue;
        // Text exports carry the acquisition headers used for rate/cycle checks.
        // Avoid importing their same-name binary companions as extra electrodes.
        if(/\.bin$/i.test(entry.name)&&names.has(entry.name.replace(/\.bin$/i,'.txt').toLowerCase()))continue;
        if(files.length>=500)throw Error('文件夹中超过 500 个 Cdl/CV 文件，请选择更小的文件夹。');
        const stat=await fs.stat(selected);totalBytes+=stat.size;
        if(stat.size>20*1024*1024 || totalBytes>100*1024*1024)throw Error('文件过大，请分批选择（单文件 20 MB，本次总量 100 MB）。');
        const buffer=await fs.readFile(selected);
        files.push({name:entry.name,data:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),lastModified:stat.mtimeMs,sourcePath:selected,relativePath:[path.basename(root),relative].join('/').replaceAll('\\','/')});
      }
    }
    await visit(root,0);if(!files.length)throw Error('未找到名称或路径包含 Cdl/CV 的数据文件，请直接选择文件导入。');
    await log(`Cdl folder files=${files.length} bytes=${totalBytes}`);return files;
  }finally{filePickerBusy=false;}
});

invoke('studio:choose-ph-folder',async()=>{
  if(updatePreparing)throw Error('正在准备更新，请等待软件重启后再导入数据。');
  if(filePickerBusy)return [];filePickerBusy=true;
  try{
    const result=await dialog.showOpenDialog(window,{title:'选择 pH 依赖性原始数据文件夹',properties:['openDirectory']});
    if(result.canceled||!result.filePaths[0])return [];
    const root=path.resolve(result.filePaths[0]),files=[];let total=0;
    async function visit(folder,depth){
      if(depth>8)return;
      const entries=await fs.readdir(folder,{withFileTypes:true}),names=new Set(entries.map(e=>e.name.toLowerCase()));
      for(const entry of entries){
        if(entry.isSymbolicLink())continue;const selected=path.join(folder,entry.name),relative=path.relative(root,selected);
        if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('文件路径超出所选文件夹。');
        if(entry.isDirectory()){if(!/^(?:\.|分析结果|参照方法|完整数据|node_modules|__pycache__)/i.test(entry.name))await visit(selected,depth+1);continue;}
        if(!entry.isFile()||!(/\.(txt|csv|tsv|dat|xlsx|bin)$/i.test(entry.name))||/活化|activation/i.test(entry.name))continue;
        if(/\.bin$/i.test(entry.name)&&names.has(entry.name.replace(/\.bin$/i,'.txt').toLowerCase()))continue;
        if(files.length>=120)throw Error('文件夹超过 120 个文件，请选择更小的原始数据文件夹。');
        const stat=await fs.stat(selected);total+=stat.size;if(stat.size>20*1024*1024||total>100*1024*1024)throw Error('文件过大：单文件 20 MB，本次总量 100 MB。');
        const buffer=await fs.readFile(selected);files.push({name:entry.name,data:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),lastModified:stat.mtimeMs,sourcePath:selected,relativePath:[path.basename(root),relative].join('/').replaceAll('\\','/')});
      }
    }
    await visit(root,0);if(!files.length)throw Error('所选文件夹未找到曲线数据。');return files;
  }finally{filePickerBusy=false;}
});

invoke('studio:choose-cv-folder',async()=>{
  if(updatePreparing)throw Error('正在准备更新，请等待软件重启后再导入数据。');
  if(filePickerBusy)return [];filePickerBusy=true;
  try{
    const result=await dialog.showOpenDialog(window,{title:'选择 CV 原始数据文件夹',properties:['openDirectory']});
    if(result.canceled||!result.filePaths[0])return [];
    return await readDroppedData('cv',result.filePaths);
  }finally{filePickerBusy=false;}
});

invoke('studio:choose-eis-folder',async()=>{
  if(updatePreparing)throw Error('正在准备更新，请等待软件重启后再导入数据。');
  if(filePickerBusy)return [];filePickerBusy=true;
  try{
    const result=await dialog.showOpenDialog(window,{title:'选择原位 EIS 原始数据文件夹',properties:['openDirectory']});
    if(result.canceled||!result.filePaths[0])return [];
    return await readDroppedData('eis',result.filePaths);
  }finally{filePickerBusy=false;}
});

async function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  let settings = {};
  try { settings = await readJson(path.join(app.getPath('userData'), 'window.json'), 4096); } catch { /* first launch */ }
  const width = Math.min(area.width, Math.max(1050, Number(settings.width) || 1520));
  const height = Math.min(area.height, Math.max(650, Number(settings.height) || 960));
  window = new BrowserWindow({
    width, height, minWidth: Math.min(1000, area.width), minHeight: Math.min(650, area.height),
    show: false, backgroundColor: '#f5f7fa', title: `Friday · 桌面版 ${app.getVersion()}`,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (DOCUMENT_URLS.has(url)) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { const target = new URL(url); if (target.protocol !== 'plot-app:' || target.host !== 'studio' || !['/', '/index.html'].includes(target.pathname)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-fail-load', (_event, code, description) => { void log(`Renderer load failed ${code} ${description}`); });
  window.on('close', event => {
    if (closeConfirmed) return;
    event.preventDefault();
    if (updatePreparing) return;
    void window.webContents.executeJavaScript("Boolean(document.querySelector('.lsv-managed-curve, .xrd-reference-managed, #panel-cdl [data-cdl-has-data=\"true\"]'))").catch(() => false).then(async hasData => {
      if ((projectStatus?projectStatus.dirty&&(projectStatus.hasData||hasData):hasData) || originBusy || jadeBusy) {
        const result = await dialog.showMessageBox(window, { type: 'question', title: '退出 Friday', message: originBusy || jadeBusy ? '本机软件连接仍在进行。确定退出？' : '项目有尚未保存的数据或修改。', detail: '请先保存项目或导出需要的数据，再退出。', buttons: ['继续使用', '退出'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) return;
      }
      closeConfirmed = true;
      const bounds = window.getNormalBounds();
      await fs.writeFile(path.join(app.getPath('userData'), 'window.json'), JSON.stringify({ width: bounds.width, height: bounds.height, maximized: window.isMaximized() })).catch(() => {});
      window.close();
    });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{label:'新建项目',accelerator:'CmdOrCtrl+N',click:()=>window.webContents.send('studio:project-action','new')},{label:'打开项目…',accelerator:'CmdOrCtrl+Shift+O',click:()=>window.webContents.send('studio:project-action','open')},{label:'保存项目',accelerator:'CmdOrCtrl+S',click:()=>window.webContents.send('studio:project-action','save')},{label:'项目另存为…',accelerator:'CmdOrCtrl+Shift+S',click:()=>window.webContents.send('studio:project-action','save-as')},{type:'separator'},{ label: '导入数据…', accelerator: 'CmdOrCtrl+O', click: () => window.webContents.send('studio:open-import') }, { label: '打开本机数据文件夹', click: async () => { await fs.mkdir(workDirectory, { recursive: true }); await shell.openPath(workDirectory); } }, { type: 'separator' }, { label: '退出', accelerator: 'Alt+F4', click: () => window.close() }] },
    { label: '工作台', submenu: [
      { label: 'LSV', tab: 'lsv', shortcut: 1 },
      { label: '过电位', tab: 'overpotential', shortcut: 6 },
      { label: 'EIS', tab: 'eis', shortcut: 2 },
      { label: 'Cdl', tab: 'cdl', shortcut: 7 },
      { label: 'CV', tab: 'cv', shortcut: 9 },
      { label: 'Tafel', tab: 'tafel', shortcut: 3 },
      { label: 'pH 依赖性', tab: 'ph', shortcut: 8 },
      { label: 'XRD', tab: 'xrd', shortcut: 4 },
      { label: 'Raman', tab: 'raman', shortcut: 5 },
    ].map(({ label, tab, shortcut }) => ({ label, accelerator: `CmdOrCtrl+${shortcut}`, click: () => window.webContents.send('studio:navigate', tab) })) },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] },
    { label: '帮助', submenu: [{ label: '检查更新…', click: () => window.webContents.send('studio:open-updates') }, { type: 'separator' }, { label: '使用说明书（PDF）', click: async () => { const manual=path.join(app.isPackaged?process.resourcesPath:path.dirname(__dirname),'docs','科研绘图台使用说明书.pdf');const error=await shell.openPath(manual);if(error)void dialog.showMessageBox(window,{type:'error',message:'无法打开使用说明书，请从发行版单独下载 PDF。'}); } }, { label: '重播启动动画', click: () => window.webContents.send('studio:startup-intro') }, { label: '项目主页（Gitee）', click: () => shell.openExternal(WEB_URL) }, { label: '关于Friday', click: () => dialog.showMessageBox(window, { type: 'info', title: 'Friday', message: `Friday · 桌面版 ${app.getVersion()}`, detail: 'LSV · 过电位 · EIS · Cdl · CV · Tafel · pH 依赖性 · XRD · Raman\n导入、计算和导出在本机完成。\nCV 页面支持峰位提取、Laviron 拟合与 Ks 计算。\nCdl 页面支持正反扫取点、扫描速率拟合与完整导出。\n过电位页面自动汇总 LSV 样品与读数。\nOrigin / JADE 需在本机安装；JADE 当前适配 9 中文版。' }) }] },
  ]));
  window.once('ready-to-show', () => { if (settings.maximized) window.maximize(); window.show(); });
  await window.loadURL(`plot-app://studio/index.html?v=${app.getVersion()}`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    await fs.mkdir(workDirectory, { recursive: true });
    // The packaged workbench has no network dependency and no remote page can
    // gain access to its native bridge.
    const localFullscreen=(contents,permission,requestUrl,isMainFrame)=>{
      if(permission!=='fullscreen'||!window||contents!==window.webContents||isMainFrame===false)return false;
      try{const top=new URL(contents.getURL()),request=new URL(requestUrl||contents.getURL());return top.protocol==='plot-app:'&&top.host==='studio'&&['/','/index.html'].includes(top.pathname)&&request.protocol==='plot-app:'&&request.host==='studio';}catch{return false;}
    };
    session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details) => callback(localFullscreen(contents,permission,details?.requestingUrl,details?.isMainFrame)));
    session.defaultSession.setPermissionCheckHandler((contents,permission,origin,details) => localFullscreen(contents,permission,details?.requestingUrl||origin,details?.isMainFrame));
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:\/\//i.test(details.url) }));
    session.defaultSession.on('will-download', (_event, item) => {
      if (updatePreparing) { item.cancel(); return; }
      pendingDownloads.add(item);
      item.setSaveDialogOptions({ title: '导出数据或图像', defaultPath: path.join(app.getPath('documents'), path.basename(item.getFilename())) });
      item.once('done', (_event, state) => {
        pendingDownloads.delete(item);
        if (state === 'completed' && window && !window.isDestroyed()) window.webContents.send('studio:download', item.getFilename());
        else if (state === 'interrupted' && window && !window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', message: '文件保存失败，请检查保存位置后重试。' });
      });
    });
    protocol.handle('plot-app', async request => {
      try {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        const file = resolveAsset(request.url, rendererDirectory);
        return new Response(await fs.readFile(file), { headers: { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    await log(`Start version=${app.getVersion()}`);
    await createWindow();
    // A failed post-exit replacement can only be reported by the next launch.
    setTimeout(() => { void reportUpdateFailure().catch(() => {}); }, 2000);
  }).catch(error => { dialog.showErrorBox('Friday启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
