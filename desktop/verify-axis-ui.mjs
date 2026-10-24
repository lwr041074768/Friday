import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

delete process.env.ELECTRON_RUN_AS_NODE;
const directory=path.dirname(fileURLToPath(import.meta.url));
const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const output=path.resolve(value('--output')||path.join(directory,'output/axis-ui'));
const playwright=value('--playwright');if(!playwright)throw Error('Provide --playwright <installed playwright/index.mjs>.');
const {_electron:electron}=await import(pathToFileURL(path.resolve(playwright)).href);
const fixtures=path.join(output,'fixtures'),shots=path.join(output,'screenshots');
for(const folder of [fixtures,shots])await fs.mkdir(folder,{recursive:true});

const fixture=path.join(fixtures,'AxisUI-XRD.csv');
const rows=['2theta,Intensity'];
for(let i=0;i<=600;i++){const x=10+i*.1;rows.push(`${x.toFixed(2)},${(100+9000*Math.exp(-(((x-43.2)/.2)**2))).toFixed(6)}`);}
await fs.writeFile(fixture,rows.join('\n'));

const runId=Date.now()+'-'+process.pid,isolated=path.join(output,'isolated-app-'+runId),profile=path.join(output,'profile-'+runId);
await fs.cp(path.join(directory,'build/app'),isolated,{recursive:true});await fs.mkdir(profile,{recursive:true});
const original=await fs.readFile(path.join(isolated,'main.cjs'),'utf8'),marker="app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(original.includes(marker));await fs.writeFile(path.join(isolated,'main.cjs'),original.replace(marker,`app.setPath('userData',${JSON.stringify(profile)});`));

const app=await electron.launch({executablePath:path.resolve(value('--electron')||path.join(directory,'node_modules/electron/dist/electron.exe')),args:[isolated],timeout:30000});
const report={checks:[],screenshots:[]};
let page;
try{
  page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.restore();w.show();w.focus();w.setContentSize(1440,950);}));
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  const toDay=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await toDay.count())await toDay.click();

  await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},[fixture]);
  await page.locator('.lsv-tabs a[href="#xrd"]').click();await page.locator('#panel-xrd').waitFor();
  await page.locator('#panel-xrd').getByRole('button',{name:'导入数据',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'选择 XRD 数据文件',exact:true}).click();
  await page.getByRole('button',{name:/^绘制.*条曲线$/}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const chart=page.locator('#panel-xrd [data-testid=lsv-chart]');await chart.waitFor();

  await page.locator('#panel-xrd .plot-settings-trigger').click();await page.getByRole('dialog').waitFor();
  const options=await page.getByLabel('X 轴类型',{exact:true}).locator('option').allTextContents();
  assert.deepEqual(options,['线性','倒数（1/x）'],'log option must be removed from the axis selector');
  assert.equal(await page.getByText('双 Y 轴 / 上轴',{exact:true}).count()>=1,true,'dual/top axes must remain available');
  assert.equal(await page.getByLabel('Y 轴断轴起点',{exact:true}).count(),1,'axis break controls must remain available');
  await page.getByLabel('X 轴类型',{exact:true}).selectOption('reciprocal');
  await page.getByRole('button',{name:'应用刻度',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await chart.getAttribute('data-x-scale'),'reciprocal');
  await page.locator('#panel-xrd .plot-settings-trigger').click();await page.getByRole('dialog').waitFor();
  await page.getByLabel('X 轴类型',{exact:true}).selectOption('linear');
  await page.getByRole('button',{name:'应用刻度',exact:true}).click();
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(await chart.getAttribute('data-x-scale'),'linear');
  assert.deepEqual(errors,[]);
  const file=path.join(shots,'axis-ui.png');await page.screenshot({path:file});report.screenshots.push(file);
  report.checks.push('log-option-removed-from-axis-selector','reciprocal-and-advanced-axes-still-available');
  console.log(JSON.stringify({ok:true,version:await page.evaluate(()=>window.scientificPlot.version),checks:report.checks,options,screenshots:report.screenshots}));
}catch(error){
  if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  throw error;
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
