import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/plot-ticks.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {axisTicks,formatTick,DEFAULT_TICKS,axisScale,axisValueAllowed,tickLabel,transformAxisValue,untransformAxisValue}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
assert.deepEqual(axisTicks(.2,1.2,{step:1,anchor:0,minorCount:1}),{major:[1],minor:[.5],step:1});
assert.deepEqual(axisTicks(-1.1,1.2,{step:.5,anchor:0,minorCount:1}).major,[-1,-.5,0,.5,1]);
assert.deepEqual(axisTicks(-1.1,1.2,{step:.5,anchor:0,minorCount:1}).minor,[-.75,-.25,.25,.75]);
const anchored=axisTicks(-.4,1.1,{step:.5,anchor:.1,minorCount:1});
assert.deepEqual(anchored.major.map(v=>formatTick(v,.5)),['-0.4','0.1','0.6','1.1']);
assert.equal(axisTicks(0,1,{step:.2,anchor:0,minorCount:0}).minor.length,0);
assert.equal(axisTicks(0,1,{step:1,anchor:0,minorCount:20}).minor.length,20);
const large=axisTicks(100000,100002,{step:.5,anchor:100000,minorCount:1});
assert.deepEqual(large.major.map(v=>formatTick(v,.5)),['100000','100000.5','100001','100001.5','100002']);
assert.notEqual(formatTick(1e8,.5),formatTick(1e8+.5,.5));
assert.equal(formatTick(-0,.5),'0');
assert.deepEqual(axisTicks(-.05,.05,{step:.1,anchor:.3,minorCount:0}).major,[0]);
assert.throws(()=>axisTicks(-.5,.5,{step:1,anchor:1e15,minorCount:1}),/精度不足/);
assert.throws(()=>axisTicks(-.5,.5,{step:1,anchor:1e14,minorCount:20}),/精度不足/);
assert.deepEqual(axisTicks(1,2,{step:1e16,anchor:0,minorCount:0}).major,[]);
assert.deepEqual(axisTicks(1,2,{step:1e16,anchor:2.1,minorCount:0}).major,[]);
const auto=axisTicks(-2,4,DEFAULT_TICKS.x);assert.ok(auto.major.length>=4&&auto.minor.length>0);
const manual={step:.5,anchor:0,minorCount:1};
assert.equal(axisTicks(-1,1,manual).step,axisTicks(-2,2,manual).step);
for(const settings of [
  {step:0,anchor:0,minorCount:1},{step:-1,anchor:0,minorCount:1},{step:Infinity,anchor:0,minorCount:1},
  {step:1,anchor:NaN,minorCount:1},{step:1,anchor:0,minorCount:1.5},{step:1,anchor:0,minorCount:21},
  {step:1e-7,anchor:0,minorCount:1},{step:1e-100,anchor:0,minorCount:1},{step:.01,anchor:1e100,minorCount:1},
])assert.throws(()=>axisTicks(0,1,settings));
assert.throws(()=>axisTicks(0,Infinity,manual));
// Axis types: linear stays the default, log10 maps data through a decade transform.
assert.equal(axisScale({anchor:0,minorCount:1}),'linear');
assert.equal(axisScale({anchor:0,minorCount:1,scale:'log10'}),'log10');
assert.equal(transformAxisValue('log10',1000),3);
assert.equal(untransformAxisValue('log10',3),1000);
assert.equal(axisValueAllowed('log10',0),false);
assert.equal(axisValueAllowed('log10',.5),true);
const decades=axisTicks(1,1000,{anchor:0,minorCount:1,scale:'log10'});
assert.deepEqual(decades.major,[1,10,100,1000]);
assert.equal(decades.scale,'log10');
assert.deepEqual(decades.minor.filter(v=>v>1&&v<10),[2,3,4,5,6,7,8,9]);
assert.equal(decades.minor.length,24);
assert.deepEqual(axisTicks(1,1000,{anchor:0,minorCount:0,scale:'log10'}).minor,[]);
const wide=axisTicks(.01,100,{anchor:0,minorCount:1,scale:'log10'});
assert.deepEqual(wide.major,[.01,.1,1,10,100]);
assert.deepEqual(wide.major.map(v=>tickLabel(v,wide)),['0.01','0.1','1','10','100']);
assert.equal(tickLabel(1000,decades),'1000');
assert.throws(()=>axisTicks(0,10,{anchor:0,minorCount:1,scale:'log10'}),/大于 0/);
assert.throws(()=>axisTicks(-5,10,{anchor:0,minorCount:1,scale:'log10'}),/大于 0/);
// A range narrower than one decade keeps the data-space labels instead of losing every major tick.
const narrow=axisTicks(20,30,{anchor:0,minorCount:1,scale:'log10'});
assert.equal(narrow.scale,'log10');
assert.ok(narrow.major.length>=4);
assert.ok(narrow.major.every(v=>v>=20&&v<=30));
const narrowLabels=narrow.major.map(v=>tickLabel(v,narrow));
assert.equal(new Set(narrowLabels).size,narrow.major.length);
assert.ok(axisTicks(5,50,{anchor:0,minorCount:1,scale:'log10'}).major.every(v=>v>=5&&v<=50));
console.log('Plot ticks passed: anchored increments, signed ranges, edge minor ticks, 0/1/20 minors, distinct precise labels, zoom and density/numeric limits, linear and log10 axis types, decade and mantissa ticks, narrow-range fallback and non-positive rejection.');
