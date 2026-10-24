import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url),modules={fflate:pathToFileURL(require.resolve('fflate')).href};
for(const name of ['lsv-math','chi-lsv-bin','chi-eis-bin','xrd-mdi','lsv-import','eis-data','raman-data']){
 const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/(from\s*["'])(?:\.\/)?([^"']+)(["'])/g,(_,a,dep,b)=>{assert.ok(modules[dep],dep);return a+modules[dep]+b;});modules[name]=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {parseText,pointsFor,rawPairs,rawPointsFor}=await import(modules['lsv-import']);const {plotCurves}=await import(modules['lsv-math']);const {plotEisCurves}=await import(modules['eis-data']);const {ramanCsv,makeRamanCurve}=await import(modules['raman-data']);
const table=parseText('Potential/V,Current/A\n.1,.001\n.2,.002\n\n.3,NaN\n.4,.004\n\n\nNotes,end','fixture');assert.equal(table.rows.length,5);const data=pointsFor(table,{e:0,current:1,name:'sample',unit:'A'});assert.equal(data.points.length,5);assert.equal(data.skipped,2);assert.ok(Number.isNaN(data.points[2].e));assert.ok(Number.isNaN(data.points[3].current));
const base={id:'a',name:'A',source:'fixture',unit:'A',color:'#2374d5',visible:true,area:'1',resistance:'0',compensation:'raw',points:data.points};const line=plotCurves([base],{x:'E',y:'I',resistance:'0',voltage:'0',fraction:'100',irMode:'voltage'}).curves[0];assert.equal(line.plotted[2],null);assert.equal(line.plotted[3],null);assert.equal(line.plotted[4].y,.004);
const spectrum=parseText('Raman Shift;Intensity\n100;1\n110;2\n\n120;4\n','R','R.txt','raman');assert.equal(spectrum.rows.length,4);const xy=rawPointsFor(spectrum,rawPairs(spectrum,'raman')[0]);assert.equal(xy.points.length,4);assert.ok(Number.isNaN(xy.points[2].e));
const eis=plotEisCurves([{...base,points:xy.points}])[0];assert.equal(eis.plotted[2],null);assert.equal(eis.plotted[3].y,-4);
const r=makeRamanCurve(spectrum,rawPairs(spectrum,'raman')[0],'group','','#2374d5');assert.ok(ramanCsv([{...r,name:' \t=1+1'}],false,false,0).includes("' \t=1+1"));
console.log('PASS: interior blank and NaN rows survive import, terminal blanks/footers do not add rows, LSV/EIS gaps break lines, Raman whitespace-prefixed spreadsheet text is neutralized.');
