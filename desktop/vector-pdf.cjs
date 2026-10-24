const { randomUUID } = require('node:crypto');

const MAX_SVG_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const TAGS = new Set(['svg','g','defs','style','title','desc','path','line','polyline','polygon','rect','circle','ellipse','text','tspan','clipPath','linearGradient','radialGradient','stop','pattern','marker']);
const unescapeXml = text => text.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-f]+);/gi, entity => {
  const basic = { '&quot;':'"', '&apos;':"'", '&amp;':'&', '&lt;':'<', '&gt;':'>' };
  if (basic[entity]) return basic[entity];
  const point = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3,-1),16) : parseInt(entity.slice(2,-1),10);
  return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
});
function staticStyle(value) {
  // No imports, escaped names, external URLs, web fonts or animation. Only local SVG fragment paint servers.
  const checked = value.replace(/(?:^|;)\s*(?:filter|backdrop-filter)\s*:\s*none\s*(?=;|$)/gi,'');
  if (/[\\@]/.test(checked) || /(?:animation|transition|behavior|expression|filter|backdrop-filter)\s*[:(]/i.test(checked)) throw Error('PDF 图形不支持动态、滤镜或外部样式；请改用 SVG。');
  const withoutLocal = value.replace(/url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)/gi, '');
  if (/url\s*\(|(?:https?|file|data|javascript):|image-set\s*\(/i.test(withoutLocal)) throw Error('PDF 图形不能引用外部资源。');
}
function validateVectorPdfRequest(request) {
  if (!request || typeof request.svgText !== 'string' || Buffer.byteLength(request.svgText,'utf8') > MAX_SVG_BYTES) throw Error('PDF 图形内容无效或超过 8 MB。');
  const { svgText, widthMm, heightMm } = request;
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm < 20 || widthMm > 1000 || heightMm < 1 || heightMm > 1000) throw Error('PDF 页面宽度需为 20～1000 mm，高度需为 1～1000 mm。');
  if (/<!|<\?|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(svgText)) throw Error('PDF 图形包含不支持的声明或控制符。');
  const token = /<\/?[A-Za-z][\w:.-]*(?:\s+[\w:.-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*\/?>/g;
  const stack = []; let cursor = 0, count = 0, root = false, closed = false;
  for (const match of svgText.matchAll(token)) {
    const between = svgText.slice(cursor,match.index);
    if (/[<>]/.test(between) || (!stack.length && between.trim())) throw Error('PDF 图形结构无效。');
    if (stack.at(-1) === 'style') staticStyle(unescapeXml(between));
    cursor = match.index + match[0].length;
    const tag = match[0], name = /^<\/?([\w:.-]+)/.exec(tag)[1], closing = tag.startsWith('</'), self = tag.endsWith('/>');
    if (!TAGS.has(name) || ++count > 100000) throw Error('PDF 图形包含不支持的元素或元素过多。');
    if (closing) { if (self || tag !== `</${name}>` || stack.pop() !== name) throw Error('PDF 图形标签不匹配。'); if (!stack.length) closed = true; continue; }
    if (closed || (!root && name !== 'svg') || (root && !stack.length)) throw Error('PDF 图形必须只有一个 SVG 根元素。');
    root = true;
    const seen = new Set();
    for (const attr of tag.matchAll(/\s+([\w:.-]+)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g)) {
      const key = attr[1], lower = key.toLowerCase(), value = unescapeXml(attr[2] ?? attr[3]);
      if (seen.has(key) || /^on/i.test(key) || /^(?:xml:base|src|srcset)$/i.test(key)) throw Error('PDF 图形包含不支持的属性。');
      seen.add(key);
      if (lower === 'xmlns' && value !== 'http://www.w3.org/2000/svg' || lower === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink') throw Error('PDF 图形命名空间无效。');
      if (lower.endsWith('href') && !/^#[A-Za-z_][\w:.-]*$/.test(value)) throw Error('PDF 图形仅支持内部引用。');
      if (['style','fill','stroke','filter','clip-path','mask','cursor','marker-start','marker-mid','marker-end'].includes(lower)) staticStyle(value);
      if (lower === 'filter' && value.trim() !== 'none') throw Error('PDF 图形不支持会使矢量栅格化的滤镜，请改用 SVG。');
      if (lower === 'd' && value.length > 1_000_000) throw Error('PDF 图形单条路径过长。');
    }
    if (!self) { stack.push(name); if (stack.length > 80) throw Error('PDF 图形嵌套过深。'); }
    else if (!stack.length) closed = true;
  }
  if (!root || !closed || stack.length || svgText.slice(cursor).trim()) throw Error('PDF 图形结构不完整。');
  // Explicit physical dimensions override width/height from the live screen SVG.
  const svg = svgText.replace(/^\s*<svg\b([^>]*?)(\/?)>/, (_whole, attributes, self) => `<svg${attributes.replace(/\s+(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/g,'')} width="${widthMm}mm" height="${heightMm}mm"${self}>`);
  return { svg, widthMm, heightMm };
}
async function renderVectorPdf(request, { BrowserWindow, session }, { timeoutMs = 30000 } = {}) {
  const { svg, widthMm, heightMm } = validateVectorPdfRequest(request);
  const isolated = session.fromPartition(`friday-vector-pdf-${randomUUID()}`, { cache: false });
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  // Even malformed fragments cannot fetch HTTP/file URLs or use the app's privileged scheme.
  isolated.webRequest.onBeforeRequest((details,callback) => callback({cancel: details.resourceType !== 'mainFrame' || !details.url.startsWith('data:text/html;base64,')}));
  let printer, timer;
  try {
    printer = new BrowserWindow({ show:false, width:800, height:600, backgroundColor:'#ffffff', paintWhenInitiallyHidden:true, webPreferences:{ session:isolated, sandbox:true, contextIsolation:true, nodeIntegration:false, javascript:false, webSecurity:true, devTools:false, backgroundThrottling:false, spellcheck:false, plugins:false } });
    printer.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    printer.webContents.on('will-navigate', event => event.preventDefault());
    printer.webContents.on('will-frame-navigate', event => event.preventDefault());
    printer.webContents.on('will-redirect', event => event.preventDefault());
    printer.webContents.on('will-attach-webview', event => event.preventDefault());
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>@page{size:${widthMm}mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0;width:${widthMm}mm;height:${heightMm}mm;overflow:hidden;background:white}body>svg{display:block;width:${widthMm}mm!important;height:${heightMm}mm!important;max-width:none!important;max-height:none!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}</style></head><body>${svg}</body></html>`;
    const operation = (async () => {
      await printer.loadURL(`data:text/html;base64,${Buffer.from(html,'utf8').toString('base64')}`);
      // The validator forbids asynchronous web fonts; only installed fonts are used.
      // Capture flushes the hidden compositor before print; the captured pixels are never put in the PDF.
      await printer.webContents.capturePage();
      const pdf = await printer.webContents.printToPDF({ printBackground:true, displayHeaderFooter:false, margins:{top:0,bottom:0,left:0,right:0}, preferCSSPageSize:true, pageSize:{width:widthMm/25.4,height:heightMm/25.4}, scale:1, generateTaggedPDF:true });
      if (pdf.length > MAX_PDF_BYTES || pdf.length < 8 || pdf.subarray(0,5).toString('ascii') !== '%PDF-') throw Error('PDF 返回内容无效或超过 32 MB。');
      return new Uint8Array(pdf);
    })();
    return await Promise.race([operation,new Promise((_resolve,reject) => { timer = setTimeout(() => reject(Error('矢量 PDF 导出超时，请减小图形复杂度。')),timeoutMs); })]);
  } finally {
    clearTimeout(timer);
    if (printer && !printer.isDestroyed()) printer.destroy();
    isolated.webRequest.onBeforeRequest(null);
    await isolated.clearStorageData().catch(() => {});
    await isolated.clearCache().catch(() => {});
  }
}
module.exports = { validateVectorPdfRequest, renderVectorPdf, MAX_SVG_BYTES, MAX_PDF_BYTES };
