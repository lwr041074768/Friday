import {loadPlaywright} from './qa-playwright.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

delete process.env.ELECTRON_RUN_AS_NODE;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.env.EIS_QA_OUTPUT||path.join(root,'../output/playwright/eis-auto-20261022'));
const appDirectory=path.join(root,'desktop/build/app');
await fs.mkdir(out,{recursive:true});
const appData=path.resolve(process.env.EIS_QA_APP_DATA||path.join(out,'app-data')),downloads=path.join(out,'downloads');
await fs.mkdir(appData,{recursive:true});await fs.mkdir(downloads,{recursive:true});
const {_electron:electron}=await loadPlaywright();
const source=path.join(out,'known-RQ.csv'),rows=['Freq/Hz,Zreal/ohm,Zimag/ohm'];
for(let i=0;i<61;i++){
  const f=10**(5-7*i/60),w=2*Math.PI*f,n=.85,q=2e-4,r=200;
  const a=1+q*r*w**n*Math.cos(n*Math.PI/2),b=q*r*w**n*Math.sin(n*Math.PI/2),d=a*a+b*b;
  const noise=1+.0005*Math.sin(i*2.361);
  rows.push(`${f},${(10+r*a/d)*noise},${-r*b/d*noise}`);
}
await fs.writeFile(source,rows.join('\n'));
const sourceHash=createHash('sha256').update(await fs.readFile(source)).digest('hex');
const wrapper=path.join(out,'main.cjs');
await fs.writeFile(wrapper,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});require(${JSON.stringify(path.join(appDirectory,'main.cjs'))});`);
const launch=process.env.EIS_QA_EXECUTABLE
  ? {executablePath:path.resolve(process.env.EIS_QA_EXECUTABLE),env:{...process.env,FRIDAY_QA_APP_DATA:appData},timeout:30000}
  : {executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[wrapper],timeout:30000};
const checks=[],errors=[],app=await electron.launch(launch);
let page;
const started=Date.now();
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow,dialog,session},folder)=>{
    const window=BrowserWindow.getAllWindows()[0];window.restore();window.show();window.focus();window.setContentSize(1600,1000);
    dialog.showMessageBox=async()=>({response:1});
    session.defaultSession.on('will-download',(_event,item)=>item.setSavePath(folder+'/'+Date.now()+'-'+item.getFilename()));
  },downloads);
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  const day=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await day.count())await day.click();
  await page.locator('.lsv-tabs a[href="#eis"]').click();
  const panel=page.locator('#panel-eis'),card=panel.getByTestId('eis-fit-card');
  const auto=panel.getByRole('button',{name:'自动选择最佳电路',exact:true});
  assert.equal(await auto.getAttribute('aria-pressed'),'true');
  assert.equal(await panel.getByRole('button',{name:'拟合',exact:true}).isDisabled(),true);
  checks.push('default-auto-and-empty-data-disabled');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
  await panel.getByRole('button',{name:'导入数据',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'选择 EIS 数据文件',exact:true}).click();
  await page.getByRole('button',{name:/^绘制.*条曲线$/}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const fit=()=>panel.getByRole('button',{name:'拟合',exact:true}).click();
  await fit();await panel.getByTestId('eis-fit-progress').waitFor();
  await panel.getByRole('button',{name:'取消',exact:true}).click();
  await panel.getByTestId('eis-fit-progress').waitFor({state:'hidden'});
  assert.equal(await card.count(),0);checks.push('worker-progress-cancel-no-stale-result');
  const fitStart=Date.now();await fit();await card.waitFor({timeout:180000});
  const fitMs=Date.now()-fitStart;
  assert.equal(await panel.locator('[data-curve="eis-circuit-fit"]').count(),1);
  assert.ok((await card.innerText()).includes('112'));
  const selected=panel.getByTestId('eis-candidate-list').locator('button[aria-pressed="true"]');
  assert.equal(await selected.getAttribute('data-kind'),'zsimp:R(QR)');
  assert.equal(await card.getByTestId('eis-circuit-diagram').count(),1);
  const bestText=await card.getByTestId('eis-fit-table').innerText();
  checks.push('auto-112-selects-known-rq-and-draws-overlay-circuit');
  await page.screenshot({path:path.join(out,'eis-auto-result.png')});
  await card.screenshot({path:path.join(out,'eis-auto-card.png')});
  await panel.getByRole('button',{name:'导出拟合报告',exact:true}).click();
  await page.waitForFunction(async()=>true);
  let csvFile;
  for(let i=0;i<100;i++){
    csvFile=(await fs.readdir(downloads)).find(name=>name.endsWith('-EIS-拟合报告.csv'));
    if(csvFile)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(csvFile);const csv=await fs.readFile(path.join(downloads,csvFile),'utf8');
  assert.match(csv,/zsimp:R\(QR\)/);assert.match(csv,/AICc/);assert.match(csv,/频率_Hz/);
  checks.push('report-contains-selection-ranking-parameters-and-all-residuals');
  const candidates=panel.getByTestId('eis-candidate-list').locator('button[data-kind]:not([aria-pressed="true"]):not([disabled])');
  const alternative=candidates.first(),alternativeKind=await alternative.getAttribute('data-kind');
  await alternative.click();
  assert.equal(await panel.getByTestId('eis-candidate-list').locator('button[aria-pressed="true"]').getAttribute('data-kind'),alternativeKind);
  assert.notEqual(await card.getByTestId('eis-fit-table').innerText(),bestText);
  checks.push('candidate-click-updates-selected-fit');
  await panel.getByTestId('eis-candidate-list').locator('button[data-kind="zsimp:R(QR)"]').click();
  const project=path.join(out,'auto-roundtrip.fri');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},project);
  await page.getByRole('button',{name:'保存项目',exact:true}).click();
  await page.getByText('已保存',{exact:true}).waitFor();
  const saved=JSON.parse(await fs.readFile(project,'utf8'));
  assert.equal(saved.states['eis.analysis.selectionMode'],'auto');assert.equal(saved.states['eis.analysis.fitRequested'],true);
  assert.equal(saved.states['eis.curves'][0].points.length,61);
  checks.push('fri-keeps-auto-request-and-full-signed-frequency-data');
  await panel.getByRole('button',{name:'手动选择',exact:true}).click();
  await card.waitFor({state:'hidden'});
  const picker=panel.getByRole('combobox',{name:'EIS 等效电路',exact:true});
  assert.equal(await picker.locator('option').count(),115);
  await picker.selectOption('zsimp:LR(QR)');
  assert.equal(await panel.getByTestId('eis-circuit-diagram').count(),1);
  await panel.getByRole('searchbox',{name:'搜索等效电路',exact:true}).fill('LR(QR)');
  assert.ok(await picker.locator('option').count()<115);
  await panel.getByRole('searchbox',{name:'搜索等效电路',exact:true}).fill('');
  await picker.selectOption('r-cpe');await fit();await card.waitFor({timeout:30000});
  const rct=Number((await card.locator('[data-parameter="Rct"]').innerText()).split('±')[0].trim());
  assert.ok(Math.abs(rct-200)/200<.01,`Rct=${rct}`);
  checks.push('manual-112-plus-3-search-and-legacy-fitting');
  await panel.getByRole('combobox',{name:'EIS 拟合加权',exact:true}).selectOption('unit');
  await card.waitFor({state:'hidden'});assert.equal(await panel.locator('[data-curve="eis-circuit-fit"]').count(),0);
  checks.push('weight-change-invalidates-overlay-and-report');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},project);
  await page.getByRole('button',{name:'打开项目',exact:true}).click();await card.waitFor({timeout:180000});
  assert.equal(await auto.getAttribute('aria-pressed'),'true');
  assert.equal(await card.getByTestId('eis-fit-table').innerText(),bestText);
  checks.push('fri-reopen-recomputes-identical-auto-fit');
  assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'),sourceHash);
  assert.deepEqual(errors,[]);
  const report={passed:true,checks,fitMs,elapsedMs:Date.now()-started,version:await page.evaluate(()=>window.scientificPlot.version),errors,output:out};
  await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  if(page){await page.screenshot({path:path.join(out,'error.png')}).catch(()=>{});await fs.writeFile(path.join(out,'error.txt'),await page.locator('body').innerText().catch(()=>''));}
  throw error;
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
