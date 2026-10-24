import {loadPlaywright} from './qa-playwright.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

delete process.env.ELECTRON_RUN_AS_NODE;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appDirectory=path.resolve(process.argv[2]||path.join(root,'desktop/build/app'));
const out=path.resolve(process.env.CV_QA_OUTPUT||path.join(root,'../output/playwright',`cv-layout-${new Date().toISOString().replace(/[:.]/g,'-')}`));
const appData=path.resolve(process.env.CV_QA_APP_DATA||path.join(out,'app-data'));
await fs.mkdir(out,{recursive:true});await fs.mkdir(appData,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'desktop/package.json'),'utf8'));
const {_electron:electron}=await loadPlaywright('CV_QA_PLAYWRIGHT');
const checks=[],errors=[],rates=[10,20,30,40,60,80],chosen=[10,30,40,80];
async function synthetic(sample,rate,base=.04){
  const lines=['Oct. 22, 2026 00:10:00','Cyclic Voltammetry','Instrument Model: CHI760F','Init E (V) = 0','High E (V) = 1','Low E (V) = 0',`Scan Rate (V/s) = ${rate/1000}`,'Segment = 8','Sample Interval (V) = 0.002','','Potential/V, Current/A'];
  for(let cycle=1;cycle<=4;cycle++){
    const half=(base+.002*(cycle-1))*Math.log(rate),epa=.55+half,epc=.55-half;
    for(let i=0;i<=500;i++){const e=i/500;lines.push(`${e.toFixed(3)},${(.0012*Math.exp(-(((e-epa)/.035)**2))+.00001*(e-.5)).toExponential(12)}`);}
    for(let i=499;i>=0;i--){const e=i/500;lines.push(`${e.toFixed(3)},${(-.001*Math.exp(-(((e-epc)/.035)**2))+.00001*(e-.5)).toExponential(12)}`);}
  }
  const file=path.join(out,'fixtures',sample,`CV-${rate}mV.txt`);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,lines.join('\r\n'));return file;
}
const filesA=await Promise.all(rates.map(r=>synthetic('A',r))),filesB=await Promise.all(rates.map(r=>synthetic('B',r,.052)));
let launch;
if(process.env.CV_QA_EXECUTABLE)launch={executablePath:path.resolve(process.env.CV_QA_EXECUTABLE),env:{...process.env,FRIDAY_QA_APP_DATA:appData},timeout:30000};
else{const wrapper=path.join(out,'main.cjs');await fs.writeFile(wrapper,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});require(${JSON.stringify(path.join(appDirectory,'main.cjs'))});`);launch={executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[wrapper],timeout:30000};}
const app=await electron.launch(launch);let page,panel;
async function picker(files){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showMessageBox=async()=>({response:1});},files);}
async function importFiles(files){await picker(files);await panel.getByRole('button',{name:'导入数据',exact:true}).click();const d=page.getByRole('dialog');await d.getByRole('heading',{name:/导入到/}).waitFor();assert.equal(await d.getByLabel('CV 导入有效面积',{exact:true}).inputValue(),'1');await d.getByRole('button',{name:`导入并作图（${files.length} 条）`,exact:true}).click();await d.waitFor({state:'detached'});}
async function view(mode){await panel.getByRole('tab',{name:mode==='cv'?'原始 CV 与取峰':'Laviron / Ks',exact:true}).click();await panel.locator(`svg[data-cv-figure="${mode}"]`).waitFor();}
async function fitCount(name,n){await page.waitForFunction(({name,n})=>document.querySelector(`path[data-cv-fit="${name}"]`)?.getAttribute('data-cv-n')===String(n),{name,n});}
async function four(){await panel.getByRole('button',{name:'选四个点…',exact:true}).click();const d=page.getByRole('dialog');await d.getByRole('heading',{name:'选择四个拟合点',exact:true}).waitFor();return d;}
async function chooseFour(d,selection){for(const input of await d.locator('[data-cv-four-rate] input[type=checkbox]').all())await input.uncheck();for(const rate of selection)await d.locator(`[data-cv-four-rate="${rate}"] input[type=checkbox]`).first().check();}
async function applyFour(d){await d.getByRole('button',{name:'应用四点拟合',exact:true}).click();await d.waitFor({state:'detached'});}
async function saveProject(file){await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.keyboard.press('Control+Shift+S');for(let i=0;i<100;i++){try{const text=await fs.readFile(file,'utf8');return JSON.parse(text);}catch{}await delay(50);}throw Error('Project save did not complete');}
async function openProject(file,groups){await picker([file]);await page.getByRole('button',{name:'打开项目',exact:true}).click();await page.waitForFunction(groups=>document.querySelectorAll('#panel-cv .cv-group-tabs button').length===groups,groups);}
async function geometry(width,mode){
  await view(mode);await page.evaluate(()=>window.scrollTo(0,0));
  const value=await panel.evaluate(node=>{const b=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};return{plot:b(node.querySelector('.cv-plot-card')),results:b(node.querySelector('.cv-results-card')),frame:b(node.querySelector('[data-cv-frame]')),svg:b(node.querySelector('svg[data-cv-figure]')),overflow:node.scrollWidth-node.clientWidth};});
  assert.ok(value.results.x>=value.plot.right+4,`${width} ${mode}: results should sit to the right of the plot`);
  assert.ok(Math.abs(value.results.y-value.plot.y)<2,`${width} ${mode}: result and plot cards should share their top edge`);
  assert.ok(value.frame.width<=705&&value.frame.width>=200,`${width} ${mode}: resized frame width ${value.frame.width}`);
  assert.ok(Math.abs(value.frame.width-value.frame.height)<1,'both views should have square data frames');
  assert.ok(value.overflow<=1,`${width} ${mode}: page-level horizontal overflow ${value.overflow}`);
  return value;
}
async function exportFigure(format,file){await app.evaluate(({session},file)=>{globalThis.__cvLayoutDownload=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,state)=>state==='completed'?resolve(true):reject(Error(state)));}));},file);await panel.getByRole('button',{name:'导出图形（多格式）',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('图形格式',{exact:true}).selectOption(format);await d.getByRole('button',{name:'导出',exact:true}).click();await app.evaluate(()=>globalThis.__cvLayoutDownload);await d.waitFor({state:'detached'});return fs.readFile(file);}
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  const packaged=await app.evaluate(({app})=>app.isPackaged),profile=await app.evaluate(({app})=>app.getPath('userData'));assert.ok(profile.toLowerCase().startsWith(appData.toLowerCase()+path.sep));if(process.env.CV_QA_EXECUTABLE)assert.equal(packaged,true);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1920,1080));const day=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await day.count())await day.click();await page.locator('nav a[href="#cv"]').click();panel=page.locator('#panel-cv');await panel.getByRole('heading',{name:'CV',exact:true}).waitFor();await panel.getByRole('button',{name:'全部扫速',exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'全部扫速',exact:true}).count(),1);assert.equal(await panel.getByRole('button',{name:'全部排除',exact:true}).count(),0);
  await importFiles(filesA);await fitCount('样品1',6);await panel.getByRole('button',{name:'新增 CV 样品组',exact:true}).click();await importFiles(filesB);await fitCount('样品2',6);await panel.locator('.cv-group-tabs button').first().click();
  let d=await four();await chooseFour(d,[10,30,40]);assert.equal(await d.getByRole('button',{name:'应用四点拟合',exact:true}).isDisabled(),true);assert.match(await d.getByTestId('cv-four-count').textContent(),/3\s*\/\s*4/);await d.locator('[data-cv-four-rate="80"] input[type=checkbox]').check();await applyFour(d);await fitCount('样品1',4);await fitCount('样品2',6);
  assert.equal(await panel.locator('.cv-file-list summary input[type=checkbox]:checked').count(),4);assert.equal(await panel.locator('[data-cv-point][data-cv-included="false"]').count(),2);
  checks.push('nonconsecutive-four-distinct-scan-rates-current-sample-only');
  d=await four();await d.locator('[data-cv-four-rate="10"] input[type=checkbox]').uncheck();await d.getByRole('button',{name:'取消',exact:true}).click();await d.waitFor({state:'detached'});await fitCount('样品1',4);
  await panel.getByRole('button',{name:'全部扫速',exact:true}).click();await fitCount('样品1',6);await fitCount('样品2',6);checks.push('cancel-is-transactional-and-all-rates-restores-current-group');
  await importFiles([filesA[0]]);d=await four();for(const input of await d.locator('[data-cv-four-rate] input[type=checkbox]').all())await input.uncheck();await d.locator('[data-cv-four-rate="10"] input[type=checkbox]').nth(0).check();await d.locator('[data-cv-four-rate="10"] input[type=checkbox]').nth(1).check();await d.locator('[data-cv-four-rate="30"] input[type=checkbox]').check();await d.locator('[data-cv-four-rate="80"] input[type=checkbox]').check();assert.equal(await d.getByRole('button',{name:'应用四点拟合',exact:true}).isDisabled(),true);assert.match(await d.textContent(),/不同|重复/);await chooseFour(d,chosen);await applyFour(d);await fitCount('样品1',4);await fitCount('样品2',6);checks.push('four-files-with-repeated-rate-require-distinct-scan-rates');
  const pointId=await panel.getByRole('button',{name:'样品1 30 mV/s 移出拟合',exact:true}).getAttribute('data-cv-point'),point=panel.locator(`[data-cv-point="${pointId}"]`);await point.click();await fitCount('样品1',3);await point.press('Enter');await fitCount('样品1',4);checks.push('manual-point-and-keyboard-selection-still-works');
  const project=path.join(out,'four-point-project.fri'),saved=await saveProject(project);assert.equal(saved.states['cv.groups'][0].series.filter(s=>s.included).length,4);assert.equal(saved.states['cv.groups'][1].series.filter(s=>s.included).length,6);assert.deepEqual(saved.states['cv.groups'][0].series.filter(s=>s.included).map(s=>Number(s.rate)).sort((a,b)=>a-b),chosen);
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#panel-cv .cv-group-tabs button').length===0);await openProject(project,2);await fitCount('样品1',4);await fitCount('样品2',6);checks.push('four-point-inclusion-and-full-source-data-persist-on-fri-reopen');
  for(const [width,height] of [[1920,1080],[1366,768]]){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});const raw=await geometry(width,'cv'),fit=await geometry(width,'fit');assert.ok(Math.abs(raw.frame.width-fit.frame.width)<1,'raw/fit data frames share their size');for(const mode of ['cv','fit']){await view(mode);await page.screenshot({path:path.join(out,`four-point-${mode}-${width}.png`),fullPage:true});}}
  await panel.getByRole('button',{name:/^逐扫速峰位与计算结果/}).click();d=page.getByRole('dialog');await d.getByRole('heading',{name:'逐扫速峰位与计算结果',exact:true}).waitFor();assert.equal(await d.locator('tbody tr').count(),13);await page.keyboard.press('Escape');await d.waitFor({state:'detached'});checks.push('compact-raw-and-fit-same-frame-results-right-1920-1366-and-detail-dialog');
  await view('cv');const svg=await exportFigure('svg',path.join(out,'compact-cv.svg'));assert.match(svg.toString('utf8'),/viewBox="0 0 1000 800"/);assert.ok(svg.toString('utf8').includes('data-cv-trace')&&svg.toString('utf8').includes('data-cv-peak'));
  const png=await exportFigure('png',path.join(out,'compact-cv.png'));assert.ok(Math.abs(png.readUInt32BE(16)/png.readUInt32BE(20)-1.25)<.002);const pdf=await exportFigure('pdf',path.join(out,'compact-cv.pdf'));assert.equal(pdf.subarray(0,5).toString('ascii'),'%PDF-');checks.push('compact-export-SVG-markers-PNG-ratio-and-vector-PDF');
  const twelve=structuredClone(saved),template=saved.states['cv.groups'][1];twelve.states['cv.groups']=Array.from({length:12},(_,i)=>({...structuredClone(template),id:`layout-group-${i}`,name:`样品${i+1}`,series:template.series.map((s,j)=>({...structuredClone(s),id:`layout-${i}-${j}`}))}));twelve.states['cv.active']='layout-group-0';const twelveFile=path.join(out,'twelve-samples.fri');await fs.writeFile(twelveFile,JSON.stringify(twelve));await openProject(twelveFile,12);await view('fit');assert.equal(await panel.locator('.cv-result').count(),12);await geometry(1366,'fit');
  const scroll=await panel.locator('.cv-results-card').evaluate(el=>{const list=el.querySelector('.cv-results');return{cardWidth:el.scrollWidth-el.clientWidth,height:list.clientHeight,scrollHeight:list.scrollHeight,overflowY:getComputedStyle(list).overflowY};});assert.ok(scroll.cardWidth<=1);assert.ok(scroll.scrollHeight>scroll.height&&['auto','scroll'].includes(scroll.overflowY),'Twelve results should scroll inside the summary column');
  await page.screenshot({path:path.join(out,'twelve-samples-1366.png'),fullPage:true});await page.getByRole('button',{name:'切换到夜晚模式',exact:true}).click();await geometry(1366,'cv');assert.equal(await panel.locator('[data-plot-background]').getAttribute('fill'),'white');await page.screenshot({path:path.join(out,'twelve-samples-night.png'),fullPage:true});checks.push('twelve-sample-summary-scroll-and-night-without-page-overflow');
  assert.equal(errors.length,0,errors.join('\n'));const report={ok:true,version:manifest.version,checks,packaged,profile,output:out};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
