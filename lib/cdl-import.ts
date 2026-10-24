import { strFromU8, unzipSync } from "fflate";
import { axisRole, numberCell, parseDataFile, parseText, type DataTable } from "./lsv-import";
import { COLORS, type CurrentUnit } from "./lsv-math";
import type { CdlSample, CdlSummaryPoint } from "./cdl-math";

export type CdlImportMode = "cv" | "branches" | "halfDelta";
export type CdlImportTable = DataTable & {
  rateHints?: number[]; rateHintSource?: string; notice?: string;
  headerRateMV?: number; fileNameRateMV?: number; rateWarning?: string;
  currentUnitHint?: CurrentUnit; currentUnitSource?: string; metadata?: Record<string, unknown>;
  unitSuggested?: CurrentUnit; unitSuggestionSource?: string;
};
export type CdlColumnMapping = { id: string; e: number; current: number; rateMV: string };
export type CdlSummaryMapping = { rate: number; anodic: number; cathodic: number; halfDelta: number };
export type CdlPendingImport = {
  table: CdlImportTable;
  name: string;
  groupName: string;
  replicate: string;
  mode: CdlImportMode;
  pairs: CdlColumnMapping[];
  summary: CdlSummaryMapping;
  summaryYs?: { column: number; groupName: string; replicate?: string; role?: "electrode" | "meanCurve"; selected: boolean }[];
  role?: "electrode" | "meanCurve";
  unit: CurrentUnit | "unconfirmed";
  area: string;
  summaryPotential: string;
  ratesConfirmed: boolean;
};

const rateColumn = (s: string) => /scan.?rate|扫[描速].*率|扫描速率|扫速|^rate\b|^v\s*(?:[/([]|$)|^ν|^(?:X\s*[:：]?\s*)?m?V\s*\/\s*s\b/i.test(s.trim());
const anodicColumn = (s: string) => /anodic|阳极|^\s*[ij]_?a\b/i.test(s);
const cathodicColumn = (s: string) => /cathodic|阴极|^\s*[ij]_?c\b/i.test(s);
const halfColumn = (s: string) => /half.?delta|half.?difference|半差|(?:Δ|delta)\s*[ij].*(?:\/\s*2|÷\s*2)|\([ij]_?a\s*[-−]\s*[ij]_?c\)\s*\/\s*2/i.test(s);
const fitReport = (table: DataTable) => /(?:^| · )(?:Cdl[_\s]*数值|计算设置与来源|设置与来源|Settings|Metadata|Provenance)(?:$|\b)/i.test(table.name) || table.headers.some(h => /standard.?error|intercept|pearson|残差|截距|标准误差|参数值/i.test(h)) || (!table.headers.some(rateColumn) && table.headers.some(h => /(?:^|[_\s])cdl(?=[\s_(/（]|$)|^\s*(?:slope\b|电容|斜率)/i.test(h)));
const scanRateFromHeader = (header: string): string => {
  const match = /(?:^|\D)(\d+(?:\.\d+)?)\s*mV\s*(?:[/_]\s*s|s\s*[-−]?\s*1|s(?:\b|_))/i.exec(header);
  return match ? match[1] : "";
};
const cdlPotentialColumn = (header: string) => axisRole(header, "lsv") === "x" || /^(?:E|Potential|Voltage)[_\s]+|_E_X_/i.test(header);
const cdlCurrentColumn = (header: string) => axisRole(header, "lsv") === "y" || /^(?:I|J|Current)[_\s]+|_[IJ]_Y_/i.test(header);
const cdlSheetName = (table: DataTable) => /\.xlsx$/i.test(table.source) && table.name.includes(" · ") ? table.name.slice(table.name.indexOf(" · ") + 3) : table.name;
const cdlMeanTable = (table: DataTable) => /均值.*取点|均值|mean/i.test(cdlSheetName(table));

export const CDL_MAX_GROUPS = 10, CDL_MAX_ELECTRODES = 60, CDL_MAX_SERIES = 40;
export const cdlElectrodeName = (groupName: string, replicate: string) => [groupName.trim(), replicate.trim()].filter(Boolean).join(" · ");
export const cdlElectrodeKey = (groupName: string, replicate: string) => JSON.stringify([groupName.trim(), replicate.trim()]);

/** A folder identifies the electrode; a scan-rate filename does not. */
function suggestedIdentity(table: CdlImportTable): { groupName: string; replicate: string } {
  const parts = table.source.replace(/\\/g, "/").split("/").filter(Boolean);
  const cdlIndex = parts.findLastIndex(part => /^cdl$/i.test(part));
  if (cdlIndex >= 2 && /^\d+$/.test(parts[cdlIndex - 1])) return { groupName: parts[cdlIndex - 2], replicate: parts[cdlIndex - 1] };
  const replicateIndex = parts.findLastIndex((part, index) => index < parts.length - 1 && /^\d+$/.test(part));
  if (replicateIndex >= 1) return { groupName: parts[replicateIndex - 1], replicate: parts[replicateIndex] };
  const exportedName = cdlSheetName(table).replace(/^(?:Cdl[_\s]*)?CV[_\s]*/i, "").replace(/[_\s]*\d+[-–]\d+mV(?:s|_s).*$/i, "");
  const exportedReplicate = /^(.*?)(?:[_\s]*(?:rep(?:licate)?|重复)[_\s]*|\s*·\s*)(\d+)\s*$/i.exec(exportedName);
  if (exportedReplicate) return { groupName: exportedReplicate[1], replicate: exportedReplicate[2] };
  return { groupName: cdlSheetName(table), replicate: "" };
}

function summaryIdentity(header: string, meanTable = false): { groupName: string; replicate?: string; role: "electrode" | "meanCurve"; selected: boolean } {
  const withoutQuantity = header.replace(/[_\s]*(?:half[_\s-]*delta[IJ]?|半差值?).*$/i, "").replace(/\s*[(/]\s*(?:[muμµn]?A|cm).*/i, "").trim();
  const replicate = /^(.*?)(?:[_\s]*(?:rep(?:licate)?|重复)[_\s]*|\s*·\s*)(\d+)\s*$/i.exec(withoutQuantity);
  const isDeviation = /(?:^|[_\s])(?:SD|SE|std|stdev|error|n)(?:[_\s]|$)|标准差|误差|偏差/i.test(header);
  const mean = !replicate && (meanTable || /(?:^|[_\s])mean(?:[_\s]|$)|均值/i.test(header));
  return { groupName: replicate?.[1] || withoutQuantity, ...(replicate ? { replicate: replicate[2] } : mean ? { replicate: "均值曲线" } : {}), role: mean ? "meanCurve" : "electrode", selected: !isDeviation };
}

function suggestedColumnUnit(table: CdlImportTable): CdlImportTable {
  if (table.currentUnitHint) return table;
  const headers = table.headers.filter(header => cdlCurrentColumn(header) || halfColumn(header));
  const units = headers.flatMap(header => {
    const match = /(?:^|[/(_\s])([muμµn]?A)(?=[/)_\s]|$)/i.exec(header);
    if (!match) return [];
    const density = /cm(?:\^?2|²)/i.test(header), token = match[1];
    const unit = /^mA$/i.test(token) ? density ? "mA/cm2" : "mA" : /^[uμµ]A$/i.test(token) ? density ? "uA/cm2" : "uA" : /^nA$/i.test(token) ? "nA" : density ? "A/cm2" : "A";
    return [unit as CurrentUnit];
  });
  if (!units.length || units.length !== headers.length || new Set(units).size !== 1) return table;
  return { ...table, unitSuggested: units[0], unitSuggestionSource: `所选电流 / 半差值列标题标注 ${units[0]}，请在单位选择框确认` };
}

function decodedText(bytes: Uint8Array): string {
  let value = new TextDecoder("utf-8").decode(bytes);
  if (value.includes("�")) value = new TextDecoder("gb18030").decode(bytes);
  return value;
}

/** Read the acquisition header before the generic table reader discards it. */
function acquisitionMetadata(text: string, source: string): Partial<CdlImportTable> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const dataHeader = lines.findIndex(line => /potential\s*\/\s*V/i.test(line) && /current\s*\/\s*A/i.test(line));
  const header = lines.slice(0, dataHeader >= 0 ? dataHeader : Math.min(lines.length, 100)).join("\n");
  const explicitCv = /cyclic\s+voltammetry|循环伏安|^\s*(?:technique\s*[:=]\s*)?CV\s*$/im.test(header);
  const wrongTechnique = /linear\s+sweep|\bLSV\b|impedance|\bEIS\b|chronoamperometry|chronopotentiometry|differential\s+pulse|square\s+wave|交流阻抗|线性扫描/i.exec(header);
  if (wrongTechnique && !explicitCv) throw new Error(`检测到 ${wrongTechnique[0]}，Cdl 需要完整双向 CV，不能把 LSV、EIS 或其他技术当作 CV 导入。`);
  if (!explicitCv && /freq(?:uency)?\s*\/|Z\s*[′'"″]\s*\/|phase\s*\//i.test(text.slice(0, 8000))) throw new Error("这是阻抗数据，请在 EIS 页面导入；Cdl 需要电位与电流的双向 CV。");
  const isChi = /CHI\s*\d{3,4}[A-Z]?|CH\s+Instruments|(?:^|\n)\s*Scan\s+Rate\s*\(/i.test(header);
  if (isChi && !explicitCv) throw new Error("辰华文本中未确认 Cyclic Voltammetry（CV）技术，请导出带完整测量头部的 CV 文本。");
  const rateMatch = /(?:scan\s*rate|扫描速率|扫速)\s*\(\s*(m?V)\s*\/\s*s\s*\)\s*[:=]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/i.exec(header);
  const headerRateMV = rateMatch ? Number(rateMatch[2]) * (rateMatch[1].toLowerCase() === "mv" ? 1 : 1000) : undefined;
  if (headerRateMV != null && (!Number.isFinite(headerRateMV) || headerRateMV <= 0)) throw new Error("文件头 Scan Rate 无效，请核对原始 CV。");
  const filename = source.replace(/\\/g, "/").split("/").at(-1) ?? source;
  const filenameMatch = /(?:^|[\s_\-])(?:cdl[\s_\-]*)?(\d+(?:\.\d+)?)\s*mV(?:\s*\/\s*s)?/i.exec(filename);
  const fileNameRateMV = filenameMatch ? Number(filenameMatch[1]) : undefined;
  const rateWarning = headerRateMV != null && fileNameRateMV != null && Math.abs(headerRateMV - fileNameRateMV) > 1e-6
    ? `扫描速率冲突：文件名提示 ${fileNameRateMV} mV/s，测量头部为 ${rateMatch![2]} ${rateMatch![1]}/s = ${headerRateMV} mV/s。已采用测量头部 ${headerRateMV} mV/s；不会按文件名改换速率。`
    : undefined;
  const unitHeader = dataHeader >= 0 ? lines[dataHeader] : "";
  const metadata: Record<string, unknown> = { technique: explicitCv ? "CV" : "unconfirmed", acquisitionHeader: header, originalPath: source };
  if (rateMatch) metadata.scanRateHeader = rateMatch[0];
  const notice = [headerRateMV != null ? `扫描速率读取自测量头部：${headerRateMV} mV/s。` : fileNameRateMV != null ? `文件名仅提示 ${fileNameRateMV} mV/s，尚未从测量头部确认。` : "", rateWarning].filter(Boolean).join(" ");
  return { ...(headerRateMV != null ? { rateHints: [headerRateMV], rateHintSource: `测量头部：${rateMatch![0]}`, headerRateMV } : {}), ...(fileNameRateMV != null ? { fileNameRateMV } : {}), ...(rateWarning ? { rateWarning } : {}), ...(notice ? { notice } : {}), ...(isChi && explicitCv && unitHeader ? { currentUnitHint: "A" as const, currentUnitSource: "辰华测量数据列 Current/A（绝对电流）" } : {}), metadata };
}

/** Recognize duplicated X and I*1000 columns by their values, without assuming units. */
export function cdlRawColumnGroups(table: DataTable): { e: number; current: number }[] {
  const groups: { e: number; current: number }[] = [];
  for (let c = 0; c + 3 < table.headers.length; c++) {
    const rows = table.rows.slice(0, 12).filter(row => [c, c + 1, c + 2, c + 3].every(index => row[index] != null));
    if (rows.length < 3) continue;
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (!rows.every(row => close(row[c]!, row[c + 2]!) && close(row[c + 1]! * 1000, row[c + 3]!))) continue;
    if (new Set(rows.map(row => row[c])).size < 2) continue;
    groups.push({ e: c, current: c + 1 });
    c += 3;
  }
  return groups;
}

export function suggestedCdlMappings(table: CdlImportTable): CdlColumnMapping[] {
  let pairs = cdlRawColumnGroups(table);
  if (!pairs.length) {
    const xs = table.headers.flatMap((header, c) => cdlPotentialColumn(header) ? [c] : []);
    const ys = table.headers.flatMap((header, c) => cdlCurrentColumn(header) ? [c] : []);
    if (xs.length === 1) pairs = ys.map(current => ({ e: xs[0], current }));
    else if (xs.length && xs.every(e => ys.includes(e + 1))) pairs = xs.map(e => ({ e, current: e + 1 }));
    else if (table.headers.length === 2) pairs = [{ e: 0, current: 1 }];
  }
  return pairs.slice(0, CDL_MAX_SERIES).map((pair, n) => ({
    ...pair,
    id: crypto.randomUUID(),
    rateMV: table.rateHints?.length === pairs.length ? String(table.rateHints[n]) : scanRateFromHeader(table.headers[pair.current]) || (pairs.length === 1 && table.fileNameRateMV != null ? String(table.fileNameRateMV) : ""),
  }));
}

export function cdlPendingTable(table: CdlImportTable): CdlPendingImport {
  const find = (fn: (header: string) => boolean, fallback: number) => {
    const index = table.headers.findIndex(fn);
    return index >= 0 ? index : Math.min(fallback, table.headers.length - 1);
  };
  const hasRate = table.headers.some(rateColumn), hasBranches = table.headers.some(anodicColumn) && table.headers.some(cathodicColumn);
  const mode: CdlImportMode = hasRate && hasBranches ? "branches" : hasRate && !table.headers.some(cdlPotentialColumn) ? "halfDelta" : "cv";
  const identity = suggestedIdentity(table), rate = find(rateColumn, 0);
  const summaryYs = mode === "halfDelta" && table.headers.length > 2 ? table.headers.flatMap((header, column) => column === rate ? [] : [{ column, ...summaryIdentity(header, cdlMeanTable(table)) }]) : undefined;
  return {
    table: suggestedColumnUnit(table), ...identity, name: cdlElectrodeName(identity.groupName, identity.replicate), mode, role: "electrode",
    pairs: suggestedCdlMappings(table),
    summary: { rate: find(rateColumn, 0), anodic: find(anodicColumn, 1), cathodic: find(cathodicColumn, 2), halfDelta: find(halfColumn, 1) },
    ...(summaryYs ? { summaryYs } : {}),
    unit: table.currentUnitHint ?? "unconfirmed", area: "1", summaryPotential: "", ratesConfirmed: table.headerRateMV != null,
  };
}

type RateMetadata = { sheet: string; rates: number[]; cells: string[] };
function xlsxRateMetadata(bytes: Uint8Array): { matrices: RateMetadata[]; grids: Map<string, (number | null)[][]> } {
  let total = 0;
  const files = unzipSync(bytes, { filter: part => {
    if (!/^xl\/.*\.xml$/.test(part.name) && part.name !== "xl/_rels/workbook.xml.rels") return false;
    total += part.originalSize;
    if (total > 80 * 1024 * 1024 || part.originalSize > 40 * 1024 * 1024) throw new Error("Excel 解压后过大，请拆分文件");
    return true;
  } });
  const tags = (root: Document | Element, tag: string) => Array.from(root.getElementsByTagNameNS("*", tag));
  const xml = (part: Uint8Array) => {
    const doc = new DOMParser().parseFromString(strFromU8(part), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Excel XML 无法读取");
    return doc;
  };
  if (!files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"]) return { matrices: [], grids: new Map() };
  const strings = files["xl/sharedStrings.xml"] ? tags(xml(files["xl/sharedStrings.xml"]), "si").map(si => tags(si, "t").map(t => t.textContent ?? "").join("")) : [];
  const rels = new Map(tags(xml(files["xl/_rels/workbook.xml.rels"]), "Relationship").map(r => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]));
  const results: RateMetadata[] = [], grids = new Map<string, (number | null)[][]>();
  for (const sheet of tags(xml(files["xl/workbook.xml"]), "sheet")) {
    const target = rels.get(sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
    if (!target) continue;
    const parts: string[] = [];
    for (const part of (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/")) {
      if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
    }
    const entry = files[parts.join("/")];
    if (!entry) continue;
    const grid: (number | null)[][] = [];
    const rows = tags(xml(entry), "row").map((row, position) => {
      const values = new Map<number, { value: number; ref: string }>();
      for (const cell of tags(row, "c")) {
        const ref = cell.getAttribute("r") ?? "", col = ref.replace(/\d/g, "").toUpperCase();
        let index = 0;
        for (const char of col) index = index * 26 + char.charCodeAt(0) - 64;
        const type = cell.getAttribute("t"), cached = tags(cell, "v")[0]?.textContent ?? "";
        const raw = type === "s" ? strings[Number(cached)] ?? "" : type === "inlineStr" ? tags(cell, "t").map(t => t.textContent ?? "").join("") : cached;
        if (["b", "e", "d"].includes(type ?? "") || raw.trim() === "") continue;
        const value = Number(raw);
        if (index > 0 && index <= 64 && Number.isFinite(value)) values.set(index - 1, { value, ref });
      }
      const rowIndex = Number(row.getAttribute("r") || position + 1) - 1;
      if (rowIndex < 0 || rowIndex > 50200) throw new Error("工作表超过 50,000 行，请拆分后导入");
      grid[rowIndex] = Array.from({ length: Math.max(0, ...values.keys()) + 1 }, (_, c) => values.get(c)?.value ?? null);
      return values;
    });
    grids.set(sheet.getAttribute("name") ?? "工作表", Array.from({ length: grid.length }, (_, r) => grid[r] ?? []));
    for (let r = 0; r + 2 < Math.min(rows.length, 60); r++) {
      const rates = [...rows[r]].filter(([c, rate]) => {
        const eA = rows[r + 1].get(c - 1)?.value, eC = rows[r + 2].get(c - 1)?.value;
        return rate.value > 0 && rate.value <= 100000 && eA != null && eC != null && Math.abs(eA) <= 5 && Math.abs(eA - eC) < 1e-8 && rows[r + 1].has(c) && rows[r + 2].has(c);
      }).sort(([a], [b]) => a - b);
      if (rates.length >= 3 && rates.every((entry, n) => n === 0 || entry[1].value > rates[n - 1][1].value)) {
        results.push({ sheet: sheet.getAttribute("name") ?? "工作表", rates: rates.map(([, entry]) => entry.value), cells: rates.map(([, entry]) => entry.ref) });
        break;
      }
    }
  }
  return { matrices: results, grids };
}

/** Restore completely blank interior rows which the shared generic reader omits. */
function preserveBlankRows(table: DataTable, grid: (number | null)[][]): DataTable {
  const matches = (raw: (number | null)[], expected: (number | null)[]) => expected.every((value, c) => value == null || raw[c] === value);
  const first = grid.findIndex(row => matches(row, table.rows[0]));
  if (first < 0) return table;
  const rows: (number | null)[][] = [];
  let next = 0;
  for (let r = first; r < grid.length && next < table.rows.length; r++) {
    const row = grid[r];
    if (matches(row, table.rows[next])) { rows.push(table.rows[next]); next++; }
    else if (row.every(value => value == null)) rows.push(Array.from({ length: table.headers.length }, () => null));
    else return table;
  }
  return next === table.rows.length ? { ...table, rows } : table;
}

function preserveTextBlankRows(table: DataTable, text: string): DataTable {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const delimiter of ["\t", ",", ";", " "]) {
    const grid = lines.map(line => {
      if (!line.trim()) return [];
      if (delimiter === " ") return line.trim().split(/\s+/).map(numberCell);
      const cells: string[] = [];
      let cell = "", quoted = false;
      for (let n = 0; n < line.length; n++) {
        const char = line[n];
        if (char === '"') { if (quoted && line[n + 1] === '"') { cell += '"'; n++; } else quoted = !quoted; }
        else if (char === delimiter && !quoted) { cells.push(cell); cell = ""; } else cell += char;
      }
      cells.push(cell);
      return cells.map(numberCell);
    });
    const restored = preserveBlankRows(table, grid);
    if (restored !== table) return restored;
  }
  return table;
}

export async function parseCdlDataFile(file: File): Promise<CdlImportTable[]> {
  if (/\.opju?$/i.test(file.name)) throw new Error("OPJU 是 Origin 工程文件。请在 Origin 中把 CV 工作表导出为 XLSX、CSV 或 TXT 后导入；拟合参数报告不能代替原始 CV。");
  if (!/\.(xlsx|csv|tsv|txt|dat|bin)$/i.test(file.name)) throw new Error("请上传 XLSX、CSV、TSV、TXT、DAT 或已验证的辰华 CV BIN");
  if (file.size > 20 * 1024 * 1024) throw new Error("单个文件不能超过 20 MB");
  const source = (file as File&{measurementSourcePath?:string}).measurementSourcePath || file.webkitRelativePath || file.name;
  let text = "", acquisition: Partial<CdlImportTable> = {};
  if (!/\.(xlsx|bin)$/i.test(file.name)) {
    text = decodedText(new Uint8Array(await file.arrayBuffer()));
    acquisition = acquisitionMetadata(text, source);
  }
  const tables = (await parseDataFile(file)).map(table => ({ ...table, source }));
  if (!/\.xlsx$/i.test(file.name)) {
    const result = tables.filter(table => !fitReport(table));
    if (!result.length) throw new Error("这是拟合参数报告，请导入原始 CV 或扫描速率、电流汇总数据。");
    if (!/\.bin$/i.test(file.name)) {
      return result.map(table => ({ ...preserveTextBlankRows(table, text), ...acquisition }));
    }
    // The shared BIN reader rejects non-CV techniques. Its scan-rate header
    // offset is not verified, so do not invent a scan rate from binary bytes.
    return result.map(table => ({ ...table, currentUnitHint: "A", currentUnitSource: "已验证的辰华 CV BIN 原始电流（A）", metadata: { technique: "CV", originalPath: source }, notice: "已读取 CV BIN 原始电流。BIN 扫描速率字段尚未验证，请从原测量记录填写 mV/s。" }));
  }
  const metadata = xlsxRateMetadata(new Uint8Array(await file.arrayBuffer()));
  const matrixNames = new Set(metadata.matrices.map(m => m.sheet));
  const eligible = tables.filter(table => !fitReport(table) && !matrixNames.has(cdlSheetName(table)));
  const replicatedGroups = new Set(eligible.flatMap(table => table.headers.some(rateColumn) ? table.headers.filter(halfColumn).map(header => summaryIdentity(header, cdlMeanTable(table))).filter(y => y.selected && y.replicate && y.role === "electrode").map(y => y.groupName) : []));
  let skippedMeans = 0;
  const inputs = eligible.filter(table => {
    if (!table.headers.some(rateColumn)) return true;
    const ys = table.headers.filter(halfColumn).map(header => summaryIdentity(header, cdlMeanTable(table))).filter(y => y.selected);
    if (ys.length && ys.every(y => y.role === "meanCurve" && replicatedGroups.has(y.groupName))) { skippedMeans++; return false; }
    return true;
  });
  const result = inputs.map(table => {
    const sheetName = cdlSheetName(table);
    table = preserveBlankRows(table, metadata.grids.get(sheetName) ?? []);
    const count = cdlRawColumnGroups(table).length;
    const compatible = metadata.matrices.filter(m => m.rates.length === count);
    const match = compatible.length === 1 ? compatible[0] : undefined;
    return {
      ...table,
      ...(match ? { rateHints: match.rates, rateHintSource: `${match.sheet}!${match.cells.join("、")}` } : {}),
      ...((count || skippedMeans) ? { notice: [count ? "已识别重复电位及电流 ×1000 列，默认选择对应的原始电流列。请核对各组列、扫描速率及单位。" : "", skippedMeans ? "同工作簿含完整平行样汇总，已优先读取各片电极；派生均值表不重复导入。" : ""].filter(Boolean).join(" ") } : {}),
    };
  });
  if (!result.length) throw new Error("工作簿中只有拟合报告或分块汇总表。请导出原始 CV 工作表，或整理成扫描速率、阳极电流、阴极电流三列。");
  return result;
}

export function parseCdlText(text: string, name = "样品 1"): CdlImportTable {
  const acquisition = acquisitionMetadata(text, "粘贴数据");
  const table = parseText(text, name, "粘贴数据");
  if (fitReport(table)) throw new Error("这是拟合参数报告。请粘贴原始 CV，或扫描速率与电流汇总表。");
  return { ...preserveTextBlankRows(table, text), ...acquisition };
}

export function samplesFromCdlImport(pending: CdlPendingImport[], existingCount: number, existingSamples: CdlSample[] = []): { samples: CdlSample[]; skipped: number } {
  if (!pending.length) throw new Error("请先导入数据");
  const samples: CdlSample[] = [];
  let skipped = 0;
  const expanded = pending.flatMap(item => {
    if (item.mode !== "halfDelta" || !item.summaryYs?.length) return [item];
    const selected = item.summaryYs.filter(y => y.selected);
    if (!selected.length) throw new Error(`“${item.table.name}”请至少选择一列半差值`);
    return selected.map(y => ({ ...item, groupName: y.groupName, replicate: y.replicate ?? item.replicate, role: y.role ?? item.role, name: cdlElectrodeName(y.groupName, y.replicate ?? item.replicate), summary: { ...item.summary, halfDelta: y.column } }));
  });
  for (const item of expanded) {
    const groupName = (item.groupName ?? item.name).trim(), replicate = (item.replicate ?? "").trim();
    const name = cdlElectrodeName(groupName, replicate), key = cdlElectrodeKey(groupName, replicate);
    if (!groupName) throw new Error("请填写样品组别；每个重复编号对应一片独立电极");
    if (item.unit === "unconfirmed") throw new Error(`请确认“${item.name}”所选电流列的单位；原始数值不会自动乘以 1000。`);
    const area = item.area.trim() ? Number(item.area) : undefined;
    if (area != null && (!Number.isFinite(area) || area <= 0)) throw new Error(`“${item.name}”的面积需大于 0`);
    const previous = existingSamples.find(s => cdlElectrodeKey(s.groupName || s.name, s.replicate || "") === key);
    let sample = samples.find(s => cdlElectrodeKey(s.groupName || s.name, s.replicate || "") === key);
    if ([sample, previous].some(existing => existing && (existing.role ?? "electrode") !== (item.role ?? "electrode"))) throw new Error(`“${name}”不能把已平均曲线与独立电极合并。请为均值曲线保留单独编号。`);
    if (sample && (sample.unit !== item.unit || sample.areaCM2 !== area)) throw new Error(`同一样品“${item.name}”的单位与面积需一致，或使用不同名称。`);
    if (previous && (previous.unit !== item.unit || previous.areaCM2 !== area)) throw new Error(`已有电极“${name}”的单位与面积不同。请使用相同设置，或修改组别与重复编号。`);
    if (!sample) {
      sample = { id: crypto.randomUUID(), name, groupName, role: item.role ?? "electrode", ...(replicate ? { replicate } : {}), color: COLORS[(existingCount + samples.length) % COLORS.length], visible: true, source: item.table.source, unit: item.unit, ...(area != null ? { areaCM2: area } : {}), series: [] };
      samples.push(sample);
    } else if (!sample.source.split("；").includes(item.table.source)) sample.source += `；${item.table.source}`;
    if (item.mode === "cv") {
      if (!item.pairs.length) throw new Error(`请为“${item.name}”选择至少一组电位、电流列`);
      if (item.table.rateHints?.length && !item.ratesConfirmed) throw new Error(`请核对并确认“${item.name}”从其他工作表读取的扫描速率对应关系。`);
      for (const pair of item.pairs) {
        const rateMV = item.table.headerRateMV != null && item.pairs.length === 1 ? item.table.headerRateMV : Number(pair.rateMV);
        if (!pair.rateMV.trim() || !Number.isFinite(rateMV) || rateMV <= 0) throw new Error(`“${item.name}”的每组扫描速率必须是大于 0 的 mV/s 数值`);
        const duplicate = [...sample.series, ...(previous?.series ?? [])].some(s => s.rateMV === rateMV) || [...(sample.summary ?? []), ...(previous?.summary ?? [])].some(s => s.rateMV === rateMV);
        if (/\bmV|μV|µV|uV/i.test(item.table.headers[pair.e])) throw new Error("电位列需要以 V 为单位，请先换算后导入");
        if (pair.e === pair.current) throw new Error("电位列与电流列不能相同");
        // Preserve missing rows in acquisition order: removing them would let
        // interpolation bridge a gap and invent a current at the selected E₀.
        const rows = [...item.table.rows];
        while (rows.length && rows.at(-1)?.[pair.e] == null && rows.at(-1)?.[pair.current] == null) rows.pop();
        let valid = 0;
        const points = rows.map((row, sourceRowIndex) => {
          const e = row[pair.e], current = row[pair.current];
          if (e == null || current == null || !Number.isFinite(e) || !Number.isFinite(current)) {
            skipped++; return { e: Number.NaN, current: Number.NaN, sourceRowIndex, originalRow: [...row] };
          }
          valid++; return { e, current, sourceRowIndex, originalRow: [...row] };
        });
        if (valid < 2) throw new Error(`“${item.name}”不足两个有效 CV 数据点`);
        const rateWarning = [item.table.rateWarning, duplicate ? `同一电极存在重复的 ${rateMV} mV/s 原始文件。本次重复文件已保留，默认排除拟合；请在取点明细中选择使用的文件，不会自动平均。` : ""].filter(Boolean).join(" ");
        sample.series.push({ id: crypto.randomUUID(), rateMV, points, source: `${item.table.source} · ${item.table.name} · ${pair.e + 1}/${pair.current + 1} 列`, ...(duplicate ? { included: false } : {}), rateSource: item.table.headerRateMV != null ? item.table.rateHintSource : item.table.rateHintSource || (item.table.fileNameRateMV != null ? "文件名提示，经导入表确认" : "手动填写"), ...(item.table.headerRateMV != null ? { headerRateMV: item.table.headerRateMV } : {}), ...(item.table.fileNameRateMV != null ? { fileNameRateMV: item.table.fileNameRateMV } : {}), ...(rateWarning ? { rateWarning } : {}), metadata: { ...item.table.metadata, originalHeaders: [...item.table.headers], selectedPotentialColumn: pair.e + 1, selectedCurrentColumn: pair.current + 1 } });
      }
      if (sample.series.length + (previous?.series.length ?? 0) > CDL_MAX_SERIES) throw new Error(`“${sample.name}”每片电极最多保存 ${CDL_MAX_SERIES} 组原始 CV`);
    } else {
      const summaryPotential = item.summaryPotential.trim() ? Number(item.summaryPotential) : undefined;
      if (summaryPotential != null && !Number.isFinite(summaryPotential)) throw new Error("汇总表取点电位需填写有效的 V 数值");
      if (sample.summary?.length && sample.summaryPotential !== summaryPotential) throw new Error(`同一样品“${item.name}”的汇总取点电位需一致`);
      if (summaryPotential != null) sample.summaryPotential = summaryPotential;
      const { rate, anodic, cathodic, halfDelta } = item.summary;
      const columns = item.mode === "branches" ? [rate, anodic, cathodic] : [rate, halfDelta];
      if (new Set(columns).size !== columns.length) throw new Error("扫描速率、阳极、阴极或半差值需选择不同列");
      const rateFactor = rateColumn(item.table.headers[rate]) && /(?:^|[^m])V\s*\/\s*s/i.test(item.table.headers[rate]) ? 1000 : 1;
      const rows: CdlSummaryPoint[] = [];
      for (const row of item.table.rows) {
        if (columns.some(c => row[c] == null)) { skipped++; continue; }
        const rateMV = row[rate]! * rateFactor;
        if (!Number.isFinite(rateMV) || rateMV <= 0) throw new Error("汇总表中的扫描速率需是大于 0 的 mV/s 数值");
        const duplicate = [...rows, ...(sample.summary ?? []), ...(previous?.summary ?? [])].some(s => s.rateMV === rateMV) || [...sample.series, ...(previous?.series ?? [])].some(s => s.rateMV === rateMV);
        const source = `${item.table.source} · ${item.table.name} · ${columns.map(c => c + 1).join("/")} 列${duplicate ? " · 重复速率，默认排除拟合" : ""}`;
        const rateSource = rateFactor === 1000 ? `${item.table.headers[rate]}，V/s × 1000 转为 mV/s` : `${item.table.headers[rate]}（mV/s）`;
        const rateWarning = duplicate ? `同一电极存在重复的 ${rateMV} mV/s 汇总数据，已保留并默认排除拟合，请选择使用的数据，不会自动平均。` : undefined;
        rows.push(item.mode === "branches" ? { rateMV, anodic: row[anodic]!, cathodic: row[cathodic]!, source, rateSource, ...(duplicate ? { included: false, rateWarning } : {}) } : { rateMV, halfDelta: row[halfDelta]!, source, rateSource, ...(duplicate ? { included: false, rateWarning } : {}) });
      }
      if (rows.length < 2) throw new Error(`“${item.name}”至少需要两组有效扫描速率`);
      sample.summary = [...(sample.summary ?? []), ...rows];
      if (sample.summary.length + (previous?.summary?.length ?? 0) > CDL_MAX_SERIES) throw new Error(`“${sample.name}”每片电极最多保存 ${CDL_MAX_SERIES} 组汇总数据`);
    }
  }
  const existingKeys = new Set(existingSamples.map(sample => cdlElectrodeKey(sample.groupName || sample.name, sample.replicate || "")));
  const newCount = samples.filter(sample => !existingKeys.has(cdlElectrodeKey(sample.groupName || sample.name, sample.replicate || ""))).length;
  if (existingCount + newCount > CDL_MAX_ELECTRODES) throw new Error(`已有 ${existingCount} 片电极，本次最多新增 ${Math.max(0, CDL_MAX_ELECTRODES - existingCount)} 片；相同组别与重复编号只合并扫描速率。`);
  const groups = new Set([...existingSamples, ...samples].map(sample => sample.groupName || sample.name));
  if (groups.size > CDL_MAX_GROUPS) throw new Error(`最多比较 ${CDL_MAX_GROUPS} 个样品组。当前共 ${groups.size} 组；每组可分别保留多片重复电极。`);
  return { samples, skipped };
}
