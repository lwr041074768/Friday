import {loadPlaywright} from './qa-playwright.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

delete process.env.ELECTRON_RUN_AS_NODE;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appDirectory=path.resolve(process.argv[2]||path.join(root,'desktop/build/app'));
const out=path.resolve(process.env.CV_QA_OUTPUT||path.join(root,'../output/playwright',`cv-viewport-${new Date().toISOString().replace(/[:.]/g,'-')}`));
const appData=path.resolve(process.env.CV_QA_APP_DATA||path.join(out,'app-data'));
await fs.mkdir(out,{recursive:true});await fs.mkdir(appData,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'desktop/package.json'),'utf8'));
const {_electron:electron}=await loadPlaywright('CV_QA_PLAYWRIGHT');
const rates=[5,10,20,30,40,50,60,80,100],chosen=[20,30,40,80],checks=[],errors=[];
async function synthetic(sample,rate,base=.04){
  const lines=['Oct. 22, 2026 00:30:00','Cyclic Voltammetry','Instrument Model: CHI760F','Init E (V) = 0','High E (V) = 1','Low E (V) = 0',`Scan Rate (V/s) = ${rate/1000}`,'Segment = 8','Sample Interval (V) = 0.004','','Potential/V, Current/A'];
  for(let cycle=1;cycle<=4;cycle++){
    const half=(base+.002*(cycle-1))*Math.log(rate),epa=.55+half,epc=.55-half;
    for(let i=0;i<=250;i++){const e=i/250;lines.push(`${e.toFixed(3)},${(.0012*Math.exp(-(((e-epa)/.035)**2))+.00001*(e-.5)).toExponential(12)}`);}
    for(let i=249;i>=0;i--){const e=i/250;lines.push(`${e.toFixed(3)},${(-.001*Math.exp(-(((e-epc)/.035)**2))+.00001*(e-.5)).toExponential(12)}`);}
  }
  const file=path.join(out,'fixtures',sample,`CV-${rate}mV.txt`);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,lines.join('\r\n'));return file;
}
const filesA=await Promise.all(rates.map(rate=>synthetic('A',rate))),filesB=await Promise.all(rates.map(rate=>synthetic('B',rate,.052)));
let launch;
if(process.env.CV_QA_EXECUTABLE)launch={executablePath:path.resolve(process.env.CV_QA_EXECUTABLE),env:{...process.env,FRIDAY_QA_APP_DATA:appData},timeout:30000};
else{const wrapper=path.join(out,'main.cjs');await fs.writeFile(wrapper,`const {app}=require('electron');app.setPath('appData',${JSON.stringify(appData)});require(${JSON.stringify(path.join(appDirectory,'main.cjs'))});`);launch={executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[wrapper],timeout:30000};}
const app=await electron.launch(launch);let page,panel;
async function picker(files){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});dialog.showMessageBox=async()=>({response:1});},files);}
async function importFiles(files){await picker(files);await panel.getByRole('button',{name:'导入数据',exact:true}).click();const d=page.getByRole('dialog');await d.getByRole('heading',{name:/导入到/}).waitFor();assert.equal(await d.getByLabel('CV 导入有效面积',{exact:true}).inputValue(),'1');await d.getByRole('button',{name:`导入并作图（${files.length} 条）`,exact:true}).click();await d.waitFor({state:'detached'});}
async function view(mode){await panel.getByRole('tab',{name:mode==='cv'?'原始 CV 与取峰':'Laviron / Ks',exact:true}).click();await panel.locator(`svg[data-cv-figure="${mode}"]`).waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function fitCount(name,n){await page.waitForFunction(({name,n})=>document.querySelector(`path[data-cv-fit="${name}"]`)?.getAttribute('data-cv-n')===String(n),{name,n});}
async function saveProject(file){await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await page.keyboard.press('Control+Shift+S');for(let i=0;i<100;i++){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{}await delay(50);}throw Error('Project save did not complete');}
async function openProject(file,count){await picker([file]);await page.getByRole('button',{name:'打开项目',exact:true}).click();await page.waitForFunction(count=>document.querySelector('#panel-cv .cv-group-tabs')?.getAttribute('data-cv-group-count')===String(count)||Number(document.querySelector('#panel-cv .cv-sidebar h2')?.textContent?.match(/样品组\s*(\d+)/)?.[1])===count,count);await view('fit');}
async function buttonPages(prevLabel,nextLabel,selector,attribute){
  const previous=panel.getByRole('button',{name:prevLabel,exact:true}),next=panel.getByRole('button',{name:nextLabel,exact:true});
  for(let i=0;i<150&&await previous.isEnabled();i++)await previous.click();
  const values=new Set();let pages=0;
  for(let i=0;i<150;i++){
    for(const value of await panel.locator(selector).evaluateAll((nodes,attribute)=>nodes.map(node=>node.getAttribute(attribute)),attribute))if(value)values.add(value);
    pages++;if(!await next.isEnabled())break;await next.click();
    if(i===149)throw Error(`Pagination did not terminate: ${nextLabel}`);
  }
  return{values,pages};
}
async function geometry(width,height,mode){
  await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});await view(mode);await delay(100);
  const value=await panel.evaluate((node,mode)=>{
    const bounds=element=>{if(!element)return null;const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const root=document.documentElement,axisTitles=[...node.querySelectorAll('[data-cv-axis-title]')].map(bounds);
    return{innerWidth,innerHeight,documentWidth:root.scrollWidth,documentHeight:root.scrollHeight,bodyHeight:document.body.scrollHeight,plot:bounds(node.querySelector('.cv-plot-card')),frame:bounds(node.querySelector('[data-cv-frame]')),results:bounds(node.querySelector('.cv-results-card')),legend:bounds(node.querySelector('[data-cv-legend-panel]')),fitPoints:bounds([...node.querySelectorAll('.cv-sidebar>.cv-card')].at(-1)),axisTitles,viewBox:node.querySelector('svg[data-cv-figure]')?.getAttribute('viewBox'),svgBottom:bounds(node.querySelector('svg[data-cv-figure]'))?.bottom};
  },mode);
  assert.ok(value.documentWidth<=value.innerWidth+1,`${width} ${mode}: document horizontal overflow ${JSON.stringify(value)}`);
  assert.ok(value.documentHeight<=value.innerHeight+1&&value.bodyHeight<=value.innerHeight+1,`${width} ${mode}: document needs vertical scrolling ${JSON.stringify(value)}`);
  assert.equal(value.viewBox,'0 0 720 720');
  assert.ok(value.frame.width>=200,`${width} ${mode}: data frame too small (${value.frame.width})`);
  assert.ok(Math.abs(value.frame.width-value.frame.height)<1,`${width} ${mode}: data frame should stay square`);
  assert.ok(value.results.x>=value.plot.right+3,`${width} ${mode}: results should be on the right`);
  for(const [label,box] of Object.entries({frame:value.frame,results:value.results,fitPoints:value.fitPoints,...Object.fromEntries(value.axisTitles.map((box,i)=>['axis'+i,box])),...(mode==='cv'?{legend:value.legend}:{})})){
    assert.ok(box,`${label} must exist`);assert.ok(box.y>=-1&&box.bottom<=value.innerHeight+1&&box.x>=-1&&box.right<=value.innerWidth+1,`${width} ${mode}: ${label} outside viewport ${JSON.stringify(box)}`);
  }
  assert.equal(value.axisTitles.length,2,'both axis titles should have measurable markers');
  if(mode==='cv'){assert.ok(value.legend.x>value.frame.right,'CV legend should be to the right of the data frame');assert.equal(await panel.locator('svg[data-cv-figure] [data-cv-legend-series]').count(),0,'legend is a screen-side list');}
  return value;
}
async function exportFigure(format,file){await app.evaluate(({session},file)=>{globalThis.__cvViewportDownload=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,state)=>state==='completed'?resolve(true):reject(Error(state)));}));},file);await panel.getByRole('button',{name:'导出图形（多格式）',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('图形格式',{exact:true}).selectOption(format);await d.getByRole('button',{name:'导出',exact:true}).click();await app.evaluate(()=>globalThis.__cvViewportDownload);await d.waitFor({state:'detached'});return fs.readFile(file);}
try{
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  const packaged=await app.evaluate(({app})=>app.isPackaged),profile=await app.evaluate(({app})=>app.getPath('userData'));assert.ok(profile.toLowerCase().startsWith(appData.toLowerCase()+path.sep));if(process.env.CV_QA_EXECUTABLE)assert.equal(packaged,true);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1920,1080));const day=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await day.count())await day.click();await page.locator('nav a[href="#cv"]').click();panel=page.locator('#panel-cv');await panel.getByRole('heading',{name:'CV',exact:true}).waitFor();
  await importFiles(filesA);await fitCount('样品1',9);await view('cv');
  let paged=await buttonPages('上一页 CV 图例','下一页 CV 图例','[data-cv-legend-series]','data-cv-legend-rate');assert.deepEqual([...paged.values].map(Number).sort((a,b)=>a-b),rates);assert.ok(paged.pages>1);
  const visibleLegend=panel.locator('[data-cv-legend-series]').last(),legendId=await visibleLegend.getAttribute('data-cv-legend-series');await visibleLegend.click();assert.equal(await panel.getByLabel('CV 当前取峰文件',{exact:true}).inputValue(),legendId);
  assert.ok(await panel.evaluate(node=>[...node.querySelectorAll('[data-cv-legend-series]')].every(legend=>{const curve=node.querySelector(`path[data-cv-trace="${legend.getAttribute('data-cv-legend-series')}"]`),paint=document.createElement('i');paint.style.backgroundColor=curve?.getAttribute('stroke')??'';return legend.querySelector('i')?.style.backgroundColor===paint.style.backgroundColor;})),'Legend swatches should match the actual curve strokes');checks.push('all-nine-scan-rate-legends-on-right-button-pagination-selection-and-colors');
  paged=await buttonPages('上一页 CV 文件','下一页 CV 文件','[data-cv-file-series]','data-cv-file-rate');assert.deepEqual([...paged.values].map(Number).sort((a,b)=>a-b),rates);assert.ok(paged.pages>1);
  const editingId=await panel.locator('[data-cv-file-series]').first().getAttribute('data-cv-file-series');await panel.getByRole('button',{name:`编辑 CV 文件 ${editingId}`,exact:true}).click();let fileDialog=page.getByRole('dialog');await fileDialog.getByRole('heading',{name:'CV 文件设置',exact:true}).waitFor();assert.equal(await fileDialog.getByLabel(`${editingId} CV面积`,{exact:true}).inputValue(),'1');await page.keyboard.press('Escape');await fileDialog.waitFor({state:'detached'});checks.push('all-nine-source-files-and-edit-dialog-accessible-by-buttons');
  await panel.getByRole('button',{name:'新增 CV 样品组',exact:true}).click();await importFiles(filesB);await view('fit');await fitCount('样品2',9);await panel.getByRole('button',{name:'上一个 Ks 样品',exact:true}).click();
  await panel.getByRole('button',{name:'选四个点…',exact:true}).click();let d=page.getByRole('dialog');await d.getByRole('heading',{name:'选择四个拟合点',exact:true}).waitFor();for(const input of await d.locator('[data-cv-four-rate] input[type=checkbox]').all())await input.uncheck();for(const rate of chosen)await d.locator(`[data-cv-four-rate="${rate}"] input[type=checkbox]`).check();await d.getByRole('button',{name:'应用四点拟合',exact:true}).click();await d.waitFor({state:'detached'});await fitCount('样品1',4);await fitCount('样品2',9);
  const projectFile=path.join(out,'nine-rates-four-point.fri'),saved=await saveProject(projectFile);assert.deepEqual(saved.states['cv.groups'].map(group=>group.series.length),[9,9]);assert.deepEqual(saved.states['cv.groups'].map(group=>group.series.filter(series=>series.included).length),[4,9]);assert.ok(saved.states['cv.groups'].flatMap(group=>group.series).every(series=>series.area==='1'));await page.getByRole('button',{name:'新建',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#panel-cv [data-cv-file-series]'));await openProject(projectFile,2);await fitCount('样品1',4);await fitCount('样品2',9);checks.push('four-noncontinuous-points-and-all-original-files-persist-after-reopen');
  const geometries=[];
  for(const [width,height] of [[1920,1080],[1366,768]])for(const mode of ['cv','fit']){geometries.push({width,height,mode,...await geometry(width,height,mode)});await page.screenshot({path:path.join(out,`viewport-${mode}-${width}.png`)});}
  checks.push('both-views-and-all-main-controls-fit-1920-and-1366-without-document-scroll');
  await view('cv');const selectedId=await panel.getByLabel('CV 当前取峰文件',{exact:true}).inputValue();
  const svg=panel.locator('svg[data-cv-figure]'),beforeRange=Number(await svg.getAttribute('data-x-max'))-Number(await svg.getAttribute('data-x-min'));await panel.getByRole('button',{name:'放大 CV 图',exact:true}).click();const zoomRange=Number(await svg.getAttribute('data-x-max'))-Number(await svg.getAttribute('data-x-min'));assert.ok(zoomRange<beforeRange);await panel.getByRole('button',{name:'缩小 CV 图',exact:true}).click();await panel.getByRole('button',{name:'复位 CV 图',exact:true}).click();assert.ok(Math.abs(Number(await svg.getAttribute('data-x-max'))-Number(await svg.getAttribute('data-x-min'))-beforeRange)<1e-9);
  for(const [branch,label] of [['anodic','点选氧化峰'],['cathodic','点选还原峰']]){await panel.getByRole('button',{name:label,exact:true}).click();const marker=panel.locator(`circle[data-cv-peak="${branch}"][data-cv-series="${selectedId}"]`),box=await marker.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);assert.match(await marker.locator('title').textContent(),/手动/);}
  checks.push('scaled-peak-hit-testing-and-zoom-buttons-without-wheel');
  const svgBytes=await exportFigure('svg',path.join(out,'viewport-cv.svg')),svgText=svgBytes.toString('utf8');assert.match(svgText,/viewBox="0 0 1240 720"/);assert.ok(svgText.includes('data-cv-trace')&&svgText.includes('data-cv-peak')&&svgText.includes('data-cv-export-results'));for(const rate of rates)assert.ok(svgText.includes(`${rate} mV/s`),`Export should retain ${rate} mV/s legend`);
  const png=await exportFigure('png',path.join(out,'viewport-cv.png'));assert.ok(Math.abs(png.readUInt32BE(16)/png.readUInt32BE(20)-1240/720)<.003);const pdf=await exportFigure('pdf',path.join(out,'viewport-cv.pdf'));assert.equal(pdf.subarray(0,5).toString('ascii'),'%PDF-');checks.push('complete-right-legend-and-results-in-SVG-PNG-and-vector-PDF');
  const twelve=structuredClone(saved),template=saved.states['cv.groups'][1];twelve.states['cv.groups']=Array.from({length:12},(_,i)=>({...structuredClone(template),id:`viewport-group-${i}`,name:`样品${i+1}`,series:template.series.map((series,j)=>({...structuredClone(series),id:`viewport-${i}-${j}`}))}));twelve.states['cv.active']='viewport-group-0';const twelveFile=path.join(out,'twelve-samples.fri');await fs.writeFile(twelveFile,JSON.stringify(twelve));await openProject(twelveFile,12);await view('fit');
  const ksPages=await buttonPages('上一个 Ks 样品','下一个 Ks 样品','[data-cv-summary]','data-cv-summary');assert.equal(ksPages.values.size,12);assert.equal(ksPages.pages,12);await geometry(1366,768,'fit');await view('cv');paged=await buttonPages('上一页 CV 图例','下一页 CV 图例','[data-cv-legend-series]','data-cv-legend-series');assert.equal(paged.values.size,108,'Every visible source trace should remain reachable');await geometry(1366,768,'cv');checks.push('all-twelve-sample-results-and-108-trace-legends-reachable-by-buttons');
  await page.getByRole('button',{name:'切换到夜晚模式',exact:true}).click();await geometry(1366,768,'cv');assert.equal(await panel.locator('[data-plot-background]').getAttribute('fill'),'white');await page.screenshot({path:path.join(out,'viewport-twelve-samples-night.png')});checks.push('night-mode-with-white-scientific-canvas-and-no-document-scroll');
  assert.equal(errors.length,0,errors.join('\n'));const report={ok:true,version:manifest.version,checks,packaged,profile,geometries,output:out};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
