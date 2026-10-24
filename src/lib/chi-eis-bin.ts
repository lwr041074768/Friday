import type { DataTable } from "./lsv-import";

// CHI760E/F IMP layout, verified against paired instrument TXT exports.
// The opaque header identifier varies even with the same data layout.
const VERIFIED_IDENTIFIERS = new Set(["W0208", "U0603", "e1129", "e0610"]);
const unsupported = (reason: string): never => {
  throw new Error(`无法读取此 EIS BIN：${reason}。可在辰华软件中导出包含频率、Z′、Z″的 TXT 文件后导入。`);
};

export function parseChiEisBin(bytes: Uint8Array, name: string, source: string): DataTable {
  const offset = 1682, stride = 16;
  if (bytes.length < offset + 2 * stride) unsupported("文件过短或不完整，当前布局至少需要两个数据点");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x001df280) unsupported("文件格式标记尚未支持");
  const text = (at: number, size: number) => new TextDecoder("ascii").decode(bytes.subarray(at, at + size));
  if (view.getUint32(4, true) !== 3 || text(8, 3) !== "IMP" || view.getUint32(11, true) !== 14 || text(15, 14) !== "A.C. Impedance") unsupported("当前文件不是支持的 IMP 交流阻抗技术布局");
  for (let at = 29; at <= 53; at += 4) if (view.getUint32(at, true) !== 0) unsupported("带备注或扩展字段的头部布局尚未验证");
  if (view.getUint32(57, true) !== 5 || view.getUint32(650, true) !== 760) unsupported("仪器字段或头部布局尚未支持");
  const identifier = text(61, 5);
  if (!VERIFIED_IDENTIFIERS.has(identifier)) unsupported(`头部标识“${identifier.replace(/[^\x20-\x7e]/g, "?")}”尚未验证`);
  const count = view.getUint32(606, true);
  if (count < 2 || count > 50000) unsupported("点数无效或超过 50,000 点");
  if (view.getUint32(614, true) !== count || bytes.length !== offset + count * stride) unsupported("头部点数与数据长度不一致，可能有截断或扩展数据");
  const rows: number[][] = [];
  for (let at = offset; at < bytes.length; at += stride) {
    const f = view.getFloat32(at, true), repeated = view.getFloat32(at + 4, true);
    const real = view.getFloat32(at + 8, true), imaginary = view.getFloat32(at + 12, true);
    const point = rows.length + 1;
    if (![f, repeated, real, imaginary].every(Number.isFinite)) unsupported(`第 ${point} 点含有无效数值`);
    if (f <= 0 || f !== repeated) unsupported(`第 ${point} 点的频率字段无效或不一致`);
    if (rows.length && f >= rows[rows.length - 1][0]) unsupported(`第 ${point} 点不符合已验证的频率递减顺序`);
    rows.push([f, real, imaginary]);
  }
  return { id: crypto.randomUUID(), name, source, headers: ["Freq/Hz", "Z'/ohm", "Z''/ohm"], rows };
}
