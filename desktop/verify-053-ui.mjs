import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

delete process.env.ELECTRON_RUN_AS_NODE;
const directory=path.dirname(fileURLToPath(import.meta.url));
const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const output=path.resolve(value('--output')||path.join(directory,'output/053-ui'));
const playwright=value('--playwright');if(!playwright)throw Error('Provide --playwright <installed playwright/index.mjs>.');
const {_electron:electron}=await import(pathToFileURL(path.resolve(playwright)).href);
const fixtures=path.join(output,'fixtures'),shots=path.join(output,'screenshots'),downloads=path.join(output,'downloads');
for(const folder of [fixtures,shots,downloads])await fs.mkdir(folder,{recursive:true});

const xrd=path.join(fixtures,'Feature-XRD.csv');
const xrdRows=['2theta,Intensity'];
for(let i=0;i<=600;i++){const x=10+i*.1;let y=2;for(const [c,h,w] of [[30.2,1200,.2],[43.2,8000,.18],[57.3,60,.25]])y+=h*Math.exp(-(((x-c)/w)**2));xrdRows.push(`${x.toFixed(2)},${y.toFixed(5)}`);}
await fs.writeFile(xrd,xrdRows.join('\n'));

const eis=path.join(fixtures,'Feature-EIS.csv');
const eisRows=['Freq/Hz,Zreal/ohm,Zimag/ohm'];
const Rs=10,Rct=200,Q=2e-4,n=.85;
for(let i=0;i<60;i++){const f=1e5*Math.pow(10,-i*6/59),w=2*Math.PI*f,qt=Math.pow(w*Rct*Q,n),a=1+qt*Math.cos(n*Math.PI/2),b=qt*Math.sin(n*Math.PI/2),den=a*a+b*b;const zr=Rs+Rct*a/den,zi=-Rct*b/den;eisRows.push(`${f.toPrecision(8)},${zr.toFixed(8)},${zi.toFixed(8)}`);}
await fs.writeFile(eis,eisRows.join('\n'));

const tafel=path.join(fixtures,'Feature-Tafel.csv');
const tafelRows=['Potential/V,Current/A'];
for(let i=0;i<80;i++){const logj=-3+i*0.035,j=Math.pow(10,logj),e=1.25+0.12*logj;tafelRows.push(`${e.toFixed(6)},${(j/1000).toFixed(10)}`);}
await fs.writeFile(tafel,tafelRows.join('\n'));

const runId=Date.now()+'-'+process.pid,isolated=path.join(output,'isolated-app-'+runId),profile=path.join(output,'profile-'+runId);
await fs.cp(path.join(directory,'build/app'),isolated,{recursive:true});await fs.mkdir(profile,{recursive:true});
const original=await fs.readFile(path.join(isolated,'main.cjs'),'utf8'),marker="app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(original.includes(marker));await fs.writeFile(path.join(isolated,'main.cjs'),original.replace(marker,`app.setPath('userData',${JSON.stringify(profile)});`));
const executable=path.resolve(value('--electron')||path.join(directory,'node_modules/electron/dist/electron.exe'));
const report={checks:[],screenshots:[]};
const launch=()=>electron.launch({executablePath:executable,args:[isolated],timeout:30000});
const waitFile=async(folder,suffix)=>{for(let i=0;i<300;i++){const names=await fs.readdir(folder).catch(()=>[]);const hit=names.find(name=>name.endsWith(suffix));if(hit)return path.join(folder,hit);await new Promise(r=>setTimeout(r,100));}throw Error(`download ${suffix} not found`);};
let app=await launch(),page;
try{
  page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.restore();w.show();w.focus();w.setContentSize(1440,950);}));
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  const toDay=page.getByRole('button',{name:'切换到白天模式',exact:true});if(await toDay.count())await toDay.click();
  assert.equal(await page.evaluate(()=>window.scientificPlot.version),JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8')).version);
  await app.evaluate(({dialog,session},folder)=>{dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:folder+'/'+options.defaultPath.split(/[\\/]/).pop()});session.defaultSession.on('will-download',(_e,item)=>item.setSavePath(folder+'/'+item.getFilename()));},downloads);
  async function go(tab){await page.locator(`.lsv-tabs a[href="#${tab}"]`).click();await page.waitForURL(new RegExp(`#${tab}$`));await page.locator(`#panel-${tab}`).waitFor();}
  async function picker(files){await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},files);}
  async function importFile(tab,title,files){await go(tab);await picker(files);const panel=page.locator(`#panel-${tab}`);await panel.getByRole('button',{name:'导入数据',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:`选择 ${title} 数据文件`,exact:true}).click();await page.getByRole('button',{name:/^绘制.*条曲线$/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
  async function shot(name){await page.getByRole('navigation',{name:'绘图类型'}).scrollIntoViewIfNeeded();const file=path.join(shots,`${name}.png`);await page.screenshot({path:file});report.screenshots.push(file);}

  await importFile('xrd','XRD',[xrd]);
  for(const [format,suffix,check] of [['tiff','.tif',b=>b[0]===0x49&&b[1]===0x49],['pdf','.pdf',b=>/^%PDF-\d\.\d/.test(b.subarray(0,8).toString())],['png','.png',b=>b[0]===0x89&&b.subarray(1,4).toString()==='PNG']]){
    await page.locator('#panel-xrd').getByRole('button',{name:'导出图形（多格式）',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await page.getByLabel('图形格式',{exact:true}).selectOption(format);
    await page.getByLabel('图形宽度毫米',{exact:true}).fill('85');
    if(format!=='svg'&&format!=='pdf')await page.getByLabel('图形分辨率',{exact:true}).selectOption('600');
    await dialog.getByRole('button',{name:'导出',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const file=await waitFile(downloads,suffix),bytes=await fs.readFile(file);
    assert.ok(bytes.length>1000,`${format} too small`);assert.ok(check(bytes),`${format} header`);
    if(format==='pdf')assert.ok(!bytes.includes(Buffer.from('/Subtype /Image')),'PDF must not embed a full-page raster image');
  }
  report.checks.push('figure-export-writes-raster600dpi-and-vector-pdf-at-85mm');
  await shot('01-export-controls');

  await importFile('eis','EIS',[eis]);
  await page.locator('#panel-eis').getByRole('button',{name:'拟合',exact:true}).click();
  const card=page.locator('[data-testid=eis-fit-card]');await card.waitFor({timeout:20000});
  const rctText=await page.locator('[data-parameter=Rct]').innerText();
  const rct=Number(rctText.split('±')[0].trim());
  assert.ok(Number.isFinite(rct)&&Math.abs(rct-Rct)/Rct<0.05,`Rct ${rctText}`);
  assert.equal(await page.locator('#panel-eis [data-curve="eis-circuit-fit"]').count(),1);
  assert.match(await page.locator('#panel-eis').innerText(),/Rs \+ \(Rct ∥ CPE\)/);
  report.checks.push('eis-circuit-fit-recovers-rct-and-draws-overlay');
  await shot('02-eis-fit');

  await importFile('tafel','Tafel',[tafel]);
  await page.locator('#panel-tafel [aria-label="扫描方向"] button').first().click();
  await page.locator('#panel-tafel').getByRole('button',{name:'自动选区',exact:true}).click();
  await page.locator('#panel-tafel').getByText(/候选线性区|自动选区：/).waitFor({timeout:20000});
  await page.locator('#panel-tafel').getByRole('button',{name:'线性拟合',exact:true}).click();
  await page.locator('[data-testid=tafel-fit-table]').waitFor();
  const j0=await page.locator('[data-stat=j0]').innerText(),ci=await page.locator('[data-stat=slope-ci]').innerText();
  assert.match(j0,/mA cm⁻²|mA/);assert.match(ci,/至/);
  report.checks.push('tafel-auto-window-fits-and-reports-j0-and-95ci');

  const addBook=page.locator('#panel-tafel').getByRole('button',{name:/添加 BOOK/}).first();
  await addBook.click();
  const book=page.locator('.data-book-window').first();await book.waitFor();
  await book.getByRole('button',{name:'计算列',exact:true}).click();
  await book.getByLabel(/计算列名称$/).fill('Y×1000');
  await book.getByLabel(/计算列公式$/).fill('y*1000');
  await book.getByRole('button',{name:'添加列',exact:true}).click();
  await book.locator('thead th strong').filter({hasText:/^F$/}).waitFor();
  assert.ok(await book.locator('td[data-column^="computed-"]').count()>0);
  await book.getByRole('button',{name:'列统计',exact:true}).click();
  await book.getByText('列统计',{exact:true}).waitFor();
  assert.match(await book.innerText(),/均值/);
  await book.getByRole('button',{name:'导出 CSV',exact:true}).click();
  const csvFile=await waitFile(downloads,'-BOOK1.csv');
  const csv=await fs.readFile(csvFile,'utf8');
  assert.match(csv,/Y×1000/);
  report.checks.push('book-worksheet-adds-computed-column-stats-and-csv');
  await shot('03-worksheet');

  await go('xrd');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  const recovery=path.join(profile,'Recovery','autosave.fri');
  for(let i=0;i<200;i++){try{if((await fs.stat(recovery)).size>1000)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok((await fs.stat(recovery)).size>1000,'autosave file');
  report.checks.push('autosave-writes-recovery-snapshot-when-hidden');
  assert.deepEqual(errors,[]);
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
  await new Promise(r=>setTimeout(r,1200));

  app=await launch();page=await app.firstWindow();
  const errors2=[];page.on('pageerror',error=>errors2.push(error.message));
  await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.restore();w.show();w.focus();w.setContentSize(1440,950);}));
  const banner=page.locator('.studio-recovery-banner');await banner.waitFor({timeout:20000});
  assert.match(await banner.innerText(),/自动恢复副本/);
  await banner.getByRole('button',{name:'恢复',exact:true}).click();
  await banner.waitFor({state:'hidden'});
  await page.locator('.studio-project-message').filter({hasText:'已恢复'}).waitFor({timeout:20000});
  assert.ok(await page.locator('[data-curve]').count()>0);
  assert.deepEqual(errors2,[]);
  report.checks.push('relaunch-offers-recovery-and-restores-imported-data');
  await shot('04-recovered');

  report.ok=true;report.version=await page.evaluate(()=>window.scientificPlot.version);
  await fs.writeFile(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,version:report.version,checks:report.checks,screenshots:report.screenshots.length}));
}catch(error){if(page){await page.screenshot({path:path.join(output,'ui-error.png')}).catch(()=>{});await fs.writeFile(path.join(output,'ui-error.txt'),await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
