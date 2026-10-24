import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

/** Smoke-check the packaged desktop build for the version in desktop/package.json. */
delete process.env.ELECTRON_RUN_AS_NODE;
const directory=path.dirname(fileURLToPath(import.meta.url));
const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const playwright=value('--playwright');if(!playwright)throw Error('Provide --playwright <installed playwright/index.mjs>.');
const output=path.resolve(value('--output')||path.join(directory,'output/installed'));
const manifest=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
const install=path.join(directory,'release',`Friday-${manifest.version}-win32-x64`);
const executable=path.join(install,'ScientificPlotStudio.exe');
await fs.access(executable);
const running=execFileSync('tasklist',['/FI','IMAGENAME eq ScientificPlotStudio.exe','/NH'],{encoding:'utf8'});
if(running.includes('ScientificPlotStudio.exe'))throw Error('Friday 正在运行；请先完全退出，再检查已安装版本。');

const {_electron:electron}=await import(pathToFileURL(path.resolve(playwright)).href);
const app=await electron.launch({executablePath:executable,timeout:30000});
let page;
try{
  page=await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'绘图类型'}).waitFor({timeout:20000});
  const tab=value('--tab');
  if(tab){if(!/^[a-z]+$/.test(tab))throw Error('Invalid tab.');await page.locator(`a[href="#${tab}"]`).click();await page.locator(`#panel-${tab}:not([hidden])`).waitFor();}
  const version=await page.evaluate(()=>window.scientificPlot.version);
  assert.equal(version,manifest.version);
  const title=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getTitle());
  assert.match(title,/桌面版 v?\d+\.\d+\.\d+/);
  assert.ok(title.includes(manifest.version),`窗口标题 ${title} 未包含 ${manifest.version}`);
  await fs.mkdir(output,{recursive:true});
  const screenshot=path.join(output,`installed-${version}.png`);
  await page.screenshot({path:screenshot});
  console.log(JSON.stringify({ok:true,version,title,executable,screenshot}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
