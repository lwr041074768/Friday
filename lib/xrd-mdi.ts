import type { DataTable } from "./lsv-import";

// Jade ASCII MDI: title, seven scan fields, then consecutive intensities.
// Field order is corroborated by CarbonXS data_io.py read_mdi_file/write_mdi_file:
// https://github.com/lktsui/carbon_xs_gui/blob/master/data_io.py
// Terminator/padding handling and range checks were verified read-only against
// 25 files shipped with Jade 9. Four inconsistent demo files are rejected.
const MAX_POINTS = 50000;
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/;
const invalid = (reason: string): never => {
  throw new Error(`无法可靠读取此 MDI：${reason}。请在 JADE 中核对扫描范围和点数，或导出 2θ/Intensity 文本后导入。`);
};

function value(token: string, label: string): number {
  if (!NUMERIC.test(token)) invalid(`${label}不是有效数值`);
  const parsed = Number(token.replace(/[dD]/, "e"));
  if (!Number.isFinite(parsed)) invalid(`${label}超出有效数值范围`);
  return parsed;
}

export function parseXrdMdi(bytes: Uint8Array, name: string, source: string): DataTable {
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("�")) text = new TextDecoder("gb18030").decode(bytes);
  // DOS EOF is only allowed at the end; binary .mdi document images are not XRD.
  text = text.replace(/^\uFEFF/, "").replace(/[\s\x1a]+$/, "");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) invalid("不是已验证的 JADE ASCII 衍射数据格式");
  const lines = text.split(/\r\n?|\n/);
  if (lines.length < 3) invalid("缺少标题、扫描参数或强度数据");
  const fields = lines[1].trim().split(/\s+/);
  if (fields.length !== 7 || !fields[3] || NUMERIC.test(fields[3])) invalid("第二行需含起点、步长、计数时间、靶材、波长、终点和点数七个字段");
  const start = value(fields[0], "起始 2θ"), step = value(fields[1], "2θ 步长");
  const dwell = value(fields[2], "计数时间"), wavelength = value(fields[4], "波长");
  const end = value(fields[5], "终止 2θ"), count = value(fields[6], "声明点数");
  if (!Number.isInteger(count) || count < 2 || count > MAX_POINTS) invalid("声明点数需为 2–50,000 的整数");
  if (!step || dwell <= 0 || wavelength <= 0) invalid("步长不能为零，计数时间和波长需大于零");
  if (start < 0 || start > 180 || end < 0 || end > 180 || (end - start) * step <= 0) invalid("2θ 范围或扫描方向与步长不一致");
  const last = start + (count - 1) * step;
  const tolerance = Math.max(1e-9, Math.abs(step) * 1e-7);
  const remaining = (end - last) * Math.sign(step);
  // Some Jade files give a range limit between the final point and the next
  // step (e.g. 5/.03/40/1167). Honor the recorded step; never stretch the axis.
  if (!Number.isFinite(last) || last < -tolerance || last > 180 + tolerance || remaining < -tolerance || remaining >= Math.abs(step) - tolerance) invalid("起点、终点、步长与声明点数不一致");
  const tokens = lines.slice(2).join(" ").trim().split(/\s+/);
  if (tokens.length < count) invalid(`声明 ${count} 点，实际强度不足（${tokens.length} 个）`);
  const intensities = tokens.slice(0, count).map((token, n) => value(token, `第 ${n + 1} 点强度`));
  // Recognize -1 only after all declared intensities. Negative measured data
  // inside the declared range remains unchanged. Jade may pad to eight columns.
  const tail = tokens.slice(count).map(token => value(token, "数据尾部"));
  if (tail.length && (tail[0] !== -1 || tail.length > 8 || tail.slice(1).some(n => n !== 0))) invalid(`声明 ${count} 点，但数据尾部含额外强度或未知内容`);
  return {
    id: crypto.randomUUID(), source, name, headers: ["2theta / °", "Intensity"],
    rows: intensities.map((intensity, n) => [Number((start + n * step).toPrecision(15)), intensity]),
  };
}
