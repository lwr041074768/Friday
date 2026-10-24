import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),require=createRequire(import.meta.url);
function compile(file,overrides={}){
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  class TestDOMPoint {constructor(x,y){this.x=x;this.y=y;}matrixTransform(m){return {x:m.a*this.x+m.c*this.y+m.e,y:m.b*this.x+m.d*this.y+m.f};}}
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>Object.hasOwn(overrides,name)?overrides[name]:require(name),DOMPoint:TestDOMPoint},{filename:file});
  return module.exports;
}
const raman=compile('lib/raman-data.ts'),ticks=compile('lib/plot-ticks.ts');
const stored=new Map(),locals=[];
let localIndex=0,settings,svg;
const runtime=require('react/jsx-runtime');
function capture(factory){return (type,props,key)=>{if(type==='svg'&&props?.['data-testid']==='raman-contour')svg=props;return factory(type,props,key);};}
const Contour=compile('components/raman-contour.tsx',{
  react:{...React,useEffect:()=>{},useState:initial=>{const index=localIndex++;if(!(index in locals))locals[index]=typeof initial==='function'?initial():initial;return [locals[index],value=>{locals[index]=typeof value==='function'?value(locals[index]):value;}];}},
  'react/jsx-runtime':{...runtime,jsx:capture(runtime.jsx),jsxs:capture(runtime.jsxs)},
  '@/lib/raman-data':raman,'@/lib/plot-ticks':ticks,
  '@/lib/project-state':{useProjectEpoch:()=>0,useProjectState:(scope,key,initial)=>{const id=scope+'.'+key;if(!stored.has(id))stored.set(id,typeof initial==='function'?initial():initial);return [stored.get(id),value=>stored.set(id,typeof value==='function'?value(stored.get(id)):value)];}},
  '@/components/plot-settings-dialog':{__esModule:true,default:props=>{settings=props;return null;}},
  '@/components/plot-tick-settings':{__esModule:true,default:()=>null}
}).default;
const grid={x:[0,5,10],y:[1,2,3],values:[[0,5,10],[10,15,20],[20,25,30]],names:['one','two','three'],min:0,max:30,note:'Original source grid'};
const original=JSON.stringify(grid),props={grid,axis:'sequence',bands:6,palette:'viridis',normalize:false,xLabel:'Raman Shift / cm⁻¹',yLabel:'Spectrum sequence',onFilesDrop:()=>{}};
const render=extra=>{localIndex=0;return renderToStaticMarkup(React.createElement(Contour,{...props,...extra}));};
const viewBox=html=>/viewBox="([^"]+)" preserveAspectRatio="none"/.exec(html)?.[1];
const bands=html=>[...html.matchAll(/<path [^>]*d="([^"]*)"[^>]*data-contour-band="(\d+)"/g)].map(match=>match[1]);
function descendants(node){return node&&typeof node==='object'?[node,...React.Children.toArray(node.props?.children).flatMap(descendants)]:[];}
function setRanges(values){for(const [key,value] of Object.entries(values)){const label=key[0].toUpperCase()+' 轴'+(key[1]==='0'?'最小值':'最大值');descendants(settings.rangeControls).find(node=>node.props?.['aria-label']===label).props.onChange({target:{value}});}render();descendants(settings.rangeControls).find(node=>node.type==='button'&&node.props.children==='应用范围').props.onClick();}
const checks=[];

const full=render();assert.equal(viewBox(full),'0 0 1000 1000');assert.equal(bands(full).length,6);
assert.deepEqual([...full.matchAll(/data-axis="y" data-tick="major" data-value="([^"]+)"/g)].map(match=>Number(match[1])),[1,2,3]);
checks.push('default-contour-keeps-source-view-and-integer-sequence-labels');

setRanges({x0:'2',x1:'8',y0:'1.5',y1:'2.5'});const cropped=render();
assert.equal(viewBox(cropped),'200 250 600 500');assert.deepEqual(bands(cropped),bands(full));assert.equal(JSON.stringify(grid),original);
assert.deepEqual(JSON.parse(JSON.stringify(stored.get('raman.contour.manual'))),{x:[2,8],y:[1.5,2.5]});
checks.push('custom-xy-ranges-transform-real-contour-viewport-without-changing-paths-or-source-values');

const issue=settings.tickControls.props.onApply({x:{step:2,anchor:0,minorCount:3},y:{step:.5,anchor:0,minorCount:1}});assert.equal(issue,undefined);
const customTicks=render();assert.match(customTicks,/data-axis="x" data-tick="major" data-value="4"><path d="M335,482v7"/);
assert.match(customTicks,/data-axis="y" data-tick="major" data-value="2"><path d="M105,262h-7"/);
assert.match(customTicks,/data-axis="x" data-tick="minor" data-value="2.5"/);assert.deepEqual(bands(customTicks),bands(full));
assert.match(settings.tickControls.props.onApply({x:{step:1e-9,anchor:0,minorCount:20},y:{anchor:0,minorCount:1}}),/刻度过密/);
checks.push('major-minor-ticks-use-physical-values-and-screen-positions-with-density-validation');

const identity={a:1,b:0,c:0,d:1,e:0,f:0};
svg.onPointerMove({clientX:450,clientY:262,currentTarget:{getScreenCTM:()=>({inverse:()=>identity})}});
assert.equal(locals[0].x,5);assert.equal(locals[0].y,2);assert.equal(locals[0].z,15);assert.match(render(),/强度 15/);
stored.set('raman.contour.manual',{x:[-10,20],y:[0,4]});const expanded=render();assert.equal(viewBox(expanded),'-1000 -500 3000 2000');
svg.onPointerMove({clientX:105,clientY:262,currentTarget:{getScreenCTM:()=>({inverse:()=>identity})}});assert.equal(locals[0],null);
svg.onPointerMove({clientX:450,clientY:262,currentTarget:{getScreenCTM:()=>({inverse:()=>identity})}});assert.equal(locals[0].x,5);assert.equal(locals[0].y,2);assert.equal(locals[0].z,15);
checks.push('hover-maps-cropped-and-expanded-view-to-original-grid-and-ignores-outside-source');

const potentialGrid={...grid,y:[.1,.4,.6]};stored.set('raman.contour.manual',{x:[2,8],y:[.2,.5]});const physicalY=render({grid:potentialGrid,axis:'potential'});
viewBox(physicalY).split(' ').map(Number).forEach((value,index)=>assert.ok(Math.abs(value-[200,200,600,600][index])<1e-10));
svg.onPointerMove({clientX:450,clientY:262,currentTarget:{getScreenCTM:()=>({inverse:()=>identity})}});assert.equal(locals[0].y,.4);assert.equal(locals[0].z,15);
checks.push('nonuniform-potential-axis-uses-physical-source-distance-for-view-and-nearest-spectrum');

const applied=stored.get('raman.contour.manual');setRanges({x0:'8',x1:'2'});assert.equal(stored.get('raman.contour.manual'),applied);assert.match(locals[2],/最小值须小于最大值/);
setRanges({x0:'',x1:'2'});assert.equal(stored.get('raman.contour.manual'),applied);
stored.set('raman.contour.manual',{x:[-1e308,1e308]});assert.match(render(),/坐标范围超出可显示的数值尺度/);
stored.set('raman.contour.manual',{});for(const empty of [{x:[],y:[],values:[],names:[],min:0,max:1},{x:[2],y:[1],values:[[3]],names:['one'],min:3,max:3}]){const html=render({grid:empty});assert.equal(bands(html).length,0);assert.match(html,/至少需要两条光谱/);assert.doesNotMatch(html,/viewBox="[^"]*(?:Infinity|NaN)/);}
assert.equal(JSON.stringify(grid),original);
checks.push('invalid-partial-reversed-or-extreme-ranges-and-insufficient-grids-fail-without-corrupting-data');
console.log(JSON.stringify({ok:true,checks},null,2));
