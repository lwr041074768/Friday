import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// A copied build, unique application identity and private profile only. Never
// attach to, close or replace the user's running Friday or its data.
delete process.env.ELECTRON_RUN_AS_NODE;
const directory=path.dirname(fileURLToPath(import.meta.url));
const option=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
if(!option('--playwright'))throw Error('Provide --playwright <installed playwright/index.mjs>.');
const {_electron:electron}=await import(pathToFileURL(path.resolve(option('--playwright'))).href);
const output=path.resolve(option('--output')||path.join(directory,'output/correctness-ui'));
const runId=`${Date.now()}-${process.pid}`;
const fixtures=path.join(output,`fixtures-${runId}`),downloads=path.join(output,`downloads-${runId}`),shots=path.join(output,`screenshots-${runId}`);
const isolated=path.join(output,`isolated-app-${runId}`),profile=path.join(output,`profile-${runId}`);
for(const folder of [fixtures,downloads,shots,profile])await fs.mkdir(folder,{recursive:true});
await fs.cp(path.join(directory,'build/app'),isolated,{recursive:true});
const mainFile=path.join(isolated,'main.cjs'),main=await fs.readFile(mainFile,'utf8');
const marker="app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(main.includes(marker),'Private-profile marker must match before launch.');
await fs.writeFile(mainFile,main.replace("app.setName('Friday');",`app.setName('Friday-CorrectnessQA-${runId}');`).replace(marker,`app.setPath('userData',${JSON.stringify(profile)});`));

const conversion=.0592*13.65+.197-1.23;
const rawTafel=[-3,-2,-1,0,1].map((x,index)=>({
  e:.12+.06*x+[.001,-.002,.002,-.002,.001][index]-conversion,
  current:10**x/1000,
}));
const tafelName='Correctness-Tafel',tafelFile=path.join(fixtures,tafelName+'.csv');
await fs.writeFile(tafelFile,'Potential/V,Current/A\n'+rawTafel.map(point=>`${point.e},${point.current}`).join('\n'));
const cvs=[];
for(const [index,rate] of [10,20,30,40,50].entries()){
  const halfMA=.03+12*rate/1000+[.006,-.003,.001,-.005,.004][index],amplitude=halfMA/1000;
  const file=path.join(fixtures,`Noisy-Cdl-${rate}mV.txt`);
  await fs.writeFile(file,`CHI760E\nCyclic Voltammetry\nScan Rate (V/s) = ${rate/1000}\nPotential/V,Current/A\n`+[[.05,-.0005+amplitude],[.075,-.0005+amplitude],[.1,-.0005+amplitude],[.075,-.0005-amplitude],[.05,-.0005-amplitude]].map(point=>point.join(',')).join('\n'));
  cvs.push(file);
}
const near=(actual,expected,label,tolerance=1e-8)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);
function parseCsv(text){
  const rows=[];let row=[],value='',quoted=false;text=text.replace(/^\uFEFF/,'');
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='"'){if(quoted&&text[index+1]==='"'){value+='"';index++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(value);value='';}
    else if(char==='\r'&&!quoted&&text[index+1]==='\n'){row.push(value);rows.push(row);row=[];value='';index++;}
    else if(char==='\n'&&!quoted){row.push(value);rows.push(row);row=[];value='';}
    else value+=char;
  }
  if(value||row.length){row.push(value);rows.push(row);}return rows;
}
const report={checks:[],screenshots:[],errors:[],fixtures:{rawTafel,cvs}};
let app,page;
try{
  app=await electron.launch({executablePath:path.resolve(option('--electron')||path.join(directory,'node_modules/electron/dist/electron.exe')),args:[isolated],timeout:30000});
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow,dialog,session})=>{
    for(const window of BrowserWindow.getAllWindows()){window.restore();window.show();window.focus();window.setContentSize(1600,1050);}
    dialog.showMessageBox=async()=>({response:1});
    dialog.showSaveDialog=async()=>({canceled:false,filePath:globalThis.__FridayQaDestination});
    session.defaultSession.on('will-download',(_event,item)=>{if(globalThis.__FridayQaDestination)item.setSavePath(globalThis.__FridayQaDestination);});
  });
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  const day=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await day.count())await day.click();
  const panel=id=>page.locator('#panel-'+id);
  async function go(id){await page.locator(`.lsv-tabs a[href="#${id}"]`).click();await page.waitForURL(new RegExp(`#${id}$`));await panel(id).waitFor();}
  async function picker(files){await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},files);}
  async function destination(file){await app.evaluate((_electron,file)=>{globalThis.__FridayQaDestination=file;},file);}
  async function waitFile(file){for(let index=0;index<200;index++){try{if((await fs.stat(file)).size>0){await page.waitForTimeout(100);return await fs.readFile(file,'utf8');}}catch{}await page.waitForTimeout(50);}throw Error(`File not written: ${file}`);}
  async function exported(name,action){const file=path.join(downloads,name);await destination(file);await action();return waitFile(file);}
  async function screenshot(name){const file=path.join(shots,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}
  async function saveProject(file){await destination(file);await page.getByRole('button',{name:'保存项目',exact:true}).click();await page.locator('.studio-project-message').filter({hasText:'已保存'}).waitFor();return JSON.parse(await waitFile(file));}
  async function openProject(file){await picker([file]);await page.getByRole('button',{name:'打开项目',exact:true}).click();}
  async function fitTafel(){
    const tp=panel('tafel');await tp.getByRole('button',{name:'选择拟合区域',exact:true}).click();
    await tp.getByRole('spinbutton',{name:'拟合区间下限',exact:true}).fill('-4');
    await tp.getByRole('spinbutton',{name:'拟合区间上限',exact:true}).fill('2');
    await tp.getByRole('button',{name:'线性拟合',exact:true}).click();await tp.getByTestId('tafel-fit-table').waitFor();
  }
  async function checkTafelExports(basis,expected){
    const tp=panel('tafel'),symbol=basis==='current'?'I₀':'j₀',unit=basis==='current'?'mA':'mA cm⁻²';
    const label=basis==='current'?'外推交换电流 I₀':'外推交换电流密度 j₀';
    const displayed=await tp.locator('[data-stat=j0]').innerText();near(Number(displayed.split(' ')[0]),expected,basis+' UI exchange');
    assert.notEqual(Number(displayed.split(' ')[0]),10);assert.ok(displayed.endsWith(unit));
    assert.match(await tp.getByTestId('tafel-fit-table').innerText(),new RegExp(label));
    const ciText=await tp.locator('[data-stat=slope-ci]').innerText(),ciValues=ciText.match(/(-?[\d.e+]+) 至 (-?[\d.e+]+)/i);assert.ok(ciValues,ciText);
    const data=parseCsv(await exported(basis+'-all-data.csv',()=>tp.getByRole('button',{name:'导出数据',exact:true}).click()));
    const header=data[0],value=key=>data[1][header.indexOf(key)];
    assert.equal(data.length,rawTafel.length+1);assert.equal(value('交换电流量'),symbol);assert.equal(value('交换电流单位'),unit);
    near(+value('交换电流数值'),expected,basis+' data CSV exchange');near(+value('斜率置信水平'),.95,'confidence level');
    near(+value('斜率置信区间下限_mV_per_dec'),+ciValues[1],basis+' UI/data CI low',2e-7);
    near(+value('斜率置信区间上限_mV_per_dec'),+ciValues[2],basis+' UI/data CI high',2e-7);
    for(const [index,row] of data.slice(1).entries()){near(+row[header.indexOf('原始电位_V')],rawTafel[index].e,'raw potential');near(+row[header.indexOf('导入电流')],rawTafel[index].current,'raw current',1e-12);}
    const fitReport=parseCsv(await exported(basis+'-fit-report.csv',()=>tp.getByRole('button',{name:'导出拟合结果',exact:true}).click()));
    const metric=key=>fitReport.find(row=>row[0]===key);
    near(+metric(label)[1],expected,basis+' report exchange');assert.equal(metric(label)[3],unit);
    near(+metric('斜率95%置信区间下限')[1],+value('斜率置信区间下限_mV_per_dec'),'data/report CI');
    near(+metric('斜率95%置信区间上限')[1],+value('斜率置信区间上限_mV_per_dec'),'data/report CI');
    assert.match(metric('派生结果说明')[1],/不含选区和实验参数不确定度/);
  }

  await go('tafel');await picker([tafelFile]);
  await panel('tafel').getByRole('button',{name:'导入数据',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'选择 Tafel 数据文件',exact:true}).click();
  await page.getByRole('button',{name:/^绘制.*条曲线$/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await panel('tafel').locator('[aria-label="扫描方向"] button').first().click();
  await fitTafel();await checkTafelExports('current',.01);await screenshot('01-tafel-current-0.01mA');
  report.checks.push('real-total-current-fit-I0-is-0.01mA-not10-with-matching-CSV-report-CI');
  await panel('tafel').getByRole('combobox',{name:'Tafel 横轴计算',exact:true}).click();
  await page.getByRole('option',{name:'电流密度 j（需电极面积）',exact:true}).click();
  await panel('tafel').getByRole('spinbutton',{name:tafelName+'面积',exact:true}).fill('2');
  await fitTafel();await checkTafelExports('density',.005);await screenshot('02-tafel-density-0.005mAcm2');
  report.checks.push('area2-density-j0-is-0.005mAcm2-with-unchanged-raw-data-and-matching-exports');

  await go('cdl');await picker(cvs);await panel('cdl').getByRole('button',{name:'导入数据',exact:true}).click();
  await panel('cdl').locator('[data-cdl-has-data="true"]').waitFor();
  const bands=panel('cdl').locator('path[data-cdl-confidence-band]');await bands.first().waitFor();
  assert.equal(await bands.count(),1);assert.equal(await bands.first().getAttribute('data-confidence-level'),'0.95');
  assert.equal(await bands.first().getAttribute('data-confidence-model'),'intercept');assert.equal(await bands.first().getAttribute('data-confidence-dof'),'3');
  const interceptPath=await bands.first().getAttribute('d');
  const cdlSvg=await exported('cdl-intercept.svg',()=>panel('cdl').getByRole('button',{name:'导出本组 Cdl SVG',exact:true}).click());
  assert.ok(cdlSvg.includes(`d="${interceptPath}"`));assert.match(cdlSvg,/data-confidence-level="0.95"/);assert.match(cdlSvg,/data-confidence-dof="3"/);
  await panel('cdl').getByRole('button',{name:'图形设置',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.getByRole('checkbox',{name:'强制拟合过原点',exact:true}).check();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#panel-cdl path[data-cdl-confidence-band]')?.getAttribute('data-confidence-model')==='through-origin');
  assert.equal(await bands.first().getAttribute('data-confidence-dof'),'4');assert.equal(await bands.first().getAttribute('data-confidence-level'),'0.95');
  assert.notEqual(await bands.first().getAttribute('d'),interceptPath);
  const originSvg=await exported('cdl-origin.svg',()=>panel('cdl').getByRole('button',{name:'导出本组 Cdl SVG',exact:true}).click());
  assert.match(originSvg,/data-confidence-model="through-origin"/);assert.match(originSvg,/data-confidence-dof="4"/);
  await panel('cdl').getByRole('combobox',{name:'Cdl 拟合显示',exact:true}).click();await page.getByRole('option',{name:'比较全部组',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#panel-cdl path[data-cdl-confidence-band]').length===0);
  const aggregateSvg=await exported('cdl-aggregate.svg',()=>panel('cdl').getByRole('button',{name:'导出本组 Cdl SVG',exact:true}).click());
  assert.ok(!aggregateSvg.includes('data-cdl-confidence-band='));await screenshot('03-cdl-group-aggregate');
  report.checks.push('noisy-five-sweep-Cdl-central95-intercept-df3-origin-df4-with-exact-SVG-export-and-no-aggregate-OLS-band');

  await go('tafel');await panel('tafel').getByRole('button',{name:`为 ${tafelName} 添加 BOOK`,exact:true}).click();
  let book=panel('tafel').locator(`.data-book-window[aria-label="BOOK 1 · ${tafelName}"]`);await book.waitFor();
  const projectFile=path.join(fixtures,'Correctness.fri'),saved=await saveProject(projectFile);
  assert.deepEqual(saved.states['tafel.curves'][0].points,rawTafel,'Conversions and fitting must not modify imported points');
  const gapDoc=structuredClone(saved);gapDoc.name='Correctness-Gap';
  gapDoc.states['tafel.curves'][0].points[0]={...gapDoc.states['tafel.curves'][0].points[0],e:{__ec_number__:'NaN'},current:{__ec_number__:'NaN'}};
  gapDoc.states['tafel.analysis.fitRequested']=false;
  const gapFile=path.join(fixtures,'Correctness-Gap.fri');await fs.writeFile(gapFile,JSON.stringify(gapDoc));
  await openProject(gapFile);await page.locator('.studio-project-message').filter({hasText:'已恢复项目'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'项目名称',exact:true}).inputValue(),'Correctness-Gap');
  book=panel('tafel').locator(`.data-book-window[aria-label="BOOK 1 · ${tafelName}"]`);await book.waitFor();
  if(!await book.getByLabel(/计算列名称$/).isVisible())await book.getByRole('button',{name:'计算列',exact:true}).click();
  await book.getByLabel(/计算列名称$/).fill('EtaDouble');await book.getByLabel(/计算列公式$/).fill('y*2');
  await book.getByRole('button',{name:'添加列',exact:true}).click();
  const computed=book.locator('td[data-column^="computed-"]');await computed.first().waitFor();
  assert.equal(await book.locator('tr[data-raw-row="1"] td[data-column^="computed-"]').getAttribute('title'),'');
  const baseY=Number(await book.locator('tr[data-raw-row="2"] td[data-column="y"]').getAttribute('title'));
  near(Number(await book.locator('tr[data-raw-row="2"] td[data-column^="computed-"]').getAttribute('title')),baseY*2,'later computed cell');
  const bookCsv=parseCsv(await exported('book-gap.csv',()=>book.getByRole('button',{name:'导出 CSV',exact:true}).click()));
  assert.equal(bookCsv.length,rawTafel.length+1);assert.equal(bookCsv[0].length,6);assert.equal(bookCsv[0][5],'EtaDouble');
  assert.ok(bookCsv[1].every(cell=>cell===''),'first missing row must stay blank in every data column');
  near(+bookCsv[2][5],baseY*2,'computed CSV');near(+bookCsv[2][0],rawTafel[1].e,'later raw potential');
  report.checks.push('gap-first-row-can-add-y-times2-column-with-later-valid-rows-and-lossless-CSV');
  // Save the live gap+column state, corrupt only a private copy, then verify
  // validation is atomic and the previous project/worksheet remains usable.
  await destination(gapFile);await page.getByRole('button',{name:'保存项目',exact:true}).click();await page.locator('.studio-project-message').filter({hasText:'已保存'}).waitFor();
  const withColumn=JSON.parse(await waitFile(gapFile));assert.equal(withColumn.states['tafel.bookstate.books'][0].columns.length,1);
  const bad=structuredClone(withColumn);bad.name='SHOULD-NOT-REPLACE';bad.states['tafel.bookstate.books'][0].columns='bad-type';
  const badFile=path.join(fixtures,'Malformed-Book.fri');await fs.writeFile(badFile,JSON.stringify(bad));
  const beforeCell=await book.locator('tr[data-raw-row="2"] td[data-column^="computed-"]').getAttribute('title');
  await openProject(badFile);await page.locator('.studio-project-message').filter({hasText:/格式无效|当前项目未被替换/}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'项目名称',exact:true}).inputValue(),'Correctness-Gap');
  assert.equal(await book.locator('tr[data-raw-row="2"] td[data-column^="computed-"]').getAttribute('title'),beforeCell);
  if(!await book.getByLabel(/计算列名称$/).isVisible())await book.getByRole('button',{name:'计算列',exact:true}).click();
  await book.getByLabel(/计算列名称$/).fill('EtaTriple');await book.getByLabel(/计算列公式$/).fill('y*3');await book.getByRole('button',{name:'添加列',exact:true}).click();
  const secondRow=book.locator('tr[data-raw-row="2"] td[data-column^="computed-"]');await page.waitForFunction(()=>document.querySelectorAll('#panel-tafel tr[data-raw-row="2"] td[data-column^="computed-"]').length===2);
  near(Number(await secondRow.nth(1).getAttribute('title')),baseY*3,'live worksheet after rejected project');await screenshot('04-validated-gap-book');
  report.checks.push('malformed-book-columns-rejected-before-replacing-data-and-previous-worksheet-remains-editable');
  assert.deepEqual(report.errors,[]);report.ok=true;report.version=await page.evaluate(()=>window.scientificPlot.version);
  await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,version:report.version,checks:report.checks,screenshots:report.screenshots}));
}catch(error){
  if(page){await page.screenshot({path:path.join(output,'ui-error.png')}).catch(()=>{});await fs.writeFile(path.join(output,'ui-error.txt'),await page.locator('body').innerText().catch(()=>''));}
  report.ok=false;report.failure=error.message;await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));throw error;
}finally{
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
}
