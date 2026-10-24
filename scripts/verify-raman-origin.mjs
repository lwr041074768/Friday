import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url),modules={fflate:pathToFileURL(require.resolve('fflate')).href};
for(const name of ['lsv-math','chi-lsv-bin','chi-eis-bin','xrd-mdi','lsv-import','raman-data','raman-origin-export']) {
  const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g,(_,a,dep,b)=>{assert.ok(modules[dep],dep);return a+modules[dep]+b;});
  modules[name]=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {buildRamanOriginExport}=await import(modules['raman-origin-export']);
const {parseText,rawPairs}=await import(modules['lsv-import']);
const {makeRamanCurve,ramanIdentity}=await import(modules['raman-data']);
const {validateOriginRequest}=require('../desktop/policy.cjs');
const id='11111111-2222-4333-8444-555555555555';
const base={id:'a',name:'Original',color:'#2374d5',visible:true,unit:'A',resistance:'',area:'',compensation:'unknown',source:'group/source.txt',group:'group',potential:'.35',xColumn:'Raman Shift',yColumn:'BaseLine Subtracted',metadata:{instrument:'ATR3110'},points:[{e:195.0149,current:-2},{e:197.2473,current:4},{e:199.479,current:8}]};
const options={curves:[base,{...base,id:'hidden',visible:false,name:'Hidden',potential:'',points:[{e:201,current:NaN},{e:202,current:1}]},{...base,id:'third',name:'Third'}],mode:'stack',normalize:true,offset:1.2,axis:'sequence',xLabel:'Raman shift / cm⁻¹',intensityLabel:'Normalized intensity / a.u.',xMin:'3000',xMax:'3700'};
const original=JSON.stringify(options),payload=buildRamanOriginExport(options,id);
assert.equal(JSON.stringify(options),original);assert.equal(payload.kind,'raman');assert.equal(payload.samples.length,3);assert.equal(payload.samples[0].rows.length,3);assert.equal(payload.samples[1].rows.length,2);
assert.deepEqual(payload.columns.map(c=>c.role),['x','y','x','y']);assert.deepEqual(payload.columns.map(c=>c.unit),['cm^-1','a.u.','cm^-1','a.u.']);
assert.deepEqual(payload.samples[0].rows[0],[195.0149,-2,195.0149,-.25]);assert.equal(payload.samples[1].visible,false);assert.deepEqual(payload.samples[1].rows[0],[201,null,null,null]);
assert.equal(payload.samples[2].rows[0][3],.95);assert.match(payload.samples[0].note,/ATR3110/);assert.match(payload.samples[0].note,/BaseLine Subtracted/);assert.match(payload.samples[0].note,/0?\.35/);
assert.equal(validateOriginRequest(JSON.stringify(payload)).kind,'raman');
const contour=buildRamanOriginExport({...options,mode:'contour',axis:'potential'},id);assert.equal(contour.settings.offset,0);assert.equal(contour.samples[2].rows[0][3],-.25);assert.match(contour.samples[0].note,/不以显示网格插值替代实测数据/);assert.equal(contour.axes.y,options.intensityLabel);
const eighty=buildRamanOriginExport({...options,curves:Array.from({length:80},(_,n)=>({...base,name:`s${n}`}))},id);assert.equal(eighty.samples.length,80);validateOriginRequest(JSON.stringify(eighty));
assert.throws(()=>buildRamanOriginExport({...options,curves:Array(81).fill(base)},id),/80/);
assert.throws(()=>buildRamanOriginExport({...options,offset:NaN},id),/间距/);
assert.throws(()=>buildRamanOriginExport({...options,curves:[base,{...base,group:'other'}]},id),/数据组/);
assert.throws(()=>buildRamanOriginExport({...options,curves:[{...base,points:Array(500001).fill(base.points[0])}]},id),/500,000/);
assert.throws(()=>validateOriginRequest(JSON.stringify({...eighty,kind:'xrd'})),/10/);
assert.throws(()=>validateOriginRequest(JSON.stringify({...eighty,samples:Array(81).fill(eighty.samples[0])})),/80/);
const root=process.argv[2],output=path.resolve('../output/raman-origin-qa');await mkdir(output,{recursive:true});
const groups=new Map();
if(root) {
  async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory()){await walk(full);continue;}if(!/\.txt$/i.test(entry.name))continue;
    const relative=path.relative(root,full).replace(/\\/g,'/'),name=entry.name.replace(/\.txt$/i,'');const table=parseText(await readFile(full,'utf8'),name,relative,'raman');const identity=ramanIdentity(name,relative);const c=makeRamanCurve(table,rawPairs(table,'raman')[0],identity.group,identity.potential,'#2374d5');if(!groups.has(c.group))groups.set(c.group,[]);groups.get(c.group).push(c);
  }}await walk(root);
  assert.equal([...groups.values()].reduce((n,g)=>n+g.length,0),49);
  for(const [group,curves] of groups){const p=buildRamanOriginExport({...options,curves,normalize:false,mode:'contour'},id);assert.equal(p.samples.reduce((n,s)=>n+s.rows.length,0),curves.length*2048);p.samples.forEach((s,n)=>s.rows.forEach((row,i)=>{assert.equal(row[0],curves[n].points[i].e);assert.equal(row[1],curves[n].points[i].current);assert.equal(row[2],row[0]);assert.equal(row[3],row[1]);}));await writeFile(path.join(output,`${group.replaceAll('/','-')}.json`),JSON.stringify(p));}
}
await writeFile(path.join(output,'fixture.json'),JSON.stringify(payload));await writeFile(path.join(output,'eighty.json'),JSON.stringify(eighty));
console.log(JSON.stringify({passed:true,realFiles:[...groups.values()].reduce((n,g)=>n+g.length,0),checks:'full raw/applied rows, units, gaps, hidden spectra, unequal lengths, no viewport cropping, contour semantics, metadata, 80-spectrum bridge and legacy limits',output}));
