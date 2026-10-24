import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {unzipSync,strFromU8} from 'fflate';
process.on('uncaughtException',error=>{console.error(error.message);process.exitCode=1;});

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'desktop/output/cv-qa');
await fs.mkdir(out,{recursive:true});
const cache=new Map();
async function moduleUrl(relative){
  const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file);
  const promise=(async()=>{let code=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    const specs=[...new Set([...code.matchAll(/from\s*["']([^"']+)["']/g)].map(m=>m[1]))];
    for(const spec of specs){let url;if(spec.startsWith('.')||spec.startsWith('@/')){const target=spec.startsWith('@/')?path.join(root,spec.slice(2)):path.resolve(path.dirname(file),spec);url=await moduleUrl(target.endsWith('.ts')?target:target+'.ts');}else url=import.meta.resolve(spec);code=code.replaceAll(`from "${spec}"`,`from ${JSON.stringify(url)}`).replaceAll(`from '${spec}'`,`from ${JSON.stringify(url)}`);}
    return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');})();cache.set(file,promise);return promise;
}
const math=await import(await moduleUrl('lib/cv-data.ts')),imp=await import(await moduleUrl('lib/cv-import.ts')),exp=await import(await moduleUrl('lib/cv-export.ts'));
const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const settings={...math.DEFAULT_CV_SETTINGS};
const R=8.31446261815324,F=96485.33212,temperature=298.15,alpha=.45,targetKs=.01;
const theory=rate=>({epa:.5+R*temperature/((1-alpha)*F)*Math.log((1-alpha)*F*(rate/1000)/(R*temperature*targetKs)),epc:.5-R*temperature/(alpha*F)*Math.log(alpha*F*(rate/1000)/(R*temperature*targetKs))});
function makeSeries(rate,{count=4,step=.002,descending=false}={}){
  const {epa,epc}=theory(rate),grid=[...new Set([...Array.from({length:Math.round(1/step)+1},(_,i)=>i*step),epa,epc])].sort((a,b)=>a-b),points=[];
  const branch=direction=>{const coordinates=direction==='up'?grid:[...grid].reverse();return coordinates.map(e=>({e,current:direction==='up'?.002*Math.exp(-(((e-epa)/.03)**2)):-.002*Math.exp(-(((e-epc)/.03)**2))}));};
  for(let i=0;i<count;i++){const a=branch(descending?'down':'up'),b=branch(descending?'up':'down');for(const p of i?a.slice(1):a)points.push(p);for(const p of b.slice(1))points.push(p);}
  return {id:crypto.randomUUID(),name:`CV-${rate}mV`,source:`sample/CV-${rate}mV.txt`,rate:String(rate),area:'1',unit:'A',included:true,cycle:'',anodic:'',cathodic:'',anodicQuality:'peak',cathodicQuality:'peak',points,metadata:{}};
}
const group=math.createCvGroup();group.series=[20,30,40,80].map(rate=>makeSeries(rate));
const before=JSON.stringify(group);let result=math.analyzeCv([group],settings),g=result.groups[0];
assert.equal(g.error,undefined);near(g.alpha,alpha,1e-10);near(g.ksGeomean,targetKs,1e-10);assert.equal(g.ksCount,4);near(g.fit.r2,1,1e-10);
assert.ok(result.traces.every(t=>t.cycles===4&&t.selectedCycle===4));assert.equal(JSON.stringify(group),before,'analysis leaves raw samples immutable');
near(math.cvCurrent(2,'mA',2),1);near(math.cvCurrent(2,'mA/cm2',2),2);near(math.cvCurrent(-2,'uA',1),-.002);
const density=structuredClone(group);for(const s of density.series)s.area='2';near(math.analyzeCv([density],settings).groups[0].ksGeomean,targetKs);
for(const descending of [false,true]){const s=makeSeries(20,{descending});const split=math.cvCycles(s.points);assert.equal(split.cycles.length,4);const t=math.prepareCvTraces([{...group,series:[s]}],settings)[0];near(t.anodic.e,theory(20).epa);near(t.cathodic.e,theory(20).epc);}
const unavailable=structuredClone(group);unavailable.series[0]=makeSeries(20,{count:2});assert.match(math.analyzeCv([unavailable],settings).groups[0].error,/待确认/);assert.match(math.prepareCvTraces([unavailable],settings)[0].error,/第 4 圈/);
const partial=makeSeries(20,{count:1});const cut=partial.points.findIndex(p=>p.e>=.2);partial.points=partial.points.slice(cut);assert.equal(math.cvCycles(partial.points).cycles.length,0,'partial leading outward sweep is not paired with a later return');
const duplicate=structuredClone(group);duplicate.series[1].rate='20';assert.match(math.analyzeCv([duplicate],settings).groups[0].error,/重复扫速/);
const boundary=structuredClone(group);for(const p of boundary.series[0].points)p.current=p.e;assert.match(math.prepareCvTraces([boundary],settings)[0].error,/待确认峰位/);
const gap=structuredClone(group);const at=math.prepareCvTraces([gap],settings)[0].anodic.index;gap.series[0].points[at].current=NaN;assert.equal(math.prepareCvTraces([gap],settings)[0].anodic,undefined,'gap at peak is not bridged for an automatic peak');
const shoulder=structuredClone(group);shoulder.series[0].anodic=String(theory(20).epa);shoulder.series[0].anodicQuality='shoulder';let shoulderResult=math.analyzeCv([shoulder],settings);assert.equal(shoulderResult.groups[0].rows[0].usedForKs,false);assert.equal(shoulderResult.groups[0].ksCount,3);shoulderResult=math.analyzeCv([shoulder],{...settings,calculationMode:'trial'});assert.equal(shoulderResult.groups[0].ksCount,4);assert.equal(shoulderResult.traces[0].anodic.quality,'shoulder');
// Stress one branch above typical function-argument limits; analysis must remain linear.
const stress=makeSeries(20,{count:1,step:1/150000}),started=Date.now();
const stressTrace=math.prepareCvTraces([{...group,series:[stress]}],{...settings,cycle:'1'})[0];assert.equal(stressTrace.error,undefined);near(stressTrace.anodic.e,theory(20).epa,1e-10);assert.ok(Date.now()-started<20000,'large-branch analysis remains bounded');

// Import the same analytical traces through text parsing, then export every row.
const rates=[20,30,40,80],files=rates.map(rate=>{
  const series=makeSeries(rate),text=['Synthetic CV acquisition','Cyclic Voltammetry',`Scan Rate (V/s) = ${rate/1000}`,'Potential/V, Current/A',...series.points.map(p=>`${p.e},${p.current}`)].join('\r\n');
  const file=new File([text],`CV-${rate}mV.txt`);Object.defineProperty(file,'measurementSourcePath',{value:`synthetic/Sample-A/${file.name}`});return file;
});
const imported=await imp.readCvFiles(files);assert.equal(imported.items.length,4);assert.ok(imported.items.every(item=>item.unit==='A'));
const sample=imp.appendCvFilesToSample([],imported.items).groups[0];sample.name='Synthetic-A';
assert.ok(sample.series.every(s=>s.area==='1'));
const repeated=imp.appendCvFilesToSample([sample],imported.items,'1',sample.id);assert.equal(repeated.groups[0].series.length,8);assert.equal(new Set(repeated.groups[0].series.map(s=>s.id)).size,8,'reimport preserves independent IDs');
assert.throws(()=>imp.appendCvFilesToSample([],imported.items,''),/有效面积/);
assert.throws(()=>imp.appendCvFilesToSample([],imported.items.map(item=>({...item,pair:{...item.pair,current:item.pair.e}}))),/不能相同/);
const samples=[sample],analysis=math.analyzeCv(samples,settings);
assert.equal(analysis.groups[0].error,undefined);near(analysis.groups[0].alpha,alpha,1e-10);near(analysis.groups[0].ksGeomean,targetKs,1e-10);assert.equal(analysis.groups[0].ksCount,4);
for(const row of analysis.groups[0].rows){near(row.epa,theory(row.rate).epa);near(row.epc,theory(row.rate).epc);near(row.ks,targetKs,1e-10);}
const snapshot=JSON.stringify(samples),tables=exp.cvTables(samples,settings,analysis),xlsx=exp.cvXlsx(tables),zip=unzipSync(xlsx);
assert.equal(tables.find(t=>t.name==='FitPoints').rows.length,4);assert.equal(tables.filter(t=>t.name.startsWith('Raw')).length,4);assert.equal(tables.find(t=>t.name==='FittedValues').headers.length,5);assert.ok(tables.find(t=>t.name==='FittedValues').rows.every(r=>r.length===5));
const rawCount=tables.filter(t=>t.name.startsWith('Raw')).reduce((sum,t)=>sum+t.rows.length,0);assert.equal(rawCount,sample.series.reduce((n,s)=>n+s.points.length,0));
assert.ok(strFromU8(zip['xl/worksheets/sheet1.xml']).includes('<v>20</v>'));assert.ok(!Object.values(zip).some(bytes=>strFromU8(bytes).includes('<f>')));assert.ok(exp.cvCsv({name:'t',label:'t',headers:['name'],rows:[['=SUM(A1)']]}).includes("'=SUM(A1)"));
assert.equal(JSON.stringify(samples),snapshot,'export leaves original points and settings intact');
await fs.writeFile(path.join(out,'synthetic-origin-data.xlsx'),xlsx);await fs.writeFile(path.join(out,'synthetic-peak-ks.csv'),exp.cvCsv(tables[0]));await fs.writeFile(path.join(out,'synthetic-plot.csv'),exp.cvCsv(tables.find(t=>t.name==='FittedValues')));
const doc=await import(await moduleUrl('lib/project-document.ts'));
const states={'cv.groups':samples,'cv.settings':settings,'cv.activeGroup':sample.id,'shell.tab':'cv'};
for(const [key,value] of Object.entries(states))doc.validateStateShape(key,value,value);
const project={schema:'electrocatalysis-project/v1',application:'Scientific Plot Studio',version:'0.6.0',name:'Synthetic CV QA',savedAt:new Date().toISOString(),states};
assert.deepEqual(doc.decodeProject(doc.encodeProject(project)).states,states);
const summary={ok:true,fixture:'analytical Laviron traces',checks:'formula, scan direction, cycle identity, gaps, boundaries, shoulder, duplicate rates, 150k-point branch, text import, repeated import, raw CSV/XLSX export and project roundtrip',rawRows:rawCount,stressMS:Date.now()-started,samples:analysis.groups.map(g=>({name:g.group.name,alpha:g.alpha,ksGeomean:g.ksGeomean,ksCount:g.ksCount}))};
await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
