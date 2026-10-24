import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const urls={};
for(const name of ['xrd-reference-types','xrd-jade']){
 let code=ts.transpileModule(await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from ["']\.\/xrd-reference-types["']/g,'from '+JSON.stringify(urls['xrd-reference-types']));
 urls[name]='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
}
const {parseJadeCardText,readJadeClipboardPacket,JADE_CLIPBOARD_PREFIX}=await import(urls['xrd-jade']);
const {referencePeaksAtWavelength}=await import(urls['xrd-reference-types']);
const fixture=['PDF#99-999-9999: 质标=计算值; d=计算值; I=(未知)','Synthetic test phase','CoFe2O4','波长=1.5406','2θ\td(埃)\tI(v)\t( h k l )\tθ\t1/(2d)\t2π/d\tn^2','30\t2.97619\t100.0\t( 1 1 1)\t15\t0.168\t2.11\t3','60\t1.5406\t<1\t( 2 2 0)\t30\t0.324\t4.08\t8'].join('\r\n');
const card=parseJadeCardText(fixture);
assert.equal(card.peaks.length,2);assert.equal(card.sourceId,'99-999-9999');assert.equal(card.peaks[1].intensityQualifier,'<');assert.equal(card.peaks[1].intensity,1);
assert.equal(referencePeaksAtWavelength(card,1.5406)[0].twoTheta,30,'Same-wave bars preserve the JADE source angle');
assert.notEqual(referencePeaksAtWavelength(card,1.6)[0].twoTheta,30,'A deliberate wavelength change uses d');
assert.ok(card.warnings.some(note=>note.includes('界限')));
const id='11111111-2222-4333-8444-555555555555';
const packet={schema:'jade-card/v1',requestId:id,cardNumber:'99-999-9999',wavelength:1.5406,text:fixture};
assert.equal(readJadeClipboardPacket(JADE_CLIPBOARD_PREFIX+JSON.stringify(packet),id).peaks.length,2);
assert.equal(readJadeClipboardPacket('unrelated clipboard text',id),null);
assert.throws(()=>readJadeClipboardPacket(JADE_CLIPBOARD_PREFIX+JSON.stringify({schema:'jade-card/v1',requestId:id,error:'请打开一张卡片'}),id),/打开/);
assert.equal(readJadeClipboardPacket(JADE_CLIPBOARD_PREFIX+JSON.stringify({...packet,requestId:'00000000-2222-4333-8444-555555555555'}),id),null);
assert.throws(()=>readJadeClipboardPacket(JADE_CLIPBOARD_PREFIX+JSON.stringify({...packet,cardNumber:'99-999-9998'}),id),/卡号/);
assert.throws(()=>parseJadeCardText(fixture.replace('2.97619','7.9')),/不一致/);
assert.throws(()=>parseJadeCardText(fixture.replace('<1','unknown')),/无效/);
assert.throws(()=>parseJadeCardText('PDF#99-999-9999: only card number'),/完整峰表/);
if(process.argv[2]){
 const text=await readFile(process.argv[2],'utf8');const real=parseJadeCardText(text,1.54059);
 assert.equal(real.sourceId,'97-010-9044');assert.equal(real.peaks.length,11);
 assert.equal(real.peaks[2].twoTheta,35.439);assert.equal(real.peaks[2].intensity,100);assert.equal(real.peaks[10].intensityQualifier,'<');
 console.log('Actual JADE selected card: 11 peaks, strongest 35.439/100, last <1 marker retained.');
}
console.log('PASS: copied peak table, censored intensity, Bragg consistency, original precision, stale/mismatched packets and malformed data.');
