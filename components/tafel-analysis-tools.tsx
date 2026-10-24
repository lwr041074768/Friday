"use client";
import {useProjectState,useProjectDerived} from "@/lib/project-state";


import { useCallback, useMemo, useState } from "react";
import { Download, Eraser, RotateCcw, ScanLine, Sparkles, SquareDashed, TrendingUp, Undo2 } from "lucide-react";
import { fitTafelLine, indicesInRectangle, withTafelMasks, type TafelFitResult, type TafelMaskRectangle, type TafelRange } from "@/lib/tafel-analysis";
import { autoTafelWindow } from "@/lib/tafel-auto";
import { tafelDerivedMetrics, TAFEL_DERIVED_NOTE } from "@/lib/tafel-derived";
import { selectScan, type ScanMode } from "@/lib/scan-branches";
import type { PlotCurve } from "@/lib/lsv-math";
import type { PlotAnalysisTools } from "./lsv-plot";

type Mode = PlotAnalysisTools["mode"];
type Edit = { key: string; indices: number[] };
type Options = { enabled: boolean; curves: PlotCurve[]; scan: ScanMode; basis: "current" | "density"; datasetKey: string; onExportFit: (fit: TafelFitResult, curve: PlotCurve) => void };
const scanName = (scan: ScanMode) => scan === "up" ? "正向扫描" : scan === "down" ? "反向扫描" : "全部";
const number = (value: number | null) => value === null || !Number.isFinite(value) ? "不适用" : value === 0 ? "0" : Math.abs(value) < 1e-5 || Math.abs(value) >= 1e6 ? value.toExponential(6) : Number(value.toPrecision(8)).toString();
const uncertainty = (value: number, se: number) => `${number(value)} ± ${number(se)}`;

export function useTafelAnalysis({ enabled, curves, scan, basis, datasetKey, onExportFit }: Options) {
  const [mode, setMode] = useProjectState<Mode>(enabled?'tafel.analysis':undefined,'mode',"zoom");
  const [requestedId, setRequestedId] = useProjectState(enabled?'tafel.analysis':undefined,'requestedId',"");
  const [masks, setMasks] = useProjectState<Record<string, number[]>>(enabled?'tafel.analysis':undefined,'masks',{});
  const [history, setHistory] = useProjectState<Edit[]>(enabled?'tafel.analysis':undefined,'history',[]);
  const [range, setRange] = useProjectState<TafelRange | null>(enabled?'tafel.analysis':undefined,'range',null);
  const [draft, setDraft] = useProjectState(enabled?'tafel.analysis':undefined,'draft',{ min: "", max: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stored, setStored] = useState<{ fit: TafelFitResult; context: object } | null>(null);
  const prefix = `${datasetKey}:`;
  const available = curves.filter(curve => curve.visible && !curve.error && curve.plotted.some(Boolean));
  const targetId = available.some(curve => curve.id === requestedId) ? requestedId : available[0]?.id ?? "";
  const activeMasks = useMemo(() => Object.fromEntries(curves.map(curve => [curve.id, masks[`${datasetKey}:${curve.id}`] ?? []])), [curves, masks, datasetKey]);
  const scanned = useMemo(() => selectScan(curves, scan).curves, [curves, scan]);
  const chartCurves = useMemo(() => enabled ? withTafelMasks(scanned, activeMasks) : scanned, [enabled, scanned, activeMasks]);
  const target = chartCurves.find(curve => curve.id === targetId);
  const context = useMemo(() => ({ curves, activeMasks, scan, basis, targetId, range, datasetKey }), [curves, activeMasks, scan, basis, targetId, range, datasetKey]);
  const fit = enabled && stored?.context === context ? stored.fit : null;
  const derived = fit ? tafelDerivedMetrics(fit) : null;
  const maskedCount = curves.reduce((sum, curve) => sum + activeMasks[curve.id].length, 0);
  const historyIndex = history.findLastIndex(edit => edit.key.startsWith(prefix));

  const changeRange = useCallback((next: TafelRange) => {
    setRange(next); setDraft({ min: String(next.min), max: String(next.max) });
    setStored(null); setError(""); setNotice("");
  }, []);

  function changeDraft(bound: "min" | "max", value: string) {
    const next = { ...draft, [bound]: value };
    setDraft(next); setStored(null); setError("");
    const min = next.min.trim() ? Number(next.min) : NaN, max = next.max.trim() ? Number(next.max) : NaN;
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) setRange({ min, max });
  }

  function maskRectangle(rectangle: TafelMaskRectangle) {
    if (!target) { setError("请先选择有数据的分析样品。"); return; }
    const indices = indicesInRectangle(target, rectangle);
    if (!indices.length) { setNotice("框内没有可屏蔽的有效点；请确认分析样品和扫描方向。"); return; }
    const key = `${datasetKey}:${target.id}`;
    setMasks(previous => ({ ...previous, [key]: [...new Set([...(previous[key] ?? []), ...indices])] }));
    setHistory(previous => [...previous, { key, indices }]);
    setStored(null); setError(""); setNotice(`已屏蔽 ${target.name} 的 ${indices.length} 个点，原始数据保留。`);
  }

  function undoMask() {
    const edit = history[historyIndex]; if (!edit) return;
    const removed = new Set(edit.indices);
    setMasks(previous => ({ ...previous, [edit.key]: (previous[edit.key] ?? []).filter(index => !removed.has(index)) }));
    setHistory(previous => previous.filter((_, index) => index !== historyIndex));
    setStored(null); setError(""); setNotice("已撤销上一次屏蔽。");
  }

  function restoreMasks() {
    setMasks(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(prefix))));
    setHistory(previous => previous.filter(edit => !edit.key.startsWith(prefix)));
    setStored(null); setError(""); setNotice("已恢复本组全部屏蔽点。");
  }

  function autoSelect() {
    try {
      setError(""); setNotice("");
      if (!target) throw Error("请先导入并选择分析样品。");
      if (scan !== "up" && scan !== "down") throw Error("自动选区需要先选择一个扫描方向（正向或反向），避免混合两支数据。");
      const points = target.plotted.filter((point): point is NonNullable<typeof point> => !!point && Number.isFinite(point.x) && Number.isFinite(point.y)).map(point => ({ x: point.x, y: point.y, index: point.index }));
      const result = autoTafelWindow(points, { minPoints: 6, minSpan: 0.3 });
      if (!result.best) throw Error(result.reason || "没有找到稳定的线性区，请手动选择。");
      const best = result.best;
      changeRange({ min: best.min, max: best.max });
      setMode("range");
      setNotice(`候选线性区：${number(best.min)} 至 ${number(best.max)}，扫描点数 n=${best.n}，R²=${number(best.rSquared)}（按 R²、跨度和点数评分）；请核对后点击线性拟合。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "自动选区失败。"); }
  }

  function runFit(restoring=false) {
    try {
      setError(""); setNotice("");
      if (!target || !target.visible) throw Error("请先导入并选择分析样品。");
      const min = draft.min.trim() ? Number(draft.min) : NaN, max = draft.max.trim() ? Number(draft.max) : NaN;
      if (!range || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw Error("请点击“选择拟合区域”，并设置下限小于上限的有效区间。");
      if (min !== range.min || max !== range.max) throw Error("拟合区间输入无效，请重新输入上下限。");
      const polarities=new Set(target.plotted.filter(point=>point&&point.x>=min&&point.x<=max&&Number.isFinite(point.current)&&point.current!==0).map(point=>Math.sign(point!.current)));
      if(polarities.size>1)throw Error("所选区间同时包含正、负电流两支数据，请先屏蔽不需要的分支后再拟合。");
      if (scan === "all") {
        const indicesFor = (direction: "up" | "down") => new Set(selectScan(curves, direction).curves.find(curve => curve.id === targetId)?.plotted.filter(point => point && point.x >= min && point.x <= max && !activeMasks[targetId].includes(point.index)).map(point => point!.index) ?? []);
        const up = indicesFor("up"), down = indicesFor("down");
        if ([...up].some(index => !down.has(index)) && [...down].some(index => !up.has(index))) throw Error("此区间同时包含正向和反向数据，请先选择一个扫描方向再拟合。");
      }
      const next = fitTafelLine(target, range, { scan, basis });
      setStored({ fit: next, context }); if(!restoring)setMode("range");
      setNotice(`已拟合 ${next.curveName} 的 ${next.n} 个未屏蔽数据点。`);
      return true;
    } catch (cause) { setStored(null); setError(cause instanceof Error ? cause.message : "线性拟合失败，请检查所选数据。");return false; }
  }
  useProjectDerived(enabled?'tafel.analysis':undefined,'fitRequested',!!fit,value=>{if(value)return runFit(true);setStored(null);return true;});

  const controls = enabled ? <div className="tafel-analysis-tools">
    <label className="tafel-analysis-sample">分析样品<select aria-label="分析样品" value={targetId} disabled={!available.length} onChange={event => { setRequestedId(event.target.value); setStored(null); setError(""); setNotice(""); }}>{!available.length && <option value="">请先导入数据</option>}{available.map(curve => <option key={curve.id} value={curve.id}>{curve.name}</option>)}</select></label>
    <div className="tafel-analysis-actions" role="group" aria-label="Tafel 数据分析">
      <button className="lsv-button secondary" aria-pressed={mode === "mask"} disabled={!target} onClick={() => { setMode(value => value === "mask" ? "zoom" : "mask"); setError(""); }}><SquareDashed size={15}/>框选屏蔽</button>
      <button className="lsv-button secondary" aria-pressed={mode === "range"} disabled={!target} onClick={() => { setMode(value => value === "range" ? "zoom" : "range"); setError(""); }}><ScanLine size={15}/>选择拟合区域</button>
      <button className="lsv-button secondary" disabled={!target} onClick={autoSelect} title="按 R²、X 跨度与点数建议候选线性区，需自行核对适用性"><Sparkles size={15}/>自动选区</button>
      <button className="lsv-button primary" disabled={!target} onClick={()=>runFit()}><TrendingUp size={15}/>线性拟合</button>
    </div>
    {range && <div className="tafel-fit-range" role="group" aria-label="拟合区间"><label>下限<input type="number" step="any" aria-label="拟合区间下限" value={draft.min} onChange={event => changeDraft("min", event.target.value)}/></label><span>至</span><label>上限<input type="number" step="any" aria-label="拟合区间上限" value={draft.max} onChange={event => changeDraft("max", event.target.value)}/></label></div>}
    <div className="tafel-mask-actions"><span><Eraser size={13}/>已屏蔽 {maskedCount} 点</span><button disabled={historyIndex < 0} onClick={undoMask}><Undo2 size={13}/>撤销屏蔽</button><button disabled={!maskedCount} onClick={restoreMasks}><RotateCcw size={13}/>恢复全部</button></div>
    <p className="tafel-analysis-hint">{mode === "mask" ? "在坐标框内拖动矩形，仅屏蔽当前分析样品的框内数据。" : mode === "range" ? "左右拖动两条红线，或输入区间；再点击线性拟合。" : "拖动框选可放大；先选屏蔽或拟合区域按钮可切换操作。"}</p>
    {error && <p className="tafel-analysis-error" role="alert">{error}</p>}
    {notice && <p className="tafel-analysis-notice" role="status">{notice}</p>}
  </div> : null;

  const resultPanel = fit ? <section className="tafel-fit-card" data-testid="tafel-fit-card">
    <div className="tafel-fit-card-heading"><strong>线性拟合结果</strong><button aria-label="关闭拟合结果" title="关闭拟合结果" onClick={() => setStored(null)}>×</button></div>
    <table data-testid="tafel-fit-table"><tbody>
      <tr><th>方程</th><td>η = a + b × x</td></tr><tr><th>样品</th><td>{fit.curveName}</td></tr>
      <tr><th>扫描方向</th><td>{scanName(fit.scan)}</td></tr><tr><th>横轴</th><td>{fit.basis === "density" ? "log₁₀ |j / (mA cm⁻²)|" : "log₁₀ |I / mA|"}</td></tr>
      <tr><th>区间</th><td>{number(fit.range.min)} 至 {number(fit.range.max)}</td></tr>
      <tr><th>点数 n</th><td data-stat="n">{fit.n}</td></tr><tr><th>权重</th><td>不加权</td></tr>
      <tr><th>截距 a（V）</th><td data-stat="intercept">{uncertainty(fit.intercept, fit.interceptSE)}</td></tr>
      <tr><th>斜率 b（V/dec）</th><td data-stat="slope">{uncertainty(fit.slope, fit.slopeSE)}</td></tr>
      <tr className="tafel-slope-result"><th>Tafel斜率（mV/dec）</th><td data-stat="slope-mv">{uncertainty(fit.slopeMvPerDec, fit.slopeSEmvPerDec)}</td></tr>
      <tr><th>斜率 95% 置信区间</th><td data-stat="slope-ci">{derived && derived.slopeCI.low !== null && derived.slopeCI.high !== null ? `${number(derived.slopeCI.low)} 至 ${number(derived.slopeCI.high)} mV/dec` : "不适用"}</td></tr>
      <tr><th>{derived?.exchange.label}</th><td data-stat="j0">{derived && derived.exchange.value !== null ? `${number(derived.exchange.value)} ${derived.exchange.unit}` : derived?.exchange.status ?? "不适用"}</td></tr>
      {derived?.exchange.value === null && derived.exchange.log10 !== null && <tr><th>{derived.exchange.logLabel}</th><td>{number(derived.exchange.log10)}</td></tr>}
      <tr><th>残差平方和 SSE</th><td data-stat="sse">{number(fit.sse)}</td></tr>
      <tr><th>Pearson's r</th><td data-stat="r">{number(fit.pearsonR)}</td></tr>
      <tr><th>R²（COD）</th><td data-stat="r2">{number(fit.rSquared)}</td></tr>
      <tr><th>调整后 R²</th><td data-stat="adj-r2">{number(fit.adjustedRSquared)}</td></tr>
    </tbody></table>
    <p className="tafel-fit-note">± 为 1 个标准误差。仅使用所选样品、扫描方向和区间内未屏蔽的点。{TAFEL_DERIVED_NOTE}</p>
    <button className="lsv-button secondary tafel-fit-export" onClick={() => { const curve = scanned.find(item => item.id === fit.curveId); if (curve) onExportFit(fit, curve); }}><Download size={15}/>导出拟合结果</button>
  </section> : null;

  return { chartCurves, controls, resultPanel, fit, masks: activeMasks, analysis: enabled ? { mode, range, onRangeChange: changeRange, onMaskRectangle: maskRectangle, fit: fit && target ? { intercept: fit.intercept, slope: fit.slope, xMin: fit.xMin, xMax: fit.xMax, color: target.color } : null } satisfies PlotAnalysisTools : undefined };
}
