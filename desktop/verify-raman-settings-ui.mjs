import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const output=path.resolve(option('--output')||path.join(directory,'output',`friday-raman-settings-${Date.now()}`));
const fixtures=path.resolve(option('--fixtures')||path.join(directory,'output/friday-041/fixtures/Demo-Raman'));
const isolated=path.join(output,'isolated-app'),profile=path.join(output,'profile'),downloads=path.join(output,'downloads'),shots=path.join(output,'screenshots');
const playwright=option('--playwright');if(!playwright)throw Error('Provide --playwright <installed playwright/index.mjs>.');
const {_electron:electron}=await import(pathToFileURL(path.resolve(playwright)).href);
for(const folder of [profile,downloads,shots])await fs.mkdir(folder,{recursive:true});
await fs.cp(path.join(directory,'build/app'),isolated,{recursive:true});
const original=await fs.readFile(path.join(isolated,'main.cjs'),'utf8'),marker="app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";assert.ok(original.includes(marker));
await fs.writeFile(path.join(isolated,'main.cjs'),original.replace(marker,`app.setPath('userData',${JSON.stringify(profile)});`));
const executablePath=path.resolve(option('--electron')||path.join(directory,'node_modules/electron/dist/electron.exe'));
const errors=[],report={checks:[],screenshots:[],errors};let app,page;
async function launch(){
  app=await electron.launch({executablePath,args:[isolated],timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow,dialog,session},folder)=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.show();w.focus();w.setContentSize(1520,1000);dialog.showMessageBox=async()=>({response:1});session.defaultSession.on('will-download',(_event,item)=>item.setSavePath(folder+'/'+item.getFilename()));},downloads);
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();const day=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await day.count())await day.click();
}
async function close(){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
async function screenshot(name){await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(350);const file=path.join(shots,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
async function fileText(file){for(let attempt=0;attempt<100;attempt++){try{const text=await fs.readFile(file,'utf8');if(text.length>100)return text;}catch{}await page.waitForTimeout(50);}throw Error('File not created: '+file);}
const panel=()=>page.locator('#panel-raman');
const dialog=()=>page.getByRole('dialog',{name:'图形设置',exact:true});
async function settings(){await panel().getByRole('button',{name:'图形设置',exact:true}).click();await dialog().waitFor();assert.equal(await dialog().getByRole('spinbutton',{name:'Raman 位移下限',exact:true}).count(),1);}
async function ranges(x0,x1,y0,y1){for(const [name,value] of [['X 轴最小值',x0],['X 轴最大值',x1],['Y 轴最小值',y0],['Y 轴最大值',y1]])await dialog().getByRole('spinbutton',{name,exact:true}).fill(value);await dialog().getByRole('button',{name:'应用范围',exact:true}).click();}
async function ticks(xStep,yStep,xMinor,yMinor){for(const [name,value] of [['X 轴主刻度间隔',xStep],['Y 轴主刻度间隔',yStep],['X 轴次刻度数量',xMinor],['Y 轴次刻度数量',yMinor]])await dialog().getByRole('spinbutton',{name,exact:true}).fill(value);await dialog().getByRole('button',{name:'应用刻度',exact:true}).click();}
try{
  await launch();await page.locator('.lsv-tabs a[href="#raman"]').click();await panel().waitFor();
  await panel().getByRole('button',{name:'导入数据',exact:true}).click();await page.getByLabel('Raman 数据文件夹',{exact:true}).setInputFiles(fixtures);await page.getByRole('button',{name:'导入 7 条光谱',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const line=panel().getByTestId('lsv-chart');await line.waitFor();assert.equal(await line.locator('[data-curve]').count(),7);
  await settings();await ranges('300','3500','-100','4000');await ticks('500','1000','2','3');await screenshot('01-raman-line-settings');await page.keyboard.press('Escape');
  assert.equal(await line.getAttribute('data-x-min'),'300');assert.equal(await line.getAttribute('data-y-max'),'4000');
  for(const [axis,kind,count] of [['x','major',7],['x','minor',13],['y','major',5],['y','minor',12]])assert.equal(await line.locator(`[data-axis="${axis}"][data-tick-kind="${kind}"]`).count(),count);
  await settings();assert.equal(await dialog().getByRole('spinbutton',{name:'X 轴主刻度间隔',exact:true}).inputValue(),'500');assert.equal(await dialog().getByRole('spinbutton',{name:'Y 轴次刻度数量',exact:true}).inputValue(),'3');await page.keyboard.press('Escape');
  await panel().getByRole('button',{name:'导出图形 SVG',exact:true}).click();const lineExport=await fileText(path.join(downloads,'Raman-stack.svg'));assert.match(lineExport,/data-testid="lsv-chart"/);assert.doesNotMatch(lineExport,/data-contour-band=/);await screenshot('02-raman-line');
  report.checks.push('line-settings-ranges-major-minor-counts-reopen-and-current-line-svg-export');

  await panel().getByRole('button',{name:'等高线图',exact:true}).click();await page.getByRole('combobox',{name:'Raman 等高线纵轴',exact:true}).click();await page.getByRole('option',{name:'电位 / V（核对后使用）',exact:true}).click();
  const contour=panel().getByTestId('raman-contour');await contour.waitFor();assert.equal(await contour.getAttribute('data-spectra'),'7');
  const pathsBefore=await contour.locator('[data-contour-band]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d')));
  await settings();await ranges('3000','500','.2','.5');await dialog().getByRole('alert').filter({hasText:'最小值须小于最大值'}).waitFor();assert.equal(await contour.getAttribute('data-x-min'),'195');
  await ranges('500','3000','.2','.5');await ticks('500','.1','2','1');await screenshot('03-raman-contour-settings');await page.keyboard.press('Escape');
  assert.equal(await contour.getAttribute('data-x-min'),'500');assert.equal(await contour.getAttribute('data-x-max'),'3000');assert.equal(await contour.getAttribute('data-y-min'),'0.2');assert.equal(await contour.getAttribute('data-y-max'),'0.5');
  const viewport=await contour.locator('[data-contour-viewport]').getAttribute('viewBox'),expected=[(500-195)/3550*1000,(.6-.5)/.5*1000,2500/3550*1000,.3/.5*1000];viewport.split(' ').map(Number).forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<1e-9));
  assert.deepEqual(await contour.locator('[data-contour-band]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d'))),pathsBefore);
  for(const [axis,kind,count] of [['x','major',6],['x','minor',10],['y','major',4],['y','minor',3]])assert.equal(await contour.locator(`[data-axis="${axis}"][data-tick="${kind}"]`).count(),count);
  await dialog().waitFor({state:'hidden'});await page.waitForTimeout(300);const point=await contour.evaluate(svg=>{const matrix=svg.getScreenCTM(),p=new DOMPoint(450,262).matrixTransform(matrix);return{x:p.x,y:p.y};});await page.mouse.move(point.x,point.y);await panel().locator('.raman-contour-reading strong').waitFor();assert.match(await panel().locator('.raman-contour-reading').innerText(),/电位 0.35 V/);
  await panel().getByRole('button',{name:'导出图形 SVG',exact:true}).click();const contourExport=await fileText(path.join(downloads,'Raman-contour.svg'));assert.match(contourExport,/data-testid="raman-contour"/);assert.match(contourExport,/data-contour-band=/);assert.match(contourExport,/data-x-min="500"/);await screenshot('04-raman-contour');
  report.checks.push('contour-invalid-range-rejection-real-viewbox-path-invariance-physical-ticks-hover-and-current-svg-export');

  const project=path.join(output,'Raman-axis-settings.fri');await page.getByRole('textbox',{name:'项目名称',exact:true}).fill('Friday Raman 设置恢复验收');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async(_window,options)=>{globalThis.__projectSaveOptions=options;return {canceled:false,filePath:file};};},project);await page.getByRole('button',{name:'保存项目',exact:true}).click();await page.getByText('已保存',{exact:true}).waitFor();
  const saved=JSON.parse(await fs.readFile(project,'utf8'));assert.equal(saved.states['raman.mode'],'contour');assert.equal(saved.states['raman.curves'].length,7);assert.deepEqual(saved.states['raman.contour.manual'],{x:[500,3000],y:[.2,.5]});assert.equal(saved.states['raman.contour.tickSettings'].y.step,.1);assert.equal(saved.states['raman.plot.tickSettings'].x.step,500);assert.equal((await app.evaluate(()=>globalThis.__projectSaveOptions)).filters[0].name,'Fri');
  await page.evaluate(()=>localStorage.setItem('desktop-last-tab','lsv'));await close();await launch();assert.equal(await panel().isVisible(),false);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},project);await page.getByRole('button',{name:'打开项目',exact:true}).click();await panel().getByTestId('raman-contour').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'项目名称',exact:true}).inputValue(),'Friday Raman 设置恢复验收');assert.equal(await panel().getByRole('button',{name:'等高线图',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await panel().getByTestId('lsv-chart').isVisible(),false);
  assert.equal(await panel().getByTestId('raman-contour').locator('[data-contour-viewport]').getAttribute('viewBox'),viewport);assert.deepEqual(await panel().getByTestId('raman-contour').locator('[data-contour-band]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d'))),pathsBefore);
  await settings();assert.equal(await dialog().getByRole('spinbutton',{name:'X 轴主刻度间隔',exact:true}).inputValue(),'500');assert.equal(await dialog().getByRole('spinbutton',{name:'Y 轴主刻度间隔',exact:true}).inputValue(),'0.1');await page.keyboard.press('Escape');
  await panel().getByRole('button',{name:'堆叠图',exact:true}).click();await panel().getByTestId('lsv-chart').waitFor();assert.equal(await panel().getByTestId('lsv-chart').getAttribute('data-x-min'),'300');await settings();assert.equal(await dialog().getByRole('spinbutton',{name:'Y 轴次刻度数量',exact:true}).inputValue(),'3');await page.keyboard.press('Escape');
  report.checks.push('real-process-restart-opens-contour-project-from-default-lsv-with-raw-data-mode-and-both-plot-settings-restored');

  for(const mode of ['stack','contour']){
    await panel().getByRole('button',{name:mode==='stack'?'堆叠图':'等高线图',exact:true}).click();
    for(const [width,height] of [[1000,760],[1280,850],[1920,1080]]){
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);await page.waitForTimeout(120);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`${mode} page fits ${width}`);await settings();
      assert.ok(await dialog().evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1&&element.scrollWidth<=element.clientWidth+1;}),`${mode} settings fits ${width}`);
      if(width===1000)await screenshot(`05-${mode}-settings-1000`);await page.keyboard.press('Escape');if(width===1920)await screenshot(`06-${mode}-1920`);
    }
  }
  report.checks.push('line-contour-page-and-settings-no-horizontal-overflow-at-1000-1280-and-1920-widths');
  assert.deepEqual(errors,[]);report.ok=true;report.version=await page.evaluate(()=>window.scientificPlot.version);await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,version:report.version,checks:report.checks,screenshots:report.screenshots,output},null,2));
}catch(error){if(page){await page.screenshot({path:path.join(output,'ui-error.png')}).catch(()=>{});await fs.writeFile(path.join(output,'ui-error.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}finally{if(app)await close();}
