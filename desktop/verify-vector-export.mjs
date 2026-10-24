import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';

delete process.env.ELECTRON_RUN_AS_NODE;
const here=path.dirname(fileURLToPath(import.meta.url));
const value=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
if(!value('--playwright'))throw Error('Provide --playwright <installed playwright/index.mjs>.');
const {_electron:electron}=await import(pathToFileURL(path.resolve(value('--playwright'))).href);
const output=path.resolve(value('--output')||path.join(here,'output/vector-export'));
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-'));
const isolated=path.join(run,'isolated-app'),profile=path.join(run,'profile'),downloads=path.join(run,'exports');
await fs.cp(path.join(here,'build/app'),isolated,{recursive:true});
await fs.mkdir(profile,{recursive:true});await fs.mkdir(downloads,{recursive:true});
const original=await fs.readFile(path.join(isolated,'main.cjs'),'utf8'),marker="app.setPath('userData', path.join(app.getPath('appData'), 'ScientificPlotStudio'));";
assert.ok(original.includes(marker));
await fs.writeFile(path.join(isolated,'main.cjs'),original.replace(marker,`app.setPath('userData',${JSON.stringify(profile)});`));
const fixture=path.join(run,'Vector-Export.csv');
await fs.writeFile(fixture,'Potential/V,Current/A\n0.1,0.001\n0.2,0.002\n0.3,0.006\n0.4,0.02\n0.5,0.04');
const app=await electron.launch({executablePath:path.resolve(value('--electron')||path.join(here,'node_modules/electron/dist/electron.exe')),args:[isolated],timeout:30000});
const report={checks:[],files:{},run},errors=[];
let page;
try{
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor();
  await page.locator('.lsv-tabs a[href="#lsv"]').click();
  await app.evaluate(({dialog,session},{fixture,downloads})=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});
    session.defaultSession.on('will-download',(_event,item)=>item.setSavePath(downloads+'/'+item.getFilename()));
  },{fixture,downloads});
  await page.locator('#panel-lsv').getByRole('button',{name:'导入数据',exact:true}).click();
  await page.getByRole('button',{name:'选择 LSV 数据文件',exact:true}).click();
  await page.getByRole('button',{name:/^绘制.*条曲线$/}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const chart=page.locator('#panel-lsv [data-testid=lsv-chart]');
  const box=await chart.boundingBox();assert.ok(box);
  await page.mouse.click(box.x+box.width*.7,box.y+box.height*.45,{button:'right'});
  await page.getByRole('menuitem',{name:'箭头',exact:true}).click();
  await page.mouse.move(box.x+box.width*.65,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.8,box.y+box.height*.3,{steps:8});await page.mouse.up();
  await page.locator('#panel-lsv [data-annotation-kind=arrow]').waitFor();
  await page.locator('#panel-lsv [data-testid=lsv-chart]').evaluate(svg=>{
    const text=document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x','30');text.setAttribute('y','40');text.setAttribute('font-size','11');text.setAttribute('fill','#123456');
    text.textContent='Friday 矢量验证 电流密度 η';svg.appendChild(text);
    const fixture=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="qa-grad"><stop stop-color="#d4edff"/><stop offset="1" stop-color="#246c96"/></linearGradient><pattern id="qa-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8" stroke="#246c96"/></pattern><marker id="qa-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4"><path d="M0 0L10 5L0 10Z" fill="#246c96"/></marker></defs><rect x="130" y="100" width="50" height="20" fill="url(#qa-grad)"/><rect x="190" y="100" width="50" height="20" fill="url(#qa-hatch)"/><path d="M250 110L280 110" stroke="#246c96" marker-end="url(#qa-arrow)"/></svg>','image/svg+xml');
    const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('transform','translate(-100 -45)');
    for(const node of [...fixture.documentElement.childNodes])group.appendChild(document.importNode(node,true));svg.appendChild(group);
  });
  await page.locator('#panel-lsv .plot-settings-trigger').click();
  await page.getByRole('tab',{name:'标题',exact:true}).click();
  await page.getByLabel('X 轴标题文字',{exact:true}).fill('Friday 电位 / V');
  await page.getByLabel('X 轴标题字号',{exact:true}).fill('22');
  await page.getByLabel('X 轴标题加粗',{exact:true}).uncheck();
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  const waitDownload=async suffix=>{for(let n=0;n<200;n++){const names=await fs.readdir(downloads),file=names.find(name=>name.endsWith(suffix));if(file)return path.join(downloads,file);await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`No ${suffix} download`);};
  for(const [format,suffix] of [['png','.png'],['tiff','.tif'],['svg','.svg'],['pdf','.pdf']]){
    await page.locator('#panel-lsv').getByRole('button',{name:'导出图形（多格式）',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await page.getByLabel('图形格式',{exact:true}).selectOption(format);
    await page.getByLabel('图形宽度毫米',{exact:true}).fill('85');
    if(format==='png'||format==='tiff'){
      await page.getByLabel('图形分辨率',{exact:true}).selectOption('600');
      await page.getByLabel('透明背景',{exact:true}).check();
    }else assert.equal(await page.getByLabel('图形分辨率',{exact:true}).isDisabled(),true);
    await dialog.getByRole('button',{name:'导出',exact:true}).click();
    await dialog.waitFor({state:'hidden',timeout:40000});
    report.files[format]=await waitDownload(suffix);
  }
  const svg=await fs.readFile(report.files.svg,'utf8');
  assert.match(svg,/width="85mm"/);assert.match(svg,/height="[\d.]+mm"/);assert.match(svg,/viewBox="[^"]+"/);
  assert.match(svg,/data-annotation-kind="arrow"/);assert.match(svg,/<marker/);assert.match(svg,/<pattern/);assert.match(svg,/<linearGradient/);
  assert.match(svg,/Friday 电位 \/ V/);assert.match(svg,/font-size: 22px/);assert.match(svg,/font-weight: 400/);
  assert.doesNotMatch(svg,/data-plot-transient|tabindex=/);
  const png=await sharp(report.files.png).metadata(),tiff=await sharp(report.files.tiff).metadata();
  assert.equal(png.density,600);assert.equal(tiff.density,600);assert.equal(png.width,2008);assert.equal(tiff.width,2008);
  assert.equal(png.hasAlpha,true);assert.equal(tiff.hasAlpha,true);
  report.checks.push('actual-PNG-TIFF-600dpi-alpha-and-SVG-85mm');
  const pdf=await fs.readFile(report.files.pdf);
  assert.ok(pdf.subarray(0,5).toString()==='%PDF-');assert.equal(pdf.includes(Buffer.from('/DCTDecode')),false);
  const python=value('--python')||'python';
  const audit=await promisify(execFile)(python,['-c',[
    'import json,sys,pdfplumber',
    'with pdfplumber.open(sys.argv[1]) as pdf:',
    ' assert len(pdf.pages)==1, len(pdf.pages)',
    ' p=pdf.pages[0]',
    ' assert abs(p.width*25.4/72-85)<0.2, p.width',
    ' assert len(p.images)==0, p.images',
    ' assert len(p.curves)+len(p.lines)>0',
    ' text=p.extract_text() or ""',
    ' assert "Friday" in text and "电流密度" in text and "电位" in text, repr(text)',
    ' print(json.dumps({"widthMm":p.width*25.4/72,"heightMm":p.height*25.4/72,"images":len(p.images),"curves":len(p.curves),"lines":len(p.lines),"text":text},ensure_ascii=True))'
  ].join('\n'),report.files.pdf],{maxBuffer:2*1024*1024});
  report.pdf=JSON.parse(audit.stdout);report.checks.push('actual-PDF-single-physical-page-vector-paths-selectable-Chinese-no-raster-image');
  assert.ok(Math.abs(report.pdf.heightMm-Number(svg.match(/height="([\d.]+)mm"/)[1]))<.2,'PDF height matches SVG physical aspect ratio');
  await promisify(execFile)(value('--pdftoppm')||'pdftoppm',['-singlefile','-r','150','-png',report.files.pdf,path.join(run,'vector-pdf-preview')]);
  report.preview=path.join(run,'vector-pdf-preview.png');
  // The print helper must be destroyed and cannot consume the user's desktop window/session.
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  const bad=await page.evaluate(async()=>{try{await window.scientificPlot.renderFigurePdf({svgText:'<svg><script>throw 1</script></svg>',widthMm:85,heightMm:85});return '';}catch(error){return error.message;}});
  assert.match(bad,/不支持/);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  report.checks.push('native-boundary-rejects-script-and-cleans-hidden-window');
  report.errors=errors;assert.deepEqual(errors,[]);report.ok=true;
  await fs.writeFile(path.join(output,'vector-export-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){if(page)await page.screenshot({path:path.join(run,'ui-error.png')}).catch(()=>{});throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
