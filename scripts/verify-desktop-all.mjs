import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(root,'desktop/output/audit'));
await fs.mkdir(output,{recursive:true});
let desktopTypes=false;try{await fs.access(path.join(root,'tsconfig.desktop.json'));desktopTypes=true;}catch{}
const checks=[
  ['typecheck','node_modules/typescript/bin/tsc',['--noEmit','--incremental','false',...(desktopTypes?['-p','tsconfig.desktop.json']:[])]],
  ...['verify-cdl','verify-cdl-data-export','verify-cdl-slot-import','verify-lsv-target','verify-lsv-data-export','verify-eis-import','verify-jade-card','verify-overpotential','verify-overpotential-axes','verify-plot-ticks','verify-raman','verify-xrd-hover','verify-xrd-mdi','verify-xrd-reference','verify-xrd-experimental-peaks','verify-figure-export','verify-eis-circuit','verify-tafel-auto','verify-cdl-confidence','verify-eis-fit-report'].map(n=>[n,`scripts/${n}.mjs`,[]]),
  ['verify-cdl-origin','scripts/verify-cdl-origin.mjs',[path.join(output,'cdl-origin')]],
  ['verify-overpotential-origin','scripts/verify-overpotential-origin.mjs',[]],
  ['verify-xy-export','scripts/verify-xy-export.mjs',[path.join(output,'xy-export')]],
  ['verify-raman-origin','scripts/verify-raman-origin.mjs',[]],
  ['desktop-policy','desktop/verify.mjs',[]],['desktop-text','desktop/verify-text-import.mjs',[]],
  ['import-gaps','scripts/verify-import-gaps.mjs',[]],['tafel','scripts/verify-tafel.mjs',[]],
  ['tafel-analysis','scripts/verify-tafel-analysis.mjs',[]],['tafel-analysis-export','scripts/verify-tafel-export-analysis.mjs',[]],
  ['data-book','scripts/verify-data-book.mjs',[]],
  ['project-document','scripts/verify-project-document.mjs',[]],
  ['ph','scripts/verify-ph.mjs',[]],
  ['cv','scripts/verify-cv.mjs',[]],
  ['folder-import','scripts/verify-folder-import.mjs',[]],
  ['eis-contour','scripts/verify-eis-contour.mjs',[]],
  ['eis-bode','scripts/verify-eis-bode.mjs',[]],
  ['eis-folder-import','scripts/verify-eis-folder-import.mjs',[]],
  ['plot-title','scripts/verify-plot-title.mjs',[]],
  ['project-files','desktop/verify-project-files.mjs',[]],
  ['raman-contour-view','scripts/verify-raman-contour-view.mjs',[]],
  ['desktop-updater','desktop/verify-updater.mjs',[]],['desktop-update-install','desktop/verify-update-install.mjs',[]],
];
const reports=[];
async function check([name,script,args]){
  const started=Date.now();
  const result=await new Promise(resolve=>execFile(process.execPath,[script,...args],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:8*1024*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  await fs.writeFile(path.join(output,`${name}.log`),result.stdout+result.stderr);
  const report={name,ok:!result.error,elapsedMs:Date.now()-started,...(result.error?{error:(result.stdout+result.stderr+result.error.message).slice(-4000)}:{})};
  reports.push(report);console.log(`${report.ok?'PASS':'FAIL'} ${name} (${report.elapsedMs} ms)`);if(!report.ok)console.log(report.error);
}
let index=0;
await Promise.all([1,2].map(async()=>{while(index<checks.length){const item=checks[index++];await check(item);}}));
const summary={passed:reports.every(r=>r.ok),checks:reports.length,failed:reports.filter(r=>!r.ok).map(r=>r.name),results:reports};
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({passed:summary.passed,checks:summary.checks,failed:summary.failed,output}));
if(!summary.passed)process.exitCode=1;
