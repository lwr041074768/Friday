import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const require=createRequire(import.meta.url),modules={fflate:pathToFileURL(require.resolve('fflate')).href};
for(const name of ['lsv-math','chi-lsv-bin','chi-eis-bin','xrd-mdi','lsv-import','raman-data']) {
  const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g,(_,a,dep,b)=>{assert.ok(modules[dep],dep);return a+modules[dep]+b;});
  modules[name]=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {parseText,parseDataFile,rawPairs}=await import(modules['lsv-import']);
const {makeRamanCurve,ramanIdentity,ramanLines,ramanGrid,ramanContourPaths,ramanCsv}=await import(modules['raman-data']);
const root=process.argv[2],out=path.resolve('../output/raman-qa');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const curves=[],summary=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){await walk(file);continue;}if(!/\.txt$/i.test(entry.name))continue;
  const source=path.relative(root,file).replace(/\\/g,'/'),text=await readFile(file,'utf8');
  const [table]=await parseDataFile(new File([text],entry.name),'raman');table.source=source;
  const pairs=rawPairs(table,'raman');assert.equal(table.headers.length,6);assert.equal(table.rows.length,2048);assert.equal(pairs.length,1);assert.equal(pairs[0].e,1);assert.equal(pairs[0].current,5);
  const identity=ramanIdentity(table.name,source),curve=makeRamanCurve(table,pairs[0],identity.group,identity.potential,'#2374d5');
  assert.equal(curve.points.length,2048);near(curve.points[0].e,195.0149);near(curve.points.at(-1).e,3754.2133);
  const raw=text.trim().split(/\r?\n/).slice(15).map(line=>line.split(';').map(Number));
  curve.points.forEach((p,i)=>{assert.equal(p.e,raw[i][1]);assert.equal(p.current,raw[i][5]);});
  assert.ok(table.metadata['扫描时间']);assert.ok(table.metadata['积分时间(ms)']);
  curves.push(curve);summary.push({source,...identity,rows:curve.points.length,x:curve.xColumn,y:curve.yColumn,metadata:curve.metadata});
}}
if(root){await walk(root);assert.equal(curves.length,49);assert.equal(curves.reduce((s,c)=>s+c.points.length,0),100352);
  const groups=Array.from(new Set(curves.map(c=>c.group)));assert.equal(groups.length,4);
  for(const group of groups){const selected=curves.filter(c=>c.group===group);const grid=ramanGrid(selected,false,'sequence');assert.equal(grid.error,undefined);assert.equal(grid.y.length,selected.length);assert.ok(ramanContourPaths(grid,24).some(p=>p.length>100));
    const potential=ramanGrid(selected,false,'potential');if(group==='5%Se')assert.match(potential.error,/重复测量/);else {assert.equal(potential.error,undefined);assert.deepEqual(potential.y,[.1,.2,.3,.35,.4,.45,.5,.55,.6]);}
  }
  await mkdir(out,{recursive:true});await writeFile(path.join(out,'real-data-summary.json'),JSON.stringify(summary,null,2));
}
assert.equal(ramanIdentity('spectrum-035.txt','spectrum-035.txt').potential,'0.35');
assert.equal(ramanIdentity('spectrum-0.35','spectrum-0.35.txt').potential,'0.35');
assert.equal(ramanIdentity('CoFe2O4-p-wet-2','p/CoFe2O4-p-wet-2.txt').potential,'');
assert.equal(ramanIdentity('CoFe2O4-06-2','5%Se/CoFe2O4-06-2.txt').potential,'0.6');
const basic=parseText('Raman Shift;Intensity\n100;-2\n150;4\n200;8','fixture','fixture.csv','raman');
assert.deepEqual(rawPairs(basic,'raman').map(p=>[p.e,p.current]),[[0,1]]);
const pair=rawPairs(basic,'raman')[0],a=makeRamanCurve(basic,pair,'A','.1','#000'),b={...a,id:'second',potential:'.4',points:[{e:100,current:2},{e:200,current:12}]};
assert.equal(ramanGrid([a,b],false,'potential').error,undefined);assert.deepEqual(ramanGrid([a,b],false,'potential').y,[.1,.4]);
assert.equal(ramanGrid([a,{...b,group:'B'}],false,'sequence').x.length,0);
assert.match(ramanGrid([a,{...b,potential:'.1'}],false,'potential').error,/重复/);
assert.match(ramanGrid([a,{...b,potential:''}],false,'potential').error,/至少两条/);
const descending={...a,points:[...a.points].reverse(),potential:'.2'};
const ascending=ramanGrid([a,descending],false,'potential');assert.equal(ascending.error,undefined);near(ascending.values[0][0],-2);near(ascending.values[1][0],-2);
const normalized=ramanLines([a,{...b,visible:false},descending],true,true,1.2);near(normalized[0].plotted[0].y,-.25);near(normalized[2].plotted[0].y,2.2);assert.equal(a.points[0].current,-2);
const gaps={...a,points:[{e:100,current:1},{e:NaN,current:NaN},{e:200,current:3}]};assert.ok(Number.isNaN(ramanGrid([gaps,b],false,'sequence').values[0][1]));
assert.equal(ramanLines([gaps],false,false,0)[0].plotted[1],null);
assert.match(ramanGrid([a,{...b,points:[{e:300,current:1},{e:400,current:2}]}],false,'sequence').error,/共同/);
const flat=ramanGrid([a,b].map(c=>({...c,points:c.points.map(p=>({...p,current:3}))})),false,'sequence');assert.ok(ramanContourPaths(flat,12)[0].length);
assert.throws(()=>makeRamanCurve({...basic,headers:['Pixel','Intensity']},pair,'A','','#000'),/像素/);
const csv=ramanCsv([{...a,name:'=1+1'},{...b,visible:false,points:b.points.slice(0,1)}],false,true,500);assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/'=1\+1/);assert.equal(csv.split('\r\n').length,5);assert.match(csv,/,-2,-2,/);
// Existing profiles must keep their coordinate semantics.
const eis=parseText('Zreal/Ω,Zimag/Ω\n1,.2\n2,-.3','eis','eis.csv','eis');assert.deepEqual(rawPairs(eis,'eis').map(p=>[p.e,p.current]),[[0,1]]);
const xrd=parseText('2theta,Intensity\n20,50\n21,100','xrd','xrd.csv','xrd');assert.equal(rawPairs(xrd,'xrd').length,1);
console.log(JSON.stringify({passed:true,realFiles:curves.length,realPoints:curves.reduce((s,c)=>s+c.points.length,0),groups:[...new Set(curves.map(c=>c.group))],checks:'Optosky columns and all values, grouping, potential suggestions, duplicate potentials, interpolation, gaps, normalization, raw-data export, EIS/XRD regression'}));
