import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Load the actual TypeScript modules without adding a separate test runtime.
const modules={};
for(const name of ['lsv-math','scan-branches','lsv-target']){
  const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  code=code.replace(/(from\s*["'])\.\/([^"']+)(["'])/g,(_,start,dependency,end)=>{
    if(!modules[dependency])throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name]=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {plotCurves,INITIAL_X,INITIAL_Y}=await import(modules['lsv-math']);
const {readTarget}=await import(modules['lsv-target']);
const settings={smoothPoints:3,prominence:1};
const base={id:'fixture',name:'synthetic',color:'#2374d5',visible:true,unit:'A',resistance:'',irVoltage:'0',area:'1',compensation:'raw',source:'synthetic'};
function plot(points,patch={},x=INITIAL_X,y=INITIAL_Y){
  return plotCurves([{...base,points,...patch}],{x,y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves[0];
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,`Expected ${expected}, received ${actual}`);}

// An oxidation peak crosses 10 early, followed by an OER crossing halfway between
// E=.4700 (8 mA) and E=.4817 (12 mA): raw E=.47585 V. With IR=.97,
// B1=.010 A, so X=.47585-.97*.010+.059*13.65+.197=1.46850 V.
// The overpotential is (1.46850-1.23)*1000=238.5 mV; plotted X is unchanged.
const points=[[.2,0],[.25,5],[.3,20],[.35,22],[.4,5],[.45,6],[.47,8],[.4817,12],[.5,20],[.55,30]].map(([e,j])=>({e,current:j/1000}));
const uncorrected=readTarget(plot(points),'up',settings);
const corrected=readTarget(plot(points,{irVoltage:'.97'}),'up',settings);
assert.equal(corrected.status,'forward_postpeak');
assert.ok(corrected.firstCrossing<corrected.e);
near(corrected.e,.47585);near(corrected.x,1.4685);near(corrected.etaMV,238.5);
near(uncorrected.x,1.4782);near(uncorrected.etaMV,248.2);near(uncorrected.etaMV-corrected.etaMV,9.7);
near(corrected.e,uncorrected.e);
near(readTarget(plot(points,{irVoltage:'-.1'}),'up',settings).etaMV,249.2);
// Read the actual plotted X, subtract 1.23 V once, and do not repeat the IR correction.
const belowEquilibrium=readTarget(plot(points,{irVoltage:'.97'},'第一列 - iR * B1'),'up',settings);
near(belowEquilibrium.x,.46615);near(belowEquilibrium.etaMV,-763.85);
assert.match(belowEquilibrium.note,/过电位为负/);
assert.doesNotMatch(belowEquilibrium.note,/横坐标为负/);
near(readTarget(plot(points,{},'1.23'),'up',settings).etaMV,0);
near(readTarget(plot(points,{},'1.48'),'up',settings).etaMV,250);
// The new formula multiplies each raw, signed B1 value, rather than a fixed .86.
const rawColumn=plot([{e:.4,current:.002},{e:.4,current:.003},{e:.4,current:-.002}],{irVoltage:'.97'});
near(rawColumn.plotted[0].x,1.40041);near(rawColumn.plotted[0].y,2);
near(rawColumn.plotted[1].x,1.39944);near(rawColumn.plotted[1].y,3);
near(rawColumn.plotted[2].x,1.40429);near(rawColumn.plotted[2].y,-2);
// Unit metadata must not silently replace raw B1 or the literal second-column Y.
const rawMilliamp=plot([{e:.4,current:2}],{irVoltage:'.97',unit:'mA'});
near(rawMilliamp.plotted[0].x,-.53765);near(rawMilliamp.plotted[0].y,2000);

const series=values=>values.map((j,i)=>({e:.2+i*.02,current:j/1000}));
assert.equal(readTarget(plot(series([0,5,12,20,14,11,15,25])),'up',settings).status,'no_postpeak_target_crossing');
assert.equal(readTarget(plot(series([0,5,8])),'up',settings).etaMV,undefined);
// Read the visible Y, never a second series recomputed from area/unit metadata.
for(const area of ['', '.5', '2']) near(readTarget(plot(points,{area}),'up',settings).etaMV,uncorrected.etaMV);
for(const unit of ['mA','A/cm2','mA/cm2']) near(readTarget(plot(points,{unit}),'up',settings).etaMV,uncorrected.etaMV);
near(readTarget(plot(series([0,5,15]),{area:'2'}),'up',settings).etaMV,2.35);
const densityPoints=[[.2,5],[.3,15]].map(([e,current])=>({e,current}));
assert.equal(readTarget(plot(densityPoints,{unit:'mA/cm2',area:'1'}),'up',settings).etaMV,undefined);
near(readTarget(plot(densityPoints,{unit:'mA/cm2',area:'1'},INITIAL_X,'j'),'up',settings).etaMV,22.35);
assert.equal(readTarget(plot(series([0,5,15]),{area:'2'},INITIAL_X,'j'),'up',settings).etaMV,undefined);
const lateOerPeak=series([0,6,15,20,8,5,12,30,80,300,350,250,220,400,500]);
const lateReading=readTarget(plot(lateOerPeak),'up',settings);
assert.equal(lateReading.status,'forward_postpeak');near(lateReading.e,.2+5.714285714285714*.02);
const gap=plot(points);gap.plotted[6]=null;
assert.equal(readTarget(gap,'up',settings).etaMV,undefined);
assert.equal(readTarget(plot(series([-1,-5,-12])),'up',settings).etaMV,undefined);
const cyclic=[[.2,0],[.22,5],[.24,15],[.26,20],[.24,15],[.22,5],[.2,0]].map(([e,j])=>({e,current:j/1000}));
const reverse=readTarget(plot(cyclic,{irVoltage:'.01'}),'down',settings);
assert.equal(reverse.status,'reverse_crossing');near(reverse.e,.23);near(reverse.x,1.23225);near(reverse.etaMV,2.25);
assert.equal(readTarget(plot([...cyclic,...cyclic.slice(1)]),'up',settings).status,'multiple_scans');
assert.equal(readTarget(plot(points),'all',settings).etaMV,uncorrected.etaMV);
assert.equal(readTarget(plot(points,{irVoltage:'.97',compensation:'corrected'}),'up',settings).status,'invalid_curve');
for(const [n,path] of process.argv.slice(2).entries()){
  const source=await readFile(path,'utf8');
  const actual=source.split(/\r?\n/).map(line=>line.trim().split(/[,\t ]+/).map(Number)).filter(row=>row.length>=2&&row.every(Number.isFinite)).map(([e,current])=>({e,current}));
  assert.equal(actual.length,2000);
  const first=readTarget(plot(actual),'up',settings);
  assert.equal(first.status,'forward_postpeak');assert.ok(first.etaMV>0);
  for(const area of ['.5','2'])near(readTarget(plot(actual,{area}),'up',settings).etaMV,first.etaMV);
  if(n===0)near(first.x,1.4169693773680598);
  if(n===1)assert.ok(Math.abs(first.x-1.40599)<.00001);
  console.log(`Actual LSV: X@Y10=${first.x}, eta10=${first.etaMV} mV; area metadata leaves displayed-coordinate reading unchanged.`);
}
console.log('LSV target verification passed: actual plotted Y=10, eta=(X-1.23 V)*1000, single IR correction, signed eta, post-peak selection, late OER noise, area/unit invariance, formula Y, gaps, scans, and compensation.');
