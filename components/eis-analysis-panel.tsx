"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Download, Search, Square, X } from "lucide-react";
import type { Curve, PlotCurve } from "@/lib/lsv-math";
import { circuitParameters, type EisCircuitKind } from "@/lib/eis-circuit";
import type { EisAutoFitProgress, EisAutoFitResult, EisFitCandidate, EisFitWorkerRequest, EisFitWorkerResponse } from "@/lib/eis-auto-fit";
import { ZSIMP_MODELS } from "@/lib/eis-zsimp-models";
import { useProjectDerived, useProjectEpoch, useProjectState } from "@/lib/project-state";
import { buildEisFitReportCsv, collectEisFitPoints, createEisFitReport, EIS_CIRCUIT_MODELS, eisResistanceLabel, eisResidualSummary, type EisFitReport, type EisFitSelection, type EisWeighting } from "@/lib/eis-fit-report";
import EisCircuitDiagram from "@/components/eis-circuit-diagram";
import "@/app/eis-fit.css";

const MODELS = EIS_CIRCUIT_MODELS;
const number = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : value === 0 ? "0" : Math.abs(value) < 1e-4 || Math.abs(value) >= 1e6 ? value.toExponential(4) : Number(value.toPrecision(6)).toString();
const weightedRms = (value: number, weighting: EisWeighting) => weighting === "modulus" ? `${number(value * 100)}%` : `${number(value)} Ω`;

function selectionFor(result: EisAutoFitResult, mode: "auto" | "manual", selected?: EisFitCandidate): EisFitSelection {
  return { mode, attempted: result.attempted, total: result.total, failed: result.failed, elapsedMs: result.elapsedMs, selectedRank: selected?.rank, searchBudget: result.searchBudget ? { ...result.searchBudget } : undefined,
    candidates: result.candidates.map(candidate => ({ kind: candidate.kind, label: candidate.label, expression: candidate.expression, rank: candidate.rank, aicc: candidate.aicc, deltaAicc: candidate.deltaAicc, score: candidate.score, stable: candidate.stable, converged: candidate.fit.converged, rms: candidate.rms, parameterCount: candidate.parameterCount, warnings: candidate.warnings, starts: candidate.starts, successfulStarts: candidate.successfulStarts, searchIterations: candidate.searchIterations, refined: candidate.refined })) };
}

export function useEisCircuitFit(curves: Curve[], active: boolean) {
  const [kind, setKind] = useProjectState<EisCircuitKind>("eis.analysis", "kind", "r-cpe");
  const [selectionMode, setSelectionMode] = useProjectState<"auto" | "manual">("eis.analysis", "selectionMode", "auto");
  const [weighting, setWeighting] = useProjectState<EisWeighting>("eis.analysis", "weighting", "modulus");
  const [requestedId, setRequestedId] = useProjectState("eis.analysis", "requestedId", "");
  const [stored, setStored] = useState<{ report: EisFitReport; result: EisAutoFitResult; context: object } | null>(null);
  const [running, setRunning] = useState<{ context: object; progress: EisAutoFitProgress } | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [modelSearch, setModelSearch] = useState(""), [showAllCandidates, setShowAllCandidates] = useState(false);
  const workerRef = useRef<{ worker: Worker; requestId: string } | null>(null);
  const projectEpoch = useProjectEpoch();
  const available = curves.filter(curve => curve.visible);
  const target = available.find(curve => curve.id === requestedId) ?? available[0];
  const model = MODELS.find(item => item.value === kind) ?? MODELS.find(item => item.value === "r-cpe")!;
  // Every input identity and project restore invalidates the report immediately.
  const context = useMemo(() => ({ curves, target, kind, selectionMode, weighting, projectEpoch, active }), [curves, target, kind, selectionMode, weighting, projectEpoch, active]);
  const liveContext = useRef(context); liveContext.current = context;
  const report = active && stored?.context === context ? stored.report : null;
  const result = report ? stored!.result : null;
  const fit = report?.fit ?? null;
  const progress = running?.context === context ? running.progress : null;
  const selectedCandidate = result?.candidates.find(candidate => candidate.kind === fit?.kind);
  const fittedModel = fit ? MODELS.find(item => item.value === fit.kind) : null;
  const parameters = fit ? circuitParameters(fit.kind) : [];
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    const matches = MODELS.filter(item => !query || `${item.label} ${item.value} ${item.equation}`.toLocaleLowerCase().includes(query));
    return matches.some(item => item.value === model.value) ? matches : [model, ...matches];
  }, [modelSearch, model]);

  function stopWorker() { workerRef.current?.worker.terminate(); workerRef.current = null; }
  useEffect(() => {
    stopWorker(); setRunning(null); setError(""); setNotice(""); setShowAllCandidates(false);
    return stopWorker;
  }, [context]);
  const overlay = useMemo<PlotCurve | null>(() => {
    if (!fit) return null;
    return { id: "eis-circuit-fit", name: `拟合 · ${MODELS.find(item => item.value === fit.kind)?.label ?? fit.kind}`,
      color: "#d92d3e", visible: true, unit: "A", resistance: "", area: "", compensation: "unknown",
      source: "等效电路最小二乘拟合", imaginary: "negative", style: "line", points: [], invalid: 0,
      plotted: fit.predicted.map((point, index) => ({ x: point.zReal, y: point.minusZImag, e: point.zReal, current: -point.minusZImag, index })) };
  }, [fit]);
  const residual = useMemo(() => fit ? eisResidualSummary(fit) : null, [fit]);

  function run(): boolean {
    stopWorker(); setStored(null); setError(""); setNotice(""); setShowAllCandidates(false);
    try {
      if (!active || !target) throw new Error("请先导入并选择 EIS 样品。");
      const { points, missing } = collectEisFitPoints(target);
      if (points.length < 5) throw new Error(`当前样品有 ${points.length} 个带频率的有效点${missing ? `，已跳过 ${missing} 个缺少频率或无效的点` : ""}。拟合需要至少 5 个点，请在导入时保留频率列。`);
      const startContext = context, selectedTarget = target, mode = selectionMode;
      const worker = new Worker(new URL("../lib/eis-fit-worker.ts", import.meta.url), { type: "module" });
      const requestId = crypto.randomUUID();
      workerRef.current = { worker, requestId };
      setRunning({ context: startContext, progress: { completed: 0, total: mode === "auto" ? ZSIMP_MODELS.length : 1, currentModel: "", phase: "screening" } });
      const fail = (message: string) => {
        if (liveContext.current !== startContext || workerRef.current?.requestId !== requestId) return;
        stopWorker(); setRunning(null); setStored(null); setError(message);
      };
      worker.onerror = event => fail(event.message || "拟合计算中断，请重新拟合。");
      worker.onmessage = (event: MessageEvent<EisFitWorkerResponse>) => {
        const message = event.data;
        if (message.requestId !== requestId || liveContext.current !== startContext || workerRef.current?.requestId !== requestId) return;
        if (message.type === "progress") { setRunning({ context: startContext, progress: message }); return; }
        if (message.type === "error") { fail(message.message); return; }
        const next = message.result, best = next.best;
        if (!best?.converged) { fail(best?.warnings.join("；") || "本次模型搜索尚未获得收敛结果，请检查频率范围、数据与虚部符号。"); return; }
        try {
          const candidate = next.candidates.find(item => item.kind === best.kind);
          const nextReport = createEisFitReport(selectedTarget, best, weighting, selectionFor(next, mode, candidate));
          setStored({ report: nextReport, result: next, context: startContext });
          setNotice(mode === "auto" ? `已评估 ${next.attempted} 个电路，推荐 ${candidate?.expression ?? best.kind}。${missing ? ` 跳过 ${missing} 个缺少频率或无效的点。` : ""}` : `已拟合 ${selectedTarget.name}，χ² = ${number(best.chiSquared)}。`);
          stopWorker(); setRunning(null);
        } catch (cause) { fail(cause instanceof Error ? cause.message : "拟合结果校验失败，请重新拟合。"); }
      };
      const request: EisFitWorkerRequest = { type: "fit", requestId, points, options: { kind: mode === "auto" ? "auto" : kind, weighting } };
      worker.postMessage(request);
      return true;
    } catch (cause) {
      stopWorker(); setRunning(null); setError(cause instanceof Error ? cause.message : "等效电路拟合失败。"); return false;
    }
  }
  useProjectDerived("eis.analysis", "fitRequested", !!fit || !!progress, requested => { if (requested) return run(); stopWorker(); setRunning(null); setStored(null); return true; });
  function cancel() { stopWorker(); setRunning(null); setNotice("已取消拟合。"); setError(""); }
  function clear() { stopWorker(); setRunning(null); setStored(null); setNotice(""); setError(""); }
  function chooseCandidate(candidate: EisFitCandidate) {
    if (!target || !result || !report || !candidate.fit.converged) return;
    try {
      const nextReport = createEisFitReport(target, candidate.fit, weighting, selectionFor(result, "auto", candidate));
      setStored({ report: nextReport, result, context }); setNotice(`已显示第 ${candidate.rank} 名候选：${candidate.expression}。`); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "候选结果读取失败，请重新拟合。"); }
  }
  function exportReport() {
    try {
      if (!report || !target) throw new Error("请先完成当前样品的拟合。");
      const text = buildEisFitReportCsv(report, target), url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), link = document.createElement("a");
      link.href = url; link.download = `${report.curveName.replace(/[\\/:*?"<>|]/g, "_")}-EIS-拟合报告.csv`; document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
      setNotice(`已导出 ${report.curveName} 的参数、候选排名与 ${fit!.n} 个点的逐点残差。`); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "拟合报告导出失败。"); }
  }

  const controls = active ? <section className="lsv-curves-panel eis-fit-panel" aria-label="EIS 等效电路拟合">
    <div className="lsv-curves-heading"><h2>等效电路拟合</h2><span>{ZSIMP_MODELS.length} 个模型</span></div>
    <label className="lsv-field">拟合样品<select className="lsv-select" aria-label="EIS 拟合样品" value={target?.id ?? ""} disabled={!available.length} onChange={event => setRequestedId(event.target.value)}>{!available.length && <option value="">请先导入数据</option>}{available.map(curve => <option key={curve.id} value={curve.id}>{curve.name}</option>)}</select></label>
    <div className="eis-fit-mode" role="group" aria-label="电路选择方式"><button aria-pressed={selectionMode === "auto"} onClick={() => setSelectionMode("auto")}>自动选择最佳电路</button><button aria-pressed={selectionMode === "manual"} onClick={() => setSelectionMode("manual")}>手动选择</button></div>
    {selectionMode === "auto" ? <p className="lsv-subtle eis-fit-mode-note">遍历 {ZSIMP_MODELS.length} 个电路，比较拟合误差、AICc 与参数稳定性。</p> : <div className="eis-fit-model-picker">
      <label className="eis-model-search"><Search size={14}/><input type="search" aria-label="搜索等效电路" placeholder="搜索电路，如 R(QR)" value={modelSearch} onChange={event => setModelSearch(event.target.value)}/></label>
      <label className="lsv-field">等效电路<select className="lsv-select" aria-label="EIS 等效电路" value={model.value} onChange={event => setKind(event.target.value as EisCircuitKind)}><optgroup label={`ZSimpWin 模型库（${ZSIMP_MODELS.length}）`}>{filteredModels.filter(item => item.value.startsWith("zsimp:")).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup><optgroup label="常用电路">{filteredModels.filter(item => !item.value.startsWith("zsimp:")).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup></select></label>
      <EisCircuitDiagram kind={model.value} label={model.label}/><p className="lsv-subtle eis-model-equation">{model.equation}</p>
    </div>}
    <label className="lsv-field">加权方式<select className="lsv-select" aria-label="EIS 拟合加权" value={weighting} onChange={event => setWeighting(event.target.value as EisWeighting)}><option value="modulus">按 |Z| 加权（推荐）</option><option value="unit">不加权</option></select></label>
    <div className="eis-fit-actions"><button className="lsv-button primary" disabled={!target || !!progress} onClick={() => run()}><Activity size={15}/>{progress ? "拟合中…" : "拟合"}</button>{progress && <button className="lsv-button secondary" onClick={cancel}><Square size={13}/>取消</button>}<button className="lsv-button secondary" disabled={!report} onClick={exportReport}><Download size={15}/>导出拟合报告</button>{fit && <button className="lsv-button secondary" onClick={clear}>清除结果</button>}</div>
    {progress && <div className="eis-fit-progress" data-testid="eis-fit-progress" role="status" aria-live="polite"><progress aria-label="电路搜索进度" value={progress.completed} max={progress.total}/><span>{selectionMode === "manual" ? "正在拟合所选电路" : progress.phase === "refining" ? `已检查 ${progress.total} 个电路，正在精修候选` : `正在检查 ${progress.completed} / ${progress.total} 个电路`}{progress.currentModel && <code>{progress.currentModel}</code>}</span></div>}
    {error && <p className="lsv-error" role="alert">{error}</p>}{notice && <p className="lsv-import-message" role="status">{notice}</p>}
    <p className="lsv-subtle">使用原始频率、Z′ 与 −Z″。报告保存参数、候选排名和逐点残差；重开项目时重新计算。</p>
  </section> : null;

  const candidates = result?.candidates ?? [], shownCandidates = showAllCandidates ? candidates : candidates.slice(0, 5);
  const resultPanel = fit && report ? <section className="tafel-fit-card eis-fit-card" data-testid="eis-fit-card">
    <div className="tafel-fit-card-heading"><strong>{report.selection?.mode === "auto" ? `推荐电路${selectedCandidate && selectedCandidate.rank > 1 ? ` · 当前第 ${selectedCandidate.rank} 名` : ""}` : "等效电路拟合结果"}</strong><button aria-label="关闭拟合结果" title="关闭拟合结果" onClick={clear}><X size={14}/></button></div>
    <EisCircuitDiagram kind={fit.kind} label={fittedModel?.label ?? String(fit.kind)}/>
    <table data-testid="eis-fit-table"><tbody><tr><th>样品</th><td>{report.curveName}</td></tr><tr><th>电路</th><td>{fittedModel?.label ?? fit.kind}</td></tr><tr><th>加权</th><td>{report.weighting === "modulus" ? "按 |Z| 加权" : "不加权"}</td></tr>
      {parameters.map(parameter => <tr key={parameter.key}><th>{parameter.label}</th><td data-parameter={parameter.key}>{number(fit.params[parameter.key])} ± {number(fit.standardErrors[parameter.key])} {parameter.unit}</td></tr>)}
      {Number.isFinite(fit.totalResistance) && <tr><th>{eisResistanceLabel(fit.kind)}</th><td>{number(fit.totalResistance)} Ω</td></tr>}
      <tr><th>χ²</th><td>{number(fit.chiSquared)}</td></tr>{selectedCandidate && <tr><th>AICc / ΔAICc</th><td>{number(selectedCandidate.aicc)} / {number(selectedCandidate.deltaAicc)}</td></tr>}
      <tr><th>残差 RMS / 最大</th><td>{number(residual?.rms)} / {number(residual?.max)} Ω</td></tr><tr><th>点数 / 自由度</th><td>{fit.n} / {fit.dof}</td></tr><tr><th>迭代次数</th><td>{fit.iterations}</td></tr></tbody></table>
    {candidates.length > 0 && <div className="eis-fit-candidates" data-testid="eis-fit-candidates"><div className="eis-candidate-heading"><strong>候选排名</strong><span>{result!.attempted} 个已检查 · {candidates.filter(candidate => candidate.fit.converged).length} 个已收敛</span></div><div className="eis-candidate-table-wrap" data-testid="eis-candidate-list"><table><thead><tr><th>排名 / 电路</th><th>ΔAICc</th><th>加权 RMS</th><th>参数</th></tr></thead><tbody>{shownCandidates.map(candidate => <tr key={candidate.kind} className={candidate.kind === fit.kind ? "is-selected" : ""}><td><button data-kind={candidate.kind} disabled={!candidate.fit.converged} aria-pressed={candidate.kind === fit.kind} onClick={() => chooseCandidate(candidate)} title={candidate.warnings.join("；")}><span>#{candidate.rank}</span> <code>{candidate.expression}</code>{candidate.kind === fit.kind && <span className="eis-current-candidate">当前</span>}</button></td><td title={`AICc = ${number(candidate.aicc)}`}>{number(candidate.deltaAicc)}</td><td>{weightedRms(candidate.rms, weighting)}</td><td><span className={candidate.stable && candidate.fit.converged ? "eis-parameter-stable" : "eis-parameter-check"}>{!candidate.fit.converged ? "待收敛" : candidate.stable ? "稳定" : "待检查"}</span><small>{candidate.parameterCount} 个</small></td></tr>)}</tbody></table></div>{candidates.length > 5 && <button className="eis-show-candidates" onClick={() => setShowAllCandidates(value => !value)}>{showAllCandidates ? "收起候选" : `查看全部 ${candidates.length} 个候选`}</button>}<p className="tafel-fit-note">按 AICc 比较模型；ΔAICc ≤ 2 时优先参数较少、估计较稳定的电路。点击候选可比较拟合线与参数。</p></div>}
    <p className="tafel-fit-note">± 为局部协方差估计的标准误差。模型与参数的物理含义请结合样品和实验条件核对。</p>{fit.warnings.length > 0 && <p className="tafel-analysis-error" role="status">{fit.warnings.join("；")}</p>}{selectedCandidate && !selectedCandidate.stable && <p className="eis-fit-stability-note">部分参数约束较弱，可比较邻近候选与参数标准误差。</p>}
  </section> : null;
  return { controls, resultPanel, overlay, target };
}
