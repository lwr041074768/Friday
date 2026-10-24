export type FigureFormat = "svg" | "png" | "tiff" | "pdf";
export type FigureExportOptions = {
  format: FigureFormat;
  /** Printed width in millimetres; height follows the figure aspect ratio. */
  widthMm: number;
  dpi: number;
  transparent: boolean;
  filename: string;
};
export type FigureFile = { blob: Blob; filename: string; mime: string; widthPx: number; heightPx: number; widthMm: number; heightMm: number };
export type VectorPdfRequest = { svgText: string; widthMm: number; heightMm: number };
type VectorPdfRenderer = (request: VectorPdfRequest) => Promise<Uint8Array<ArrayBuffer>>;
let vectorPdfRenderer: VectorPdfRenderer | undefined;
/** Only the desktop shell registers its isolated, native vector printer. */
export function registerVectorPdfRenderer(renderer: VectorPdfRenderer): void { vectorPdfRenderer = renderer; }
export function canExportVectorPdf(): boolean { return !!vectorPdfRenderer; }

const MM_PER_INCH = 25.4;
const MAX_SIDE = 20000;
const MAX_PIXELS = 80_000_000;
export const FIGURE_DPI_CHOICES = [150, 300, 600, 1200] as const;
export const FIGURE_WIDTH_PRESETS = [
  { label: "单栏 85 mm", value: 85 },
  { label: "1.5 栏 120 mm", value: 120 },
  { label: "双栏 160 mm", value: 160 },
  { label: "整页 190 mm", value: 190 },
] as const;

/** CSS font/colour rules that live in stylesheets rather than SVG attributes. */
const FIGURE_CSS = `text{font-family:Arial,"Microsoft YaHei",sans-serif}
.lsv-axis-tick{fill:#111;font-weight:700}.lsv-axis-title{fill:#111;font-weight:700}
.lsv-svg-legend text{fill:#111}`;

export function figureMime(format: FigureFormat): string {
  return format === "svg" ? "image/svg+xml" : format === "png" ? "image/png" : format === "tiff" ? "image/tiff" : "application/pdf";
}
export function figureExtension(format: FigureFormat): string {
  return format === "tiff" ? "tif" : format;
}
export function figureFilename(base: string, format: FigureFormat, widthMm: number, dpi: number): string {
  const safe = (base || "figure").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "figure";
  return format === "svg" ? `${safe}.svg` : format === "pdf" ? `${safe}-${Math.round(widthMm)}mm.pdf` : `${safe}-${Math.round(widthMm)}mm-${Math.round(dpi)}dpi.${figureExtension(format)}`;
}

export function validateFigureOptions(widthMm: number, dpi: number): void {
  if (!Number.isFinite(widthMm) || widthMm < 20 || widthMm > 1000) throw new Error("图形宽度需为 20～1000 mm。");
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 1200) throw new Error("分辨率需为 72～1200 dpi。");
}

export function figurePixelSize(widthMm: number, aspect: number, dpi: number): { widthPx: number; heightPx: number; heightMm: number } {
  validateFigureOptions(widthMm, dpi);
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("图形宽高比无效。");
  const heightMm = widthMm / aspect;
  const widthPx = Math.max(1, Math.round(widthMm / MM_PER_INCH * dpi));
  const heightPx = Math.max(1, Math.round(heightMm / MM_PER_INCH * dpi));
  if (widthPx > MAX_SIDE || heightPx > MAX_SIDE || widthPx * heightPx > MAX_PIXELS) throw new Error("导出尺寸过大，请降低宽度或分辨率。");
  return { widthPx, heightPx, heightMm };
}

/** Clone the live SVG for export: drop transient overlays, keep vector text, fix the canvas size. */
export function cleanFigureSvg(source: SVGSVGElement, transparent = false): { svg: SVGSVGElement; width: number; height: number } {
  const clone = source.cloneNode(true) as SVGSVGElement;
  // Freeze the live stylesheet presentation before detaching the SVG. Every
  // format uses this same snapshot, including inherited CJK font and boldness.
  const texts=source.querySelectorAll<SVGElement>('text,tspan'),copies=clone.querySelectorAll<SVGElement>('text,tspan');
  texts.forEach((node,index)=>{
    const computed=source.ownerDocument.defaultView?.getComputedStyle(node),copy=copies[index];
    if(!computed||!copy)return;
    for(const key of ['font-family','font-size','font-weight','font-style','fill','fill-opacity','letter-spacing','text-anchor','dominant-baseline'])copy.style.setProperty(key,computed.getPropertyValue(key));
  });
  clone.removeAttribute('tabindex');
  clone.querySelectorAll('[tabindex]').forEach(node=>node.removeAttribute('tabindex'));
  clone.querySelectorAll('[data-export-stroke]').forEach(node=>{
    node.setAttribute('stroke',node.getAttribute('data-export-stroke')!);
    node.setAttribute('stroke-width',node.getAttribute('data-export-width')!);
    if(node.hasAttribute('data-export-dash'))node.removeAttribute('stroke-dasharray');
    for(const attr of ['data-export-stroke','data-export-width','data-export-dash'])node.removeAttribute(attr);
  });
  clone.querySelectorAll("[data-plot-transient]").forEach(node => node.remove());
  if (transparent) clone.querySelectorAll("[data-plot-background]").forEach(node => node.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const box = (clone.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = box.length === 4 && Number.isFinite(box[2]) && box[2] > 0 ? box[2] : (source.clientWidth || 800);
  const height = box.length === 4 && Number.isFinite(box[3]) && box[3] > 0 ? box[3] : (source.clientHeight || 600);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = FIGURE_CSS;
  clone.insertBefore(style, clone.firstChild);
  return { svg: clone, width, height };
}

export function serializeFigure(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

async function rasterize(svgText: string, widthPx: number, heightPx: number, transparent: boolean): Promise<HTMLCanvasElement> {
  const image = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图形渲染失败，请重试。"));
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = widthPx; canvas.height = heightPx;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前环境无法创建图形画布。");
  if (!transparent) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, widthPx, heightPx); }
  context.drawImage(image, 0, 0, widthPx, heightPx);
  return canvas;
}

export async function renderFigureFile(source: SVGSVGElement, options: FigureExportOptions): Promise<FigureFile> {
  validateFigureOptions(options.widthMm, options.dpi);
  const { svg, width, height } = cleanFigureSvg(source, options.transparent);
  const heightMm = options.widthMm * height / width;
  if (!Number.isFinite(heightMm) || heightMm <= 0 || heightMm > 1000) throw new Error("图形高度需在 0～1000 mm 内，请减小宽度。");
  const filename = figureFilename(options.filename, options.format, options.widthMm, options.dpi);
  if (options.format === "svg" || options.format === "pdf") {
    svg.setAttribute("width", `${options.widthMm}mm`);
    svg.setAttribute("height", `${heightMm}mm`);
    const svgText = serializeFigure(svg);
    if (options.format === "svg") return { blob: new Blob([svgText], { type: figureMime("svg") }), filename, mime: figureMime("svg"), widthPx: width, heightPx: height, widthMm: options.widthMm, heightMm };
    if (!vectorPdfRenderer) throw new Error("当前环境不支持矢量 PDF 导出，请使用 Friday 桌面版，或导出 SVG。");
    const bytes = await vectorPdfRenderer({ svgText, widthMm: options.widthMm, heightMm });
    if (bytes.length < 8 || bytes.length > 32 * 1024 * 1024 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("矢量 PDF 返回内容无效。");
    return { blob: new Blob([bytes], { type: figureMime("pdf") }), filename, mime: figureMime("pdf"), widthPx: width, heightPx: height, widthMm: options.widthMm, heightMm };
  }
  const { widthPx, heightPx } = figurePixelSize(options.widthMm, width / height, options.dpi);
  const svgText = serializeFigure(svg);
  const canvas = await rasterize(svgText, widthPx, heightPx, options.transparent);
  if (options.format === "png") {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG 编码失败。")), "image/png"));
    const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), options.dpi);
    return { blob: new Blob([bytes], { type: figureMime("png") }), filename, mime: figureMime("png"), widthPx, heightPx, widthMm: options.widthMm, heightMm };
  }
  if (options.format === "tiff") {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前环境无法读取图形像素。");
    const rgba = context.getImageData(0, 0, widthPx, heightPx).data;
    const bytes = encodeTiff(rgba, widthPx, heightPx, options.dpi, options.transparent);
    return { blob: new Blob([bytes], { type: figureMime("tiff") }), filename, mime: figureMime("tiff"), widthPx, heightPx, widthMm: options.widthMm, heightMm };
  }
  throw new Error("不支持的图形格式。");
}

/** Replace/add PNG pHYs without re-encoding pixels or touching their alpha channel. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 1200) throw new Error("PNG 分辨率无效。");
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || !signature.every((value, index) => png[index] === value)) throw new Error("PNG 文件头无效。");
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  view.setUint32(8, pixelsPerMetre); view.setUint32(12, pixelsPerMetre); chunk[16] = 1;
  let crc = 0xffffffff;
  for (const value of chunk.subarray(4, 17)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const parts: Uint8Array[] = [png.subarray(0, 8)], source = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let cursor = 8, inserted = false, ended = false;
  while (cursor + 12 <= png.length) {
    const size = source.getUint32(cursor), end = cursor + 12 + size;
    if (end > png.length) throw new Error("PNG 数据块不完整。");
    const name = String.fromCharCode(...png.subarray(cursor + 4, cursor + 8));
    if (cursor === 8 && (name !== "IHDR" || size !== 13)) throw new Error("PNG 图形头无效。");
    if (name === "IDAT" && !inserted) { parts.push(chunk); inserted = true; }
    if (name !== "pHYs") parts.push(png.subarray(cursor, end));
    cursor = end;
    if (name === "IEND") { ended = true; break; }
  }
  if (!inserted || !ended || cursor !== png.length) throw new Error("PNG 数据块无效。");
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  cursor = 0; for (const part of parts) { result.set(part, cursor); cursor += part.length; }
  return result;
}

/** Baseline uncompressed TIFF (RGB or RGBA) with DPI tags. */
export function encodeTiff(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, dpi: number, alpha: boolean): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("TIFF 尺寸无效。");
  if (rgba.length !== width * height * 4) throw new Error("TIFF 像素数量与尺寸不一致。");
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error("TIFF 分辨率无效。");
  const samples = alpha ? 4 : 3, rowBytes = width * samples, pixelBytes = rowBytes * height;
  const entries = alpha ? 14 : 13;
  const ifdOffset = 8, ifdSize = 2 + entries * 12 + 4;
  const bitsOffset = ifdOffset + ifdSize;
  const xResolutionOffset = bitsOffset + samples * 2;
  const yResolutionOffset = xResolutionOffset + 8;
  const dataOffset = yResolutionOffset + 8;
  const out = new Uint8Array(dataOffset + pixelBytes), view = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; view.setUint16(2, 42, true); view.setUint32(4, ifdOffset, true);
  let cursor = ifdOffset;
  view.setUint16(cursor, entries, true); cursor += 2;
  const short = (tag: number, count: number, value: number) => { view.setUint16(cursor, tag, true); view.setUint16(cursor + 2, 3, true); view.setUint32(cursor + 4, count, true); view.setUint16(cursor + 8, value, true); view.setUint16(cursor + 10, 0, true); cursor += 12; };
  const long = (tag: number, count: number, value: number) => { view.setUint16(cursor, tag, true); view.setUint16(cursor + 2, 4, true); view.setUint32(cursor + 4, count, true); view.setUint32(cursor + 8, value, true); cursor += 12; };
  const offset = (tag: number, count: number, value: number) => { view.setUint16(cursor, tag, true); view.setUint16(cursor + 2, 3, true); view.setUint32(cursor + 4, count, true); view.setUint32(cursor + 8, value, true); cursor += 12; };
  long(256, 1, width); long(257, 1, height); offset(258, samples, bitsOffset); short(259, 1, 1); short(262, 1, 2);
  long(273, 1, dataOffset); short(277, 1, samples); long(278, 1, height); long(279, 1, pixelBytes);
  view.setUint16(cursor, 282, true); view.setUint16(cursor + 2, 5, true); view.setUint32(cursor + 4, 1, true); view.setUint32(cursor + 8, xResolutionOffset, true); cursor += 12;
  view.setUint16(cursor, 283, true); view.setUint16(cursor + 2, 5, true); view.setUint32(cursor + 4, 1, true); view.setUint32(cursor + 8, yResolutionOffset, true); cursor += 12;
  short(284, 1, 1); short(296, 1, 2); if (alpha) short(338, 1, 2);
  view.setUint32(cursor, 0, true); // next IFD
  for (let index = 0; index < samples; index++) view.setUint16(bitsOffset + index * 2, 8, true);
  view.setUint32(xResolutionOffset, Math.round(dpi), true); view.setUint32(xResolutionOffset + 4, 1, true);
  view.setUint32(yResolutionOffset, Math.round(dpi), true); view.setUint32(yResolutionOffset + 4, 1, true);
  if (alpha) { out.set(rgba, dataOffset); }
  else {
    let target = dataOffset;
    for (let index = 0; index < rgba.length; index += 4) { out[target++] = rgba[index]; out[target++] = rgba[index + 1]; out[target++] = rgba[index + 2]; }
  }
  return out;
}
