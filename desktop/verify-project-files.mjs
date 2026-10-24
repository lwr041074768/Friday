import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Exercise the actual native IPC handlers with isolated files and dialog responses.
const directory=path.dirname(fileURLToPath(import.meta.url));
const source=await fs.readFile(path.join(directory,'main.cjs'),'utf8');
const start=source.indexOf("invoke('studio:project-status',");
const end=source.indexOf("invoke('studio:update-state',",start);
assert.ok(start>=0&&end>start,'Native project handler block exists');
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'friday-project-files-'));
const handlers=new Map(),dialogs=[];
let nextSave={canceled:true},nextOpen={canceled:true,filePaths:[]};
const sandbox={
  fs,path,Buffer,randomUUID,
  window:{},originBusy:false,jadeBusy:null,exportBusy:0,filePickerBusy:false,updatePreparing:false,
  projectFile:null,projectStatus:null,pendingProjects:new Map(),
  app:{getPath:name=>{assert.equal(name,'documents');return folder;}},
  validateId:value=>assert.match(value,/^[a-f0-9-]{36}$/i),
  invoke:(channel,handler)=>handlers.set(channel,handler),
  dialog:{
    showSaveDialog:async(_window,options)=>{dialogs.push({kind:'save',options});return nextSave;},
    showOpenDialog:async(_window,options)=>{dialogs.push({kind:'open',options});return nextOpen;},
    showMessageBox:async()=>({response:0})
  }
};
vm.runInNewContext(source.slice(start,end),sandbox,{filename:'native-project-handlers.cjs'});
const save=request=>handlers.get('studio:project-save')(request);
const open=()=>handlers.get('studio:project-open')();
const accept=token=>handlers.get('studio:project-accept')(token);
const reset=()=>handlers.get('studio:project-reset-path')();
const text=JSON.stringify({schema:'electrocatalysis-project/v1',application:'Scientific Plot Studio',name:'研究/项目',states:{'lsv.curves':[]}});
const request={text,saveAs:false};
const checks=[];
try{
  const extensionless=path.join(folder,'new-project');nextSave={canceled:false,filePath:extensionless};
  const first=await save(request);assert.equal(first.saved,true);assert.equal(first.fileName,'new-project.fri');
  assert.equal(await fs.readFile(extensionless+'.fri','utf8'),text);
  const firstDialog=dialogs.at(-1).options;
  assert.equal(firstDialog.title,'保存 Friday 项目');assert.equal(firstDialog.filters.length,1);
  assert.equal(firstDialog.filters[0].name,'Fri');assert.equal(firstDialog.filters[0].extensions.join(','),'fri');
  assert.equal(path.basename(firstDialog.defaultPath),'研究_项目.fri');
  checks.push('new-save-dialog-is-Fri-and-appends-fri-for-extensionless-name');

  const beforeDialogs=dialogs.length;
  await save({...request,text:text+' '});assert.equal(dialogs.length,beforeDialogs);
  assert.equal(await fs.readFile(extensionless+'.fri','utf8'),text+' ');
  checks.push('regular-fri-save-overwrites-current-file-without-reopening-picker');

  nextSave={canceled:false,filePath:path.join(folder,'bad.txt')};
  await assert.rejects(save({...request,saveAs:true}),/\.fri/);
  await assert.rejects(fs.stat(path.join(folder,'bad.txt')),{code:'ENOENT'});
  assert.equal(sandbox.projectFile,extensionless+'.fri');
  nextSave={canceled:true};assert.equal((await save({...request,saveAs:true})).saved,false);
  assert.equal(sandbox.projectFile,extensionless+'.fri');
  checks.push('incompatible-extension-and-cancel-leave-current-project-path-and-file-intact');

  const upper=path.join(folder,'upper.FRI');nextSave={canceled:false,filePath:upper};
  assert.equal((await save({...request,saveAs:true})).fileName,'upper.FRI');
  nextOpen={canceled:false,filePaths:[upper]};const upperOpen=await open();assert.equal(upperOpen.text,text);await accept(upperOpen.token);
  const openDialog=dialogs.at(-1).options;
  assert.equal(openDialog.filters[0].name,'Fri');assert.equal(openDialog.filters[0].extensions.join(','),'fri');
  assert.equal(openDialog.filters[1].extensions.join(','),'ecproj');
  checks.push('uppercase-FRI-saves-and-opens-with-legacy-filter-available');

  const legacy=path.join(folder,'legacy.ECPROJ');await fs.writeFile(legacy,text);
  nextOpen={canceled:false,filePaths:[legacy]};const legacyOpen=await open();await accept(legacyOpen.token);
  nextSave={canceled:true};assert.equal((await save({...request,text:text+' '})).saved,false);
  assert.equal(sandbox.projectFile,legacy);assert.equal(await fs.readFile(legacy,'utf8'),text);
  assert.equal(dialogs.at(-1).options.defaultPath,path.join(folder,'legacy.fri'));
  const migrated=path.join(folder,'legacy.fri');nextSave={canceled:false,filePath:migrated};
  assert.equal((await save({...request,text:text+' '})).fileName,'legacy.fri');
  assert.equal(await fs.readFile(legacy,'utf8'),text);assert.equal(await fs.readFile(migrated,'utf8'),text+' ');
  checks.push('legacy-ecproj-regular-save-prompts-fri-copy-and-never-modifies-original');

  nextOpen={canceled:true,filePaths:[]};assert.equal(await open(),null);assert.equal(sandbox.projectFile,migrated);
  const rejected=path.join(folder,'wrong.json');await fs.writeFile(rejected,text);nextOpen={canceled:false,filePaths:[rejected]};
  await assert.rejects(open(),/\.fri/);assert.equal(sandbox.projectFile,migrated);
  await assert.rejects(save({...request,text:'{'}),/JSON/);assert.equal(sandbox.projectFile,migrated);
  assert.equal(sandbox.exportBusy,0);assert.ok(!(await fs.readdir(folder)).some(file=>file.endsWith('.tmp')));
  checks.push('cancel-invalid-open-and-invalid-save-preserve-current-project-with-no-temporary-files');

  const occupied=path.join(folder,'occupied.fri');await fs.mkdir(occupied);nextSave={canceled:false,filePath:occupied};
  await assert.rejects(save({...request,saveAs:true}));assert.equal(sandbox.projectFile,migrated);assert.equal(await fs.readFile(migrated,'utf8'),text+' ');assert.equal(await fs.readFile(legacy,'utf8'),text);
  assert.equal(sandbox.exportBusy,0);assert.ok(!(await fs.readdir(folder)).some(file=>file.endsWith('.tmp')));checks.push('native-write-rename-failure-keeps-source-and-current-file-intact-and-cleans-owned-temp');

  reset();assert.equal(sandbox.projectFile,null);
  console.log(JSON.stringify({ok:true,checks},null,2));
}finally{
  // Only remove this script's unique temporary directory under the system temp root.
  const absolute=path.resolve(folder),tempRoot=path.resolve(os.tmpdir())+path.sep;
  assert.ok(absolute.startsWith(tempRoot)&&path.basename(absolute).startsWith('friday-project-files-'));
  await fs.rm(absolute,{recursive:true,force:true});
}
