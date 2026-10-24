"use client";
import {useEffect as useProjectEffect} from "react";
import {useProjectState,useProjectEpoch} from "@/lib/project-state";


import { useMemo, useState } from "react";
import { Eye, EyeOff, Settings2, Trash2, Upload } from "lucide-react";
import LsvPlot from "@/components/lsv-plot";
import XyImportDialog from "@/components/xy-import-dialog";
import XyDataExport from "@/components/xy-data-export";
import XyOriginExport from "@/components/xy-origin-export";
import XrdJadeReader from "@/components/xrd-jade-reader";
import { referencePeaksAtWavelength, XRD_DEFAULT_WAVELENGTH, type ReferenceCard } from "@/lib/xrd-reference-types";
import { OptionSelect, type FileImportRequest } from "@/components/lsv-import-dialog";
import type { Curve, PlotCurve } from "@/lib/lsv-math";

export default function XrdWorkspace() {
  const [curves, setCurves] = useProjectState<Curve[]>('xrd','curves',[]);
  const [open, setOpen] = useState(false), [message, setMessage] = useState("");
  const [fileRequest, setFileRequest] = useState<FileImportRequest>();
  const [stack, setStack] = useProjectState('xrd','stack',false), [normalize, setNormalize] = useProjectState('xrd','normalize',false);
  const [offset, setOffset] = useProjectState('xrd','offset',"500");
  const [xLabel, setXLabel] = useProjectState('xrd','xLabel',"2θ / °"), [yLabel, setYLabel] = useProjectState('xrd','yLabel',"Intensity / a.u.");
  const [referenceCards,setReferenceCards]=useProjectState<ReferenceCard[]>('xrd','referenceCards',[]);
  const projectEpoch=useProjectEpoch();useProjectEffect(()=>{if(projectEpoch){setMessage('');setOpen(false);setFileRequest(undefined);}},[projectEpoch]);
  const [wavelength,setWavelength]=useProjectState('xrd','wavelength',XRD_DEFAULT_WAVELENGTH);
  const referenceSticks=useMemo(()=>referenceCards.filter(card=>card.visible).map(card=>({id:card.id,name:`PDF#${card.sourceId} · ${card.name}`,color:card.color,peaks:referencePeaksAtWavelength(card,wavelength).map(peak=>({x:peak.twoTheta,intensity:peak.intensity,intensityQualifier:peak.intensityQualifier,d:peak.d,hkl:peak.hkl}))})),[referenceCards,wavelength]);
  const result = useMemo(() => {
    if (stack && (!offset.trim() || !Number.isFinite(Number(offset)) || Number(offset) < 0)) {
      return { curves: [] as PlotCurve[], error: "堆叠间距需为大于或等于 0 的数值。" };
    }
    let visibleIndex = 0;
    return {
      curves: curves.map((curve): PlotCurve => {
        let magnitude = 0;
        for (const point of curve.points) if(Number.isFinite(point.current))magnitude = Math.max(magnitude, Math.abs(point.current));
        const shift = stack && curve.visible ? visibleIndex * Number(offset) : 0;
        if (curve.visible) visibleIndex++;
        return { ...curve, invalid: 0, plotted: curve.points.map((point, index) => Number.isFinite(point.e)&&Number.isFinite(point.current)?({
          x: point.e, y: (normalize && magnitude ? point.current / magnitude : point.current) + shift,
          e: point.e, current: point.current, index,
        }):null) };
      }), error: undefined,
    };
  }, [curves, stack, normalize, offset]);

  function change(id: string, patch: Partial<Curve>) {
    setCurves(list => list.map(curve => curve.id === id ? { ...curve, ...patch } : curve));
  }
  function drop(files: File[]) {
    if (!files.length) return;
    setFileRequest(last => ({ id: (last?.id ?? 0) + 1, files }));
    setOpen(true);
  }

  const exportSettings = { normalize, stack, offset: Number.isFinite(Number(offset)) ? Number(offset) : offset };
  return <div className="lsv-workspace lsv-raised-workspace lsv-viewport-workspace xrd-workspace">
    <div className="lsv-layout lsv-compact-layout">
      <aside className="lsv-controls">
        <div className="lsv-heading">
          <div><div className="lsv-eyebrow">DIFFRACTION / XRD</div><h1>XRD 谱图绘制</h1></div>
          <div className="lsv-heading-actions">
            <button className="lsv-button primary" onClick={() => setOpen(true)} disabled={curves.length >= 20}><Upload size={15}/>导入数据</button>
          </div>
        </div>
        <section className="lsv-curves-panel">
          <div className="lsv-curves-heading"><h2>曲线管理 <span>{curves.length} / 20</span></h2></div>
          {curves.length ? curves.map(curve => <div className={`lsv-managed-curve ${curve.visible ? "" : "hidden-curve"}`} key={curve.id}>
            <div className="lsv-curve-row">
              <button aria-label={`${curve.visible ? "隐藏" : "显示"} ${curve.name}`} onClick={() => change(curve.id, { visible: !curve.visible })}>{curve.visible ? <Eye size={17}/> : <EyeOff size={17}/>}</button>
              <input type="color" className="lsv-color-input" aria-label={`${curve.name}颜色`} value={curve.color} onChange={event => change(curve.id, { color: event.target.value })}/>
              <input aria-label={`${curve.name}名称`} value={curve.name} onChange={event => change(curve.id, { name: event.target.value })}/>
              <button className="lsv-delete-curve" aria-label={`删除 ${curve.name}`} onClick={() => setCurves(list => list.filter(item => item.id !== curve.id))}><Trash2 size={16}/></button>
            </div>
            <details className="lsv-curve-details"><summary>{curve.points.length.toLocaleString()} 个点 · 数据来源</summary><div className="xrd-source-details">{curve.source}</div></details>
          </div>) : <p className="lsv-subtle">尚未导入数据 · 最多 20 条曲线</p>}
        </section>
        <XrdJadeReader cards={referenceCards} onCardsChange={setReferenceCards} wavelength={wavelength} onWavelengthChange={setWavelength}/>
        <details className="xrd-settings">
          <summary><Settings2 size={16}/>谱图设置</summary>
          <div>
            <label className="lsv-field">排列方式<OptionSelect label="XRD 排列方式" value={stack ? "stack" : "overlay"} onChange={value => setStack(value === "stack")} options={[{ value: "overlay", label: "叠加比较" }, { value: "stack", label: "上下堆叠" }]}/></label>
            <label className="lsv-field">强度处理<OptionSelect label="XRD 强度处理" value={normalize ? "normalize" : "raw"} onChange={value => {
              const next = value === "normalize";
              setNormalize(next); setOffset(next ? "1.2" : "500");
              setYLabel(next ? "Normalized intensity / a.u." : "Intensity / a.u.");
            }} options={[{ value: "raw", label: "保留原始强度" }, { value: "normalize", label: "每条曲线按最大绝对值归一化" }]}/></label>
            {stack && <label className="lsv-field">堆叠间距<input aria-label="XRD 堆叠间距" type="number" step="any" min="0" value={offset} onChange={event => setOffset(event.target.value)}/></label>}
            <label className="lsv-field">X 轴标题<input aria-label="XRD X 轴标题" value={xLabel} onChange={event => setXLabel(event.target.value)}/></label>
            <label className="lsv-field">Y 轴标题<input aria-label="XRD Y 轴标题" value={yLabel} onChange={event => setYLabel(event.target.value)}/></label>
          </div>
        </details>
      </aside>
      <div className="lsv-results">
        {message && <div className="lsv-import-message" role="status">{message}</div>}
        <LsvPlot projectScope="xrd.plot" curves={result.curves} xLabel={xLabel} yLabel={yLabel} error={result.error} title="XRD" compactToolbar summary={<div className="studio-plot-export-group"><strong>XRD 谱图</strong><XyDataExport kind="xrd" curves={result.curves} xLabel={xLabel} yLabel={yLabel} settings={exportSettings}/><XyOriginExport kind="xrd" curves={result.curves} xLabel={xLabel} yLabel={yLabel} settings={exportSettings} plotStyle="line"/></div>} style="line" legendInside legendAbove axisControls fillCanvas continuousHover showFooter={false} referenceSticks={referenceSticks} onFilesDrop={drop} emptyText="拖入 MDI、TXT、CSV、TSV、DAT 或 XLSX 文件，或点击导入数据。"/>
      </div>
    </div>
    <XyImportDialog kind="xrd" open={open} onOpenChange={setOpen} fileRequest={fileRequest} existingCount={curves.length} onAdd={(added, note) => { setCurves(list => [...list, ...added]); setMessage(note); }}/>
  </div>;
}
