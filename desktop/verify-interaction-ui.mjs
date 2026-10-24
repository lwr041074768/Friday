import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

delete process.env.ELECTRON_RUN_AS_NODE;
const here=path.dirname(fileURLToPath(import.meta.url));
const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
if(!value('--playwright'))throw Error('Provide --playwright <installed playwright/index.mjs>.');
const {_electron:electron}=await import(pathToFileURL(path.resolve(value('--playwright'))).href);
const output=path.resolve(value('--output')||path.join(here,'output/interaction-ui'));
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-')),isolated=path.join(run,'app'),profile=path.join(run,'profile');
await fs.cp(path.join(here,'build/app'),isolated,{recursive:true});await fs.mkdir(profile,{recursive:true});
const main=path.join(isolated,'main.cjs'),original=await fs.readFile(main,'utf8'),marker="app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(original.includes(marker));await fs.writeFile(main,original.replace(marker,`app.setPath('userData',${JSON.stringify(profile)});`));
const curve={id:'interaction-sample',name:'Interaction',source:'synthetic.csv',color:'#246c96',visible:true,unit:'A',area:'1',resistance:'',compensation:'raw',points:[{e:.3,current:.001},{e:.35,current:.003},{e:.4,current:.01},{e:.5,current:.02},{e:.6,current:.04}]};
const fixture=path.join(run,'old-format.fri'),saved=path.join(run,'interaction.fri');
// Deliberately omit new title fields: old 0.5.7 projects must still load.
await fs.writeFile(fixture,JSON.stringify({schema:'electrocatalysis-project/v1',application:'Scientific Plot Studio',version:'0.5.7',name:'Interaction QA',savedAt:new Date().toISOString(),states:{'shell.tab':'lsv','lsv.curves':[curve],'tafel.curves':[curve],'lsv.plot.annotations':[{id:'lsv-line',kind:'hline',x:0,y:10,color:'#6b8094'}],'tafel.plot.annotations':[{id:'tafel-line',kind:'hline',x:0,y:.2,color:'#6b8094'}]}}));
let app,page;const report={checks:[],screenshots:[],run},errors=[];
async function launch(){
  app=await electron.launch({executablePath:path.join(here,'node_modules/electron/dist/electron.exe'),args:[isolated],timeout:30000});
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.setContentSize(1440,950);w.show();w.focus();});
  await app.evaluate(({dialog,session},{fixture,saved,run})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});dialog.showMessageBox=async()=>({response:1});session.defaultSession.on('will-download',(_e,item)=>item.setSavePath(run+'/'+item.getFilename()));},{fixture,saved,run});
}
const chart=tab=>page.locator(`#panel-${tab} [data-testid=lsv-chart]`);
const line=tab=>page.locator(`#panel-${tab} [data-annotation-kind=hline]`);
async function go(tab){await page.locator(`.lsv-tabs a[href="#${tab}"]`).click();await page.locator(`#panel-${tab}`).waitFor();}
async function clickLine(tab){await chart(tab).scrollIntoViewIfNeeded();const p=await line(tab).locator('line').first().evaluate(node=>{const m=node.getScreenCTM();return {x:(Number(node.getAttribute('x1'))+Number(node.getAttribute('x2')))/2*m.a+m.e,y:Number(node.getAttribute('y1'))*m.d+m.f};});await page.mouse.click(p.x,p.y);}
async function screenshot(name){const file=path.join(run,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function save(){await page.getByRole('button',{name:'项目另存为',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.studio-save-project').disabled);await page.getByText('已保存',{exact:true}).waitFor();return JSON.parse(await fs.readFile(saved,'utf8'));}
async function titlesInside(tab){
  const results=await chart(tab).evaluate(svg=>{const s=svg.getBoundingClientRect();return [...svg.querySelectorAll('[data-testid$="-axis-title"]')].map(n=>{const b=n.getBoundingClientRect();return {text:n.textContent,inside:b.left>=s.left-1&&b.right<=s.right+1&&b.top>=s.top-1&&b.bottom<=s.bottom+1,b:{x:b.x,y:b.y,w:b.width,h:b.height},s:{x:s.x,y:s.y,w:s.width,h:s.height}};});});
  assert.ok(results.every(r=>r.inside),JSON.stringify(results));
}
try{
  await launch();await page.getByRole('button',{name:'打开项目',exact:true}).click();await line('lsv').waitFor({state:'attached'});
  await clickLine('lsv');const lsv=await line('lsv').getAttribute('data-annotation-value');
  await go('tafel');await clickLine('tafel');const tafel=await line('tafel').getAttribute('data-annotation-value');
  await page.keyboard.press('ArrowDown');assert.notEqual(await line('tafel').getAttribute('data-annotation-value'),tafel);assert.equal(await line('lsv').getAttribute('data-annotation-value'),lsv);
  await page.keyboard.press('Delete');assert.equal(await line('tafel').count(),0);assert.equal(await line('lsv').count(),1);
  report.checks.push('arrow-and-delete-affect-only-focused-visible-plot');
  await go('lsv');await clickLine('lsv');
  await page.locator('#panel-lsv .plot-settings-trigger').click();let dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.getByRole('tab',{name:'坐标轴',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'标题',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('tab',{name:'坐标轴',exact:true}).getAttribute('tabindex'),'-1');
  await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'坐标轴',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'注释',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'标题',exact:true}).click();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'tabpanel');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'X 轴标题文字');
  const x=page.getByLabel('X 轴标题文字',{exact:true});await x.fill('Potential / V');await page.keyboard.press('Backspace');await page.keyboard.press('Delete');
  assert.equal(await line('lsv').getAttribute('data-annotation-value'),lsv);
  await x.fill('Friday 电位 / V');await page.getByLabel('Y 轴标题文字',{exact:true}).fill('Friday 电流密度 / mA cm⁻²');
  const fontSize=page.getByLabel('X 轴标题字号',{exact:true});await fontSize.fill('');await fontSize.pressSequentially('12');assert.equal(await fontSize.inputValue(),'12');
  await fontSize.fill('22');await page.getByLabel('Y 轴标题字号',{exact:true}).fill('20');
  await page.getByLabel('X 轴标题加粗',{exact:true}).uncheck();await screenshot('title-settings');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('plot-settings-trigger')),true);
  assert.equal(await line('lsv').count(),1);
  report.checks.push('roving-tabs-arrows-home-end-tab-escape-modal-fields-no-graph-edits');
  let title=page.locator('#panel-lsv [data-testid=x-axis-title]');await title.dblclick();await dialog.waitFor();
  assert.equal(await page.getByRole('tab',{name:'标题',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-testid')),'x-axis-title');
  report.checks.push('double-click-title-opens-titles-and-restores-title-focus');
  await page.locator('#panel-lsv').getByRole('button',{name:'全屏显示图形',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
  await title.dblclick();await dialog.waitFor();assert.equal(await dialog.evaluate(n=>document.fullscreenElement.contains(n)),true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
  await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.restore();});await page.waitForTimeout(400);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,950));await page.waitForFunction(()=>innerWidth===1440&&innerHeight===950);
  report.checks.push('fullscreen-settings-remain-visible-and-escape-closes-only-dialog');
  // BOOK has its own arrow-key movement and selection, even with a graph annotation selected.
  await clickLine('lsv');await page.locator('#panel-lsv').getByRole('button',{name:'为 Interaction 添加 BOOK',exact:true}).click();
  const book=page.locator('#panel-lsv .data-book-window');await book.waitFor();
  const grip=book.locator('.data-book-grip');await grip.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Delete');
  await book.locator('td[data-column=rawPotential]').first().click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Backspace');
  assert.equal(await line('lsv').getAttribute('data-annotation-value'),lsv);
  const bookBeforeResize=(await save()).states['lsv.bookstate.books'];
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,720));await page.waitForTimeout(180);
  const fittedBook=await book.boundingBox();assert.ok(fittedBook.x>=0&&fittedBook.x+fittedBook.width<=1000,JSON.stringify({fittedBook,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,fullscreen:!!document.fullscreenElement}))}));
  assert.equal(await page.locator('.studio-project-state').innerText(),'已保存');
  assert.deepEqual((await save()).states['lsv.bookstate.books'],bookBeforeResize);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,950));await page.waitForTimeout(180);
  report.checks.push('open-book-fits-small-window-without-overwriting-saved-geometry');
  await book.getByRole('button',{name:'关闭 BOOK 1 · Interaction',exact:true}).click();report.checks.push('book-move-table-navigation-never-edit-plot');
  const dataBefore=(await save()).states['lsv.curves'];
  const start=await title.boundingBox();await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+start.width/2-70,start.y+start.height/2-32,{steps:10});await page.mouse.up();
  const moved=await title.boundingBox();assert.ok(Math.abs(moved.x-start.x)>20&&Math.abs(moved.y-start.y)>10);
  await titlesInside('lsv');const savedDoc=await save();const shift=savedDoc.states['lsv.plot.xTitleShift'];assert.ok(shift.x<0&&shift.y<0);assert.deepEqual(savedDoc.states['lsv.curves'],dataBefore);
  assert.equal(savedDoc.states['lsv.plot.titleSettings'].x.bold,false);assert.equal(savedDoc.states['lsv.plot.titleSettings'].x.size,22);
  for(const [width,height] of [[1000,720],[1280,800],[1920,1080],[1440,950]]){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});await page.waitForTimeout(180);await titlesInside('lsv');assert.equal(await page.locator('.studio-project-state').innerText(),'已保存');}
  await screenshot('resized-canvas');report.checks.push('title-drag-resize-clamp-and-display-only-changes-no-raw-data-or-dirty-on-resize');
  await app.evaluate(({app})=>app.exit(0));await app.close().catch(()=>{});await launch();title=page.locator('#panel-lsv [data-testid=x-axis-title]');dialog=page.getByRole('dialog');
  await app.evaluate(({dialog},saved)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[saved]});},saved);
  await page.getByRole('button',{name:'打开项目',exact:true}).click();await title.waitFor();
  assert.equal(await title.textContent(),'Friday 电位 / V');assert.equal(await title.evaluate(n=>getComputedStyle(n).fontWeight),'400');await titlesInside('lsv');
  const restored=await save();assert.deepEqual(restored.states['lsv.plot.xTitleShift'],shift);assert.deepEqual(restored.states['lsv.curves'],dataBefore);
  report.checks.push('real-process-restart-restores-title-text-font-boldness-and-position');
  // Exercise the public export dialog, then compare the file with the live SVG.
  await page.locator('#panel-lsv').getByRole('button',{name:'导出图形（多格式）',exact:true}).click();await dialog.waitFor();await page.getByLabel('图形格式',{exact:true}).selectOption('svg');await dialog.getByRole('button',{name:'导出',exact:true}).click();await dialog.waitFor({state:'hidden'});
  let exported;for(let n=0;n<100;n++){exported=(await fs.readdir(run)).find(n=>n.endsWith('.svg'));if(exported)break;await page.waitForTimeout(100);}assert.ok(exported);
  const svgText=await fs.readFile(path.join(run,exported),'utf8');assert.match(svgText,/Friday 电位 \/ V/);assert.match(svgText,/font-weight: 400/);assert.match(svgText,/font-size: 22px/);assert.doesNotMatch(svgText,/data-plot-transient|tabindex=/);
  report.checks.push('exported-svg-keeps-live-labels-font-weight-size-and-omits-editing-overlays');
  await screenshot('restored-canvas');assert.deepEqual(errors,[]);report.ok=true;report.version=await page.evaluate(()=>window.scientificPlot.version);assert.equal(report.version,'0.5.7');await fs.writeFile(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){await page.screenshot({path:path.join(run,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(run,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}console.error('Failure artifacts: '+run);throw error;}
finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}}
