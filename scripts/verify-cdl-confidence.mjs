import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url), modules={
  react:pathToFileURL(require.resolve('react')).href,
  'react/jsx-runtime':pathToFileURL(require.resolve('react/jsx-runtime')).href,
};
for(const [name,file] of [
  ['tafel-auto','../lib/tafel-auto.ts'],
  ['cdl-confidence','../lib/cdl-confidence.ts'],
  ['plot-ticks','../lib/plot-ticks.ts'],
  ['cdl-fit-figure','../components/cdl-fit-figure.tsx'],
]){
  let code=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  code=code.replace(/(from\s*["'])([^"']+)(["'])/g,(_,start,dependency,end)=>{
    const name=dependency.startsWith('.')?dependency.split('/').at(-1):dependency;
    assert.ok(modules[name],`Unexpected dependency ${dependency}`);
    return `${start}${modules[name]}${end}`;
  });
  modules[name]=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const {cdlMeanConfidenceBand}=await import(modules['cdl-confidence']);
const {default:CdlFitFigure}=await import(modules['cdl-fit-figure']);
const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);

// Independent OLS arithmetic and tabulated critical values: central 95%, df=3/4.
const points=[0,100,200,300,400].map((rateMV,index)=>({rateMV,y:[.2,2.3,3.9,6.2,7.9][index]}));
const snapshot=structuredClone(points), n=points.length, xbar=200;
const ybar=points.reduce((sum,point)=>sum+point.y,0)/n;
const centeredXX=100000;
const slopeMV=points.reduce((sum,point)=>sum+(point.rateMV-xbar)*(point.y-ybar),0)/centeredXX;
const intercept=ybar-slopeMV*xbar;
const sse=points.reduce((sum,point)=>sum+(point.y-slopeMV*point.rateMV-intercept)**2,0);
const df=n-2, t95df3=3.182446305284263;
const band=cdlMeanConfidenceBand(points,slopeMV*1000,intercept,false);
assert.equal(band.level,.95);assert.equal(band.dof,3);assert.equal(band.n,5);assert.equal(band.throughOrigin,false);
for(const point of band.points){
  const prediction=slopeMV*point.rate+intercept;
  const margin=t95df3*Math.sqrt(sse/df*(1/n+(point.rate-xbar)**2/centeredXX));
  near(point.low,prediction-margin);near(point.high,prediction+margin);
}
const rawXX=300000;
const originSlopeMV=points.reduce((sum,point)=>sum+point.rateMV*point.y,0)/rawXX;
const originSSE=points.reduce((sum,point)=>sum+(point.y-originSlopeMV*point.rateMV)**2,0);
const originBand=cdlMeanConfidenceBand(points,originSlopeMV*1000,0,true);
const t95df4=2.7764451051977987;
assert.equal(originBand.dof,4);assert.equal(originBand.throughOrigin,true);
for(const point of originBand.points){
  const prediction=originSlopeMV*point.rate;
  const margin=t95df4*Math.sqrt(originSSE/(n-1)*point.rate**2/rawXX);
  near(point.low,prediction-margin);near(point.high,prediction+margin);
}
near(originBand.points[0].low,0);near(originBand.points[0].high,0);
assert.notEqual(band.points.at(-1).high,originBand.points.at(-1).high);

// Excluded/invalid points neither enter residuals nor change degrees of freedom.
const extended=[...points,{rateMV:500,y:9999,included:false},{rateMV:NaN,y:1},{rateMV:20,y:Infinity}];
assert.deepEqual(cdlMeanConfidenceBand(extended,slopeMV*1000,intercept,false),band);
assert.deepEqual(points,snapshot);
assert.equal(cdlMeanConfidenceBand(points,slopeMV*1000,intercept,undefined),null,'aggregate curves must not fabricate OLS covariance');
assert.equal(cdlMeanConfidenceBand(points.slice(0,2),slopeMV*1000,intercept,false),null);
assert.equal(cdlMeanConfidenceBand(points,slopeMV*1000,1,true),null,'origin model requires intercept0');

// Render the actual export SVG and compare its polygon with the numeric band.
const row={id:'electrode',name:'Independent electrode',color:'#2374d5',points,slope:slopeMV*1000,intercept,throughOrigin:false};
const render=rows=>renderToStaticMarkup(React.createElement(CdlFitFigure,{rows,half:true,density:false,width:760,height:500}));
const svg=render([row]);
const bandTag=svg.match(/<path[^>]*data-cdl-confidence-band="electrode"[^>]*>/)?.[0];
assert.ok(bandTag);assert.match(bandTag,/data-confidence-level="0.95"/);assert.match(bandTag,/data-confidence-dof="3"/);assert.match(bandTag,/data-confidence-model="intercept"/);
const attr=name=>Number(new RegExp(`${name}="([^"]+)"`).exec(svg)?.[1]);
const first=band.points[0];
const upperXY=/d="M([-\d.]+),([-\d.]+)/.exec(bandTag);
// Explicit viewport margins from the public 760x500 SVG layout.
const sx=rate=>96+(rate-attr('data-x-min'))/(attr('data-x-max')-attr('data-x-min'))*(760-96-29);
const sy=value=>57+(attr('data-y-max')-value)/(attr('data-y-max')-attr('data-y-min'))*(500-57-88);
assert.ok(Math.abs(+upperXY[1]-sx(first.rate))<=.005);assert.ok(Math.abs(+upperXY[2]-sy(first.high))<=.005);
assert.ok(attr('data-y-min')<=Math.min(...band.points.map(point=>point.low)));
assert.ok(attr('data-y-max')>=Math.max(...band.points.map(point=>point.high)));
assert.match(svg,/不是预测带/);assert.match(svg,/不是电极间 SD/);
const zeroSVG=render([{...row,slope:originSlopeMV*1000,intercept:0,throughOrigin:true}]);
assert.match(zeroSVG,/data-confidence-dof="4"/);assert.match(zeroSVG,/data-confidence-model="through-origin"/);
const aggregateSVG=render([{...row,throughOrigin:undefined,points:points.map(point=>({...point,sd:.5}))}]);
assert.ok(!aggregateSVG.includes('data-cdl-confidence-band='));assert.equal((aggregateSVG.match(/data-cdl-errorbar="true"/g)??[]).length,5);
const excludedSVG=render([{...row,points:[...points,{rateMV:500,y:50,sd:10,included:false}]}]);
assert.equal((excludedSVG.match(/data-cdl-errorbar="true"/g)??[]).length,0);
console.log('PASS: independent central95% Student-t numeric bands for intercept(df=n-2) and origin(df=n-1), unit conversion and excluded rows; actual export SVG polygon/model/level agree; replicate SD remains separate and aggregates do not fabricate OLS bands.');
