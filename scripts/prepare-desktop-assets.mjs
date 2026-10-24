import fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const binary=path.resolve(process.argv[2]||''),output=path.resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3]||output===root||output===path.dirname(binary))throw Error('Provide the reviewed desktop ZIP and a separate release directory.');
if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true}).trim())throw Error('Commit the reviewed source before preparing release assets.');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const {version}=JSON.parse(await fs.readFile(path.join(root,'desktop/package.json'),'utf8'));const prefix=`ScientificPlotStudio-${version}`;await fs.mkdir(output,{recursive:true});
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const fullName=`${prefix}-Windows-x64.zip`,fullTarget=path.join(output,fullName);await fs.copyFile(binary,fullTarget);
const parts=[];let handle,partHash,partSize=0,index=0;const maximum=90000000;
async function begin(){const filename=`${fullName}.${String(++index).padStart(3,'0')}`;handle=await fs.open(path.join(output,filename),'w');partHash=createHash('sha256');partSize=0;parts.push({filename,size:0,sha256:''});}
async function finish(){if(!handle)return;await handle.close();handle=null;Object.assign(parts.at(-1),{size:partSize,sha256:partHash.digest('hex')});}
await begin();try{for await(const chunk of createReadStream(fullTarget)){let offset=0;while(offset<chunk.length){if(partSize===maximum){await finish();await begin();}const slice=chunk.subarray(offset,offset+Math.min(chunk.length-offset,maximum-partSize));await handle.writeFile(slice);partHash.update(slice);partSize+=slice.length;offset+=slice.length;}}}finally{await finish();}
const guideName=`Friday-${version}-UserGuide-zh-CN.pdf`;await fs.copyFile(path.join(root,'docs/科研绘图台使用说明书.pdf'),path.join(output,guideName));
const sourceName=`Friday-${version}-Source.zip`;execFileSync('git',['archive','--format=zip',`--prefix=Friday-${version}-Source/`,'--output',path.join(output,sourceName),'HEAD'],{cwd:root,windowsHide:true});
for(const name of ['Merge-DesktopRelease.ps1','Merge-DesktopRelease.cmd']){let text=await fs.readFile(path.join(root,'desktop/tools',name),'utf8');if(name.endsWith('.cmd'))text=text.replace(/\r?\n/g,'\r\n');await fs.writeFile(path.join(output,name),text);}
const stat=await fs.stat(fullTarget),manifest={product:'Scientific Plot Studio',displayName:'Friday',version,sourceCommit:commit,createdAt:new Date().toISOString(),tag:`desktop-v${version}`,desktop:{filename:fullName,size:stat.size,sha256:await digest(fullTarget),parts},guide:guideName,source:sourceName};
await fs.writeFile(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const assetNames=[...parts.map(p=>p.filename),guideName,sourceName,'Merge-DesktopRelease.ps1','Merge-DesktopRelease.cmd','release-manifest.json'];
const sums=[];for(const name of [fullName,...assetNames])sums.push(`${await digest(path.join(output,name))}  ${name}`);await fs.writeFile(path.join(output,'SHA256SUMS.txt'),sums.join('\n')+'\n');
await fs.writeFile(path.join(output,'UPLOAD-ASSETS.json'),JSON.stringify({version,sourceCommit:commit,tag:manifest.tag,files:[...assetNames,'SHA256SUMS.txt']},null,2));
console.log(JSON.stringify({version,sourceCommit:commit,fullZip:fullTarget,parts:parts.length,uploadFiles:assetNames.length+1,output}));
