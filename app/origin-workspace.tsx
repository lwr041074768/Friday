"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { BarChart3, FilePlus2, Grid2X2, LayoutGrid, LineChart, Plus, RotateCcw, Sigma, Table2, X } from "lucide-react";
import { projectStore } from "@/lib/project-state";
import { INITIAL_X, INITIAL_Y, plotCurves, type Curve } from "@/lib/lsv-math";
import OriginGraph, { fitSeries, ORIGIN_TEMPLATES, type ColumnDesignation, type OriginColumn, type OriginFit, type OriginGraphModel, type OriginWorkbook } from "@/components/origin-graph";
import FigureExportDialog from "@/components/figure-export-dialog";
import "./origin-workspace.css";

type Doc = { kind: "graph" | "workbook"; id: string };
type Model = { workbooks: OriginWorkbook[]; graphs: OriginGraphModel[] };
type IrSettings = { mode: "resistance" | "voltage"; resistance: string; voltage: string };
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`;
const finite = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);

function demoModel(): Model {
  const potential = Array.from({ length: 65 }, (_, index) => 1 + index * 0.0125);
  const current = (offset: number, amplitude: number, tau: number) => potential.map((value, index) => Number((offset + amplitude * Math.exp((value - 1.5) / tau) + 0.004 * Math.sin(index / 3)).toPrecision(6)));
  const lsv: OriginWorkbook = {
    id: "wb-demo-lsv", name: "LSV · 演示组", columns: [
      { id: "col-potential", name: "电位", unit: "V", designation: "X", values: potential },
      { id: "col-a", name: "样品 A", unit: "mA cm⁻²", designation: "Y", values: current(0.05, 0.02, 0.05) },
      { id: "col-b", name: "样品 B", unit: "mA cm⁻²", designation: "Y", values: current(0.035, 0.014, 0.055) },
      { id: "col-c", name: "样品 C", unit: "mA cm⁻²", designation: "Y", values: current(0.06, 0.009, 0.06) },
    ],
  };
  const logCurrent = Array.from({ length: 61 }, (_, index) => -3 + index * 0.06);
  const overpotential = logCurrent.map(value => Number((0.35 - 0.12 * value + 0.0012 * Math.sin(value * 9)).toPrecision(6)));
  const tafel: OriginWorkbook = {
    id: "wb-demo-tafel", name: "Tafel · 演示", columns: [
      { id: "col-logj", name: "log₁₀ |j|", unit: "", designation: "X", values: logCurrent },
      { id: "col-eta", name: "过电位 η", unit: "V", designation: "Y", values: overpotential },
    ],
  };
  const fit = fitSeries(logCurrent.map((value, index) => ({ x: value, y: overpotential[index] })));
  return {
    workbooks: [lsv, tafel],
    graphs: [
      { id: "g-demo-lsv", name: "LSV 对比图", workbookId: lsv.id, xColumnId: "col-potential", yColumnIds: ["col-a", "col-b", "col-c"], fit: null },
      { id: "g-demo-tafel", name: "Tafel 线性拟合", workbookId: tafel.id, xColumnId: "col-logj", yColumnIds: ["col-eta"], fit: fit ? { ...fit, seriesId: "col-eta" } : null },
    ],
  };
}

const designationLabel: Record<ColumnDesignation, string> = { X: "X", Y: "Y", Yerr: "Y 误差", ignore: "忽略" };
function columnStats(column: OriginColumn | undefined) {
  const values = (column?.values ?? []).filter((value): value is number => finite(value)).sort((a, b) => a - b);
  const n = values.length, mean = n ? values.reduce((sum, value) => sum + value, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean, sd, min: values[0], max: values[n - 1], median: n ? (values[(n - 1) >> 1] + values[n >> 1]) / 2 : NaN, missing: (column?.values.length ?? 0) - n };
}
const statText = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : Number(value.toPrecision(6)).toString();

function WorksheetDocument({ workbook, onChange, onNewGraph }: { workbook: OriginWorkbook; onChange: (workbook: OriginWorkbook) => void; onNewGraph: () => void }) {
  const [selected, setSelected] = useState(workbook.columns[0]?.id ?? "");
  const column = workbook.columns.find(item => item.id === selected) ?? workbook.columns[0];
  const stats = useMemo(() => columnStats(column), [column]);
  const rowCount = Math.max(0, ...workbook.columns.map(item => item.values.length)), limit = Math.min(rowCount, 300);
  const updateColumn = (id: string, patch: Partial<OriginColumn>) => onChange({ ...workbook, columns: workbook.columns.map(item => item.id === id ? { ...item, ...patch } : item) });
  const updateCell = (id: string, row: number, value: number | null) => onChange({ ...workbook, columns: workbook.columns.map(item => item.id === id ? { ...item, values: item.values.map((current, index) => index === row ? value : current) } : item) });
  return <section className="origin-doc origin-sheet" aria-label={`${workbook.name} 工作表`}>
    <header className="origin-doc-bar"><div><strong>{workbook.name}</strong><span>{rowCount} 行 × {workbook.columns.length} 列</span></div><div className="origin-doc-actions"><button className="origin-btn" onClick={onNewGraph}><LineChart size={14}/>用此表新建图</button></div></header>
    <div className="origin-sheet-scroll"><table><thead><tr><th className="origin-row-head">#</th>{workbook.columns.map((item, index) => <th key={item.id} className={selected === item.id ? "is-selected" : ""} onClick={() => setSelected(item.id)}><div className="origin-col-letter">{String.fromCharCode(65 + index)}</div><input aria-label={`列 ${index + 1} 名称`} value={item.name} onChange={event => updateColumn(item.id, { name: event.target.value })}/><select aria-label={`列 ${index + 1} 类型`} value={item.designation} onChange={event => updateColumn(item.id, { designation: event.target.value as ColumnDesignation })}>{(Object.keys(designationLabel) as ColumnDesignation[]).map(key => <option key={key} value={key}>{designationLabel[key]}</option>)}</select><input className="origin-col-unit" aria-label={`列 ${index + 1} 单位`} value={item.unit} onChange={event => updateColumn(item.id, { unit: event.target.value })} placeholder="单位"/></th>)}</tr></thead>
      <tbody>{Array.from({ length: limit }, (_, row) => <tr key={row} className={selected ? "" : ""}><th className="origin-row-head">{row + 1}</th>{workbook.columns.map((item, index) => <td key={item.id} className={selected === item.id ? "is-selected" : ""}><input type="number" step="any" aria-label={`${workbook.name} 第 ${row + 1} 行 ${item.name || `列 ${index + 1}`}`} value={item.values[row] ?? ""} onChange={event => updateCell(item.id, row, event.target.value.trim() === "" ? null : Number(event.target.value))}/></td>)}</tr>)}</tbody></table></div>
    {limit < rowCount && <p className="origin-sheet-note">预览工作表显示前 {limit} 行，共 {rowCount} 行。</p>}
    <footer className="origin-sheet-stats"><strong>{column?.name || "未选列"}</strong><span>n {stats.n}</span><span>均值 {statText(stats.mean)}</span><span>SD {statText(stats.sd)}</span><span>最小 {statText(stats.min)}</span><span>中位数 {statText(stats.median)}</span><span>最大 {statText(stats.max)}</span><span>缺失 {stats.missing}</span></footer>
  </section>;
}

function NewGraphDialog({ workbooks, initialWorkbook, onClose, onCreate }: { workbooks: OriginWorkbook[]; initialWorkbook?: string; onClose: () => void; onCreate: (value: { name: string; workbookId: string; xColumnId: string; yColumnIds: string[] }) => void }) {
  const first = workbooks.find(item => item.id === initialWorkbook) ?? workbooks[0];
  const [workbookId, setWorkbookId] = useState(first?.id ?? "");
  const workbook = workbooks.find(item => item.id === workbookId);
  const initialX = workbook?.columns.find(item => item.designation === "X") ?? workbook?.columns[0];
  const [name, setName] = useState(workbook ? `${workbook.name} 图` : "新图");
  const [xColumnId, setXColumnId] = useState(initialX?.id ?? "");
  const [yColumnIds, setYColumnIds] = useState<string[]>(workbook?.columns.filter(item => item.designation === "Y").map(item => item.id) ?? []);
  function changeWorkbook(id: string) {
    const next = workbooks.find(item => item.id === id); setWorkbookId(id);
    const x = next?.columns.find(item => item.designation === "X") ?? next?.columns[0];
    setXColumnId(x?.id ?? ""); setYColumnIds(next?.columns.filter(item => item.designation === "Y").map(item => item.id) ?? []); setName(next ? `${next.name} 图` : "新图");
  }
  const xColumns = workbook?.columns.filter(item => item.designation === "X" || item.designation !== "Yerr") ?? [];
  const yColumns = workbook?.columns.filter(item => item.designation === "Y") ?? [];
  return <div className="origin-dialog-overlay" role="presentation" onMouseDown={onClose}>
    <div className="origin-dialog" role="dialog" aria-modal="true" aria-label="新建图" onMouseDown={event => event.stopPropagation()}>
      <header><strong>新建图</strong><button aria-label="关闭新建图" onClick={onClose}><X size={16}/></button></header>
      <label>图名称<input aria-label="新图名称" value={name} onChange={event => setName(event.target.value)}/></label>
      <label>工作簿<select aria-label="新图工作簿" value={workbookId} onChange={event => changeWorkbook(event.target.value)}>{workbooks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>X 列<select aria-label="新图 X 列" value={xColumnId} onChange={event => setXColumnId(event.target.value)}>{xColumns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <fieldset><legend>Y 列</legend>{yColumns.map(item => <label key={item.id} className="origin-check"><input type="checkbox" checked={yColumnIds.includes(item.id)} onChange={event => setYColumnIds(old => event.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))}/>{item.name}</label>)}{!yColumns.length && <small>该工作簿没有标记为 Y 的列。</small>}</fieldset>
      <footer><button className="origin-btn" onClick={onClose}>取消</button><button className="origin-btn primary" disabled={!workbook || !xColumnId || !yColumnIds.length} onClick={() => onCreate({ name: name.trim() || "新图", workbookId, xColumnId, yColumnIds })}>创建</button></footer>
    </div>
  </div>;
}

export default function OriginWorkspace({ onExit }: { onExit?: () => void }) {
  const [model, setModel] = useState<Model>(demoModel);
  const [openDocs, setOpenDocs] = useState<Doc[]>([{ kind: "graph", id: "g-demo-lsv" }, { kind: "workbook", id: "wb-demo-lsv" }]);
  const [active, setActive] = useState<Doc>({ kind: "graph", id: "g-demo-lsv" });
  const [templateId, setTemplateId] = useState("default");
  const [grid, setGrid] = useState(false);
  const [dialog, setDialog] = useState<{ workbookId?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const revision = useSyncExternalStore(projectStore.subscribe, projectStore.getRevision, projectStore.getRevision);
  const lsvCurves = useMemo(() => projectStore.get<Curve[]>("lsv.curves") ?? [], [revision]);
  const lsvApplied = useMemo(() => projectStore.get<IrSettings>("lsv.applied") ?? { mode: "voltage", resistance: "0", voltage: "0" }, [revision]);
  const template = ORIGIN_TEMPLATES.find(item => item.id === templateId) ?? ORIGIN_TEMPLATES[0];
  const activeGraph = active.kind === "graph" ? model.graphs.find(item => item.id === active.id) : undefined;
  const activeWorkbook = active.kind === "workbook" ? model.workbooks.find(item => item.id === active.id) : undefined;
  const lsvPlotted = useMemo(() => plotCurves(lsvCurves, { x: INITIAL_X, y: INITIAL_Y, resistance: lsvApplied.resistance || "0", fraction: "100", irMode: "voltage", voltage: "0" }).curves, [lsvCurves, lsvApplied]);
  const graphSvg = useMemo(() => ({ current: null as SVGSVGElement | null }), []);
  function open(doc: Doc) { setOpenDocs(list => list.some(item => item.kind === doc.kind && item.id === doc.id) ? list : [...list, doc]); setActive(doc); setGrid(false); }
  function close(doc: Doc) {
    setOpenDocs(list => list.filter(item => !(item.kind === doc.kind && item.id === doc.id)));
    if (active.kind === doc.kind && active.id === doc.id) {
      const rest = openDocs.filter(item => !(item.kind === doc.kind && item.id === doc.id));
      if (rest.length) setActive(rest[rest.length - 1]);
    }
  }
  function updateGraph(id: string, patch: Partial<OriginGraphModel>) { setModel(current => ({ ...current, graphs: current.graphs.map(item => item.id === id ? { ...item, ...patch } : item) })); }
  function updateWorkbook(workbook: OriginWorkbook) { setModel(current => ({ ...current, workbooks: current.workbooks.map(item => item.id === workbook.id ? workbook : item) })); }
  function fitGraph(graph: OriginGraphModel) {
    const workbook = model.workbooks.find(item => item.id === graph.workbookId);
    const x = workbook?.columns.find(item => item.id === graph.xColumnId);
    const y = workbook?.columns.find(item => item.id === graph.yColumnIds[0]);
    if (!workbook || !x || !y) { setNotice("该图没有可拟合的数据列。"); return; }
    const points = x.values.map((value, index) => ({ x: value, y: y.values[index] })).filter((point): point is { x: number; y: number } => finite(point.x) && finite(point.y));
    const fit = fitSeries(points);
    if (!fit) { setNotice("有效点不足 3 个（或 X 没有变化），无法拟合。"); return; }
    updateGraph(graph.id, { fit: { ...fit, seriesId: y.id } });
    setNotice(`已为“${graph.name}”添加线性拟合：斜率 ${fit.slope.toPrecision(6)}，截距 ${fit.intercept.toPrecision(6)}，R² ${fit.r2.toFixed(5)}。${fit.r2 < 0.9 ? "R² 偏低：这段数据本身不适合线性拟合，可打开 Tafel 演示图查看线性区示例。" : ""}`);
  }
  function importLsv() {
    const usable = lsvPlotted.filter(curve => !curve.error && curve.plotted.some(Boolean)).slice(0, 8);
    if (!usable.length) { setNotice("LSV 工作台还没有可导入的曲线。请先到 LSV 页导入数据，或点“载入示例”。"); return; }
    const workbooks: OriginWorkbook[] = [], graphs: OriginGraphModel[] = [];
    for (const curve of usable) {
      const points = curve.plotted.filter((point): point is NonNullable<typeof point> => !!point && Number.isFinite(point.x) && Number.isFinite(point.y));
      if (points.length < 2) continue;
      const workbookId = nextId("wb"), xId = nextId("col"), yId = nextId("col");
      workbooks.push({ id: workbookId, name: curve.name, columns: [
        { id: xId, name: "X", unit: "", designation: "X", values: points.map(point => point.x) },
        { id: yId, name: "Y", unit: "", designation: "Y", values: points.map(point => point.y) },
      ] });
      graphs.push({ id: nextId("g"), name: `${curve.name} 图`, workbookId, xColumnId: xId, yColumnIds: [yId], fit: null });
    }
    if (!workbooks.length) { setNotice("没有可导入的有效曲线。"); return; }
    setModel(current => ({ workbooks: [...current.workbooks, ...workbooks], graphs: [...current.graphs, ...graphs] }));
    setOpenDocs(list => [...list, { kind: "graph", id: graphs[0].id }]); setActive({ kind: "graph", id: graphs[0].id }); setGrid(false);
    setNotice(`已从 LSV 导入 ${workbooks.length} 个样品；每个样品一个工作簿和一张图。`);
  }
  function addWorkbook() {
    const workbook: OriginWorkbook = { id: nextId("wb"), name: `工作簿 ${model.workbooks.length + 1}`, columns: [
      { id: nextId("col"), name: "X", unit: "", designation: "X", values: Array(12).fill(null) },
      { id: nextId("col"), name: "Y", unit: "", designation: "Y", values: Array(12).fill(null) },
    ] };
    setModel(current => ({ ...current, workbooks: [...current.workbooks, workbook] })); open({ kind: "workbook", id: workbook.id });
    setNotice("已新建空白工作表，可直接在单元格输入数据；输入 X/Y 后可用“用此表新建图”。");
  }
  function resetDemo() { setModel(demoModel()); setOpenDocs([{ kind: "graph", id: "g-demo-lsv" }, { kind: "workbook", id: "wb-demo-lsv" }]); setActive({ kind: "graph", id: "g-demo-lsv" }); setGrid(false); setNotice("已恢复示例工作簿与图。"); }
  const activeWorkbookForGraph = activeGraph ? model.workbooks.find(item => item.id === activeGraph.workbookId) : undefined;
  const graphCount = model.graphs.length, workbookCount = model.workbooks.length, fitCount = model.graphs.filter(item => item.fit).length;
  return <div className="origin-mode">
    <header className="origin-toolbar">
      <div className="origin-mode-title"><span className="origin-mark"><LayoutGrid size={17}/></span><div><strong>Origin 模式</strong><small>预览 · 项目树 / 工作表 / 独立图窗口</small></div></div>
      <div className="origin-toolbar-actions">
        <button className="origin-btn" onClick={resetDemo} title="恢复演示工作簿与图"><RotateCcw size={14}/>载入示例</button>
        <button className="origin-btn" onClick={importLsv} title="把 LSV 工作台的曲线变成工作簿和图"><FilePlus2 size={14}/>从 LSV 导入</button>
        <button className="origin-btn" onClick={() => setDialog({ workbookId: activeWorkbook?.id })}><LineChart size={14}/>新建图…</button>
        <button className="origin-btn" onClick={addWorkbook}><Table2 size={14}/>新建工作表</button>
        <button className="origin-btn" aria-pressed={grid} onClick={() => setGrid(value => !value)}><Grid2X2 size={14}/>并排</button>
        <label className="origin-template">模板<select aria-label="图形模板" value={templateId} onChange={event => setTemplateId(event.target.value)}>{ORIGIN_TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {onExit && <button className="origin-btn" onClick={onExit} title="返回工作台"><X size={14}/>退出预览</button>}
      </div>
    </header>
    {notice && <div className="origin-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={13}/></button></div>}
    <div className="origin-workarea">
      <aside className="origin-tree">
        <div className="origin-tree-section">
          <div className="origin-tree-head"><Table2 size={14}/><span>工作簿</span><b>{workbookCount}</b><button aria-label="新建工作表" onClick={addWorkbook}><Plus size={14}/></button></div>
          {model.workbooks.map(workbook => <button key={workbook.id} className={`origin-tree-item${active.kind === "workbook" && active.id === workbook.id ? " is-active" : ""}`} onClick={() => open({ kind: "workbook", id: workbook.id })}><Table2 size={14}/><span>{workbook.name}</span><small>{workbook.columns.length} 列</small></button>)}
        </div>
        <div className="origin-tree-section">
          <div className="origin-tree-head"><LineChart size={14}/><span>图</span><b>{graphCount}</b></div>
          {model.graphs.map(graph => <button key={graph.id} className={`origin-tree-item${active.kind === "graph" && active.id === graph.id ? " is-active" : ""}`} onClick={() => open({ kind: "graph", id: graph.id })}><LineChart size={14}/><span>{graph.name}</span></button>)}
        </div>
        <div className="origin-tree-section">
          <div className="origin-tree-head"><Sigma size={14}/><span>分析</span><b>{fitCount}</b></div>
          {model.graphs.filter(graph => graph.fit).map(graph => <button key={graph.id} className="origin-tree-item" onClick={() => open({ kind: "graph", id: graph.id })}><Sigma size={14}/><span>线性拟合 · {graph.name}</span></button>)}
          {!fitCount && <p className="origin-tree-empty">在图属性里添加线性拟合</p>}
        </div>
      </aside>
      <main className="origin-docs">
        {grid ? <div className="origin-grid">{model.graphs.slice(0, 4).map(graph => { const workbook = model.workbooks.find(item => item.id === graph.workbookId); return <button key={graph.id} className="origin-grid-card" onClick={() => open({ kind: "graph", id: graph.id })}>{workbook && <OriginGraph graph={graph} workbook={workbook} template={template} compact/>}<span>{graph.name}</span></button>; })}{!model.graphs.length && <p className="origin-empty">还没有图。</p>}</div> : <>
          <div className="origin-tabs" role="tablist" aria-label="已打开的文档">{openDocs.map(doc => {
            const label = doc.kind === "graph" ? model.graphs.find(item => item.id === doc.id)?.name : model.workbooks.find(item => item.id === doc.id)?.name;
            const selected = active.kind === doc.kind && active.id === doc.id;
            return <div key={`${doc.kind}-${doc.id}`} className={`origin-tab${selected ? " is-active" : ""}`}><button role="tab" aria-selected={selected} onClick={() => setActive(doc)}>{doc.kind === "graph" ? <LineChart size={13}/> : <Table2 size={13}/>}{label ?? "已关闭"}</button><button className="origin-tab-close" aria-label={`关闭 ${label ?? ""}`} onClick={() => close(doc)}><X size={12}/></button></div>;
          })}</div>
          <div className="origin-doc-area">
            {activeGraph && activeWorkbookForGraph ? <section className="origin-doc origin-graph-doc" aria-label={`${activeGraph.name} 图`}>
              <header className="origin-doc-bar"><div><strong>{activeGraph.name}</strong><span>{activeWorkbookForGraph.name} · {activeGraph.yColumnIds.length} 条曲线</span></div><div className="origin-doc-actions"><span className="origin-template-chip">{template.name}</span><button className="origin-btn" onClick={() => fitGraph(activeGraph)}><Sigma size={14}/>线性拟合</button><FigureExportDialog getSvg={() => graphSvg.current} defaultName={activeGraph.name} compact/></div></header>
              <div className="origin-graph-canvas"><OriginGraph key={activeGraph.id} graph={activeGraph} workbook={activeWorkbookForGraph} template={template} svgRef={graphSvg}/></div>
            </section> : activeWorkbook ? <WorksheetDocument workbook={activeWorkbook} onChange={updateWorkbook} onNewGraph={() => setDialog({ workbookId: activeWorkbook.id })}/> : <div className="origin-empty"><BarChart3 size={34}/><p>从左侧打开一个工作簿或图。</p></div>}
          </div>
        </>}
      </main>
      {!grid && <aside className="origin-properties">
        {activeGraph && activeWorkbookForGraph ? <div className="origin-prop-body">
          <h3>图形</h3>
          <label>名称<input aria-label="图形名称" value={activeGraph.name} onChange={event => updateGraph(activeGraph.id, { name: event.target.value })}/></label>
          <label>工作簿<select aria-label="图形工作簿" value={activeGraph.workbookId} onChange={event => { const workbook = model.workbooks.find(item => item.id === event.target.value); if (!workbook) return; const x = workbook.columns.find(item => item.designation === "X") ?? workbook.columns[0]; updateGraph(activeGraph.id, { workbookId: workbook.id, xColumnId: x?.id ?? "", yColumnIds: workbook.columns.filter(item => item.designation === "Y").slice(0, 4).map(item => item.id), fit: null }); }}>{model.workbooks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <h3>数据</h3>
          <label>X 列<select aria-label="图形 X 列" value={activeGraph.xColumnId} onChange={event => updateGraph(activeGraph.id, { xColumnId: event.target.value, fit: null })}>{activeWorkbookForGraph.columns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="origin-y-list">{activeWorkbookForGraph.columns.filter(item => item.designation === "Y").map(item => <label key={item.id} className="origin-check"><input type="checkbox" checked={activeGraph.yColumnIds.includes(item.id)} onChange={event => updateGraph(activeGraph.id, { yColumnIds: event.target.checked ? [...activeGraph.yColumnIds, item.id] : activeGraph.yColumnIds.filter(id => id !== item.id), fit: null })}/>{item.name}</label>)}</div>
          <h3>线性拟合</h3>
          {activeGraph.fit ? <div className="origin-fit-card"><b>y = a + b·x</b><span>a = {statText(activeGraph.fit.intercept)}</span><span>b = {statText(activeGraph.fit.slope)}</span><span>R² = {activeGraph.fit.r2.toFixed(5)}</span><span>n = {activeGraph.fit.n}</span><button className="origin-btn" onClick={() => updateGraph(activeGraph.id, { fit: null })}>移除拟合</button></div> : <button className="origin-btn primary" onClick={() => fitGraph(activeGraph)}><Sigma size={14}/>添加线性拟合</button>}
          <p className="origin-hint">这里演示 Origin 的“分析对象”：拟合挂在图上，数据改了可重新拟合；项目树会出现“分析”条目。</p>
        </div> : activeWorkbook ? <div className="origin-prop-body">
          <h3>工作簿</h3>
          <label>名称<input aria-label="工作簿名称" value={activeWorkbook.name} onChange={event => updateWorkbook({ ...activeWorkbook, name: event.target.value })}/></label>
          <p className="origin-hint">列类型可在表头切换 X / Y / 误差 / 忽略。双击单元格可直接改数，图会跟着变。</p>
          <h3>列</h3>
          {activeWorkbook.columns.map(column => <div key={column.id} className="origin-prop-column"><b>{column.name}</b><span>{`${designationLabel[column.designation]}${column.unit ? ` · ${column.unit}` : ""}`}</span></div>)}
          <button className="origin-btn" onClick={() => setDialog({ workbookId: activeWorkbook.id })}><LineChart size={14}/>用此表新建图</button>
        </div> : <div className="origin-empty"><p>没有打开的文档。</p></div>}
      </aside>}
    </div>
    {dialog && <NewGraphDialog workbooks={model.workbooks} initialWorkbook={dialog.workbookId} onClose={() => setDialog(null)} onCreate={value => { const graph: OriginGraphModel = { id: nextId("g"), ...value, fit: null }; setModel(current => ({ ...current, graphs: [...current.graphs, graph] })); setOpenDocs(list => [...list, { kind: "graph", id: graph.id }]); setActive({ kind: "graph", id: graph.id }); setDialog(null); setGrid(false); setNotice(`已创建图“${graph.name}”。`); }}/>}
  </div>;
}
