import type { DataTable } from "./lsv-import";

// Empirically verified against paired CHI760E/F BIN and TXT exports. These
// files are named LSV but use the instrument's CV technique. The EIS payload
// starts elsewhere and has a different shape; it must never enter this parser.
const DATA_OFFSET = 1685;
const FORMAT_MARKER = 0x001df280;
const MAX_POINTS = 50000;
const VERIFIED_IDENTIFIERS = new Set(["W0205", "W0208", "U0603", "e0610"]);

const unsupported = (reason: string): never => {
  throw new Error(`无法可靠读取此辰华 BIN：${reason}。请在辰华软件中导出 Potential/V、Current/A 文本后导入。`);
};

export function parseChiLsvBin(bytes: Uint8Array, name: string, source: string): DataTable {
  if (bytes.byteLength < DATA_OFFSET + 8) unsupported("文件不完整或不是已验证的 CHI760E/F 格式");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => new TextDecoder("ascii").decode(bytes.subarray(offset, offset + length));

  if (view.getUint32(0, true) !== FORMAT_MARKER) unsupported("文件格式或版本尚未验证");
  if (view.getUint32(4, true) !== 2 || text(8, 2) !== "CV" ||
      view.getUint32(10, true) !== 18 || text(14, 18) !== "Cyclic Voltammetry") {
    unsupported("当前仅支持已验证的 CV 扫描数据，其他技术的 BIN 布局不同");
  }
  // Nonempty serialized header/note fields shift all later offsets. Reject
  // them instead of applying fixed offsets to an unverified layout.
  for (let offset = 32; offset < 60; offset += 4) {
    if (view.getUint32(offset, true) !== 0) unsupported("带备注或扩展字段的头部布局尚未验证");
  }
  if (view.getUint32(60, true) !== 5 || !VERIFIED_IDENTIFIERS.has(text(64, 5)) ||
      view.getUint32(653, true) !== 760) unsupported("仪器标识或头部布局尚未验证");

  const count = view.getUint32(609, true);
  if (count < 2 || count > MAX_POINTS) unsupported("点数无效或超过 50,000 点");
  if (view.getUint32(617, true) !== count || bytes.byteLength !== DATA_OFFSET + count * 4) {
    unsupported("头部点数与数据长度不一致，可能有多通道数据、截断或扩展格式");
  }

  const initial = view.getFloat32(1085, true);
  const high = view.getFloat32(1093, true);
  const low = view.getFloat32(1097, true);
  const interval = view.getFloat32(1117, true);
  const segments = view.getUint32(665, true);
  const segmentValue = view.getFloat32(1113, true);
  const direction = view.getUint32(661, true);
  if (![initial, high, low, interval, segmentValue].every(Number.isFinite) || !(high > low) || !(interval > 0)) {
    unsupported("扫描参数无效");
  }
  if (direction !== 1 || view.getFloat32(1109, true) !== 1 || initial !== low ||
      ![2, 10].includes(segments) || segmentValue !== segments) {
    unsupported("当前只验证了从 Low E 开始正向扫描的 2 或 10 段 CV，无法推断此文件的电位序列");
  }
  if (view.getFloat32(1121, true) !== interval) unsupported("取样间隔字段不一致，扫描布局尚未验证");

  const rawIntervals = (high - low) / interval;
  const intervals = Math.round(rawIntervals);
  // Metadata is float32, so decimal settings such as 0.001 are not exact.
  // Permit only the corresponding float32 rounding error, never a partial step.
  const roundingTolerance = Math.max(0.0001, intervals * 2e-7);
  if (intervals < 1 || Math.abs(rawIntervals - intervals) > roundingTolerance || intervals * segments !== count) {
    unsupported("扫描范围、取样间隔、扫描段数与点数不匹配");
  }

  const rows: number[][] = [];
  for (let i = 0; i < count; i++) {
    const current = view.getFloat32(DATA_OFFSET + i * 4, true);
    if (!Number.isFinite(current)) unsupported(`第 ${i + 1} 个电流值无效`);
    const segment = Math.floor(i / intervals), step = i % intervals;
    // The first sample of each segment is its vertex; the next vertex belongs
    // to the following segment. Thus a two-segment 0→1→0 scan ends at 0.001 V.
    const potential = segment % 2 === 0 ? low + step * interval : high - step * interval;
    rows.push([potential, current]);
  }
  return { id: crypto.randomUUID(), source, name, headers: ["Potential/V", "Current/A"], rows };
}
