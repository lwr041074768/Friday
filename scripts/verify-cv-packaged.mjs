import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const install=path.resolve(process.argv[2]||path.join(root,'desktop/release/cv-20261021/Friday-0.5.8-win32-x64'));
const out=path.resolve(process.argv[3]||path.join(root,'../output/playwright/cv-package-20261021'));
const target=path.join(out,'packaged-check'),resources=path.join(target,'resources');
await fs.mkdir(out,{recursive:true});
await fs.cp(install,target,{recursive:true,force:false,errorOnExist:true});
const original=path.join(resources,'app.asar'),test=path.join(resources,'smoke.asar'),loader=path.join(resources,'app');
assert.ok(path.resolve(original).startsWith(out+path.sep));
const digest=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const sourceHash=await digest(path.join(install,'resources/app.asar'));
assert.equal(await digest(original),sourceHash);
await fs.rename(original,test);await fs.mkdir(loader);
try{
  await fs.writeFile(path.join(loader,'package.json'),JSON.stringify({name:'friday-cv-package-check',version:'0.5.8',main:'main.cjs'}));
  await fs.writeFile(path.join(loader,'main.cjs'),`const {app}=require('electron');const path=require('node:path');const profile=path.resolve(process.env.FRIDAY_QA_APP_DATA||'');if(!profile.startsWith(${JSON.stringify(out+path.sep)}))throw Error('Unexpected QA profile');app.setPath('appData',profile);require(${JSON.stringify(path.join(test,'main.cjs'))});`);
  const uiOut=path.join(out,'ui');
  const uiScript=path.resolve(process.env.CV_QA_SCRIPT||path.join(root,'scripts/verify-cv-ui.mjs'));
  const result=await new Promise((resolve,reject)=>execFile(process.execPath,[uiScript],{
    cwd:root,windowsHide:true,timeout:240000,maxBuffer:4*1024*1024,
    env:{...process.env,CV_QA_EXECUTABLE:path.join(target,'ScientificPlotStudio.exe'),CV_QA_APP_DATA:path.join(out,'app-data'),CV_QA_OUTPUT:uiOut},
  },(error,stdout,stderr)=>error?reject(Error(stdout+stderr+error.message)):resolve(stdout)));
  const ui=JSON.parse(await fs.readFile(path.join(uiOut,'summary.json'),'utf8'));
  assert.equal(await digest(test),sourceHash);
  assert.equal(await digest(path.join(install,'resources/app.asar')),sourceHash);
  const report={...ui,packaged:true,packagedAsarSHA256:sourceHash,install,output:out};
  await fs.writeFile(path.join(out,'packaged-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{
  await fs.unlink(path.join(loader,'main.cjs')).catch(()=>{});
  await fs.unlink(path.join(loader,'package.json')).catch(()=>{});
  await fs.rmdir(loader);
  await fs.rename(test,original);
}
