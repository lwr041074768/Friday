import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Exercise the production modules, without installing a separate test runtime.
const modules={};
for(const name of ['lsv-math','scan-branches','lsv-target','overpotential-data']){
  const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  code=code.replace(/(from\s*["'])\.\/([^"']+)(["'])/g,(_,start,dependency,end)=>{
    if(!modules[dependency])throw new Error(`Unexpected dependency: ${dependency}`);
    return `${start}${modules[dependency]}${end}`;
  });
  modules[name]=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {plotCurves,INITIAL_X,INITIAL_Y,COLORS}=await import(modules['lsv-math']);
const {readTarget}=await import(modules['lsv-target']);
const {buildOverpotentialRows,DEFAULT_OVERPOTENTIAL_SNAPSHOT,OVERPOTENTIAL_TARGET_SETTINGS}=await import(modules['overpotential-data']);
const base={id:'fixture',name:'synthetic',color:COLORS[0],visible:true,unit:'A',resistance:'',irVoltage:'0',area:'1',compensation:'raw',source:'synthetic'};
const points=[[.2,0],[.25,5],[.3,20],[.35,22],[.4,5],[.45,6],[.47,8],[.4817,12],[.5,20],[.55,30]].map(([e,j])=>({e,current:j/1000}));
const curve=(patch={})=>({...base,points,...patch});
const snapshot=(curves,scan='up',x=INITIAL_X,y=INITIAL_Y,demo=false)=>({curves:plotCurves(curves,{x,y,resistance:'0',fraction:'100',irMode:'voltage',voltage:'0'}).curves,scan,demo});
function near(actual,expected,message){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<1e-8,message??`Expected ${expected}, received ${actual}`);}
function readingsMatchLsv(current){
  const rows=buildOverpotentialRows(current);
  assert.deepEqual(rows.map(row=>row.reading),current.curves.map(item=>readTarget(item,current.scan,OVERPOTENTIAL_TARGET_SETTINGS)),'Overpotential page and LSV summary must use the same current plotted X/Y, scan and target settings');
  return rows;
}

assert.deepEqual(buildOverpotentialRows(DEFAULT_OVERPOTENTIAL_SNAPSHOT),[],'Opening an empty session must not invent sample results');

// Ten imports include a hidden curve and duplicate display names: stable IDs,
// original order, colors and source provenance must survive aggregation.
const samples=Array.from({length:10},(_,index)=>curve({
  id:`sample-${index}`,name:index<2?'重名样品':`样品 ${index+1}`,color:COLORS[index],visible:index!==4,
  source:`batch-20261013/sample-${index+1}.txt`,
  points:points.map(point=>({...point,e:point.e+index*.005})),
}));
const original=snapshot(samples),rows=readingsMatchLsv(original);
assert.equal(rows.length,10);
assert.deepEqual(rows.map(row=>row.curve.id),samples.map(item=>item.id));
assert.deepEqual(rows.map(row=>row.curve.name),samples.map(item=>item.name));
assert.deepEqual(rows.map(row=>row.curve.color),samples.map(item=>item.color));
assert.deepEqual(rows.map(row=>row.curve.source),samples.map(item=>item.source));
assert.equal(rows[4].curve.visible,false,'Hiding an LSV line must not delete its summary result');
for(let index=0;index<rows.length;index++)near(rows[index].reading.etaMV,248.2+index*5);

// A new LSV snapshot is the sole source of truth; edits, removal and restoration
// must neither retain deleted results nor rename an earlier saved snapshot.
const renamed=samples.map(item=>item.id==='sample-4'?{...item,name:'Se/Te-CoFe₂O₄, 复测',color:'#a024cc'}:item);
const renamedRows=buildOverpotentialRows(snapshot(renamed));
assert.equal(renamedRows[4].curve.name,'Se/Te-CoFe₂O₄, 复测');
assert.equal(renamedRows[4].curve.color,'#a024cc');
near(renamedRows[4].reading.etaMV,rows[4].reading.etaMV);
assert.equal(rows[4].curve.name,'样品 5','An updated session must not mutate earlier snapshots');
const afterDelete=buildOverpotentialRows(snapshot(renamed.filter(item=>item.id!=='sample-4')));
assert.equal(afterDelete.length,9);
assert.ok(afterDelete.every(row=>row.curve.id!=='sample-4'));
assert.deepEqual(buildOverpotentialRows(snapshot(renamed)),renamedRows,'Undo restores the current LSV curves, without a second result store');
const replotted=snapshot(renamed,'up','第一列 + 1.1');
const replottedRows=readingsMatchLsv(replotted);
near(replottedRows[0].reading.etaMV,345.85,'Read the current chart X, including formula edits');
near(rows[0].reading.etaMV,248.2);

// Independent known answer: E@10=.47585 V, after the oxidation peak. Entered
// IR=.97 changes chart X by -.0097 V at Y=10, giving η10=238.5 mV.
const corrected=snapshot([curve({id:'ir',irVoltage:'.97'})]);
const beforeReading=JSON.stringify(corrected);
const correctedRow=readingsMatchLsv(corrected)[0];
assert.equal(correctedRow.reading.status,'forward_postpeak');
near(correctedRow.reading.e,.47585);
near(correctedRow.reading.x,1.4685);
near(correctedRow.reading.etaMV,238.5);
near(buildOverpotentialRows(corrected)[0].reading.etaMV,238.5,'Repeated rendering must not compound IR or 1.23 V subtraction');
assert.equal(JSON.stringify(corrected),beforeReading,'Reading η must not mutate raw points, current chart points or applied IR');
for(const [irVoltage,expected] of [['0',248.2],['.97',238.5],['-1',258.2]]) {
  const current=snapshot([curve({irVoltage})]);
  near(readingsMatchLsv(current)[0].reading.etaMV,expected,`η must follow applied IR ${irVoltage}`);
}
const invalidIr=readingsMatchLsv(snapshot([curve({irVoltage:'invalid'})]))[0];
assert.equal(invalidIr.reading.status,'invalid_curve');
assert.equal(invalidIr.reading.etaMV,undefined);

// Changing scan direction must re-read each sample, including reverse-only and
// absent-direction cases. "all" uses exactly the same target convention as LSV.
const cyclic=[[.2,0],[.22,5],[.24,15],[.26,20],[.24,15],[.22,5],[.2,0]].map(([e,j])=>({e,current:j/1000}));
const scanSamples=[curve({id:'cyclic',points:cyclic,irVoltage:'.01'}),curve({id:'forward-only'}),curve({id:'reverse-only',points:[...points].reverse()}),curve({id:'constant-e',points:[{e:.4,current:0},{e:.4,current:.02}]})];
for(const scan of ['all','up','down'])readingsMatchLsv(snapshot(scanSamples,scan));
const upRows=buildOverpotentialRows(snapshot(scanSamples,'up'));
const downRows=buildOverpotentialRows(snapshot(scanSamples,'down'));
near(downRows[0].reading.etaMV,2.25);
assert.equal(downRows[0].reading.status,'reverse_crossing');
assert.equal(downRows[1].reading.status,'no_scan');
assert.equal(downRows[1].reading.etaMV,undefined);
assert.equal(upRows[2].reading.status,'no_scan');
assert.equal(upRows[2].reading.etaMV,undefined);
assert.equal(upRows[3].reading.status,'no_scan');
assert.equal(upRows[3].reading.etaMV,undefined);
assert.deepEqual(buildOverpotentialRows(snapshot(scanSamples,'all')).map(row=>row.reading),upRows.map(row=>row.reading));
for(const scan of ['all','up','down'])for(const irVoltage of ['.97','-1']) {
  const changed=scanSamples.map(item=>({...item,irVoltage}));
  const changedRows=readingsMatchLsv(snapshot(changed,scan));
  const baselineRows=readingsMatchLsv(snapshot(scanSamples.map(item=>({...item,irVoltage:'0'})),scan));
  changedRows.forEach((row,index)=>{
    const baseline=baselineRows[index].reading;
    assert.equal(row.reading.status,baseline.status);
    assert.equal(row.reading.e,baseline.e,'IR must not move the raw-potential source crossing');
    if(baseline.etaMV===undefined)assert.equal(row.reading.etaMV,undefined);
    else{
      near(row.reading.etaMV,baseline.etaMV-Number(irVoltage)*10,'Every selected scan uses its applied chart IR exactly once');
      near(row.reading.x,baseline.x-Number(irVoltage)*.01);
    }
  });
}

// Missing crossings and invalid source data remain identifiable rows. A source
// already compensated by the instrument cannot accept additional software IR;
// an invalid chart has no available η10.
const lowPoints=[{e:.2,current:0},{e:.3,current:.005},{e:.4,current:.008}];
const gapPoints=points.map((point,index)=>index===6?{...point,current:NaN}:point);
const unavailable=snapshot([curve({id:'below-target',points:lowPoints}),curve({id:'already-corrected',irVoltage:'.97',compensation:'corrected'}),curve({id:'gap',points:gapPoints}),curve({id:'invalid-area',area:'-1'})]);
const unavailableRows=readingsMatchLsv(unavailable);
assert.equal(unavailableRows.length,4);
assert.deepEqual(unavailableRows.map(row=>row.reading.status),['no_target_crossing','invalid_curve','peak_detection_gap','invalid_curve']);
assert.equal(unavailableRows[0].reading.etaMV,undefined);
assert.equal(unavailableRows[1].reading.etaMV,undefined);
assert.match(unavailableRows[1].reading.note,/原数据已补偿.*避免重复补偿/);
near(readingsMatchLsv(snapshot([curve({compensation:'corrected',irVoltage:'0'})]))[0].reading.etaMV,248.2,'An already-compensated source remains readable with software IR=0');
assert.equal(unavailableRows[2].reading.etaMV,undefined);
assert.equal(unavailableRows[3].reading.etaMV,undefined);
const negative=readingsMatchLsv(snapshot([curve({irVoltage:'.97',points:points.map(point=>({...point,e:point.e-.4}))})]))[0];
near(negative.reading.etaMV,-161.5);
assert.match(negative.reading.note,/过电位为负/);
assert.equal(readingsMatchLsv(snapshot([curve({compensation:'unknown'})]))[0].reading.etaMV,rows[0].reading.etaMV);
assert.equal(readingsMatchLsv(snapshot([curve({compensation:'unknown'})]))[0].curve.compensation,'unknown');
const demoSnapshot=snapshot([curve({id:'demo-fixture',name:'模拟样品',demo:true,source:'模拟数据 · 用于体验操作'})],'up',INITIAL_X,INITIAL_Y,true);
const demoRow=readingsMatchLsv(demoSnapshot)[0];
assert.equal(demoSnapshot.demo,true);
assert.equal(demoRow.curve.demo,true);
assert.equal(demoRow.curve.source,'模拟数据 · 用于体验操作');
near(demoRow.reading.etaMV,248.2);

console.log('PASS: ten ordered/hidden LSV samples, rename/delete/undo, source/demo provenance, live η10 for positive/negative IR and formula edits, invalid IR, immutable source/chart data, forward/reverse chart crossings, compensation errors, gaps/invalid area and signed/missing readings.');
