"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Plus, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionSelect, UNIT_OPTIONS, type FileImportRequest } from "./lsv-import-dialog";
import { cdlElectrodeKey, cdlElectrodeName, CDL_MAX_SERIES, cdlPendingTable, parseCdlDataFile, parseCdlText, samplesFromCdlImport, type CdlPendingImport, type CdlImportMode } from "@/lib/cdl-import";
import { preventStaticTextCaret } from "@/lib/plot-ui";
import type { CdlSample } from "@/lib/cdl-math";
import type { CurrentUnit } from "@/lib/lsv-math";

const MODE_OPTIONS = [{ value: "cv", label: "完整 CV 曲线" }, { value: "branches", label: "扫描速率 + 阳极 / 阴极电流" }, { value: "halfDelta", label: "扫描速率 + 已计算的半差值" }];
const UNIT_CHOICES = [{ value: "unconfirmed", label: "请确认所选列的单位" }, ...UNIT_OPTIONS];

export default function CdlImportDialog({ open, onOpenChange, onAdd, existingCount, existingSamples = [], fileRequest, initialPending }: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onAdd: (samples: CdlSample[], note: string) => void;
  existingCount: number;
  existingSamples?: CdlSample[];
  fileRequest?: FileImportRequest;
  initialPending?: {id:number;items:CdlPendingImport[]};
}) {
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), lastRequest = useRef<number | null>(null);
  const [pending, setPending] = useState<CdlPendingImport[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [paste, setPaste] = useState(""), [pasteName, setPasteName] = useState("样品 1");
  const initialRequest=useRef<number|undefined>(undefined);
  useEffect(()=>{if(open&&initialPending&&initialRequest.current!==initialPending.id){initialRequest.current=initialPending.id;setPending(initialPending.items);setError("");}},[open,initialPending]);
  const addTables = useCallback((tables: Parameters<typeof cdlPendingTable>[0][]) => {
    setPending(items => [...items, ...tables.map(cdlPendingTable)]);
    setError("");
  }, []);
  const readFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    setBusy(true); setError("");
    const tables: Parameters<typeof cdlPendingTable>[0][] = [], failures: string[] = [];
    try {
      const allFiles = Array.from(files), hasFolders = allFiles.some(file => file.webkitRelativePath);
      const supported = hasFolders ? allFiles.filter(file => /\.(xlsx|csv|tsv|txt|dat|bin)$/i.test(file.name)) : allFiles;
      const cdlFiles = hasFolders ? supported.filter(file => /(?:^|[/\\])cdl(?:[/\\]|[-_\s\d])/i.test(file.webkitRelativePath || file.name) || /^cdl/i.test(file.name)) : [];
      for (const file of cdlFiles.length ? cdlFiles : supported) {
        try { tables.push(...await parseCdlDataFile(file)); }
        catch (failure) { failures.push(`${file.name}：${(failure as Error).message}`); }
      }
      if (tables.length) addTables(tables);
      if (failures.length) setError(failures.join("；"));
      if (!tables.length && !failures.length) setError("没有找到可读取的 Cdl 文件，请选择 TXT、CSV、Excel 或已验证的 CV BIN。");
    } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; if (folderInput.current) folderInput.current.value = ""; }
  }, [addTables]);
  useEffect(() => {
    if (!open || !fileRequest || lastRequest.current === fileRequest.id) return;
    lastRequest.current = fileRequest.id;
    void readFiles(fileRequest.files);
  }, [open, fileRequest, readFiles]);
  const sampleCount = new Set(pending.flatMap(item => item.mode === "halfDelta" && item.summaryYs?.length ? item.summaryYs.filter(y => y.selected).map(y => cdlElectrodeKey(y.groupName, y.replicate ?? item.replicate)) : item.groupName.trim() ? [cdlElectrodeKey(item.groupName, item.replicate)] : [])).size;
  const seriesCount = pending.reduce((sum, item) => sum + (item.mode === "cv" ? item.pairs.length : 0), 0);
  const conflictCount = pending.filter(item => item.table.rateWarning).length;
  const pendingGroups = [...pending.reduce((groups, item, index) => {
    const key = cdlElectrodeKey(item.groupName, item.replicate);
    const group = groups.get(key) ?? { key, name: cdlElectrodeName(item.groupName, item.replicate), entries: [] as { item: CdlPendingImport; index: number }[] };
    group.entries.push({ item, index }); groups.set(key, group); return groups;
  }, new Map<string, { key: string; name: string; entries: { item: CdlPendingImport; index: number }[] }>()).values()];
  const compact = (item: CdlPendingImport) => item.mode === "cv" && item.pairs.length === 1 && item.table.headerRateMV != null && item.unit !== "unconfirmed" && Boolean(item.groupName.trim() && item.replicate.trim());
  function update(index: number, fn: (item: CdlPendingImport) => CdlPendingImport) {
    setPending(items => items.map((item, n) => n === index ? fn(item) : item));
  }
  function confirm() {
    try {
      const { samples, skipped } = samplesFromCdlImport(pending, existingCount, existingSamples);
      const groups = samples.reduce((sum, sample) => sum + sample.series.length, 0);
      const excluded = samples.reduce((sum, sample) => sum + sample.series.filter(series => series.included === false).length + (sample.summary?.filter(row => row.included === false).length ?? 0), 0);
      const conflicts = samples.reduce((sum, sample) => sum + sample.series.filter(series => series.headerRateMV != null && series.fileNameRateMV != null && series.headerRateMV !== series.fileNameRateMV).length, 0);
      onAdd(samples, `已导入 ${new Set(samples.map(sample => sample.groupName || sample.name)).size} 组、${samples.length} 片电极、${groups} 组 CV${samples.some(sample => sample.summary?.length) ? "及电流汇总数据" : ""}；单位按确认的原始数值保存${conflicts ? `；${conflicts} 个速率冲突已采用测量头部` : ""}${excluded ? `；${excluded} 个重复速率已保留并默认排除拟合，请核对取点明细` : ""}${skipped ? `；CV 保留缺失行断点，汇总表忽略不完整行（共 ${skipped} 行）` : ""}。`);
      setPending([]); setPaste(""); setError(""); onOpenChange(false);
    } catch (failure) { setError((failure as Error).message); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent onMouseDownCapture={preventStaticTextCaret} className="lsv-import-modal cdl-import-modal">
      <DialogHeader>
        <DialogTitle>导入 Cdl 数据</DialogTitle>
        <DialogDescription>每片电极单独拟合，再按组别比较重复电极。同一组别与重复编号合并扫描速率；辰华测量头部优先于文件名。</DialogDescription>
      </DialogHeader>
      <div className="lsv-upload-zone" role="button" tabIndex={0} aria-label="选择 Cdl 数据文件" aria-busy={busy}
        onClick={() => !busy && fileInput.current?.click()}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy) fileInput.current?.click(); } }}
        onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void readFiles(event.dataTransfer.files); }}>
        <Upload size={28} /><strong>{busy ? "正在读取…" : "点击选择文件，或拖放到这里"}</strong>
        <span>XLSX / CSV / TSV / TXT / DAT / 辰华 CV BIN · 单个文件 ≤ 20 MB</span>
      </div>
      <input ref={fileInput} type="file" multiple hidden accept=".xlsx,.csv,.tsv,.txt,.dat,.bin" disabled={busy} aria-label="Cdl 文件" onChange={event => void readFiles(event.target.files)} />
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: "", directory: "" }} disabled={busy} aria-label="Cdl 数据文件夹" onChange={event => void readFiles(event.target.files)} />
      <div className="lsv-import-extra"><button className="lsv-button secondary" disabled={busy} onClick={() => folderInput.current?.click()}><FileSpreadsheet size={17} />选择数据文件夹</button><span className="lsv-map-note">支持组别 / 平行样编号目录。保留相对路径；同名 TXT/BIN 优先读取带测量头部的 TXT，便于核对速率和圈数。</span></div>
      <p className="lsv-map-note">Origin 工程（OPJU）请先导出 CV 工作表为 Excel 或 CSV。斜率与误差等拟合参数页不能作为 CV 导入。</p>
      <details className="lsv-paste">
        <summary>直接粘贴 CV 或电流汇总表</summary>
        <label>样品名称<input aria-label="粘贴 Cdl 样品名称" value={pasteName} onChange={event => setPasteName(event.target.value)} /></label>
        <textarea aria-label="粘贴 Cdl 数据" placeholder={"Potential/V\tCurrent/A\n0.050\t-0.00020\n0.051\t-0.00018\n\n或：\nScan rate/mV/s\tja/mA\tjc/mA\n20\t0.35\t-0.30\n40\t0.68\t-0.60"} value={paste} onChange={event => setPaste(event.target.value)} />
        <button className="lsv-button secondary" disabled={busy} onClick={() => {
          try { addTables([parseCdlText(paste, pasteName)]); setPaste(""); }
          catch (failure) { setError((failure as Error).message); }
        }}>解析粘贴数据</button>
      </details>
      {!!pending.length && <p className="lsv-map-note">已读取 {pending.length} 个数据表，按组别 / 重复电极分组。点击电极可查看原始文件与修改名称、单位。{conflictCount > 0 && <strong style={{ color: "#b45309" }}> {conflictCount} 个文件名与测量头部冲突，全部采用头部实测速率，详情已保留。</strong>}</p>}
      <div className="lsv-import-tables">
        {pendingGroups.map(group => <details key={group.entries[0].item.table.id} className="cdl-import-electrode-group" open={group.entries.some(({ item }) => !compact(item))}>
          <summary style={{ cursor: "pointer", padding: "12px 4px", fontSize: 13 }}><strong>{group.name || "待确认电极"}</strong> · {group.entries.length} 个数据表 · {group.entries.flatMap(({ item }) => item.pairs.map(pair => pair.rateMV)).filter(Boolean).join("、")} mV/s{group.entries.some(({ item }) => item.table.rateWarning) && <strong style={{ color: "#b45309" }}> · 扫速冲突（已采用头部）</strong>}</summary>
          {group.entries.every(({ item }) => item.mode === "cv") && <div className="lsv-import-extra">
            <label>批量修改此电极的组别<input aria-label={`电极 ${group.name} 批量组别`} value={group.entries[0].item.groupName} onChange={event => setPending(items => items.map((item, index) => group.entries.some(entry => entry.index === index) ? { ...item, groupName: event.target.value, name: cdlElectrodeName(event.target.value, item.replicate) } : item))} /></label>
            <label>批量修改重复编号<input aria-label={`电极 ${group.name} 批量重复编号`} value={group.entries[0].item.replicate} onChange={event => setPending(items => items.map((item, index) => group.entries.some(entry => entry.index === index) ? { ...item, replicate: event.target.value, name: cdlElectrodeName(item.groupName, event.target.value) } : item))} /></label>
          </div>}
          {group.entries.map(({ item, index }) => {
          const columnOptions = item.table.headers.map((header, c) => ({ value: String(c), label: `${c + 1} · ${header}` }));
          return <details key={item.table.id} className="lsv-table-mapping" open={!compact(item)}>
            <summary className="lsv-mapping-heading" style={{ cursor: "pointer" }}><FileSpreadsheet size={17} /><strong>{item.table.name}</strong><span>{item.table.rows.length.toLocaleString()} 行{item.table.headerRateMV != null ? ` · ${item.table.headerRateMV} mV/s` : ""}{item.table.rateWarning ? " · 文件名冲突" : ""}</span>
              <button aria-label={`移除 ${item.table.name}`} onClick={event => { event.preventDefault(); event.stopPropagation(); setPending(items => items.filter((_, n) => n !== index)); }}><Trash2 size={16} /></button>
            </summary>
            <p className="lsv-map-note" style={{ overflowWrap: "anywhere" }}>来源：{item.table.source}</p>
            <div className="lsv-preview-table"><table><thead><tr>{item.table.headers.map((header, c) => <th key={c}>{c + 1} · {header}</th>)}</tr></thead>
              <tbody>{item.table.rows.slice(0, 3).map((row, r) => <tr key={r}>{item.table.headers.map((_, c) => <td key={c}>{row[c] ?? "—"}</td>)}</tr>)}</tbody>
            </table></div>
            <div className="lsv-import-extra">
              {!(item.mode === "halfDelta" && item.summaryYs?.length) && <label>样品组别<input aria-label={`表 ${index + 1} 样品组别`} value={item.groupName} onChange={event => update(index, current => ({ ...current, groupName: event.target.value, name: cdlElectrodeName(event.target.value, current.replicate) }))} /></label>}
              <label>重复电极编号<input aria-label={`表 ${index + 1} 重复电极编号`} value={item.replicate} placeholder="例如 1、2、3；单片可留空" onChange={event => update(index, current => ({ ...current, replicate: event.target.value, name: cdlElectrodeName(current.groupName, event.target.value) }))} /></label>
              <label>数据类型<OptionSelect label={`表 ${index + 1} 数据类型`} value={item.mode} options={MODE_OPTIONS} onChange={value => update(index, current => ({ ...current, mode: value as CdlImportMode }))} /></label>
            </div>
            {item.mode === "cv" ? <>
              {item.table.notice && <p className="lsv-map-note">{item.table.notice}</p>}
              {!item.pairs.length && <p className="lsv-map-note">未找到明确的电位、电流列，请添加扫描速率并手动选择列。</p>}
              {item.pairs.map((pair, n) => <div className="lsv-pair cdl-import-pair" key={pair.id}>
                <label>扫描速率（mV/s）<input type="number" step="any" min="0" aria-label={`表 ${index + 1} 第 ${n + 1} 组扫描速率`} value={pair.rateMV} readOnly={item.table.headerRateMV != null && item.pairs.length === 1} placeholder="填写实测速率" onChange={event => update(index, current => ({ ...current, pairs: current.pairs.map(p => p.id === pair.id ? { ...p, rateMV: event.target.value } : p) }))} /></label>
                <label>电位列（V）<OptionSelect label={`表 ${index + 1} 第 ${n + 1} 组电位列`} value={String(pair.e)} options={columnOptions} onChange={value => update(index, current => ({ ...current, pairs: current.pairs.map(p => p.id === pair.id ? { ...p, e: Number(value) } : p) }))} /></label>
                <label>电流列<OptionSelect label={`表 ${index + 1} 第 ${n + 1} 组电流列`} value={String(pair.current)} options={columnOptions} onChange={value => update(index, current => ({ ...current, pairs: current.pairs.map(p => p.id === pair.id ? { ...p, current: Number(value) } : p) }))} /></label>
                <span style={{ fontSize: 12, color: "#8294a6", alignSelf: "center", paddingTop: 22 }}>第 {n + 1} 组</span>
                <button aria-label={`删除表 ${index + 1} 第 ${n + 1} 组`} onClick={() => update(index, current => ({ ...current, pairs: current.pairs.filter(p => p.id !== pair.id) }))}><Trash2 size={16} /></button>
              </div>)}
              <button className="lsv-add-pair" disabled={item.pairs.length >= CDL_MAX_SERIES || item.table.headerRateMV != null} onClick={() => update(index, current => ({ ...current, pairs: [...current.pairs, { id: crypto.randomUUID(), e: 0, current: Math.min(1, current.table.headers.length - 1), rateMV: "" }] }))}><Plus size={15} />添加一组扫描速率</button>
              {item.table.rateWarning && <p className="lsv-error" role="alert">{item.table.rateWarning}</p>}
              {item.table.rateHints?.length && item.table.headerRateMV == null && <label className="lsv-map-note" style={{ display: "flex", gap: 8, alignItems: "start", marginTop: 12 }}>
                <input type="checkbox" aria-label={`确认 ${item.name} 扫描速率对应关系`} checked={item.ratesConfirmed} onChange={event => update(index, current => ({ ...current, ratesConfirmed: event.target.checked }))} style={{ marginTop: 3 }} />
                <span>扫描速率提示来自 {item.table.rateHintSource}；我已核对上面各组 CV 与 mV/s 的对应关系。</span>
              </label>}
            </> : <>
              {item.table.notice && <p className="lsv-map-note">{item.table.notice}</p>}
              <p className="lsv-map-note">{item.mode === "branches" ? "保留阳极、阴极电流的正负号；计算 (ja − jc) / 2。" : "此列已经是 (ja − jc) / 2，导入后直接拟合，不再除以 2。"}</p>
              <div className="lsv-import-extra">
                {([{ field: "rate", label: "扫描速率列（按列标题识别 V/s 或 mV/s）" }, ...(item.mode === "branches" ? [{ field: "anodic", label: "阳极电流列" }, { field: "cathodic", label: "阴极电流列" }] : item.summaryYs?.length ? [] : [{ field: "halfDelta", label: "半差值列（已除以 2）" }])] as { field: keyof CdlPendingImport["summary"]; label: string }[]).map(({ field, label }) => <label key={field}>{label}
                  <OptionSelect label={`表 ${index + 1} ${label}`} value={String(item.summary[field])} options={columnOptions} onChange={value => update(index, current => ({ ...current, summary: { ...current.summary, [field]: Number(value) } }))} />
                </label>)}
                <label>这张汇总表的取点电位（V，可选）<input type="number" step="any" aria-label={`表 ${index + 1} 汇总表取点电位`} value={item.summaryPotential} placeholder="例如 0.075" onChange={event => update(index, current => ({ ...current, summaryPotential: event.target.value }))} /></label>
              </div>
              {item.mode === "halfDelta" && item.summaryYs?.length && <><p className="lsv-map-note">每列半差值独立导入；SD / SE 误差列默认不选。标为“均值曲线”的列已经过平均，应单独看待，不能计入独立电极的重复数量。</p><div className="lsv-import-extra">{item.summaryYs.map(y => <label key={y.column}><span><input type="checkbox" aria-label={`选择表 ${index + 1} 第 ${y.column + 1} 列半差值`} checked={y.selected} onChange={event => update(index, current => ({ ...current, summaryYs: current.summaryYs?.map(value => value.column === y.column ? { ...value, selected: event.target.checked } : value) }))} /> {y.column + 1} · {item.table.headers[y.column]}</span><input aria-label={`表 ${index + 1} 第 ${y.column + 1} 列组别`} value={y.groupName} disabled={!y.selected} onChange={event => update(index, current => ({ ...current, summaryYs: current.summaryYs?.map(value => value.column === y.column ? { ...value, groupName: event.target.value } : value) }))} /><input aria-label={`表 ${index + 1} 第 ${y.column + 1} 列重复编号`} value={y.replicate ?? item.replicate} disabled={!y.selected} placeholder="该列重复电极编号" onChange={event => update(index, current => ({ ...current, summaryYs: current.summaryYs?.map(value => value.column === y.column ? { ...value, replicate: event.target.value } : value) }))} /></label>)}</div></>}
              <p className="lsv-map-note">汇总数据已经固定在原取点电位。之后更改页面 E₀ 不会重新提取这些电流；未记录取点电位时会给出提示。</p>
            </>}
            <div className="lsv-import-extra">
              <label>所选电流 / 半差值的原始单位<OptionSelect label={`表 ${index + 1} 原始电流单位`} value={item.unit} options={UNIT_CHOICES} onChange={value => update(index, current => ({ ...current, unit: value as CurrentUnit | "unconfirmed" }))} /></label>
              <label>电极面积（cm²，可选）<input type="number" step="any" min="0" aria-label={`表 ${index + 1} 电极面积`} value={item.area} placeholder="用于绝对电流归一化" onChange={event => update(index, current => ({ ...current, area: event.target.value }))} /></label>
            </div>
            {item.table.currentUnitSource && <p className="lsv-map-note">单位来源：{item.table.currentUnitSource}；已预选 {item.table.currentUnitHint}，请核对当前电流列。</p>}
            {item.table.unitSuggestionSource && <p className="lsv-map-note">单位提示：{item.table.unitSuggestionSource}。</p>}
            <p className="lsv-map-note">单位需对应当前选中的数值列。电流已按面积归一化时，选择 A/cm²、mA/cm² 或 μA/cm²。</p>
          </details>;
        })}</details>)}
      </div>
      {error && <div className="lsv-error" role="alert">{error}</div>}
      <div className="lsv-import-bottom"><span>已有 {existingCount} 片电极 · 本次 {sampleCount} 片、{seriesCount} 组 CV · 最多 10 组 / 60 片电极</span>
        <button className="lsv-button primary" disabled={busy || !pending.length} onClick={confirm}>导入并绘图</button>
      </div>
    </DialogContent>
  </Dialog>;
}
