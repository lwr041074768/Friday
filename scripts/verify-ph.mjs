import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'desktop/output/ph-qa');
await fs.mkdir(out,{recursive:true});
const cache=new Map();
async function moduleUrl(relative){
  const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file);
  const promise=(async()=>{let code=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    const specs=[...new Set([...code.matchAll(/from\s*["']([^"']+)["']/g)].map(m=>m[1]))];
    for(const spec of specs){let url;if(spec.startsWith('.')||spec.startsWith('@/')){const target=spec.startsWith('@/')?path.join(root,spec.slice(2)):path.resolve(path.dirname(file),spec);url=await moduleUrl(target.endsWith('.ts')?target:target+'.ts');}else url=import.meta.resolve(spec);code=code.replaceAll(`from "${spec}"`,`from ${JSON.stringify(url)}`).replaceAll(`from '${spec}'`,`from ${JSON.stringify(url)}`);}
    return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');})();cache.set(file,promise);return promise;
}
const math=await import(await moduleUrl('lib/ph-data.ts')),imp=await import(await moduleUrl('lib/ph-import.ts')),exp=await import(await moduleUrl('lib/ph-export.ts'));
const doc=await import(await moduleUrl('lib/project-document.ts'));
const require=createRequire(import.meta.url),{validatePhRequest}=require('../desktop/policy.cjs');
const settings={...math.DEFAULT_PH_SETTINGS,potential:'.600'},near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
// All acquisitions below are generated from declared analytical curves.
// At 0.600 V: log10(j / uA cm^-2) = slope * pH + intercept.
const syntheticModels=[{name:'Synthetic-A',slope:.5,intercept:-4},{name:'Synthetic-B',slope:.75,intercept:-7}];
assert.deepEqual(imp.inferPhPath('synthetic/Synthetic-B/12.5/LSV.txt'),{group:'Synthetic-B',ph:'12.5'});
assert.equal(imp.inferPhPath('Synthetic-A_pH13.5.txt').ph,'13.5');
function syntheticRows(model,ph){
  const target=10**(model.slope*ph+model.intercept)*1e-6;
  return Array.from({length:2000},(_,i)=>{const e=i<1000?i/1000:1-(i-1000)/1000;return [e,target*(e-.45)/.15];});
}
function syntheticFile(model,ph,binary=false){
  const rows=syntheticRows(model,ph),name=binary?'LSV.bin':'LSV.txt';let payload;
  if(binary){
    const data=Buffer.alloc(1685+rows.length*4);
    for(const [offset,value] of [[0,0x001df280],[4,2],[10,18],[60,5],[609,rows.length],[617,rows.length],[653,760],[661,1],[665,2]])data.writeUInt32LE(value,offset);
    data.write('CV',8,'ascii');data.write('Cyclic Voltammetry',14,'ascii');data.write('W0205',64,'ascii');
    for(const [offset,value] of [[1085,0],[1093,1],[1097,0],[1109,1],[1113,2],[1117,.001],[1121,.001]])data.writeFloatLE(value,offset);
    rows.forEach((row,i)=>data.writeFloatLE(row[1],1685+i*4));payload=data;
  }else payload=['Synthetic CV acquisition','Cyclic Voltammetry','Potential/V, Current/A',...rows.map(row=>row.join(','))].join('\r\n');
  const file=new File([payload],name);Object.defineProperty(file,'measurementSourcePath',{value:`synthetic/${model.name}/${ph}/${name}`});return file;
}
const files=syntheticModels.flatMap(model=>[10,11,12,13,14].map(ph=>syntheticFile(model,ph)));
const imported=await imp.readPhFiles(files);assert.equal(imported.items.length,10);assert.equal(imported.warnings.length,0);
let groups=imp.appendPhImport([],imported.items,'1','raw');assert.deepEqual(groups.map(g=>g.name),['Synthetic-A','Synthetic-B']);
assert.ok(groups.every(g=>g.series.every(s=>s.unit==='A'&&s.points.length===2000)));
const original=JSON.stringify(groups);
let traces=math.preparePhTraces(groups,settings),result=math.analyzePh(groups,traces,settings);
assert.ok(traces.every(t=>!t.error&&t.cycles===1&&t.points.length===1001));
for(const [index,expected] of [[0,[.5,-4,1]],[1,[.75,-7,1]]]){const f=result.groups[index].fit;assert.equal(f.n,5);near(f.slope,expected[0]);near(f.intercept,expected[1]);near(f.r2,expected[2]);}
assert.ok(result.groups.every(g=>g.points.every(p=>!p.interpolated&&p.indices.length===1)));
const four=groups.map(g=>({...g,series:g.series.map(s=>({...s,included:Number(s.ph)>=11}))}));
result=math.analyzePh(four,math.preparePhTraces(four,settings),settings);near(result.groups[0].fit.slope,.5);near(result.groups[1].fit.slope,.75);assert.equal(result.groups[0].fit.n,4);near(result.groups[0].allFit.slope,.5);
const mixed={...settings,potential:'.315'};result=math.analyzePh(groups,traces,mixed);assert.equal(result.groups.flatMap(g=>g.points).filter(p=>p.error).length,10);assert.ok(result.groups.every(g=>!g.fit));
result=math.analyzePh(groups,traces,{...mixed,absolute:true});assert.ok(result.groups.every(g=>g.fit));near(result.groups[0].fit.slope,.5);assert.equal(result.groups.flatMap(g=>g.points).filter(p=>p.warning).length,10);
assert.equal(JSON.stringify(groups),original,'Analysis mutated original rows');
// Current model: first import creates a sample; every later batch appends
// to the selected sample. Sample identity is never inferred from file names.
const first=imp.appendPhFilesToSample([],imported.items.slice(0,1),'1','raw');assert.equal(first.groups[0].name,'样品1');assert.equal(first.groups[0].series.length,1);
const appended=imp.appendPhFilesToSample(first.groups,imported.items.slice(1,3),'1','raw',first.groupId);assert.equal(appended.groups.length,1);assert.equal(appended.groups[0].series.length,3);assert.equal(first.groups[0].series.length,1);
let sampleResult=math.analyzePh(appended.groups,math.preparePhTraces(appended.groups,settings),settings);assert.equal(sampleResult.groups[0].fit.n,3);
const completed=imp.appendPhFilesToSample(appended.groups,imported.items.slice(3,5),'1','raw',first.groupId);near(math.analyzePh(completed.groups,math.preparePhTraces(completed.groups,settings),settings).groups[0].fit.slope,.5);
const secondId='second-sample',withSecond=[...completed.groups,{id:secondId,name:imp.nextPhSampleName(completed.groups),color:'#e56a41',visible:true,series:[]}];
const twoSamples=imp.appendPhFilesToSample(withSecond,imported.items.slice(5),'1','raw',secondId);assert.deepEqual(twoSamples.groups.map(g=>g.name),['样品1','样品2']);assert.deepEqual(twoSamples.groups.map(g=>g.series.length),[5,5]);
sampleResult=math.analyzePh(twoSamples.groups,math.preparePhTraces(twoSamples.groups,settings),settings);near(sampleResult.groups[0].fit.slope,.5);near(sampleResult.groups[1].fit.slope,.75);
const repeated=imp.appendPhFilesToSample(completed.groups,[imported.items[0],imported.items[0]],'1','raw',first.groupId);
assert.equal(repeated.groups[0].series.length,7);assert.equal(completed.groups[0].series.length,5);
assert.equal(new Set(repeated.groups.flatMap(g=>[g.id,...g.series.map(s=>s.id)])).size,8);
assert.deepEqual(repeated.groups[0].series[5].points,repeated.groups[0].series[0].points);
assert.notEqual(repeated.groups[0].series[5].points,repeated.groups[0].series[0].points);
assert.equal(repeated.groups[0].series[6].source,repeated.groups[0].series[0].source);
doc.validateStateShape('ph.groups',repeated.groups,[]);
const legacyRepeated=imp.appendPhImport(groups,[imported.items[0],imported.items[0]],'1','raw');
assert.equal(legacyRepeated[0].series.length,7);doc.validateStateShape('ph.groups',legacyRepeated,[]);
// Bare same-name files, repeated selection and explicitly selected TXT/BIN
// companions all survive; file identity is separate from the pH fit rule.
const binaryFiles=[];
for(const ph of [10,11])binaryFiles.push(syntheticFile(syntheticModels[0],ph,true));
const binaryBatch=await imp.readPhFiles([...binaryFiles,binaryFiles[0],files[0]]);
assert.equal(binaryBatch.items.length,4);assert.equal(binaryBatch.warnings.length,0);
assert.notEqual(binaryBatch.items[0].source,binaryBatch.items[1].source);
assert.equal(binaryBatch.items[0].source,binaryBatch.items[2].source);
const binarySample=imp.appendPhFilesToSample([],binaryBatch.items,'1','raw');
assert.equal(binarySample.groups[0].series.length,4);doc.validateStateShape('ph.groups',binarySample.groups,[]);
const bareBatch=await imp.readPhFiles([new File([await binaryFiles[0].arrayBuffer()],'LSV.bin'),new File([await files[0].arrayBuffer()],'LSV.txt')]);
assert.equal(bareBatch.items.length,2);assert.equal(bareBatch.warnings.length,0);
assert.throws(()=>imp.appendPhFilesToSample(completed.groups,imported.items.slice(5,6),'1','raw','missing'),/不存在/);
const numbered=groups[0].series.map((series,i)=>({id:`numbered-${i}`,name:String(i+1),color:groups[0].color,visible:true,series:[structuredClone(series)]}));
const numberedBefore=JSON.stringify(numbered),legacySettings={...settings};delete legacySettings.fitGrouping;
const migrated=imp.normalizePhSamples(numbered,legacySettings);assert.equal(migrated.groups.length,1);assert.equal(migrated.groups[0].name,'样品1');assert.equal(migrated.groups[0].series.length,5);assert.equal(migrated.settings.fitGrouping,'groups');assert.equal(migrated.groups[0].series[3].metadata.previousSampleGroup,'4');
assert.equal(JSON.stringify(numbered),numberedBefore,'Legacy source groups must not be mutated');
const combined=math.analyzePh(migrated.groups,math.preparePhTraces(migrated.groups,migrated.settings),migrated.settings);assert.equal(combined.groups[0].fit.n,5);near(combined.groups[0].fit.slope,.5);
assert.equal(math.analyzePh(numbered,math.preparePhTraces(numbered,settings),settings).groups.length,5,'Different samples never combine during fitting');
const named=numbered.map((g,i)=>({...g,name:`Material ${String.fromCharCode(65+i)}`}));assert.equal(imp.normalizePhSamples(named,legacySettings).groups.length,5);
assert.equal(imp.normalizePhSamples(named,{...legacySettings,fitGrouping:'combined'}).groups.length,1);
const combinedPacket=exp.buildPhOrigin(migrated.groups,migrated.settings);validatePhRequest(JSON.stringify(combinedPacket));assert.equal(combinedPacket.fitPlots.length,2);
assert.throws(()=>validatePhRequest(JSON.stringify({...combinedPacket,settings:{...settings,fitGrouping:'guess'}})),/分组/);
await fs.writeFile(path.join(out,'numbered-origin-packet.json'),JSON.stringify(combinedPacket));
doc.validateStateShape('ph.settings',legacySettings,settings);

// Units alter intercept only; density input is not normalized a second time.
const ma={...settings,outputUnit:'mA/cm2'};result=math.analyzePh(groups,math.preparePhTraces(groups,ma),ma);near(result.groups[0].fit.slope,.5);near(result.groups[0].fit.intercept,-7);
near(math.phCurrent(2,'mA/cm2',3).j,.002);near(math.phCurrent(2,'mA/cm2',3).amps,.006);near(math.phCurrent(2,'mA',2).j,.001);
assert.throws(()=>math.phCurrent(2,'mA',NaN),/面积/);
const base=structuredClone(groups[0]);base.series=base.series.slice(0,1);const s=base.series[0];s.ph='12';s.points=[{e:0,current:.001},{e:.5,current:.002},{e:1,current:.003},{e:.5,current:.0004},{e:0,current:.0002}];
let trace=math.preparePhTraces([base],settings)[0];near(math.extractPhPoint(trace,.25).j,1500);assert.equal(math.extractPhPoint(trace,.25).interpolated,true);assert.match(math.extractPhPoint(trace,1.1).error,/超出/);
trace=math.preparePhTraces([base],{...settings,scan:'down'})[0];near(math.extractPhPoint(trace,.25).j,300);
s.points=[{e:0,current:.001},{e:.5,current:NaN},{e:1,current:.003}];trace=math.preparePhTraces([base],settings)[0];assert.match(math.extractPhPoint(trace,.25).error,/缺口/);
// A repeated cycle is chosen explicitly and retains its original source indices.
s.points=[{e:0,current:1e-3},{e:1,current:2e-3},{e:0,current:3e-3},{e:1,current:4e-3},{e:0,current:5e-3}];
trace=math.preparePhTraces([base],{...settings,cycle:'2'})[0];near(math.extractPhPoint(trace,.5).j,3500);assert.deepEqual(math.extractPhPoint(trace,.5).indices,[2,3]);
// iR is applied before matching potential, using total A and no double correction.
s.points=[{e:0,current:.001},{e:.5,current:.002},{e:1,current:.003}];s.rs='100';
trace=math.preparePhTraces([base],{...settings,applyIr:true})[0];near(math.extractPhPoint(trace,.3).j,2000);
s.points=[{e:0,current:0},{e:.4,current:.003},{e:.7,current:.002},{e:1,current:.01}];
trace=math.preparePhTraces([base],{...settings,applyIr:true})[0];assert.match(math.extractPhPoint(trace,.1).error,/多个交点/);
s.points=[{e:0,current:.001},{e:.5,current:.002},{e:1,current:.003}];
s.compensation='corrected';assert.match(math.preparePhTraces([base],{...settings,applyIr:true})[0].error,/重复/);s.compensation='raw';
const rhe={...settings,mode:'rhe',reference:'Hg/HgO',filling:'user verified',offset:'.098',referenceConfirmed:true};
trace=math.preparePhTraces([base],rhe)[0];near(trace.points[1].x,.5+.098+.05915934968478112*12,1e-8);
assert.match(math.preparePhTraces([base],{...rhe,referenceConfirmed:false})[0].error,/确认/);
trace=math.preparePhTraces([base],{...rhe,inputScale:'rhe'})[0];near(trace.points[1].x,.5);
const duplicate=structuredClone(groups);duplicate[0].series[1].ph='10';assert.match(math.analyzePh(duplicate,math.preparePhTraces(duplicate,settings),settings).groups[0].error,/重复/);

const tables=exp.phTables(four,settings),xlsx=exp.phXlsx(tables);await fs.writeFile(path.join(out,'synthetic-ph.xlsx'),xlsx);await fs.writeFile(path.join(out,'raw.csv'),exp.phRawCsv(four,settings));
const fitted=tables.find(t=>t.name==='FittedValues');assert.equal(fitted.rows.length,10);
const fourAnalysis=math.analyzePh(four,math.preparePhTraces(four,settings),settings),ceFit=fourAnalysis.groups[0].fit;
const at11=fitted.rows.find(row=>row[0]==='Synthetic-A'&&row[1]===11);near(at11[4],ceFit.slope*11+ceFit.intercept,1e-12);near(at11[5],at11[3]-at11[4],1e-12);near(at11[6],10**at11[4],1e-8);assert.equal(at11[11],4);
assert.match(fitted.rows.find(row=>row[0]==='Synthetic-A'&&row[1]===10)[7],/范围外预测/);
const noFit=exp.phTables(groups,mixed).find(t=>t.name==='FittedValues');assert.ok(noFit.rows.every(row=>row[4]===null&&row[5]===null));
assert.match(tables.find(t=>t.name==='Fits').rows[0].at(-1),/y = .* × pH − /);
await fs.writeFile(path.join(out,'fitted-values.csv'),exp.phCsv(fitted));
assert.equal(tables.filter(t=>t.name.startsWith('Raw')).length,10);assert.ok(tables.filter(t=>t.name.startsWith('Raw')).every(t=>t.rows.length===2000));
assert.match(exp.phCsv({headers:['a'],rows:[['=1+1']],name:'x',label:'x'}),/'=1\+1/);
const packet=exp.buildPhOrigin(four,settings);validatePhRequest(JSON.stringify(packet));assert.equal(packet.rawPlots.length,10);assert.equal(packet.fitPlots.length,4);
assert.throws(()=>validatePhRequest(JSON.stringify({...packet,rawPlots:[{...packet.rawPlots[0],sheet:'fake'}]})),/绑定/);
await fs.writeFile(path.join(out,'origin-packet.json'),JSON.stringify(packet));
const states={'ph.groups':four,'ph.settings':settings,'ph.activeGroup':four[0].id,'ph.showAll':true,'shell.tab':'ph'};
for(const [key,value] of Object.entries(states))doc.validateStateShape(key,value,value);
const restored=doc.decodeProject(doc.encodeProject({schema:'electrocatalysis-project/v1',application:'Scientific Plot Studio',version:'0.5.8',name:'pH QA',savedAt:new Date().toISOString(),states}));assert.deepEqual(restored.states,states);
const malformed=structuredClone(four);malformed[0].series[0].unit='guessed';assert.throws(()=>doc.validateStateShape('ph.groups',malformed,[]),/格式无效/);
const report={ok:true,sourceFiles:files.length,originalRows:20000,selectedForwardRows:10010,fixture:'analytical synthetic acquisition',five:[.5,.75],four:[.5,.75],output:out};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
