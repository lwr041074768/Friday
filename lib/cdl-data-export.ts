import { strToU8, zipSync } from "fflate";
import {
  buildCdlOriginTables, calculateCdl, selectedCdlCvCurves,
  type CdlOriginTable, type CdlResult, type CdlSample, type CdlSettings,
} from "./cdl-math";

type Cell = string | number | undefined;
type Sheet = CdlOriginTable & { name: string };

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const MAX_ELECTRODES = 60;
const MAX_CELLS = 2_000_000;

function xmlText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let output = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    output = String.fromCharCode(65 + (value - 1) % 26) + output;
  }
  return output;
}

function truncateName(value: string, length: number): string {
  // Do not split a supplementary Unicode character at the Excel name limit.
  const truncated = value.slice(0, length);
  return (/[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated).replace(/^'+|'+$/g, "") || "数据";
}

function uniqueSheetName(requested: string, used: Set<string>): string {
  const plain = requested.replace(/[\[\]:*?/\\\u0000-\u001F]/g, "_").replace(/^'+|'+$/g, "").trim() || "数据";
  let name = truncateName(plain, 31), suffix = 1;
  while (used.has(name.toLocaleLowerCase("en-US"))) {
    const ending = `_${++suffix}`;
    name = truncateName(plain, 31 - ending.length) + ending;
  }
  used.add(name.toLocaleLowerCase("en-US"));
  return name;
}

function worksheet(table: Sheet): Uint8Array {
  const columns = Math.max(1, table.columns.length);
  if (columns > 16384 || table.rows.length + 1 > 1048576) throw new Error(`工作表 ${table.name} 超出 Excel 行列限制，请导出完整 CSV。`);
  const pieces = [XML, `<worksheet xmlns="${SHEET_NS}"><dimension ref="A1:${columnName(columns - 1)}${table.rows.length + 1}"/><sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>`];
  table.columns.forEach((header, index) => {
    const length = Array.from(header).reduce((sum, character) => sum + (/[^\x00-\x7F]/.test(character) ? 2 : 1), 0);
    pieces.push(`<col min="${index + 1}" max="${index + 1}" width="${Math.min(45, Math.max(16, length + 2))}" customWidth="1"/>`);
  });
  pieces.push("</cols><sheetData>");
  const rows: Cell[][] = [table.columns, ...table.rows];
  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    pieces.push(`<row r="${rowNumber}"${rowIndex === 0 ? ' ht="32" customHeight="1"' : ""}>`);
    row.forEach((value, columnIndex) => {
      if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) return;
      const reference = columnName(columnIndex) + rowNumber;
      const style = rowIndex === 0 ? ' s="1"' : "";
      if (typeof value === "number") pieces.push(`<c r="${reference}"${style}><v>${value}</v></c>`);
      else {
        if (value.length > 32767) throw new Error(`工作表 ${table.name} 的 ${reference} 文本超过 Excel 字符限制，请导出完整 CSV。`);
        // Literal inline strings never become formulas, including names beginning with =.
        pieces.push(`<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`);
      }
    });
    pieces.push("</row>");
  });
  pieces.push("</sheetData></worksheet>");
  return strToU8(pieces.join(""));
}

function metadataTable(samples: CdlSample[], settings: CdlSettings, result: CdlResult, cvSheets: Map<string, string>): CdlOriginTable {
  const table: CdlOriginTable = {
    name: "计算设置与来源",
    columns: ["Record_type", "Group", "Electrode", "Replicate", "Series_ID", "Scan_rate_mV_s", "Raw_current_unit", "Output_current_unit", "Area_cm2", "Selected_cycle", "Complete_cycle_count", "Included", "Visible", "CV_sheet", "Source", "Information"],
    rows: [],
  };
  const setting = (name: string, value: string) => table.rows.push(["setting", name, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, value]);
  setting("数据范围", "Origin 作图导出：已选圈 CV 和拟合取点；所有电极均保留，图中隐藏不影响导出。完整原始循环及排除扫速的原始数据请另导出完整数据 CSV。");
  setting("取点电位", `${settings.e0} V，沿用输入电位标尺；未自动换算 RHE。汇总输入沿用各电极记录的取点电位。`);
  setting("选圈", settings.cycle === "last" ? "各文件最后完整正反扫描；每个文件可有不同总圈数。逐系列设置优先。" : `第 ${settings.cycle} 圈；逐系列设置优先。CV 与拟合取点使用同一选圈。`);
  setting("拟合", settings.throughOrigin ? "明确选择过原点拟合，R² 为未中心化定义。" : "自由截距普通最小二乘拟合。");
  setting("拟合电流", settings.halfDelta ? "Y=(Ia−Ic)/2；已输入半电流差时不再除以 2。" : "Y=Ia−Ic；Cdl 为拟合斜率/2。已输入半电流差时按该输入定义计算。");
  setting("扫速与电容单位", "作图 X 是 mV/s。半电流差 Y 为 mA 或 mA/cm² 时，Origin 拟合斜率×1000 得到 mF 或 mF/cm²；若拟合完整电流差还需除以 2。软件结果的 Fit_slope_per_V_s 已采用 V/s。");
  setting("SD 定义", "拟合均值表的 SD 是每扫速半电流差的平行样样本 SD。Cdl数值表的 Sample_SD 是各电极独立拟合后斜率的样本 SD（n−1）；n=1 时留空。拟合标准误不代替平行样 SD。");
  setting("设置记录", JSON.stringify(settings));
  if (result.error) setting("计算错误", result.error);
  const curves = selectedCdlCvCurves(samples, settings);
  for (const sample of samples) {
    const calculated = result.samples.find(item => item.id === sample.id);
    const common: Cell[] = ["electrode", sample.groupName ?? sample.name, sample.name, sample.replicate, undefined, undefined, sample.unit ?? settings.currentUnit, calculated?.outputUnit, sample.areaCM2 ?? settings.areaCM2, undefined, undefined, undefined, sample.visible ? "yes" : "no", cvSheets.get(sample.id), sample.source];
    table.rows.push([...common, JSON.stringify({ id: sample.id, role:sample.role??"electrode",summaryPotential: sample.summaryPotential, demo: sample.demo ?? false, errors: calculated?.errors, warnings: calculated?.warnings })]);
    for (const series of sample.series) {
      const curve = curves.find(item => item.sampleId === sample.id && item.seriesId === series.id);
      const row = [...common];
      row[0] = "cv_series"; row[4] = series.id; row[5] = series.rateMV;
      row[9] = curve?.cycle; row[10] = curve?.cycleCount; row[11] = series.included !== false ? "yes" : "no"; row[14] = series.source ?? sample.source;
      row[15] = JSON.stringify({ rateSource: series.rateSource, headerRateMV: series.headerRateMV, fileNameRateMV: series.fileNameRateMV, rateWarning: series.rateWarning, metadata: series.metadata, originalPointCount: series.points.length, selectedPointCount: curve?.plotted.length, originalStart: curve?.originalStart, originalEnd: curve?.originalEnd, error: curve?.error });
      table.rows.push(row);
    }
    for (const [index, point] of (sample.summary ?? []).entries()) {
      const row = [...common]; row[0] = "summary_point"; row[4] = `summary-${index}`; row[5] = point.rateMV;
      row[11] = point.included !== false ? "yes" : "no"; row[14] = point.source ?? sample.source;
      row[15] = JSON.stringify({ summaryPotential: sample.summaryPotential, inputKind: point.halfDelta === undefined ? "pair" : "halfDelta", rateSource: point.rateSource, rateWarning: point.rateWarning });
      table.rows.push(row);
    }
  }
  return table;
}

/** Pure client-side Origin workbook: typed values, selected CV loops, no formulas. */
export function buildCdlOriginXlsx(samples: CdlSample[], settings: CdlSettings, result = calculateCdl(samples, settings)): Uint8Array {
  if (!samples.length) throw new Error("请先导入 Cdl 电极数据。");
  if (samples.length > MAX_ELECTRODES) throw new Error(`Excel 作图导出最多支持 ${MAX_ELECTRODES} 片电极，请分批导出；完整原始数据可导出 CSV。`);
  const tables = buildCdlOriginTables(samples, settings, result);
  const sheets: Sheet[] = [
    { ...tables.meanPoints, name: "Cdl拟合均值" },
    { ...tables.replicatePoints, name: "Cdl拟合平行样" },
    { ...tables.summary, name: "Cdl数值" },
    { ...tables.electrodeFits, name: "逐电极拟合参数" },
  ];
  const used = new Set(sheets.map(sheet => sheet.name.toLocaleLowerCase("en-US")));
  const cvSheets = new Map<string, string>();
  tables.cv.forEach((table, index) => {
    if (!table.columns.length) return;
    const name = uniqueSheetName(`CV_${samples[index].name}`, used);
    cvSheets.set(samples[index].id, name);
    sheets.push({ ...table, name });
  });
  sheets.push(metadataTable(samples, settings, result, cvSheets));
  if (sheets.reduce((count, table) => count + (table.rows.length + 1) * Math.max(1, table.columns.length), 0) > MAX_CELLS) {
    throw new Error("Excel 作图导出超过 2,000,000 个单元格，请分批导出；完整原始数据可导出 CSV。不会删点或降采样。");
  }
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    "_rels/.rels": strToU8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8(XML + `<workbook xmlns="${SHEET_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` + sheets.map((table, index) => `<sheet name="${xmlText(table.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("") + "</sheets></workbook>"),
    "xl/_rels/workbook.xml.rels": strToU8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("") + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(XML + `<styleSheet xmlns="${SHEET_NS}"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  sheets.forEach((table, index) => { entries[`xl/worksheets/sheet${index + 1}.xml`] = worksheet(table); });
  return zipSync(entries, { level: 6 });
}
