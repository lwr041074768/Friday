import {loadPlaywright} from './qa-playwright.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {unzipSync,strFromU8} from 'fflate';

// A separate appData directory gives this run its own single-instance identity,
// project/recovery files and theme. Existing Friday windows stay untouched.
delete process.env.ELECTRON_RUN_AS_NODE;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appDirectory=path.resolve(process.argv[2]||path.join(root,'desktop/build/app'));
const out=path.resolve(process.env.CV_QA_OUTPUT||path.join(root,'../output/playwright',`cv-${new Date().toISOString().replace(/[:.]/g,'-')}`));
const appData=path.resolve(process.env.CV_QA_APP_DATA||path.join(out,'app-data'));
await fs.mkdir(out,{recursive:true});await fs.mkdir(appData,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'desktop/package.json'),'utf8'));
const {_electron:electron}=await loadPlaywright('CV_QA_PLAYWRIGHT');
const checks=[],errors=[],fixtures=path.join(out,'fixtures'),sourceHashes=new Map();
const normalize=value=>value.replaceAll('\\','/');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rates=[10,20,40,80];

async function synthetic(sample,rate,base=.04){
  const rows=['Oct. 21, 2026 12:00:00','Cyclic Voltammetry','Instrument Model: CHI760F','Init E (V) = 0','High E (V) = 1','Low E (V) = 0','Init P/N = P',`Scan Rate (V/s) = ${rate/1000}`,'Segment = 8','Sample Interval (V) = 0.001','','Potential/V, Current/A'];
  for(let cycle=1;cycle<=4;cycle++){
    const half=(base+.002*(cycle-1))*Math.log(rate),epa=.55+half,epc=.55-half;
    for(let i=0;i<=1000;i++){const e=i/1000,current=.0012*Math.exp(-(((e-epa)/.035)**2))+.00001*(e-.5);rows.push(`${e.toFixed(3)},${current.toExponential(12)}`);}
    for(let i=999;i>=0;i--){const e=i/1000,current=-.001*Math.exp(-(((e-epc)/.035)**2))+.00001*(e-.5);rows.push(`${e.toFixed(3)},${current.toExponential(12)}`);}
  }
  const file=path.join(fixtures,sample,'CV',`CV-${rate}mV.txt`);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,rows.join('\r\n'));return file;
}
const sampleA=await Promise.all(rates.map(rate=>synthetic('A',rate)));
const sampleB=await Promise.all(rates.map(rate=>synthetic('B',rate,.052)));
// A companion must be ignored during folder discovery, rather than parsed as
// a second scan-rate measurement. Its contents intentionally are not CV BIN.
await fs.writeFile(sampleB[0].replace(/\.txt$/,'.bin'),'same-name binary companion');


let launch;
if(process.env.CV_QA_EXECUTABLE){
  launch={executablePath:path.resolve(process.env.CV_QA_EXECUTABLE),env:{...process.env,FRIDAY_QA_APP_DATA:appData},timeout:30000};
}else{
  const wrapper=path.join(out,'main.cjs');await fs.writeFile(wrapper,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});require(${JSON.stringify(path.join(appDirectory,'main.cjs'))});`);
  launch={executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[wrapper],timeout:30000};
}
const app=await electron.launch(launch);let page,panel;

async function picker(files){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showMessageBox=async()=>({response:1});},files);}
async function importFiles(files,{folder=false,expected=files.length,area,defaultArea}={}){
  await picker(files);await panel.getByRole('button',{name:folder?'导入文件夹':'导入数据',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:/导入到/}).waitFor();
  assert.equal(await dialog.locator('tbody tr').count(),expected);
  if(defaultArea!==undefined)assert.equal(await dialog.getByLabel('CV 导入有效面积',{exact:true}).inputValue(),String(defaultArea));
  if(area!==undefined)await dialog.getByLabel('CV 导入有效面积',{exact:true}).fill(String(area));
  for(const rate of await dialog.locator('tbody input[type=number]').evaluateAll(inputs=>inputs.map(input=>input.value)))assert.ok(Number(rate)>0,'Measurement header should supply its scan rate');
  for(const unit of await dialog.locator('tbody select[aria-label$="CV导入原始单位"]').evaluateAll(inputs=>inputs.map(input=>input.value)))assert.equal(unit,'A');
  await dialog.getByRole('button',{name:`导入并作图（${expected} 条）`,exact:true}).click();await dialog.waitFor({state:'detached'});
}
async function settings(patch={}){
  await panel.getByRole('button',{name:'取峰与计算设置',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('CV 共同循环',{exact:true}).waitFor();
  const labels={cycle:'CV 共同循环',temperature:'CV 温度',n:'CV 电子数',threshold:'CV 峰间距阈值',anodicMin:'CV 氧化峰下限',anodicMax:'CV 氧化峰上限',cathodicMin:'CV 还原峰下限',cathodicMax:'CV 还原峰上限'};
  for(const [key,value] of Object.entries(patch)){const input=dialog.getByLabel(key==='calculationMode'?'CV Ks计算方式':labels[key],{exact:true});if(key==='calculationMode')await input.selectOption(value);else await input.fill(String(value));}
  await dialog.getByRole('button',{name:'完成',exact:true}).click();await dialog.waitFor({state:'detached'});
}
async function view(mode){await panel.getByRole('tab',{name:mode==='cv'?'原始 CV 与取峰':'Laviron / Ks',exact:true}).click();await panel.locator(`svg[data-cv-figure="${mode}"]`).waitFor();}
async function fitCount(name,count){await page.waitForFunction(({name,count})=>document.querySelector(`path[data-cv-fit="${name}"]`)?.getAttribute('data-cv-n')===String(count),{name,count});}
async function group(index){await panel.locator('.cv-group-tabs button').nth(index).click();}
async function openSeries(index){const entry=panel.locator('.cv-file-list>details').nth(index);if(await entry.getAttribute('open')===null)await entry.locator('summary').click();return entry;}
async function saveProject(file){
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  await page.keyboard.press('Control+Shift+S');
  await page.waitForFunction(()=>document.querySelector('.studio-project-state')?.textContent?.includes('已保存')&&document.querySelector('.studio-project-message')?.textContent?.startsWith('已保存 '));
  return JSON.parse(await fs.readFile(file,'utf8'));
}
async function waitWritten(file,minSize=1){for(let i=0;i<100;i++){const info=await fs.stat(file).catch(()=>null);if(info?.size>=minSize)return info;await delay(100);}throw Error(`Export was not written: ${file}`);}
async function exportData(label,filename){
  const file=path.join(out,filename);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);
  const summary=panel.locator('.cv-export-menu>summary');if(!await panel.locator('.cv-export-menu').getAttribute('open'))await summary.click();
  await panel.getByRole('button',{name:label,exact:true}).click();await waitWritten(file,100);await panel.getByRole('button',{name:'导入数据',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#panel-cv .cv-heading button:last-child')?.disabled);
  if(await panel.locator('.cv-export-menu').getAttribute('open')!==null)await summary.click();return file;
}
async function exportFigure(format,filename){
  const file=path.join(out,filename);await app.evaluate(({session},file)=>{globalThis.__cvDownload=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,state)=>state==='completed'?resolve(true):reject(Error(state)));}));},file);
  await panel.getByRole('button',{name:'导出图形（多格式）',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('图形格式',{exact:true}).selectOption(format);await dialog.getByRole('button',{name:'导出',exact:true}).click();await app.evaluate(()=>globalThis.__cvDownload);await dialog.waitFor({state:'detached'});await waitWritten(file,100);return file;
}

try{
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  const nav=page.getByRole('navigation',{name:'绘图类型'});await nav.waitFor();assert.equal(await nav.locator('a[href="#cv"]').count(),1);
  const actualProfile=await app.evaluate(({app})=>app.getPath('userData'));assert.ok(normalize(actualProfile).toLowerCase().startsWith(normalize(appData).toLowerCase()+'/'),'QA must use its isolated profile');
  const actualPackaged=await app.evaluate(({app})=>app.isPackaged);
  if(process.env.CV_QA_EXECUTABLE)assert.equal(actualPackaged,true,'The executable QA run must exercise Electron packaged mode');
  assert.equal(await page.evaluate(()=>window.scientificPlot.version),manifest.version);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1920,1080));
  const day=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await day.count())await day.click();
  await nav.locator('a[href="#cv"]').click();panel=page.locator('#panel-cv');await panel.getByRole('heading',{name:'CV',exact:true}).waitFor();
  assert.equal(await panel.locator('.cv-group-tabs button').count(),0);await page.screenshot({path:path.join(out,'cv-empty-1920.png'),fullPage:true});
  checks.push('CV-navigation-and-isolated-app-data');

  await importFiles([sampleA[0]],{defaultArea:1});assert.equal(await panel.getByLabel('CV 当前样品组名称',{exact:true}).inputValue(),'样品1');assert.equal(await panel.locator('.cv-group-tabs button').count(),1);
  const first=await openSeries(0),area=first.locator('input[aria-label$="CV面积"]');assert.equal(await area.inputValue(),'1');await area.fill('2.5');
  await importFiles(sampleA.slice(1),{defaultArea:2.5});assert.equal(await panel.locator('.cv-group-tabs button').count(),1);assert.equal(await panel.locator('.cv-file-list>details').count(),4);await fitCount('样品1',4);
  let slope=Number(await panel.locator('[data-cv-fit="样品1"]').getAttribute('data-cv-slope'));assert.ok(Math.abs(slope-.046)<.001,`Known fourth-cycle slope should be .046 V: ${slope}`);
  await openSeries(0);assert.equal(await area.inputValue(),'2.5');checks.push('first-import-sample1-append-current-sample-default-and-custom-area');

  await panel.locator('[data-cv-point]').first().click();await fitCount('样品1',3);await panel.locator('[data-cv-point]').first().press('Enter');await fitCount('样品1',4);
  await settings({cycle:'1'});slope=Number(await panel.locator('[data-cv-fit="样品1"]').getAttribute('data-cv-slope'));assert.ok(Math.abs(slope-.04)<.001);await settings({cycle:'4'});await fitCount('样品1',4);
  await view('cv');assert.equal(await panel.locator('path[data-cv-trace]').count(),4);await openSeries(0);const firstId=await panel.getByLabel('CV 当前取峰文件',{exact:true}).inputValue();
  await first.locator('input[aria-label$="CV循环"]').fill('2');assert.match(await first.locator('summary').textContent(),/第\s*2\s*圈/);await first.locator('input[aria-label$="CV循环"]').fill('');
  checks.push('point-toggle-keyboard-global-and-per-file-cycle-refit');

  for(const [branch,label] of [['anodic','点选氧化峰'],['cathodic','点选还原峰']]){
    await panel.getByRole('button',{name:label,exact:true}).click();const marker=panel.locator(`circle[data-cv-peak="${branch}"][data-cv-series="${firstId}"]`);const box=await marker.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    assert.match(await marker.locator('title').textContent(),/手动/);
    const input=first.locator(`input[aria-label$="${branch==='anodic'?'氧化峰电位':'还原峰电位'}"]`);assert.ok(Number(await input.inputValue())>0);
  }
  await first.locator('select[aria-label$="还原峰标记"]').selectOption('shoulder');await view('fit');assert.equal(await panel.locator('[data-cv-point][data-cv-used="true"]').count(),3);
  await settings({threshold:'.8',calculationMode:'qualified'});assert.equal(await panel.locator('[data-cv-point][data-cv-used="true"]').count(),0);assert.match(await panel.locator('.cv-result-value').first().textContent(),/—/);
  await settings({calculationMode:'trial'});assert.equal(await panel.locator('[data-cv-point][data-cv-used="true"]').count(),4);assert.doesNotMatch(await panel.locator('.cv-result-value').first().textContent(),/—/);assert.match(await panel.getByRole('heading',{name:/Ks 条件试算/}).textContent(),/条件试算/);
  checks.push('click-manual-peaks-shoulder-qualified-vs-trial');

  await panel.getByRole('button',{name:'新增 CV 样品组',exact:true}).click();assert.equal(await panel.getByLabel('CV 当前样品组名称',{exact:true}).inputValue(),'样品2');await importFiles([path.dirname(sampleB[0])],{folder:true,expected:4,defaultArea:1});await fitCount('样品2',4);assert.equal(await panel.locator('.cv-group-tabs button').count(),2);
  const second=await openSeries(0);assert.equal(await second.locator('input[aria-label$="CV面积"]').inputValue(),'1');checks.push('plus-new-sample-default-area-folder-TXT-BIN-preference');

  const project=path.join(out,'cv-two-samples.fri');const saved=await saveProject(project);assert.deepEqual(saved.states['cv.groups'].map(g=>g.series.length),[4,4]);assert.equal(saved.states['cv.settings'].calculationMode,'trial');assert.equal(saved.states['cv.settings'].threshold,'.8');assert.equal(saved.states['cv.groups'][0].series[0].area,'2.5');assert.ok(saved.states['cv.groups'][0].series[0].anodic);assert.equal(saved.states['cv.groups'][0].series[0].cathodicQuality,'shoulder');
  assert.ok(saved.states['cv.groups'][1].series.every(series=>series.area==='1'&&/\.txt$/i.test(series.source)));assert.equal(saved.states['shell.tab'],'cv');assert.equal(saved.states['cv.view'],'fit');
  const allSeries=saved.states['cv.groups'].flatMap(g=>g.series),expectedRawRows=allSeries.reduce((n,s)=>n+s.points.length,0);assert.equal(new Set(allSeries.map(s=>s.id)).size,8);assert.ok(allSeries.some(s=>s.points.some(p=>p.current<0)));
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#panel-cv .cv-group-tabs button').length===0);await picker([project]);await page.getByRole('button',{name:'打开项目',exact:true}).click();await fitCount('样品1',4);await fitCount('样品2',4);
  assert.equal(await panel.locator('.cv-group-tabs button').count(),2);checks.push('fri-save-new-reopen-complete-raw-manual-settings-and-areas');

  const workbookFile=await exportData('Excel：完整 Origin 作图数据','cv-complete.xlsx'),zip=unzipSync(new Uint8Array(await fs.readFile(workbookFile))),workbookXml=strFromU8(zip['xl/workbook.xml']);for(const name of ['FitPoints','Fits','FittedValues','Metadata','Raw1','Raw8'])assert.ok(workbookXml.includes(name),`Workbook is missing ${name}`);
  const rawFile=await exportData('CSV：全部原始 CV 数据','cv-raw.csv'),rawText=await fs.readFile(rawFile,'utf8');assert.equal(rawText.split(/\r?\n/).filter(line=>line.startsWith('raw,')).length,expectedRawRows);assert.ok(rawText.includes('2.5')&&rawText.includes('shoulder'));
  const pointsFile=await exportData('CSV：峰位与逐扫速 Ks','cv-peaks.csv'),pointsText=await fs.readFile(pointsFile,'utf8');assert.ok(pointsText.includes('manual')&&pointsText.includes('shoulder')&&pointsText.includes('条件试算'));for(const file of sampleA)assert.ok(pointsText.includes(file),`Missing full source path ${file}`);
  const svgFile=await exportFigure('svg','cv-fit.svg'),pngFile=await exportFigure('png','cv-fit.png'),pdfFile=await exportFigure('pdf','cv-fit.pdf');const svg=await fs.readFile(svgFile,'utf8');assert.match(svg,/viewBox="0 0 1000 800"/);assert.ok(svg.includes('样品1')&&svg.includes('样品2'));const png=await fs.readFile(pngFile);assert.equal(png.subarray(1,4).toString('ascii'),'PNG');assert.ok(Math.abs(png.readUInt32BE(16)/png.readUInt32BE(20)-1.25)<.002);const pdf=await fs.readFile(pdfFile);assert.equal(pdf.subarray(0,5).toString('ascii'),'%PDF-');
  checks.push('complete-XLSX-all-raw-CSV-manual-Ks-CSV-SVG-PNG-vector-PDF');

  await group(0);await view('cv');const rawSvgFile=await exportFigure('svg','cv-raw.svg');assert.ok((await fs.readFile(rawSvgFile,'utf8')).includes('Recorded potential'));
  for(const [width,height] of [[1920,1080],[1366,768]]){
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});await page.evaluate(()=>window.scrollTo(0,0));
    for(const mode of ['cv','fit']){await view(mode);assert.ok(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth+1),`${width}px ${mode} page overflow`);await page.screenshot({path:path.join(out,`cv-${mode}-${width}.png`),fullPage:true});}
  }
  await page.getByRole('button',{name:'切换到夜晚模式',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-desktop-theme'),'night');await page.screenshot({path:path.join(out,'cv-fit-night.png'),fullPage:true});assert.equal(await panel.locator('[data-plot-background]').getAttribute('fill'),'white');checks.push('raw-and-fit-views-1920-1366-and-night-scientific-white-canvas');

  assert.equal(errors.length,0,errors.join('\n'));
  const report={ok:true,version:manifest.version,checks,syntheticRawRows:expectedRawRows,profile:actualProfile,packaged:actualPackaged,output:out};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  if(page){await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}throw error;
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
