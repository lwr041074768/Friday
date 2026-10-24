import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const code=ts.transpileModule(await readFile(new URL('../lib/plot-title.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {titleLayout}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
// Boundary geometry differs for horizontal and rotated text. Cover all edges
// and several canvas sizes without depending on a particular machine's font.
for(const canvas of [{width:940,height:560},{width:300,height:190},{width:500,height:300}]){
  for(const axis of ['x','y'])for(const center of [{x:-1000,y:-1000},{x:2000,y:2000},{x:80,y:80}]){
    const p=titleLayout(axis,center,canvas,{width:140,ascent:20,descent:5});
    const b=axis==='x'?{x:p.x-70,y:p.y-20,w:140,h:25}:{x:p.x-20,y:p.y-70,w:25,h:140};
    assert.ok(b.x>=6&&b.y>=6&&b.x+b.w<=canvas.width-6&&b.y+b.h<=canvas.height-6,JSON.stringify({axis,canvas,b}));
  }
}
console.log('PASS: horizontal/rotated titles stay inside all canvas edges after drag and resize.');
