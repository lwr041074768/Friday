import {
  cdlElectrodeKey, cdlElectrodeName, cdlPendingTable, parseCdlDataFile,
  samplesFromCdlImport, type CdlPendingImport,
} from "@/lib/cdl-import";
import type { CdlSample } from "./cdl-math";
import type { CurrentUnit } from "./lsv-math";

export type CdlSlotImportOptions = {
  slotId: string; slotName: string; existingSamples?: CdlSample[];
  unit?: CurrentUnit; areaCM2?: number;
};
export type CdlSlotFile = {
  name: string; source: string; rateMV?: number; pointCount?: number;
  status: "imported" | "needsMapping" | "skipped" | "error"; notice?: string;
};
export type CdlSlotImportResult = {
  /** Incremental samples; use mergeCdlSlotSamples to append existing raw data. */
  samples: CdlSample[]; files: CdlSlotFile[]; warnings: string[];
  needsMapping?: { kind: "mapping" | "mixedGroups"; pending: CdlPendingImport[]; reasons: string[] };
};

type NativeFile = File & { measurementSourcePath?: string };
const sourcePath = (file: File) => (file as NativeFile).measurementSourcePath || file.webkitRelativePath || file.name;
const normalizedPath = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/g, "");
const keyPath = (value: string) => normalizedPath(value).toLocaleLowerCase();
const simpleLabel = (value: string) => /^(?:cdl|cv|data|数据|测试|原始数据|新建.*|sheet\d*|工作表\d*)$/i.test(value.trim());

/** Only a numeric directory is evidence for independently measured electrodes. */
function folderIdentity(source: string): { material?: string; replicate: string } {
  const parts = normalizedPath(source).split("/").filter(Boolean);
  const index = parts.findLastIndex((part, n) => n < parts.length - 1 && /^\d+$/.test(part));
  if (index >= 0) return { material: index > 0 && !simpleLabel(parts[index - 1]) ? parts[index - 1] : undefined, replicate: parts[index] };
  const cdl = parts.findLastIndex((part, n) => n < parts.length - 1 && /^cdl$/i.test(part));
  if (cdl > 0 && !simpleLabel(parts[cdl - 1])) return { material: parts[cdl - 1], replicate: "1" };
  return { replicate: "1" };
}

/** Strip a rate-only filename; a remaining material prefix is not a replicate. */
function filenameMaterial(source: string): string | undefined {
  const stem = normalizedPath(source).split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  const label = stem.replace(/(?:^|[\s_-])(?:cdl[\s_-]*)?\d+(?:\.\d+)?\s*mV(?:\s*[/_-]\s*s)?(?:\s*[-_]\s*\d+)?$/i, "").replace(/^[\s_-]+|[\s_-]+$/g, "");
  return label && label !== stem && !simpleLabel(label) ? label : undefined;
}

function exportedMaterial(item: CdlPendingImport): string[] {
  const sourceFile = normalizedPath(item.table.source).split("/").at(-1) ?? "";
  if (!/\.xlsx$/i.test(sourceFile)) return [];
  if (item.mode === "halfDelta" && item.summaryYs?.length) return item.summaryYs.filter(y => y.selected && y.role !== "meanCurve").map(y => y.groupName).filter(name => name.trim() && !simpleLabel(name));
  const sheet = item.table.name.includes(" · ") ? item.table.name.slice(item.table.name.indexOf(" · ") + 3) : "";
  // An explicit rep marker in an exported sheet is provenance, unlike Sheet1.
  return sheet && /(?:rep(?:licate)?|重复|\s·\s)\s*\d+\s*$/i.test(sheet) && !simpleLabel(item.groupName) ? [item.groupName] : [];
}

function stripRateTokens(header: string) {
  return header.replace(/\b\d+(?:\.\d+)?\s*m?V\s*\/\s*s\b/gi, "");
}

/** Unit evidence must be explicit. A bare I/J label never implies density. */
function columnUnit(header: string): CurrentUnit | undefined {
  const clean = stripRateTokens(header), match = /(?:^|[^A-Za-z])([muμµn]?A)(?=[^A-Za-z]|$)/i.exec(clean);
  if (!match) return;
  const density = /(?:cm\s*(?:\^?\s*2|²|[-−]\s*2)|cm\s*\*\*\s*2)/i.test(clean);
  const token = match[1], amount = /^mA$/i.test(token) ? "mA" : /^[uμµ]A$/i.test(token) ? "uA" : /^nA$/i.test(token) ? "nA" : "A";
  if (density && amount === "nA") return;
  return (density ? `${amount}/cm2` : amount) as CurrentUnit;
}

function selectedUnit(item: CdlPendingImport): { unit?: CurrentUnit; source?: string; ambiguous?: boolean } {
  if (item.table.currentUnitHint) return { unit: item.table.currentUnitHint, source: item.table.currentUnitSource };
  const columns = item.mode === "cv" ? item.pairs.map(pair => pair.current)
    : item.mode === "branches" ? [item.summary.anodic, item.summary.cathodic]
    : item.summaryYs?.length ? item.summaryYs.filter(y => y.selected).map(y => y.column) : [item.summary.halfDelta];
  const units = columns.map(index => columnUnit(item.table.headers[index] ?? ""));
  if (units.length && units.every(unit => unit != null) && new Set(units).size === 1) return { unit: units[0], source: `电流列标题明确标注 ${units[0]}` };
  return { ambiguous: new Set(units.filter(Boolean)).size > 1 };
}

function unambiguousColumns(item: CdlPendingImport): boolean {
  const h = item.table.headers;
  if (item.mode !== "cv") {
    const rate = h[item.summary.rate] ?? "";
    if (!/scan.?rate|扫速|扫描速率|^rate\b|^v\s*[/([]|^ν|m?V\s*\/\s*s/i.test(rate)) return false;
    if (item.mode === "branches") return /anodic|阳极|^[ij]_?a\b/i.test(h[item.summary.anodic] ?? "") && /cathodic|阴极|^[ij]_?c\b/i.test(h[item.summary.cathodic] ?? "");
    return /half.?delta|half.?difference|半差|(?:Δ|delta)\s*[ij].*(?:\/\s*2|÷\s*2)|\([ij]_?a\s*[-−]\s*[ij]_?c\)\s*\/\s*2/i.test(h[item.summary.halfDelta] ?? "") || !!item.summaryYs?.length;
  }
  return !!item.pairs.length && item.pairs.every(pair => {
    const potential = h[pair.e] ?? "", current = h[pair.current] ?? "";
    // The existing reader may offer two anonymous columns as a manual fallback;
    // the simplified workflow must not silently decide what those columns mean.
    return /potential|voltage|电位|电压|^e\d*(?:\b|[(/_])|_E_X_/i.test(potential)
      && /current|电流|^[ij]\d*(?:\b|[(/_])|_[IJ]_Y_/i.test(current)
      && !/\bmV|μV|µV|uV/i.test(potential);
  });
}

/** Preserve every raw series; never treat a repeated sweep as a new electrode. */
export function mergeCdlSlotSamples(existing: CdlSample[], incoming: CdlSample[]): CdlSample[] {
  const output = existing.map(sample => ({ ...sample, series: [...sample.series], ...(sample.summary ? { summary: [...sample.summary] } : {}) }));
  for (const sample of incoming) {
    const key = cdlElectrodeKey(sample.groupName || sample.name, sample.replicate || "");
    const index = output.findIndex(item => cdlElectrodeKey(item.groupName || item.name, item.replicate || "") === key);
    if (index < 0) { output.push(sample); continue; }
    const previous = output[index];
    if ((previous.role ?? "electrode") !== (sample.role ?? "electrode") || previous.unit !== sample.unit || previous.areaCM2 !== sample.areaCM2) throw new Error(`“${sample.name}”的单位、面积或电极身份与已有数据不同，不能合并。`);
    const rates = new Set([...previous.series, ...(previous.summary ?? [])].map(item => item.rateMV));
    const excludeDuplicate = <T extends { rateMV: number; included?: boolean }>(item: T): T => {
      const duplicate = rates.has(item.rateMV); rates.add(item.rateMV);
      return duplicate ? { ...item, included: false, rateWarning: ["rateWarning" in item ? item.rateWarning : "", `重复的 ${item.rateMV} mV/s 数据已保留并默认排除拟合，请选择使用的数据。`].filter(Boolean).join(" ") } : item;
    };
    output[index] = { ...previous, series: [...previous.series, ...sample.series.map(excludeDuplicate)],
      ...(previous.summary || sample.summary ? { summary: [...(previous.summary ?? []), ...(sample.summary ?? []).map(excludeDuplicate)] } : {}),
      source: [...new Set([...previous.source.split("；"), ...sample.source.split("；")])].filter(Boolean).join("；"),
      ...(sample.summaryPotential != null ? { summaryPotential: sample.summaryPotential } : {}) };
  }
  return output;
}

/** Import all selected rates into the active numbered slot without filename groups. */
export async function importCdlSlot(files: File[], options: CdlSlotImportOptions): Promise<CdlSlotImportResult> {
  const slotName = options.slotName.trim();
  if (!slotName || !options.slotId.trim()) throw new Error("请先选择第一组至第十组中的一组数据。");
  if (options.areaCM2 != null && (!Number.isFinite(options.areaCM2) || options.areaCM2 <= 0)) throw new Error("电极面积需大于 0 cm²。");
  const result: CdlSlotImportResult = { samples: [], files: [], warnings: [] };
  const pending: CdlPendingImport[] = [], materialLabels = new Set<string>(), reasons: string[] = [];
  for (const sample of options.existingSamples ?? []) if ((sample.groupName || sample.name) === slotName) for (const series of sample.series) {
    const material = series.metadata?.slotMaterial;
    if (typeof material === "string" && material.trim()) materialLabels.add(material);
  }
  const textStems = new Set(files.filter(file => /\.(txt|csv|tsv|dat)$/i.test(file.name)).map(file => keyPath(sourcePath(file)).replace(/\.[^.]+$/, "")));
  for (const file of files) {
    const source = sourcePath(file), entry: CdlSlotFile = { name: file.name, source, status: "imported" };
    result.files.push(entry);
    if (/\.bin$/i.test(file.name) && textStems.has(keyPath(source).replace(/\.[^.]+$/, ""))) {
      entry.status = "skipped"; entry.notice = "同目录有同名文本，优先使用含测量头部的文本；BIN 文件仍保留在原位置。";
      continue;
    }
    try {
      const tables = await parseCdlDataFile(file), identity = folderIdentity(source), notices: string[] = [];
      if (identity.material) materialLabels.add(identity.material);
      const material = filenameMaterial(source); if (!identity.material && material) materialLabels.add(material);
      entry.pointCount = tables.reduce((sum, table) => sum + table.rows.length, 0);
      const rates: number[] = [];
      for (const table of tables) {
        const item = cdlPendingTable(table), originalGroupName = item.groupName, originalReplicate = item.replicate;
        const exportedLabels = exportedMaterial(item);
        exportedLabels.forEach(label => materialLabels.add(label));
        const slotMaterial = identity.material || material || (exportedLabels.length === 1 ? exportedLabels[0] : undefined);
        // Numbered parent folders are the only automatic replicate boundary.
        // Exported summary columns keep their independently recorded rep IDs.
        const replicate = !identity.material && exportedLabels.length && originalReplicate ? originalReplicate : identity.replicate;
        item.groupName = slotName; item.replicate = replicate; item.name = cdlElectrodeName(slotName, replicate);
        if (item.summaryYs) item.summaryYs = item.summaryYs.map(y => ({ ...y, groupName: slotName, replicate: y.role === "meanCurve" ? "均值曲线" : y.replicate || identity.replicate }));
        const evidence = selectedUnit(item);
        item.unit = evidence.unit ?? options.unit ?? "unconfirmed";
        const electrodeKey = cdlElectrodeKey(item.groupName, item.replicate);
        const previous = options.existingSamples?.find(sample => cdlElectrodeKey(sample.groupName || sample.name, sample.replicate || "") === electrodeKey);
        // The slot's calculation area is separate from imported metadata. New
        // electrodes start at 1 cm²; appending to an existing electrode retains
        // its recorded area, including a deliberately empty legacy value.
        item.area = options.areaCM2 != null ? String(options.areaCM2)
          : previous ? previous.areaCM2 == null ? "" : String(previous.areaCM2) : "1";
        item.table = { ...item.table, metadata: { ...item.table.metadata, slotId: options.slotId, slotName, originalSuggestedGroup: originalGroupName,
          ...(slotMaterial ? { slotMaterial } : {}),
          slotGroupingSource: "使用者在当前数据组选择的文件；数值文件夹用于区分独立电极", currentUnitSource: evidence.source || (options.unit ? "使用者在当前数据组选择的电流单位" : "未确认") } };
        // The original XLSX rate metadata has explicit source cells; record that
        // evidence and accept the existing reader's unambiguous match.
        item.ratesConfirmed = item.table.headerRateMV != null || !!item.table.rateHintSource;
        if (!unambiguousColumns(item)) reasons.push(`“${file.name}”的电位/电流或汇总列需要确认。`);
        if (item.unit === "unconfirmed" || evidence.ambiguous) reasons.push(`“${file.name}”的电流单位需要确认；不能根据数值大小判断 A、mA 或电流密度。`);
        if (item.mode === "cv" && item.pairs.some(pair => !pair.rateMV.trim() || !Number.isFinite(Number(pair.rateMV)) || Number(pair.rateMV) <= 0)) reasons.push(`“${file.name}”的扫描速率需要确认（mV/s）。`);
        if (item.mode === "cv") rates.push(...item.pairs.map(pair => Number(pair.rateMV)).filter(rate => Number.isFinite(rate) && rate > 0));
        if (table.notice) notices.push(table.notice);
        if (table.rateWarning) result.warnings.push(`${file.name}：${table.rateWarning}`);
        pending.push(item);
      }
      if (new Set(rates).size === 1) entry.rateMV = rates[0];
      entry.notice = [...new Set(notices)].join(" ") || undefined;
    } catch (cause) {
      entry.status = "error"; entry.notice = cause instanceof Error ? cause.message : "无法读取数据文件。";
      result.warnings.push(`${file.name}：${entry.notice}`);
    }
  }
  // A single active slot is one material/condition. Distinct materials must be
  // split by the user; combining their Cdl values would create a false mean/SD.
  if (materialLabels.size > 1) {
    const message = `本次文件含不同材料或原始组名：${[...materialLabels].join("、")}。请把每种材料分别导入不同数据组，不能合并为同一电极或计算平行样 SD。`;
    result.files.forEach(entry => { if (entry.status === "imported") entry.status = "needsMapping"; });
    result.warnings.push(message); result.needsMapping = { kind: "mixedGroups", pending: [], reasons: [message] };
    return result;
  }
  if (reasons.length) {
    result.files.forEach(entry => { if (entry.status === "imported") entry.status = "needsMapping"; });
    result.needsMapping = { kind: "mapping", pending, reasons: [...new Set(reasons)] };
    return result;
  }
  if (!pending.length) return result;
  try {
    const imported = samplesFromCdlImport(pending, options.existingSamples?.length ?? 0, options.existingSamples ?? []);
    result.samples = imported.samples;
    for (const sample of result.samples) for (const series of sample.series) if (series.rateWarning) result.warnings.push(series.rateWarning);
    if (imported.skipped) result.warnings.push(`检测到 ${imported.skipped} 个缺失数据行；CV 原始缺口已保留，取点不会跨缺口插值。`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "数据需要确认后才能导入。";
    result.files.forEach(entry => { if (entry.status === "imported") entry.status = "needsMapping"; });
    result.needsMapping = { kind: "mapping", pending, reasons: [message] };
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}
