import { XRD_REFERENCE_COLORS, type ReferenceCard, type ReferencePeak } from "./xrd-reference-types";

export type XrdReferenceColumnMapping = {
  positionColumn: number;
  intensityColumn: number;
  positionType: "twoTheta" | "d";
  hklColumns?: number[];
  /** An explicitly identified secondary d-spacing column, never guessed by value. */
  dColumn?: number;
  sectionIndex?: number;
};

export type XrdReferenceMetadata = { name?: string; cardNumber?: string; formula?: string; wavelength?: number };
export type XrdReferencePreview = {
  metadata: XrdReferenceMetadata;
  headers: string[];
  rows: string[][];
  rowLineNumbers: number[];
  suggestedMapping: XrdReferenceColumnMapping | null;
  requiresColumnSelection: boolean;
  warnings: string[];
  sections: { index: number; startLine: number; endLine: number; rowCount: number }[];
  suspectedSpectrum: boolean;
};
export type XrdReferenceImportOptions = {
  mapping: XrdReferenceColumnMapping;
  wavelength: number;
  name?: string;
  cardNumber?: string;
  formula?: string;
  allowSpectrum?: boolean;
};
export type XrdReferenceImportResult = { card: ReferenceCard; warnings: string[]; skippedRows: number; totalRows: number };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LINES = 15000;
const MAX_PEAKS = 4000;
const numberPattern = /^[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+\-]?\d+)?(?:\(\d+\))?[*aAbBcCdDxX?~]*$/;

/** Decode browser-local TXT bytes. No content is sent to a server. */
export function decodeXrdReferenceBytes(input: ArrayBuffer | Uint8Array): { text: string; encoding: "utf-8" | "gb18030" | "utf-16le" | "utf-16be"; warnings: string[] } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_BYTES) throw new Error("标准卡片 TXT 不能超过 5 MB；请导出单张卡片的峰表。");
  let encoding: "utf-8" | "gb18030" | "utf-16le" | "utf-16be" = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { encoding = "gb18030"; }
  }
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error("此文件含二进制控制字符；请导入 JADE 导出的文本峰表。");
  return { text, encoding, warnings: encoding === "utf-8" ? [] : [`文件按 ${encoding.toUpperCase()} 解码，请核对预览中的名称和列。`] };
}

function numeric(token: string | undefined): number | null {
  if (!token || !numberPattern.test(token.trim())) return null;
  const value = Number(token.trim().replace("−", "-").replace(/\(\d+\)(?=[*aAbBcCdDxX?~]*$)/, "").replace(/[*aAbBcCdDxX?~]+$/, "").replace(/[dD]/, "e"));
  return Number.isFinite(value) ? value : null;
}

// Quoted delimited fields and grouped Miller indices stay in one column.
function tokenize(line: string): string[] {
  const clean = line.trim().replace(/^\s*(?:#|\/\/)\s*/, "");
  const delimiter = clean.includes("\t") ? "\t" : clean.includes(",") ? "," : clean.includes(";") ? ";" : null;
  if (!delimiter) return clean.match(/\([^)]*\)|"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^["']|["']$/g, "")) ?? [];
  const cells: string[] = []; let cell = "", quoted = false;
  for (let index = 0; index < clean.length; index++) {
    const character = clean[index];
    if (character === '"') {
      if (quoted && clean[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function label(token: string): "twoTheta" | "d" | "intensity" | "h" | "k" | "l" | "hkl" | null {
  const key = token.toLowerCase().replace(/[θϑ]/g, "theta").replace(/[åÅ]/g, "a").replace(/[\s_°º.()%\[\]{}]/g, "");
  if (/^(?:2[-]?theta|two[-]?theta|2th|2tth)(?:deg|degree|degrees)?$/.test(key) || /^2theta\//.test(key)) return "twoTheta";
  if (/^(?:d|d[-]?spacing|dspace)(?:a|angstrom|angstroms|\/a)?$/.test(key)) return "d";
  if (/^(?:i|i\/i[o0]|i\/imax|int|intensity|relativeintensity|relint|i[ro]|强度|相对强度|相对强度值)$/.test(key)) return "intensity";
  if (["h", "k", "l", "hkl"].includes(key)) return key as "h" | "k" | "l" | "hkl";
  return null;
}

function headerCells(tokens: string[]): string[] {
  const headers: string[] = [];
  for (const token of tokens) {
    if (headers.length && /^(?:\((?:deg\.?|degrees?|a|å|Å|angstrom|%)\)|\[(?:deg\.?|degrees?|a|å|Å|angstrom|%)\])$/i.test(token)) headers[headers.length - 1] += token;
    else headers.push(token);
  }
  return headers;
}

function infer(headers: string[], sectionIndex: number): XrdReferenceColumnMapping | null {
  const meanings = headers.map(label);
  const theta = meanings.indexOf("twoTheta"), d = meanings.indexOf("d"), intensity = meanings.indexOf("intensity");
  if (intensity < 0 || (theta < 0 && d < 0) || meanings.filter(meaning => meaning === "intensity").length !== 1 || meanings.filter(meaning => meaning === "twoTheta").length > 1 || meanings.filter(meaning => meaning === "d").length > 1) return null;
  const combinedHkl = meanings.indexOf("hkl");
  const separateHkl = [meanings.indexOf("h"), meanings.indexOf("k"), meanings.indexOf("l")];
  const hkl = combinedHkl >= 0 ? [combinedHkl] : separateHkl.every(index => index >= 0) ? separateHkl : [];
  return { positionColumn: theta >= 0 ? theta : d, intensityColumn: intensity, positionType: theta >= 0 ? "twoTheta" : "d", ...(d >= 0 && theta >= 0 ? { dColumn: d } : {}), ...(hkl.length ? { hklColumns: hkl } : {}), sectionIndex };
}

function readMetadata(line: string, metadata: XrdReferenceMetadata): boolean {
  const clean = line.trim().replace(/^(?:#|\/\/)\s*/, "");
  const bareCard = clean.match(/^(?:PDF|JCPDS|ICDD)\s*#?\s*[-:]?\s*(\d{2}[- ]\d{3}[- ]\d{4}|\d{2}[- ]\d{4})(?:\s|$)/i);
  if (bareCard) { metadata.cardNumber = bareCard[1].replace(/ /g, "-"); return true; }
  const parts = clean.match(/^([^:=：]{1,60})\s*[:=：]\s*(.+)$/);
  if (!parts) return false;
  const key = parts[1].toLowerCase().replace(/[åÅ]/g, "a").replace(/λ/g, "lambda").replace(/[\s_#().-]/g, ""), value = parts[2].trim();
  if (/^(?:card|cardno|cardnumber|pdf|pdfno|pdfnumber|pdfcard|icdd|icddno|jcpds|jcpdsno|卡号|卡片编号)$/.test(key)) metadata.cardNumber = value.slice(0, 160);
  else if (/^(?:name|phasename|phase|compound|compoundname|chemicalname|mineral|mineralname|物相|物相名称|名称)$/.test(key)) metadata.name = value.slice(0, 200);
  else if (/^(?:formula|chemicalformula|sumformula|化学式|分子式)$/.test(key)) metadata.formula = value.slice(0, 200);
  else if (/^(?:wavelength|lambda|波长|wavelengtha|lambdaa)$/.test(key)) {
    const match = value.match(/^[+]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    const wavelength = match ? Number(match[0]) : NaN;
    // nm-labelled wavelengths are converted explicitly, never by magnitude.
    if (Number.isFinite(wavelength) && wavelength > 0) metadata.wavelength = /\bnm\b/i.test(value) ? wavelength * 10 : wavelength;
  } else return false;
  return true;
}

type TextSection = { headers: string[]; rows: string[][]; lineNumbers: number[]; metadata: XrdReferenceMetadata; startLine: number; endLine: number };
function scanText(text: string): { sections: TextSection[]; warnings: string[] } {
  if (text.length > MAX_BYTES) throw new Error("标准卡片 TXT 不能超过 5 MB。");
  const lines = text.replace(/^\uFEFF/, "").replace(/\x1a\s*$/, "").split(/\r\n?|\n/);
  if (lines.length > MAX_LINES) throw new Error("文本超过 15,000 行；请导出单张卡片的峰表。");
  const sections: TextSection[] = []; const warnings: string[] = [];
  let metadata: XrdReferenceMetadata = {}, headers: string[] = [], current: TextSection | null = null;
  let repeatedMetadata = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const previousCard = metadata.cardNumber;
    if (readMetadata(line, metadata)) {
      if (current && previousCard && metadata.cardNumber !== previousCard) { repeatedMetadata = true; current = null; headers = []; }
      continue;
    }
    const tokens = tokenize(line);
    const possibleHeaders = headerCells(tokens);
    const meanings = possibleHeaders.map(label);
    const header = meanings.includes("intensity") && (meanings.includes("twoTheta") || meanings.includes("d"));
    if (header) {
      if (current && current.rows.length) current = null;
      headers = possibleHeaders;
      continue;
    }
    if (tokens.length < 2 || numeric(tokens[0]) === null) continue;
    if (!current) {
      current = { headers: [...headers], rows: [], lineNumbers: [], metadata: { ...metadata }, startLine: index + 1, endLine: index + 1 };
      sections.push(current);
    }
    current.rows.push(tokens); current.lineNumbers.push(index + 1); current.endLine = index + 1;
    if (current.rows.length > MAX_PEAKS) throw new Error("单段数据超过 4,000 行；请确认导入的是标准卡片峰表，而不是连续扫描谱。");
  }
  if (sections.length > 1) warnings.push(`检测到 ${sections.length} 段峰表，请选择一段导入，避免混合不同卡片。`);
  if (repeatedMetadata) warnings.push("检测到不同卡号；每次只导入所选段对应的卡片。");
  if (!sections.length) throw new Error("未找到可预览的数值峰表；请从 JADE 导出包含 2θ 或 d 和相对强度的 TXT。");
  return { sections, warnings };
}

function regularScan(rows: string[][], mapping: XrdReferenceColumnMapping | null): boolean {
  if (rows.length < 100) return false;
  const column = mapping?.positionColumn ?? 0;
  const positions = rows.map(row => numeric(row[column])).filter((position): position is number => position !== null);
  if (positions.length < 100) return false;
  const differences = positions.slice(1).map((position, index) => position - positions[index]);
  const step = differences[0];
  return Math.abs(step) > 0 && differences.filter(difference => Math.abs(difference - step) <= Math.max(1e-6, Math.abs(step) * 0.001)).length >= differences.length * 0.98;
}

export function previewXrdReferenceText(text: string, fileName = "reference.txt", sectionIndex = 0): XrdReferencePreview {
  const { sections, warnings } = scanText(text);
  const section = sections[sectionIndex];
  if (!section) throw new Error("所选峰表段不存在，请重新预览文件。");
  let suggestedMapping = infer(section.headers, sectionIndex);
  const rowWidths = section.rows.slice(0, 12).map(row => row.length);
  if (suggestedMapping && section.headers.length > Math.max(...rowWidths)) suggestedMapping = null;
  const width = Math.max(...section.rows.slice(0, 12).map(row => row.length), section.headers.length);
  const suspectedSpectrum = regularScan(section.rows, suggestedMapping);
  if (!suggestedMapping) warnings.push("列名不能唯一确定峰位和强度；请按预览手动选择，程序不会凭数值大小猜测 2θ 或 d。");
  if (suspectedSpectrum) warnings.push("该段数据近似等步长且点数较多，可能是连续扫描谱；标准卡片需导入离散峰表。");
  if (section.metadata.wavelength === undefined) warnings.push("文件未注明波长；请填写 JADE 导出时所用的波长，特别是导入 2θ 列时。");
  return {
    metadata: { ...section.metadata, name: section.metadata.name ?? fileName.replace(/\.[^.]+$/, "") },
    headers: Array.from({ length: width }, (_, index) => section.headers[index] || `第 ${index + 1} 列`),
    rows: section.rows.slice(0, 12), rowLineNumbers: section.lineNumbers.slice(0, 12), suggestedMapping,
    requiresColumnSelection: !suggestedMapping, warnings,
    sections: sections.map((entry, index) => ({ index, startLine: entry.startLine, endLine: entry.endLine, rowCount: entry.rows.length })),
    suspectedSpectrum,
  };
}

export function parseXrdReferenceText(text: string, fileName: string, options: XrdReferenceImportOptions): XrdReferenceImportResult {
  const { sections, warnings } = scanText(text);
  const mapping = options.mapping;
  const section = sections[mapping.sectionIndex ?? 0];
  if (!section) throw new Error("所选峰表段不存在，请重新预览文件。");
  if (!Number.isFinite(options.wavelength) || options.wavelength <= 0 || options.wavelength > 10) throw new Error("波长需为大于 0、不超过 10 的数值，单位 Å。");
  const columns = [mapping.positionColumn, mapping.intensityColumn, ...(mapping.hklColumns ?? []), ...(mapping.dColumn === undefined ? [] : [mapping.dColumn])];
  const width = Math.max(...section.rows.map(row => row.length));
  if (columns.some(column => !Number.isInteger(column) || column < 0 || column >= width) || mapping.positionColumn === mapping.intensityColumn || !["twoTheta", "d"].includes(mapping.positionType)) throw new Error("峰位列和强度列必须是不同的有效列，请核对列映射。");
  if (regularScan(section.rows, mapping) && !options.allowSpectrum) throw new Error("这段数据疑似连续扫描谱，不能直接当作标准卡片。请导出离散峰表，或核对后明确确认此文件确为峰表。");
  let skippedRows = 0, markedValues = 0, inconsistentD = 0;
  const skippedLines: number[] = [], peaks: ReferencePeak[] = [];
  for (let index = 0; index < section.rows.length; index++) {
    const row = section.rows[index], position = numeric(row[mapping.positionColumn]), intensity = numeric(row[mapping.intensityColumn]);
    let twoTheta = NaN, d = NaN;
    if (position !== null && position > 0 && intensity !== null && intensity >= 0) {
      if (mapping.positionType === "d") {
        d = position; const sine = options.wavelength / (2 * d);
        if (sine > 0 && sine < 1) twoTheta = 2 * Math.asin(sine) * 180 / Math.PI;
      } else if (position < 180) {
        twoTheta = position; d = options.wavelength / (2 * Math.sin(twoTheta * Math.PI / 360));
      }
    }
    if (!Number.isFinite(twoTheta) || !Number.isFinite(d) || intensity === null || intensity < 0) {
      skippedRows++; if (skippedLines.length < 8) skippedLines.push(section.lineNumbers[index]); continue;
    }
    if (/\(\d+\)|[*aAbBcCdDxX?~]$/.test(row[mapping.positionColumn]) || /\(\d+\)|[*aAbBcCdDxX?~]$/.test(row[mapping.intensityColumn])) markedValues++;
    if (mapping.dColumn !== undefined && mapping.positionType === "twoTheta") {
      const suppliedD = numeric(row[mapping.dColumn]);
      if (suppliedD !== null && suppliedD > 0) {
        // Retain the explicitly imported angle as authoritative. A rounded d
        // column is only a consistency check, not an undocumented axis change.
        if (Math.abs(suppliedD - d) > Math.max(0.002, d * 0.002)) inconsistentD++;
      }
    }
    const hkl = (mapping.hklColumns ?? []).map(column => row[column]?.trim()).filter(Boolean).join(" ");
    peaks.push({ twoTheta, d, intensity, ...(hkl ? { hkl } : {}) });
  }
  if (!peaks.length || peaks.every(peak => peak.intensity === 0)) throw new Error("所选列未得到有效衍射峰；请检查 2θ/d 类型、波长和强度列。");
  if (skippedRows) warnings.push(`跳过 ${skippedRows} 行无效数据（行号 ${skippedLines.join("、")}${skippedRows > skippedLines.length ? "等" : ""}）；请核对原文件。`);
  if (markedValues) warnings.push(`${markedValues} 行含不确定度或标记，导入采用数值主体；这些标记不能代表更高鉴定可信度。`);
  if (inconsistentD) warnings.push(`${inconsistentD} 行的 d 与所选 2θ/波长不一致；保留 2θ 并按所填波长换算 d，请核对波长和列。`);
  const maximum = Math.max(...peaks.map(peak => peak.intensity));
  if (Math.abs(maximum - 100) > 1e-8) warnings.push(`输入强度最大值 ${maximum}，已统一归一到 100；原 TXT 可在本地保留用于核对。`);
  const sourceWavelength = section.metadata.wavelength;
  if (sourceWavelength !== undefined && Math.abs(sourceWavelength - options.wavelength) > 1e-6) warnings.push(`文件记载波长 ${sourceWavelength} Å，当前使用 ${options.wavelength} Å；请确认这是导出时实际波长。`);
  if (sourceWavelength === undefined && mapping.positionType === "twoTheta") warnings.push(`文件未给出波长，2θ 按用户填写的 ${options.wavelength} Å 换算 d；波长不正确会影响比较。`);
  const card: ReferenceCard = {
    id: crypto.randomUUID(), name: options.name?.trim() || section.metadata.name || fileName.replace(/\.[^.]+$/, ""),
    source: "jade", sourceFile: fileName, sourceId: options.cardNumber?.trim() || section.metadata.cardNumber,
    formula: options.formula?.trim() || section.metadata.formula, wavelength: options.wavelength,
    peaks: peaks.map(peak => ({ ...peak, intensity: peak.intensity / maximum * 100 })).sort((a, b) => a.twoTheta - b.twoTheta),
    warnings: [...warnings], visible: true, color: XRD_REFERENCE_COLORS[0],
    citation: "用户本地导入 JADE/TXT 峰表；来源与卡号以原文件和用户核对为准。",
  };
  return { card, warnings, skippedRows, totalRows: section.rows.length };
}
