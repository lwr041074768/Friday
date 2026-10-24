import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
const source = await readFile(new URL('../lib/figure-export.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { figurePixelSize, figureFilename, encodeTiff, setPngDpi, figureMime, canExportVectorPdf } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const { validateVectorPdfRequest, MAX_SVG_BYTES } = createRequire(import.meta.url)('../desktop/vector-pdf.cjs');

// Physical size: 160 mm at 300 dpi with 4:3 aspect.
const size = figurePixelSize(160, 4 / 3, 300);
assert.deepEqual(size, { widthPx: 1890, heightPx: 1417, heightMm: 120 });
assert.equal(figurePixelSize(85, 1, 600).widthPx, 2008);
assert.throws(() => figurePixelSize(10, 1, 300), /20～1000/);
assert.throws(() => figurePixelSize(160, 1, 2400), /72～1200/);
assert.throws(() => figurePixelSize(1000, 0.1, 1200), /过大/);
assert.equal(figureFilename('EIS · Nyquist', 'png', 160, 300), 'EIS · Nyquist-160mm-300dpi.png');
assert.equal(figureFilename('a/b:c', 'tiff', 85, 600), 'a_b_c-85mm-600dpi.tif');
assert.equal(figureMime('pdf'), 'application/pdf');
assert.equal(figureFilename('EIS', 'pdf', 85, 600), 'EIS-85mm.pdf');
assert.equal(canExportVectorPdf(), false, 'Browser has no fake/raster PDF fallback');

// Minimal TIFF reader for the tags this exporter writes.
function readTiff(bytes) {
  assert.equal(bytes[0], 0x49); assert.equal(bytes[1], 0x49);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint16(2, true), 42);
  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true), entries = new Map();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12, tag = view.getUint16(at, true), type = view.getUint16(at + 2, true), n = view.getUint32(at + 4, true);
    const value = type === 3 && n === 1 ? view.getUint16(at + 8, true) : view.getUint32(at + 8, true);
    entries.set(tag, { type, count: n, value, at });
  }
  return { view, entries };
}
const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 10, 20, 30, 255]);
const rgbTiff = encodeTiff(rgba, 2, 2, 300, false);
const rgb = readTiff(rgbTiff);
assert.equal(rgb.entries.get(256).value, 2); assert.equal(rgb.entries.get(257).value, 2);
assert.equal(rgb.entries.get(277).value, 3); assert.equal(rgb.entries.get(259).value, 1);
const rgbStrip = rgb.entries.get(273).value, rgbBytes = rgb.entries.get(279).value;
assert.equal(rgbBytes, 2 * 2 * 3);
assert.deepEqual([...rgbTiff.slice(rgbStrip, rgbStrip + 6)], [255, 0, 0, 0, 255, 0]);
assert.deepEqual([...rgbTiff.slice(rgbStrip + 6, rgbStrip + 12)], [0, 0, 255, 10, 20, 30]);
const xres = rgb.entries.get(282).value;
assert.equal(rgb.view.getUint32(xres, true), 300); assert.equal(rgb.view.getUint32(xres + 4, true), 1);
assert.equal(rgb.entries.get(296).value, 2);
assert.equal(rgb.entries.has(338), false);

const alphaTiff = encodeTiff(rgba, 2, 2, 600, true), alpha = readTiff(alphaTiff);
assert.equal(alpha.entries.get(277).value, 4);
assert.equal(alpha.entries.get(338).value, 2);
assert.equal(alpha.entries.get(279).value, 2 * 2 * 4);
assert.deepEqual([...alphaTiff.slice(alpha.entries.get(273).value, alpha.entries.get(273).value + 16)], [...rgba]);
const alphaBits = alpha.entries.get(258).value;
assert.deepEqual([0, 1, 2, 3].map(i => alpha.view.getUint16(alphaBits + i * 2, true)), [8, 8, 8, 8]);
assert.throws(() => encodeTiff(new Uint8Array(4), 2, 2, 300, false), /像素数量/);

// Actual PNG metadata must carry the selected resolution while preserving alpha and pixels.
const originalPng = await sharp(rgba, { raw:{width:2,height:2,channels:4} }).png().toBuffer();
for (const dpi of [150,300,600,1200]) {
  const png = setPngDpi(originalPng,dpi), decoded = await sharp(png).raw().toBuffer();
  assert.deepEqual([...decoded],[...rgba]);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.density,dpi); assert.equal(metadata.hasAlpha,true);
  const second = setPngDpi(png,300), body = Buffer.from(second);
  assert.equal(body.toString('latin1').split('pHYs').length-1,1);
  const at = body.indexOf(Buffer.from('pHYs'));
  assert.equal(body.readUInt32BE(at+4),Math.round(300/.0254));
  // Verify the pHYs CRC independently using the standard zlib polynomial bit-by-bit.
  const crcAt = at+13; let crc = 0xffffffff;
  for (let i=at;i<crcAt;i++) { let c=(crc^body[i])&255; for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1; crc=(crc>>>8)^c; }
  assert.equal(body.readUInt32BE(crcAt),(crc^0xffffffff)>>>0);
}
assert.throws(()=>setPngDpi(new Uint8Array(50),300),/文件头/);
assert.throws(()=>setPngDpi(originalPng.subarray(0,originalPng.length-1),300),/不完整|无效/);

const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><style>text{font-family:Arial,"Microsoft YaHei"}</style><defs><clipPath id="chart"><rect width="300" height="200"/></clipPath></defs><path d="M10 20L300 200" clip-path="url(#chart)"/><text x="20" y="30">电流密度 η / V</text></svg>';
const accepted=validateVectorPdfRequest({svgText:svg,widthMm:85,heightMm:63.75});
assert.match(accepted.svg,/width="85mm" height="63.75mm"/);
const styled='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="grad"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8" stroke="#123"/></pattern><marker id="arrow" viewBox="0 0 10 10" markerWidth="4" markerHeight="4"><path d="M0 0L10 5L0 10Z"/></marker></defs><rect width="50" height="50" fill="url(#grad)" filter="none"/><rect y="50" width="50" height="50" fill="url(#hatch)" style="filter:none;"/><path d="M0 0L90 90" marker-end="url(#arrow)"/></svg>';
assert.ok(validateVectorPdfRequest({svgText:styled,widthMm:85,heightMm:85}));
for (const invalid of [
  '<svg><script>alert(1)</script></svg>', '<svg><foreignObject/></svg>',
  '<svg><image href="data:image/png;base64,AA"/></svg>', '<svg onload="evil()"/>',
  '<svg><use href="https://example.invalid/s.svg#x"/></svg>', '<svg><use xlink:href="file:///secret"/></svg>',
  '<svg><style>@import "remote";</style></svg>', '<svg><path style="fill:u\\72l(https://example.invalid)"/></svg>',
  '<svg><path fill="url(https://example.invalid)"/></svg>', '<svg><path filter="url(#a)"/></svg>',
  '<!DOCTYPE svg><svg/>', '<svg><g></svg>', '<svg/><svg/>', '<svg><animate/></svg>',
  '<svg><path d="M 1 2" onpointerdown="evil()"/></svg>'
]) assert.throws(()=>validateVectorPdfRequest({svgText:invalid,widthMm:85,heightMm:63.75}),undefined,invalid);
assert.throws(()=>validateVectorPdfRequest({svgText:'x'.repeat(MAX_SVG_BYTES+1),widthMm:85,heightMm:63.75}),/8 MB/);
assert.throws(()=>validateVectorPdfRequest({svgText:svg,widthMm:85,heightMm:Infinity}),/页面/);
console.log('Figure export passed: physical sizes, pixel limits, TIFF RGB/RGBA, PNG pHYs and CRC with exact alpha pixels, static SVG/native PDF validation. Actual vector PDF is tested by desktop/verify-vector-export.mjs.');
