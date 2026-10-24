import { strToU8, zipSync } from "fflate";
import { buildXyOriginExport, type XyExportOptions, type XyOriginPayload } from "./xy-origin-export";

export type DataExportFormat = "txt" | "xlsx" | "csv" | "tsv";
type Cell = string | number | null;
type Row = Cell[];

function* dataRows(payload: XyOriginPayload): Generator<Row> {
  yield payload.samples.flatMap(sample => [sample.name, ...payload.columns.map(column => `${column.label} (${column.unit})`)]);
  const count = Math.max(...payload.samples.map(sample => sample.rows.length));
  for (let index = 0; index < count; index++) {
    yield payload.samples.flatMap(sample => [null, ...(sample.rows[index] ?? payload.columns.map(() => null))]);
  }
}

function* noteRows(payload: XyOriginPayload): Generator<Row> {
  yield ["样品名称", "来源文件", "数据类型", "导入虚部约定", "图中显示", "模拟数据", "备注", "X 轴标题", "Y 轴标题", "处理设置", "图形样式", "X/Y 等比例", "导出时间"];
  for (const sample of payload.samples) {
    yield [sample.name, sample.source, payload.kind.toUpperCase(), sample.imaginary === null ? "不适用" : sample.imaginary === "negative" ? "已取负 −Z″" : "原始 Z″",
      sample.visible ? "是" : "否", sample.demo ? "是" : "否", sample.note,
      payload.axes.x, payload.axes.y, JSON.stringify(payload.settings), payload.plot.style === "line" ? "连线" : "散点", payload.plot.equalUnits ? "是" : "否", payload.createdAt];
  }
}

function delimitedCell(value: Cell, delimiter: string): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  // Metadata is text even when opened in Excel. Never turn a sample name into a formula.
  const text = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
  return text.includes(delimiter) || /["\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function textFile(payload: XyOriginPayload, delimiter: string): Uint8Array {
  const lines: string[] = [];
  for (const row of dataRows(payload)) lines.push(row.map(value => delimitedCell(value, delimiter)).join(delimiter));
  lines.push("", "样品备注");
  for (const row of noteRows(payload)) lines.push(row.map(value => delimitedCell(value, delimiter)).join(delimiter));
  return strToU8("\uFEFF" + lines.join("\r\n") + "\r\n");
}

function xmlText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let output = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) output = String.fromCharCode(65 + (n - 1) % 26) + output;
  return output;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function worksheet(rows: Iterable<Row>, columns: number, length: number): Uint8Array {
  const parts = [XML, `<worksheet xmlns="${SHEET_NS}"><dimension ref="A1:${columnName(columns - 1)}${length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${columns}" width="25" customWidth="1"/></cols><sheetData>`];
  let rowNumber = 0;
  for (const row of rows) {
    rowNumber++;
    const cells: string[] = [];
    row.forEach((value, index) => {
      if (value === null) return;
      const reference = columnName(index) + rowNumber;
      const style = rowNumber === 1 ? ' s="1"' : "";
      cells.push(typeof value === "number"
        ? `<c r="${reference}"${style}><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`);
    });
    parts.push(`<row r="${rowNumber}">${cells.join("")}</row>`);
  }
  parts.push("</sheetData></worksheet>");
  return strToU8(parts.join(""));
}

function excelFile(payload: XyOriginPayload): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8(XML + `<workbook xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${payload.kind.toUpperCase()} 数据" sheetId="1" r:id="rId1"/><sheet name="样品备注" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    "xl/styles.xml": strToU8(XML + `<styleSheet xmlns="${SHEET_NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": worksheet(dataRows(payload), payload.samples.length * (payload.columns.length + 1), Math.max(...payload.samples.map(sample => sample.rows.length)) + 1),
    "xl/worksheets/sheet2.xml": worksheet(noteRows(payload), 13, payload.samples.length + 1),
  };
  return zipSync(entries, { level: 6 });
}

export function buildXyDataFile(options: XyExportOptions, format: DataExportFormat) {
  const payload = buildXyOriginExport(options);
  if (format === "xlsx") return { bytes: excelFile(payload), extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (!["txt", "csv", "tsv"].includes(format)) throw new Error("请选择 TXT、Excel、CSV 或 TSV。");
  return { bytes: textFile(payload, format === "csv" ? "," : "\t"), extension: format,
    mime: format === "csv" ? "text/csv;charset=utf-8" : format === "tsv" ? "text/tab-separated-values;charset=utf-8" : "text/plain;charset=utf-8" };
}
