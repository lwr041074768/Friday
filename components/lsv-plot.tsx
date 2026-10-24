"use client";
import {useProjectState,useProjectEpoch} from "@/lib/project-state";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Maximize2, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { PlotCurve, PlotPoint } from "@/lib/lsv-math";
import { axisRangeAllowed, axisScale, axisTicks, axisValueAllowed, DEFAULT_TICKS, isLogAxis, isReciprocalAxis, tickLabel, transformAxisValue, untransformAxisValue, type AxisScale, type AxisTicks, type PlotTickSettings } from "@/lib/plot-ticks";
import PlotTickSettingsPanel from "./plot-tick-settings";
import PlotSettingsDialog from "./plot-settings-dialog";
import FigureExportDialog from "./figure-export-dialog";
import "./plot-axis-settings.css";
import { buildXrdHoverIndex, readXrdHover } from "@/lib/xrd-hover";
import type { TafelMaskRectangle, TafelRange } from "@/lib/tafel-analysis";
import { DEFAULT_TITLE_SETTINGS, PLOT_FONT, measureTitle, titleLayout, type PlotTitleSettings, type AxisTitleStyle } from "@/lib/plot-title";
type Bounds = { x0: number; x1: number; y0: number; y1: number };
type Hover = { point: PlotPoint; curve: PlotCurve; px: number; py: number; interpolated?: boolean; endpointIndices?: [number, number]; exactIndex?: number };
export type PlotReferenceSticks = { id: string; name: string; color: string; peaks: { x: number; intensity: number; intensityQualifier?: "<"|">"; d: number; hkl?: string }[] };
export type PlotAnnotation =
  | { id: string; kind: "text"; x: number; y: number; text: string; color?: string; border?: boolean }
  | { id: string; kind: "arrow"; x: number; y: number; x2: number; y2: number; color?: string; width?: number; head?: number }
  | { id: string; kind: "hline"; x: number; y: number; text?: string; color?: string }
  | { id: string; kind: "vline"; x: number; y: number; text?: string; color?: string };
type AnnotationMode = "text" | "arrow" | "hline" | "vline" | "peak";
type AnnotationDrag = { id: string; kind: PlotAnnotation["kind"]; startX: number; startY: number; origin: PlotAnnotation; pointerId: number };
type TitleShift = { x: number; y: number };
type TitleDrag = { axis: "x" | "y"; pointerId: number; startX: number; startY: number; base: TitleShift };
let annotationSerial = 0;
const nextAnnotationId = () => `ann-${Date.now().toString(36)}-${++annotationSerial}`;
export type PlotAnalysisTools = {
  mode: "zoom" | "mask" | "range";
  range: TafelRange | null;
  onRangeChange: (range: TafelRange) => void;
  onMaskRectangle: (rectangle: TafelMaskRectangle) => void;
  fit: { intercept: number; slope: number; xMin: number; xMax: number; color: string } | null;
};
type PlotDrag = { x0: number; y0: number; x1: number; y1: number; pointerId: number; mode: "zoom" | "mask" };
type GuideDrag = { anchor: number; pointerId: number };
function padded(values: number[], scale: AxisScale = "linear"): [number, number] {
  if (isReciprocalAxis(scale)) {
    const positive = values.filter(value => value > 0), negative = values.filter(value => value < 0);
    const side = positive.length >= negative.length ? positive : negative;
    if (!side.length) return [1, 10];
    let min = Infinity, max = -Infinity;
    for (const value of side) { min = Math.min(min, value); max = Math.max(max, value); }
    const padding = (max - min || Math.abs(max) || 1) * .06;
    return min > 0 ? [Math.max(min - padding, min * 1e-3), max + padding] : [min - padding, Math.min(max + padding, max * 1e-3)];
  }
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (!axisValueAllowed(scale, v)) continue; min = Math.min(v, min); max = Math.max(v, max); }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return isLogAxis(scale) ? [1, 10] : [0, 1];
  if (isLogAxis(scale)) { const lo = Math.log10(min), hi = Math.log10(max), padding = (hi - lo || 1) * .065; return [10 ** (lo - padding), 10 ** (hi + padding)]; }
  const padding = (max - min || Math.abs(max) || 1) * .065; return [min - padding, max + padding];
}
function fmt(value: number) { if (value === 0) return "0"; if (Math.abs(value) < .0001 || Math.abs(value) >= 1e5) return value.toExponential(2); return Number(value.toPrecision(6)).toString(); }
function displayPoints(points: (PlotPoint | null)[]) { if (points.length <= 6000) return points; const stride = Math.ceil(points.length / 1500); const result: (PlotPoint | null)[] = []; for (let offset = 0; offset < points.length; offset += stride) { const bucket = points.slice(offset, offset + stride); const valid = bucket.filter((p): p is PlotPoint => p !== null); if (valid.length !== bucket.length) { result.push(...bucket); continue; } const chosen = new Set([0, bucket.length - 1]); let min = 0, max = 0, minX = 0, maxX = 0; for (let n = 1; n < valid.length; n++) { if (valid[n].y < valid[min].y) min = n; if (valid[n].y > valid[max].y) max = n; if (valid[n].x < valid[minX].x) minX = n; if (valid[n].x > valid[maxX].x) maxX = n; } chosen.add(min); chosen.add(max); chosen.add(minX); chosen.add(maxX); [...chosen].sort((a,b) => a-b).forEach(n => result.push(bucket[n])); } return result; }
export default function LsvPlot({ projectScope, curves, xLabel, yLabel, error, title="LSV 曲线", exportName, toolbar, summary, settingsContent, leftPanel, rightPanel, analysis, compactToolbar=false, ticksInToolbar=false, tickSettingsTarget, continuousHover=false, style="line", emptyText, legendInside=false, legendAbove=false, legendRight=false, axisControls=false, equalUnits=false, squarePlot=false, fillCanvas=false, onFilesDrop, showFooter=true, notice, referenceSticks }: { projectScope?:string; curves: PlotCurve[]; xLabel: string; yLabel: string; error?: string; title?:string; exportName?:string; toolbar?:React.ReactNode; summary?:React.ReactNode; settingsContent?:React.ReactNode; leftPanel?:React.ReactNode; rightPanel?:React.ReactNode; analysis?:PlotAnalysisTools; compactToolbar?:boolean; ticksInToolbar?:boolean; tickSettingsTarget?:HTMLElement|null; continuousHover?:boolean; style?:"line"|"scatter"; emptyText?:string; legendInside?:boolean; legendAbove?:boolean; legendRight?:boolean; axisControls?:boolean; equalUnits?:boolean; squarePlot?:boolean; fillCanvas?:boolean; onFilesDrop?:(files:File[])=>void; showFooter?:boolean; notice?:string; referenceSticks?:PlotReferenceSticks[] }) {
  const projectEpoch=useProjectEpoch(),lastProjectEpoch=useRef(projectEpoch);
  const host = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const leftPanelElement = useRef<HTMLDivElement>(null);
  const rightPanelLayout = useRef<{ key: string; docked: boolean } | null>(null);
  const [leftPanelHeight, setLeftPanelHeight] = useState(0);
  const dragDepth=useRef(0),[fileOver,setFileOver]=useState(false);
  function fileDrag(event:React.DragEvent){return !!onFilesDrop&&Array.from(event.dataTransfer.types).includes("Files");}
  const [size, setSize] = useState({ width: 940, height: axisControls?940*4301/5419:560 });
  const [view, setView] = useProjectState<Bounds | null>(projectScope,'view',null), [hover, setHover] = useState<Hover | null>(null);
  const [drag, setDrag] = useState<PlotDrag | null>(null);
  const dragRef = useRef<PlotDrag | null>(null), guideDrag = useRef<GuideDrag | null>(null);
  const [manual,setManual]=useProjectState<{x?:[number,number];y?:[number,number]}>(projectScope,'manual',{});
  const [ranges,setRanges]=useProjectState(projectScope,'ranges',{x0:"",x1:"",y0:"",y1:""}),[rangeError,setRangeError]=useState("");
  const [tickSettings,setTickSettings]=useProjectState<PlotTickSettings>(projectScope,'tickSettings',DEFAULT_TICKS);
  const [axisAssignments,setAxisAssignments]=useProjectState<Record<string,"left"|"right">>(projectScope,'axisAssignments',{});
  const [y2Label,setY2Label]=useProjectState(projectScope,'y2Label',"");
  const [topLabel,setTopLabel]=useProjectState(projectScope,'topLabel',"");
  const [topMin,setTopMin]=useProjectState(projectScope,'topMin',"");
  const [topMax,setTopMax]=useProjectState(projectScope,'topMax',"");
  const [annotations,setAnnotations]=useProjectState<PlotAnnotation[]>(projectScope,'annotations',[]);
  const [annotationMode,setAnnotationMode]=useState<AnnotationMode|null>(null);
  const [contextMenu,setContextMenu]=useState<{x:number;y:number;dataX:number;dataY:number;px:number;py:number}|null>(null);
  const [selectedAnnotation,setSelectedAnnotation]=useState<string|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [settingsTab,setSettingsTab]=useState("axes");
  const [xTitleShift,setXTitleShift]=useProjectState<TitleShift>(projectScope,'xTitleShift',{x:0,y:0});
  const [yTitleShift,setYTitleShift]=useProjectState<TitleShift>(projectScope,'yTitleShift',{x:0,y:0});
  const [titleSettings,setTitleSettings]=useProjectState<PlotTitleSettings>(projectScope,'titleSettings',DEFAULT_TITLE_SETTINGS);
  const xTitleText=titleSettings.x.text??xLabel,yTitleText=titleSettings.y.text??yLabel;
  const [titleSizeDraft,setTitleSizeDraft]=useState({x:"",y:""});
  useEffect(()=>setTitleSizeDraft({x:String(titleSettings.x.size??""),y:String(titleSettings.y.size??"")}),[titleSettings.x.size,titleSettings.y.size,projectEpoch]);
  const [draftText,setDraftText]=useState<{id?:string;x:number;y:number;value:string}|null>(null);
  const [arrowDraft,setArrowDraft]=useState<{x0:number;y0:number;x1:number;y1:number}|null>(null);
  const annotationDrag=useRef<AnnotationDrag|null>(null);
  const titleDrag=useRef<TitleDrag|null>(null);
  const elementCapture=useRef<Element|null>(null);
  const clip = useId().replace(/:/g, "");
  useEffect(() => {
    const target=host.current;if(!target)return;
    const measure=()=>{
      if(target.clientWidth<=0||target.clientHeight<=0)return;
      const width=target.clientWidth,height=target.clientHeight;
      const fullscreen=document.fullscreenElement===target.parentElement;
      const viewportFit=compactToolbar&&window.matchMedia("(min-width:1101px) and (min-height:600px)").matches;
      if(axisControls&&!fillCanvas&&!viewportFit&&!fullscreen){const fitted=Math.min(width,height*5419/4301);setSize({width:fitted,height:fitted*4301/5419});}
      else setSize({width,height});
    };
    const observer=new ResizeObserver(measure);observer.observe(target);
    window.addEventListener("resize",measure);document.addEventListener("fullscreenchange",measure);
    return()=>{observer.disconnect();window.removeEventListener("resize",measure);document.removeEventListener("fullscreenchange",measure);};
  }, [axisControls,fillCanvas,compactToolbar]);
  const active = useMemo(() => curves.filter(c => c.visible && !c.error), [curves]);
  const hoverIndex = useMemo(() => continuousHover ? buildXrdHoverIndex(active) : null, [active, continuousHover]);
  const points = useMemo(() => active.flatMap(c => c.plotted.filter((p): p is PlotPoint => p !== null)), [active]);
  const leftActive = useMemo(() => active.filter(c => axisAssignments[c.id] !== "right"), [active, axisAssignments]);
  const rightActive = useMemo(() => active.filter(c => axisAssignments[c.id] === "right"), [active, axisAssignments]);
  const leftPoints = useMemo(() => leftActive.flatMap(c => c.plotted.filter((p): p is PlotPoint => p !== null)), [leftActive]);
  const rightPoints = useMemo(() => rightActive.flatMap(c => c.plotted.filter((p): p is PlotPoint => p !== null)), [rightActive]);
  const xScale = axisScale(tickSettings.x), yScale = axisScale(tickSettings.y);
  const full = useMemo(() => { const xs=points.length?points.map(p => p.x):(referenceSticks??[]).flatMap(card=>card.peaks.map(peak=>peak.x)); const [x0, x1] = padded(xs, xScale), [y0, y1] = padded(leftPoints.map(p => p.y), yScale); return { x0, x1, y0, y1 }; }, [points,leftPoints,referenceSticks,xScale,yScale]); // recompute from original data after any edit
  useEffect(() => { setHover(null); setRangeError(""); if(lastProjectEpoch.current!==projectEpoch){lastProjectEpoch.current=projectEpoch;return;} setView(null); }, [curves,projectEpoch]);
  const manualX = manual.x && axisRangeAllowed(xScale, manual.x[0], manual.x[1]) ? manual.x : undefined;
  const manualY = manual.y && axisRangeAllowed(yScale, manual.y[0], manual.y[1]) ? manual.y : undefined;
  const base={x0:manualX?.[0]??full.x0,x1:manualX?.[1]??full.x1,y0:manualY?.[0]??full.y0,y1:manualY?.[1]??full.y1};
  // A zoom saved under another axis type may fall outside the new domain; fall back to auto.
  const safeView = view && axisRangeAllowed(xScale, view.x0, view.x1) && axisRangeAllowed(yScale, view.y0, view.y1) ? view : null;
  const requestedBounds = safeView ?? base;
  // A square Nyquist plot keeps one pixel scale per ohm by extending the shorter axis.
  const equalSpan = squarePlot && equalUnits && xScale === "linear" && yScale === "linear"
    ? Math.max(requestedBounds.x1-requestedBounds.x0,requestedBounds.y1-requestedBounds.y0) : null;
  const bounds = equalSpan === null ? requestedBounds : {...requestedBounds,x1:requestedBounds.x0+equalSpan,y1:requestedBounds.y0+equalSpan};
  const rightY = useMemo(() => { const visible = rightPoints.filter(point => point.x >= bounds.x0 && point.x <= bounds.x1); const [y0, y1] = padded((visible.length ? visible : rightPoints).map(point => point.y), "linear"); return { y0, y1 }; }, [rightPoints, bounds.x0, bounds.x1]);
  // A reciprocal range that spans zero (or a log range that lost its positive side) draws linearly with a notice.
  const xRenderScale = axisRangeAllowed(xScale, bounds.x0, bounds.x1) ? xScale : "linear";
  const yRenderScale = axisRangeAllowed(yScale, bounds.y0, bounds.y1) ? yScale : "linear";
  const requestedBreak = tickSettings.y.break;
  const breakRange = requestedBreak && yRenderScale === "linear" && rightActive.length === 0 && bounds.y0 < requestedBreak.from && requestedBreak.from < requestedBreak.to && requestedBreak.to < bounds.y1 ? requestedBreak : null;
  const scaleBreaks = useMemo(() => ({
    x: isLogAxis(xScale) ? points.filter(point => !(point.x > 0)).length : isReciprocalAxis(xScale) ? points.filter(point => !(point.x !== 0) || Math.sign(point.x) !== Math.sign(bounds.x0)).length : 0,
    y: isLogAxis(yScale) ? leftPoints.filter(point => !(point.y > 0)).length : isReciprocalAxis(yScale) ? leftPoints.filter(point => !(point.y !== 0) || Math.sign(point.y) !== Math.sign(bounds.y0)).length : 0,
  }), [points, leftPoints, xScale, yScale, bounds.x0, bounds.y0]);
  const tickWarnings:string[]=[];
  if (scaleBreaks.x) tickWarnings.push(`X 轴为${isReciprocalAxis(xScale) ? "倒数" : "对数"}：${scaleBreaks.x.toLocaleString()} 个非${isReciprocalAxis(xScale) ? "同号或零" : "正"}值数据点不显示。`);
  if (scaleBreaks.y) tickWarnings.push(`Y 轴为${isReciprocalAxis(yScale) ? "倒数" : "对数"}：${scaleBreaks.y.toLocaleString()} 个非${isReciprocalAxis(yScale) ? "同号或零" : "正"}值数据点不显示。`);
  if (requestedBreak && !breakRange) tickWarnings.push("Y 轴断轴未生效：断点需在当前范围内，且不能与对数/倒数轴或双 Y 轴同时使用。");
  function ticksFor(axis:"x"|"y"):AxisTicks {
    try{return axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],tickSettings[axis]);}
    catch(error){
      tickWarnings.push(`${axis.toUpperCase()} 轴：${(error as Error).message}；当前范围暂用自动刻度。`);
      try{return axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],DEFAULT_TICKS[axis]);}catch{return {major:[],minor:[],step:1};}
    }
  }
  const xTicks=ticksFor("x");
  function ticksForRange(min:number,max:number):AxisTicks {
    try{return axisTicks(min,max,{...tickSettings.y,break:undefined});}
    catch{return {major:[],minor:[],step:1,scale:"linear"};}
  }
  const yTicks:AxisTicks = breakRange ? (()=>{ const low=ticksForRange(bounds.y0,breakRange.from),high=ticksForRange(breakRange.to,bounds.y1); return {major:[...low.major,...high.major],minor:[...low.minor,...high.minor],step:low.step||high.step,scale:"linear"}; })() : ticksFor("y");
  const y2Ticks:AxisTicks = rightActive.length ? (()=>{ try { return axisTicks(rightY.y0,rightY.y1,{anchor:0,minorCount:1}); } catch { return {major:[],minor:[],step:1}; } })() : {major:[],minor:[],step:1};
  const topMinValue=Number(topMin),topMaxValue=Number(topMax);
  const independentTop=!!topLabel.trim()&&Number.isFinite(topMinValue)&&Number.isFinite(topMaxValue)&&topMaxValue>topMinValue;
  const topTicks:AxisTicks = independentTop ? (()=>{ try { return axisTicks(topMinValue,topMaxValue,{anchor:0,minorCount:1}); } catch { return xTicks; } })() : xTicks;
  const topX=(value:number)=>independentTop?sx(bounds.x0+(value-topMinValue)/(topMaxValue-topMinValue)*(bounds.x1-bounds.x0)):sx(value);
  function applyTicks(settings:PlotTickSettings):string|undefined {
    const nextX=axisScale(settings.x),nextY=axisScale(settings.y),changedX=nextX!==xScale,changedY=nextY!==yScale;
    if(!changedX&&!changedY){
      for(const axis of ["x","y"] as const){try{axisTicks(bounds[`${axis}0`],bounds[`${axis}1`],settings[axis]);}catch(error){return `${axis.toUpperCase()} 轴：${(error as Error).message}`;}}
    }else for(const axis of ["x","y"] as const){
      const next=axis==="x"?nextX:nextY;
      if(next==="linear"||!points.length)continue;
      const values=points.map(point=>axis==="x"?point.x:point.y).filter(Number.isFinite);
      if(isLogAxis(next)&&!values.some(value=>value>0))return `${axis.toUpperCase()} 轴没有大于 0 的数据，无法改为对数轴。`;
      if(isReciprocalAxis(next)){
        const positive=values.some(value=>value>0),negative=values.some(value=>value<0);
        if(!positive&&!negative)return `${axis.toUpperCase()} 轴没有非零数据，无法改为倒数轴。`;
        if(positive&&negative)return `${axis.toUpperCase()} 轴同时包含正负值，倒数轴要求单侧数据。`;
      }
    }
    setTickSettings(settings);
    // Ranges and zoom chosen for the previous axis type no longer describe this axis.
    if(changedX||changedY){
      setView(null);setHover(null);setRangeError("");
      if(changedX){setManual(old=>{const next={...old};delete next.x;return next;});setRanges(old=>({...old,x0:"",x1:""}));}
      if(changedY){setManual(old=>{const next={...old};delete next.y;return next;});setRanges(old=>({...old,y0:"",y1:""}));}
    }
    return;
  }
  const shortCanvas=compactToolbar&&(size.height<280||(squarePlot&&size.height<400));
  const tickSize=axisControls?(shortCanvas?14:size.width<420?16:18):14;
  const tickWidth=Math.max(...yTicks.major.map(value=>tickLabel(value,yTicks).length),1)*tickSize*.6;
  const margin = axisControls?{left:Math.max(size.width<500?92:104,Math.min(154,Math.ceil(tickWidth+60))),right:36,top:shortCanvas?22:30,bottom:shortCanvas?64:88}:{ left: size.width < 500 ? 68 : 88, right: 26, top: 28, bottom: 68 };
  if(rightActive.length) margin.right=Math.max(margin.right,68);
  if(topLabel.trim()) margin.top=Math.max(margin.top,46);
  const rightLegendWidth=legendRight&&legendInside&&active.length?Math.min(200,Math.max(150,size.width*.2),Math.max(80,size.width*.35)):0;
  const rightLegendGap=rightLegendWidth?(rightActive.length?80:18):0;
  if(rightLegendWidth)margin.right+=rightLegendWidth+rightLegendGap;
  const legendLeft=margin.left,aboveColumns=size.width>=(continuousHover?560:650)?2:1;
  if(legendAbove&&!legendRight&&active.length)margin.top=Math.max(margin.top,Math.ceil(active.length/aboveColumns)*23+26);
  const titleLeft=margin.left,titleBottom=margin.bottom;
  let w = size.width - margin.left - margin.right, h = size.height - margin.top - margin.bottom;
  if(equalUnits&&!squarePlot){const scale=Math.min(w/(bounds.x1-bounds.x0),h/(bounds.y1-bounds.y0)),equalW=(bounds.x1-bounds.x0)*scale,equalH=(bounds.y1-bounds.y0)*scale;margin.left+=(w-equalW)/2;margin.top+=(h-equalH)/2;w=equalW;h=equalH;}
  else if(squarePlot){const side=Math.max(1,Math.min(w,h));margin.left+=(w-side)/2;margin.top+=(h-side)/2;w=side;h=side;}
  const visibleReferences=(referenceSticks??[]).slice(0,6);
  const referenceHeight=visibleReferences.length?Math.min(visibleReferences.length*38+12,Math.max(0,h*.42)):0;
  const xAxisBottom=margin.top+h;
  h=Math.max(1,h-referenceHeight);
  const referenceLaneHeight=visibleReferences.length?(referenceHeight-8)/visibleReferences.length:0;
  const breakGap=breakRange?18:0;
  const breakAvailable=Math.max(1,h-breakGap);
  const breakLowerSpan=breakRange?breakRange.from-bounds.y0:0;
  const breakUpperSpan=breakRange?bounds.y1-breakRange.to:0;
  let breakLowerH=breakRange?breakAvailable*breakLowerSpan/(breakLowerSpan+breakUpperSpan):h;
  let breakUpperH=breakRange?breakAvailable-breakLowerH:0;
  if(breakRange){const minimum=breakAvailable*.24;if(breakLowerH<minimum){breakLowerH=minimum;breakUpperH=breakAvailable-minimum;}else if(breakUpperH<minimum){breakUpperH=minimum;breakLowerH=breakAvailable-minimum;}}
  const xAutoSize=axisControls?Math.min(shortCanvas?18:24,Math.max(squarePlot?10:16,(squarePlot?w:size.width-margin.left+margin.right-24)/Math.max(1,xTitleText.length*.56))):16;
  const yAutoSize=axisControls?Math.min(24,Math.max(shortCanvas||squarePlot?10:16,(squarePlot?h:size.height-26)/Math.max(1,yTitleText.length*.56))):16;
  const xTitleMetrics=useMemo(()=>measureTitle(xTitleText,titleSettings.x.size??xAutoSize,titleSettings.x.bold,size.width-12),[xTitleText,titleSettings.x.size,titleSettings.x.bold,xAutoSize,size.width]);
  const yTitleMetrics=useMemo(()=>measureTitle(yTitleText,titleSettings.y.size??yAutoSize,titleSettings.y.bold,size.height-12),[yTitleText,titleSettings.y.size,titleSettings.y.bold,yAutoSize,size.height]);
  const xTitleSize=xTitleMetrics.size,yTitleSize=yTitleMetrics.size;
  const xTitleY=squarePlot?margin.top+h+titleBottom-(shortCanvas?14:22):size.height-(axisControls?22:14);
  const yTitleX=squarePlot?margin.left-titleLeft+28:axisControls?28:22;
  const yTitleY=squarePlot?margin.top+h/2:axisControls?size.height/2:margin.top+h/2;
  const xTitlePosition=titleLayout("x",{x:margin.left+w/2+xTitleShift.x*w,y:xTitleY+xTitleShift.y*h},size,xTitleMetrics);
  const yTitlePosition=titleLayout("y",{x:yTitleX+yTitleShift.x*w,y:yTitleY+yTitleShift.y*h},size,yTitleMetrics);
  // Use the square chart's existing whitespace; the panel never changes the axes.
  const leftPanelInset=16,leftPanelWidth=Math.min(340,yTitleX-yTitleSize-leftPanelInset-20);
  const leftPanelDocked=!!leftPanel&&squarePlot&&leftPanelWidth>=250&&size.height>=240;
  const rightLegendX=margin.left+w+rightLegendGap;
  const rightPanelWidth=Math.min(340,size.width-(rightLegendWidth?rightLegendX+rightLegendWidth:margin.left+w)-32);
  const panelLayoutKey=typeof window==="undefined"?"":`${window.innerWidth}:${window.innerHeight}:${!!document.fullscreenElement}:${rightLegendWidth}`;
  if(!rightPanel)rightPanelLayout.current=null;
  else if(rightPanelLayout.current?.key!==panelLayoutKey)rightPanelLayout.current={key:panelLayoutKey,docked:squarePlot&&rightPanelWidth>=260&&size.height>=240};
  // Keep this decision stable while adding a below-chart report changes the
  // host height. Reconsider on a real window/fullscreen resize, not on its own
  // layout side effect, so the report cannot alternate between right and below.
  const rightPanelDocked=!!rightPanel&&!!rightPanelLayout.current?.docked;
  useEffect(() => {
    const element=leftPanelElement.current;
    if(!rightPanel||leftPanelDocked||!element){setLeftPanelHeight(0);return;}
    const measure=()=>setLeftPanelHeight(element.getBoundingClientRect().height);
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return()=>observer.disconnect();
  },[!!rightPanel,!!leftPanel,leftPanelDocked]);
  useEffect(() => {
    if(analysis?.mode!=="range"||analysis.range||!points.length)return;
    const t0=transformAxisValue(xRenderScale,bounds.x0),t1=transformAxisValue(xRenderScale,bounds.x1);
    if(Number.isFinite(t0)&&Number.isFinite(t1)&&t1>t0)analysis.onRangeChange({min:untransformAxisValue(xRenderScale,t0+(t1-t0)*.2),max:untransformAxisValue(xRenderScale,t1-(t1-t0)*.2)});
  },[analysis?.mode,analysis?.range,analysis?.onRangeChange,bounds.x0,bounds.x1,points.length,xRenderScale]);
  useEffect(() => {
    const pointerId=dragRef.current?.pointerId??guideDrag.current?.pointerId;
    dragRef.current=null;guideDrag.current=null;setDrag(null);
    if(pointerId!==undefined&&svg.current?.hasPointerCapture(pointerId))svg.current.releasePointerCapture(pointerId);
  },[analysis?.mode]);
  const sx = useCallback((x: number) => { const t0=transformAxisValue(xRenderScale,bounds.x0),t1=transformAxisValue(xRenderScale,bounds.x1); return margin.left + (transformAxisValue(xRenderScale,x)-t0)/(t1-t0)*w; }, [margin.left, bounds.x0, bounds.x1, w, xRenderScale]);
  const sy = useCallback((y: number) => {
    if(breakRange){
      if(y<=breakRange.from)return margin.top+breakUpperH+breakGap+(breakRange.from-y)/(breakRange.from-bounds.y0)*breakLowerH;
      if(y>=breakRange.to)return margin.top+(bounds.y1-y)/(bounds.y1-breakRange.to)*breakUpperH;
      return NaN;
    }
    const t0=transformAxisValue(yRenderScale,bounds.y0),t1=transformAxisValue(yRenderScale,bounds.y1);
    return margin.top + h - (transformAxisValue(yRenderScale,y)-t0)/(t1-t0)*h;
  }, [margin.top, bounds.y0, bounds.y1, h, yRenderScale, breakRange, breakGap, breakLowerH, breakUpperH]);
  const sy2 = useCallback((y: number) => margin.top + h - (y - rightY.y0) / (rightY.y1 - rightY.y0) * h, [margin.top, h, rightY.y0, rightY.y1]);
  const curveShapes = useMemo(() => active.map(curve => {
    const plotY = axisAssignments[curve.id] === "right" ? sy2 : sy;
    const rendered = continuousHover ? curve.plotted : displayPoints(curve.plotted);
    if ((curve.style ?? style) === "scatter") return <g key={curve.id} data-curve={curve.id} data-first-x={curve.plotted.find(point => point)?.x}>{rendered.map((point, index) => { if (!point) return null; const px=sx(point.x),py=plotY(point.y); return Number.isFinite(px)&&Number.isFinite(py) ? <circle key={index} cx={px} cy={py} r="4" fill="white" stroke={curve.color} strokeWidth="1.8" data-x={point.x} data-y={point.y}/> : null; })}</g>;
    let newSegment = true;
    const commands: string[] = [];
    for (const point of rendered) {
      if (!point) { newSegment = true; continue; }
      // Non-positive values on a log axis have no pixel position and break the line like a gap.
      const px = sx(point.x), py = plotY(point.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) { newSegment = true; continue; }
      commands.push(`${newSegment ? "M" : "L"}${px.toFixed(3)},${py.toFixed(3)}`);
      newSegment = false;
    }
    return <path key={curve.id} data-curve={curve.id} data-first-x={curve.plotted.find(point => point)?.x} data-first-y={curve.plotted.find(point => point)?.y} data-point-count={curve.plotted.filter(Boolean).length} d={commands.join(" ")} fill="none" stroke={curve.color} strokeWidth="2.3" strokeLinejoin="round"/>;
  }), [active, axisAssignments, continuousHover, style, sx, sy, sy2]);
  const ix = (px: number) => { const t0=transformAxisValue(xRenderScale,bounds.x0),t1=transformAxisValue(xRenderScale,bounds.x1); return untransformAxisValue(xRenderScale, t0 + (px - margin.left) / w * (t1 - t0)); };
  const iy = (py: number) => {
    if(breakRange){
      const gapTop=margin.top+breakUpperH;
      if(py<=gapTop)return bounds.y1-(py-margin.top)/breakUpperH*(bounds.y1-breakRange.to);
      if(py>=gapTop+breakGap)return breakRange.from-(py-gapTop-breakGap)/breakLowerH*(breakRange.from-bounds.y0);
      return NaN;
    }
    const t0=transformAxisValue(yRenderScale,bounds.y0),t1=transformAxisValue(yRenderScale,bounds.y1);
    return untransformAxisValue(yRenderScale, t1 - (py - margin.top) / h * (t1 - t0));
  };
  const clamp = (x: number, y: number) => ({ x: Math.min(margin.left+w, Math.max(margin.left, x)), y: Math.min(margin.top+h, Math.max(margin.top, y)) });
  function reset(){setView(null);setManual({});setRanges({x0:"",x1:"",y0:"",y1:""});setHover(null);setRangeError("");}
  function applyRanges(){
    const next:{x?:[number,number];y?:[number,number]}={};
    for(const axis of ["x","y"] as const){const lower=ranges[`${axis}0`].trim(),upper=ranges[`${axis}1`].trim();if(!lower&&!upper)continue;const min=lower?Number(lower):NaN,max=upper?Number(upper):NaN;const scale=axis==="x"?xScale:yScale;if(!axisRangeAllowed(scale,min,max)){setRangeError(`${axis.toUpperCase()} 轴需填写有效的最小值和最大值；${isReciprocalAxis(scale)?"倒数轴范围必须同号且不能包含 0":isLogAxis(scale)?"对数轴，范围必须大于 0":"最小值需小于最大值"}。`);return;}next[axis]=[min,max];}
    setManual(next);setView(null);setHover(null);setRangeError("");
  }
  const legendColumns=legendRight?1:legendAbove?aboveColumns:w>430||active.length*23+14>h-20?2:1,legendColumnWidth=legendRight?rightLegendWidth:legendAbove?Math.min(420,(size.width-legendLeft-36)/legendColumns):Math.min(250,(w-28)/legendColumns);
  const legendRows=Math.ceil(active.length/legendColumns),legendRowHeight=legendAbove?23:Math.min(23,Math.max(14,(h-24)/Math.max(1,legendRows))),legendHeight=legendRows*legendRowHeight+14;
  function legendName(name:string){let text="",length=0;for(const char of name){length+=char.charCodeAt(0)>255?14:7;if(length>legendColumnWidth-52)return text+"…";text+=char;}return text;}
  function wrapLegendName(name:string,fontSize:number){
    const lines:string[]=[];let line="",width=0;
    for(const char of name){const nextWidth=char.charCodeAt(0)>255?fontSize:fontSize*.52;if(line&&width+nextWidth>Math.max(20,legendColumnWidth-52)){lines.push(line);line="";width=0;}line+=char;width+=nextWidth;}
    lines.push(line);return lines;
  }
  const rightLegendAvailable=Math.max(1,size.height-24);
  const rightLegendBaseLines=legendRight?active.reduce((sum,curve)=>sum+wrapLegendName(curve.name,14).length,0):0;
  const rightLegendFont=legendRight?Math.min(14,Math.max(7,(rightLegendAvailable-14-active.length*6)/Math.max(1,rightLegendBaseLines)-3)):14;
  const rightLegendItems=legendRight?active.map(curve=>({curve,lines:wrapLegendName(curve.name,rightLegendFont)})):[];
  let rightLegendHeight=14;
  const rightLegendRows=rightLegendItems.map(item=>{const y=rightLegendHeight-7;rightLegendHeight+=item.lines.length*(rightLegendFont+3)+6;return {...item,y};});
  const rightLegendY=Math.max(12,Math.min(margin.top,size.height-rightLegendHeight-12));
  function coordinates(event: React.PointerEvent | React.WheelEvent) { const rect = svg.current!.getBoundingClientRect(); return { x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height }; }
  function zoom(factor: number, cx = untransformAxisValue(xRenderScale,(transformAxisValue(xRenderScale,bounds.x0)+transformAxisValue(xRenderScale,bounds.x1))/2), cy = untransformAxisValue(yRenderScale,(transformAxisValue(yRenderScale,bounds.y0)+transformAxisValue(yRenderScale,bounds.y1))/2)) { const tx0=transformAxisValue(xRenderScale,bounds.x0),tx1=transformAxisValue(xRenderScale,bounds.x1),ty0=transformAxisValue(yRenderScale,bounds.y0),ty1=transformAxisValue(yRenderScale,bounds.y1),ncx=transformAxisValue(xRenderScale,cx),ncy=transformAxisValue(yRenderScale,cy); const candidate = { x0: untransformAxisValue(xRenderScale,ncx+(tx0-ncx)*factor), x1: untransformAxisValue(xRenderScale,ncx+(tx1-ncx)*factor), y0: untransformAxisValue(yRenderScale,ncy+(ty0-ncy)*factor), y1: untransformAxisValue(yRenderScale,ncy+(ty1-ncy)*factor) }; if (axisRangeAllowed(xScale,candidate.x0,candidate.x1) && axisRangeAllowed(yScale,candidate.y0,candidate.y1)) { setView(candidate); setHover(null); } }
  function updateGuide(value:number,anchor:number){
    if(!analysis)return;
    const next=Math.max(bounds.x0,Math.min(bounds.x1,value));
    if(next===anchor)return;
    analysis.onRangeChange({min:Math.min(next,anchor),max:Math.max(next,anchor)});
  }
  function startGuide(event:React.PointerEvent,edge:"min"|"max"){
    if(event.button!==0||analysis?.mode!=="range"||!analysis.range)return;
    event.preventDefault();event.stopPropagation();
    guideDrag.current={anchor:analysis.range[edge==="min"?"max":"min"],pointerId:event.pointerId};
    svg.current?.setPointerCapture(event.pointerId);setHover(null);
  }
  function guideKey(event:React.KeyboardEvent,edge:"min"|"max"){
    if(!analysis?.range)return;
    const step=(bounds.x1-bounds.x0)*(event.shiftKey ? .001 : .01);
    const value=analysis.range[edge];
    const next=event.key==="ArrowLeft"?value-step:event.key==="ArrowRight"?value+step:event.key==="Home"?bounds.x0:event.key==="End"?bounds.x1:null;
    if(next===null)return;
    event.preventDefault();event.stopPropagation();updateGuide(next,analysis.range[edge==="min"?"max":"min"]);
  }
  function cancelPointer(){
    const pointerId=dragRef.current?.pointerId??guideDrag.current?.pointerId??annotationDrag.current?.pointerId??titleDrag.current?.pointerId;
    const owner=elementCapture.current??svg.current;elementCapture.current=null;
    dragRef.current=null;guideDrag.current=null;annotationDrag.current=null;titleDrag.current=null;setDrag(null);setArrowDraft(null);
    if(pointerId!==undefined&&owner?.hasPointerCapture(pointerId))owner.releasePointerCapture(pointerId);
  }
  function openSettings(tab:string){setSettingsTab(tab);setSettingsOpen(true);}
  function patchAnnotation(id:string,patch:Record<string,unknown>){setAnnotations(old=>old.map(item=>item.id===id?({...item,...patch} as PlotAnnotation):item));}
  function commitText(){
    if(!draftText)return;
    const value=draftText.value.trim();
    if(value){
      if(draftText.id)patchAnnotation(draftText.id,{text:value});
      else{const id=nextAnnotationId();setAnnotations(old=>[...old,{id,kind:"text",x:draftText.x,y:draftText.y,text:value,color:"#1d4e79"}]);setSelectedAnnotation(id);}
    }
    setDraftText(null);setAnnotationMode(null);
  }
  function nearestPeak(p:{x:number;y:number}){
    let best:{point:PlotPoint;px:number;py:number}|null=null,distance=18**2;
    for(const curve of active){const plotY=axisAssignments[curve.id]==="right"?sy2:sy;for(const point of curve.plotted){if(!point)continue;const px=sx(point.x),py=plotY(point.y);if(!Number.isFinite(px)||!Number.isFinite(py))continue;const d=(p.x-px)**2+(p.y-py)**2;if(d<distance){distance=d;best={point,px,py};}}}
    return best;
  }
  function beginAnnotationDrag(event:React.PointerEvent,annotation:PlotAnnotation){
    event.stopPropagation();
    if(event.button!==0||annotationMode)return;
    const p=coordinates(event),x=ix(p.x),y=iy(p.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    annotationDrag.current={id:annotation.id,kind:annotation.kind,startX:x,startY:y,origin:annotation,pointerId:event.pointerId};
    setSelectedAnnotation(annotation.id);svg.current?.focus({preventScroll:true});elementCapture.current=event.currentTarget;event.currentTarget.setPointerCapture(event.pointerId);
  }
  function beginTitleDrag(event:React.PointerEvent,axis:"x"|"y"){
    event.stopPropagation();
    if(event.button!==0)return;
    const position=axis==="x"?xTitlePosition:yTitlePosition;
    const base=axis==="x"?{x:(position.x-margin.left-w/2)/w,y:(position.y-xTitleY)/h}:{x:(position.x-yTitleX)/w,y:(position.y-yTitleY)/h};
    titleDrag.current={axis,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,base};
    elementCapture.current=event.currentTarget;event.currentTarget.setPointerCapture(event.pointerId);setHover(null);
  }
  function canvasKey(event:React.KeyboardEvent<SVGSVGElement>){
      const target=event.target as Element,canvas=event.currentTarget;
      // This listener belongs to the focused canvas, never to document. Portals
      // (including BOOKs and modal fields) cannot act on a graph behind them.
      if(event.defaultPrevented||event.nativeEvent.isComposing||!canvas.contains(target)||!canvas.contains(document.activeElement)||!canvas.getClientRects().length||canvas.closest('[hidden],[inert]')||target.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"],[role="slider"]')||document.querySelector('[role="dialog"][data-state="open"]'))return;
      if(event.key==="Escape"){cancelPointer();setHover(null);setAnnotationMode(null);setContextMenu(null);setDraftText(null);setSelectedAnnotation(null);event.stopPropagation();return;}
      if((event.key==="Delete"||event.key==="Backspace")&&selectedAnnotation){
        event.preventDefault();setAnnotations(old=>old.filter(item=>item.id!==selectedAnnotation));setSelectedAnnotation(null);return;
      }
      if(selectedAnnotation&&!settingsOpen&&["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)){
        const item=annotations.find(annotation=>annotation.id===selectedAnnotation);
        if(!item)return;
        event.preventDefault();
        const step=event.ctrlKey?.01:event.shiftKey?.1:event.altKey?10:1;
        const dx=event.key==="ArrowRight"?step:event.key==="ArrowLeft"?-step:0;
        const dy=event.key==="ArrowDown"?step:event.key==="ArrowUp"?-step:0;
        if(item.kind==="hline"){
          if(dy){const next=iy(sy(item.y)+dy);if(Number.isFinite(next))patchAnnotation(item.id,{y:next});}
        }else if(item.kind==="vline"){
          if(dx){const next=ix(sx(item.x)+dx);if(Number.isFinite(next))patchAnnotation(item.id,{x:next});}
        }else{
          const x=ix(sx(item.x)+dx),y=iy(sy(item.y)+dy);
          if(!Number.isFinite(x)||!Number.isFinite(y))return;
          if(item.kind==="text")patchAnnotation(item.id,{x,y});
          else if(item.kind==="arrow"){
            const x2=ix(sx(item.x2)+dx),y2=iy(sy(item.y2)+dy);
            if(Number.isFinite(x2)&&Number.isFinite(y2))patchAnnotation(item.id,{x,y,x2,y2});
          }
        }
      }
  }
  function openContextMenu(event:React.MouseEvent){
    event.preventDefault();event.stopPropagation();
    if(!svg.current)return;
    const rect=svg.current.getBoundingClientRect();
    const px=(event.clientX-rect.left)*size.width/rect.width,py=(event.clientY-rect.top)*size.height/rect.height;
    if(px<margin.left||px>margin.left+w||py<margin.top||py>margin.top+h)return;
    const x=ix(px),y=iy(py);
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const target=event.target as Element,annotationId=target.closest("[data-annotation-id]")?.getAttribute("data-annotation-id")??null;
    setContextMenu({x:Math.min(event.clientX,window.innerWidth-210),y:Math.min(event.clientY,window.innerHeight-310),dataX:x,dataY:y,px,py});
    setSelectedAnnotation(annotationId);
  }
  useEffect(()=>{
    if(!contextMenu)return;
    const close=(event:PointerEvent)=>{const target=event.target as Element;if(!target.closest(".lsv-context-menu"))setContextMenu(null);};
    document.addEventListener("pointerdown",close);
    return()=>document.removeEventListener("pointerdown",close);
  },[contextMenu]);
  function startPointer(event:React.PointerEvent){
    if(event.button!==0||!points.length||analysis?.mode==="range")return;
    const p=coordinates(event);
    if(p.x<margin.left||p.x>margin.left+w||p.y<margin.top||p.y>margin.top+h)return;
    if(annotationMode){
      const x=ix(p.x),y=iy(p.y);
      if(!Number.isFinite(x)||!Number.isFinite(y))return;
      event.preventDefault();
      if(annotationMode==="text"){setDraftText({x,y,value:""});return;}
      if(annotationMode==="peak"){const peak=nearestPeak(p);if(peak){const offset=(bounds.y1-bounds.y0)*.03;setDraftText({x:peak.point.x,y:peak.point.y+offset,value:`x = ${fmt(peak.point.x)}, y = ${fmt(peak.point.y)}`});}return;}
      if(annotationMode==="hline"){const id=nextAnnotationId();setAnnotations(old=>[...old,{id,kind:"hline",x:bounds.x0,y,text:"",color:"#6b8094"}]);setSelectedAnnotation(id);setAnnotationMode(null);return;}
      if(annotationMode==="vline"){const id=nextAnnotationId();setAnnotations(old=>[...old,{id,kind:"vline",x,y:bounds.y0,text:"",color:"#6b8094"}]);setSelectedAnnotation(id);setAnnotationMode(null);return;}
      if(annotationMode==="arrow"){svg.current?.setPointerCapture(event.pointerId);setArrowDraft({x0:x,y0:y,x1:x,y1:y});return;}
    }
    event.preventDefault();svg.current?.setPointerCapture(event.pointerId);
    const selection:PlotDrag={x0:p.x,y0:p.y,x1:p.x,y1:p.y,pointerId:event.pointerId,mode:analysis?.mode==="mask"?"mask":"zoom"};
    dragRef.current=selection;setDrag(selection);setHover(null);
  }
  function move(event: React.PointerEvent) {
    const p = coordinates(event);
    const title=titleDrag.current;
    if(title){
      if(event.pointerId!==title.pointerId)return;
      const rect=svg.current!.getBoundingClientRect();
      const dx=(event.clientX-title.startX)*size.width/rect.width,dy=(event.clientY-title.startY)*size.height/rect.height;
      const next={x:Math.min(.45,Math.max(-.45,title.base.x+dx/w)),y:Math.min(.45,Math.max(-.45,title.base.y+dy/h))};
      if(title.axis==="x")setXTitleShift(next);else setYTitleShift(next);
      return;
    }
    const annotation=annotationDrag.current;
    if(annotation){
      if(event.pointerId!==annotation.pointerId)return;
      const x=ix(p.x),y=iy(p.y);
      if(!Number.isFinite(x)||!Number.isFinite(y))return;
      const dx=x-annotation.startX,dy=y-annotation.startY,origin=annotation.origin;
      if(origin.kind==="text")patchAnnotation(origin.id,{x:origin.x+dx,y:origin.y+dy});
      else if(origin.kind==="arrow")patchAnnotation(origin.id,{x:origin.x+dx,y:origin.y+dy,x2:origin.x2+dx,y2:origin.y2+dy});
      else if(origin.kind==="hline")patchAnnotation(origin.id,{y:origin.y+dy});
      else patchAnnotation(origin.id,{x:origin.x+dx});
      return;
    }
    if(arrowDraft){if(event.pointerId!==undefined){const x=ix(p.x),y=iy(p.y);if(Number.isFinite(x)&&Number.isFinite(y))setArrowDraft(old=>old?{...old,x1:x,y1:y}:old);}return;}
    if(guideDrag.current){if(event.pointerId===guideDrag.current.pointerId)updateGuide(ix(clamp(p.x,p.y).x),guideDrag.current.anchor);return;}
    if (dragRef.current) { if(event.pointerId!==dragRef.current.pointerId)return;const end = clamp(p.x,p.y);const next={...dragRef.current,x1:end.x,y1:end.y};dragRef.current=next;setDrag(next);return; }
    if (p.x < margin.left || p.x > margin.left+w || p.y < margin.top || p.y > margin.top+h) { setHover(null); return; }
    if (continuousHover && hoverIndex) {
      const rect = svg.current!.getBoundingClientRect();
      const queryX = ix(p.x), queryY = iy(p.y);
      // Hit distance is measured in CSS pixels; on a log axis the pixel density changes with the value.
      const perX = Math.abs(w / (transformAxisValue(xRenderScale,bounds.x1) - transformAxisValue(xRenderScale,bounds.x0)) * (isLogAxis(xRenderScale) ? 1 / (queryX * Math.LN10) : isReciprocalAxis(xRenderScale) ? -1 / (queryX * queryX) : 1));
      const perY = Math.abs(h / (transformAxisValue(yRenderScale,bounds.y1) - transformAxisValue(yRenderScale,bounds.y0)) * (isLogAxis(yRenderScale) ? 1 / (queryY * Math.LN10) : isReciprocalAxis(yRenderScale) ? -1 / (queryY * queryY) : 1));
      if (!Number.isFinite(perX) || !Number.isFinite(perY) || perX <= 0 || perY <= 0) { setHover(null); return; }
      const hit = readXrdHover(hoverIndex, { x: queryX, y: queryY, scaleX: perX * rect.width / size.width, scaleY: perY * rect.height / size.height, hitRadius: 12, bounds });
      setHover(hit ? { ...hit, px: sx(hit.point.x), py: (axisAssignments[hit.curve.id] === "right" ? sy2 : sy)(hit.point.y) } : null);
      return;
    }
    let nearest: Hover | null = null, distance = 24 ** 2;
    for (const curve of active) {
      const plotY = axisAssignments[curve.id] === "right" ? sy2 : sy;
      for (const point of curve.plotted) {
        if (!point || point.x < bounds.x0 || point.x > bounds.x1) continue;
        const px = sx(point.x), py = plotY(point.y), d = (p.x-px)**2+(p.y-py)**2;
        if (d < distance) { distance = d; nearest = { point, curve, px, py }; }
      }
    }
    setHover(nearest);
  }
  function finish(event: React.PointerEvent) {
    if(titleDrag.current){
      if(event.pointerId!==titleDrag.current.pointerId)return;
      titleDrag.current=null;
      const owner=elementCapture.current;elementCapture.current=null;
      if(owner?.hasPointerCapture(event.pointerId))owner.releasePointerCapture(event.pointerId);
      return;
    }
    if(annotationDrag.current){
      if(event.pointerId!==annotationDrag.current.pointerId)return;
      annotationDrag.current=null;
      const owner=elementCapture.current;elementCapture.current=null;
      if(owner?.hasPointerCapture(event.pointerId))owner.releasePointerCapture(event.pointerId);
      return;
    }
    if(arrowDraft){
      if(Math.hypot(sx(arrowDraft.x1)-sx(arrowDraft.x0),sy(arrowDraft.y1)-sy(arrowDraft.y0))>12){
        const id=nextAnnotationId();setAnnotations(old=>[...old,{id,kind:"arrow",x:arrowDraft.x0,y:arrowDraft.y0,x2:arrowDraft.x1,y2:arrowDraft.y1,color:"#b23b3b"}]);setSelectedAnnotation(id);
      }
      setArrowDraft(null);setAnnotationMode(null);
      if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId);
      return;
    }
    if(guideDrag.current){if(event.pointerId!==guideDrag.current.pointerId)return;const p=coordinates(event);updateGuide(ix(clamp(p.x,p.y).x),guideDrag.current.anchor);cancelPointer();return;}
    const selection=dragRef.current;
    if(!selection||event.pointerId!==selection.pointerId)return;
    const p=coordinates(event),end=clamp(p.x,p.y),threshold=selection.mode==="mask"?3:12;
    if(Math.abs(end.x-selection.x0)>threshold&&Math.abs(end.y-selection.y0)>threshold){
      const rectangle={x0:ix(Math.min(selection.x0,end.x)),x1:ix(Math.max(selection.x0,end.x)),y0:iy(Math.max(selection.y0,end.y)),y1:iy(Math.min(selection.y0,end.y))};
      if(selection.mode==="mask")analysis?.onMaskRectangle(rectangle);
      else if(Object.values(rectangle).every(Number.isFinite))setView(rectangle);
    }
    cancelPointer();
  }
  const fit=analysis?.fit&&[analysis.fit.intercept,analysis.fit.slope,analysis.fit.xMin,analysis.fit.xMax].every(Number.isFinite)?analysis.fit:null;
  const fitLine=fit?(()=>{const x1=sx(fit.xMin),x2=sx(fit.xMax),y1=sy(fit.intercept+fit.slope*fit.xMin),y2=sy(fit.intercept+fit.slope*fit.xMax);return [x1,x2,y1,y2].every(Number.isFinite)?{x1,x2,y1,y2}:null;})():null;
  const rangeControls=<div className="lsv-axis-controls"><div className="lsv-axis-range" role="group" aria-label="X 轴范围"><strong>X 轴范围</strong><input type="number" step="any" aria-label="X 轴最小值" placeholder={`最小 ${fmt(full.x0)}`} value={ranges.x0} onChange={e=>setRanges(r=>({...r,x0:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/><span>至</span><input type="number" step="any" aria-label="X 轴最大值" placeholder={`最大 ${fmt(full.x1)}`} value={ranges.x1} onChange={e=>setRanges(r=>({...r,x1:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/></div><div className="lsv-axis-range" role="group" aria-label="Y 轴范围"><strong>Y 轴范围</strong><input type="number" step="any" aria-label="Y 轴最小值" placeholder={`最小 ${fmt(full.y0)}`} value={ranges.y0} onChange={e=>setRanges(r=>({...r,y0:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/><span>至</span><input type="number" step="any" aria-label="Y 轴最大值" placeholder={`最大 ${fmt(full.y1)}`} value={ranges.y1} onChange={e=>setRanges(r=>({...r,y1:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")applyRanges();}}/></div><button className="lsv-button secondary" onClick={applyRanges}>应用范围</button><button className="lsv-button secondary" onClick={reset}>恢复自动范围</button>{rangeError&&<div role="alert" className="lsv-error">{rangeError}</div>}</div>;
  const multiAxisControls=<div className="lsv-axis-assign"><p>把曲线勾到右轴即可组成双 Y 图；右轴按当前 X 视窗自动缩放。上轴可填独立范围；留空则镜像 X 刻度。</p><div className="lsv-axis-assign-list">{active.map(curve=><label key={curve.id}><i style={{background:curve.color}}/><input type="checkbox" checked={axisAssignments[curve.id]==="right"} onChange={event=>setAxisAssignments(old=>({...old,[curve.id]:event.target.checked?"right":"left"}))}/><span>{curve.name}</span><em>{axisAssignments[curve.id]==="right"?"右轴":"左轴"}</em></label>)}{!active.length&&<small>当前没有可见曲线。</small>}</div><label className="lsv-axis-field">右轴标题<input value={y2Label} onChange={event=>setY2Label(event.target.value)} placeholder="留空显示“右轴”"/></label><label className="lsv-axis-field">上轴标题<input value={topLabel} onChange={event=>setTopLabel(event.target.value)} placeholder="留空隐藏上轴"/></label><div className="lsv-axis-field"><span>上轴范围（留空镜像 X）</span><div className="lsv-axis-pair"><input aria-label="上轴最小值" type="number" step="any" value={topMin} onChange={event=>setTopMin(event.target.value)} placeholder="最小"/><input aria-label="上轴最大值" type="number" step="any" value={topMax} onChange={event=>setTopMax(event.target.value)} placeholder="最大"/></div></div></div>;
  const selectedAnnotationItem=annotations.find(item=>item.id===selectedAnnotation);
  function patchTitle(axis:"x"|"y",patch:Partial<AxisTitleStyle>){setTitleSettings(old=>({...old,[axis]:{...old[axis],...patch}}));}
  const titleControls=<div className="lsv-title-controls"><p>修改仅影响图形显示，不改变数据、单位或计算。直接拖动轴标题可调整位置，文字、样式和位置随 .fri 保存。</p>
    <div className="lsv-title-fields">{(["x","y"] as const).map(axis=><fieldset key={axis}><legend>{axis.toUpperCase()} 轴标题</legend>
      <label>显示文字<input aria-label={`${axis.toUpperCase()} 轴标题文字`} maxLength={200} value={titleSettings[axis].text??(axis==="x"?xLabel:yLabel)} onChange={event=>patchTitle(axis,{text:event.target.value})}/></label>
      <label>字号（px）<input aria-label={`${axis.toUpperCase()} 轴标题字号`} type="number" min="8" max="48" step="1" placeholder="自动" value={titleSizeDraft[axis]} onBlur={()=>setTitleSizeDraft(old=>({...old,[axis]:String(titleSettings[axis].size??"")}))} onChange={event=>{const raw=event.target.value,value=Number(raw);setTitleSizeDraft(old=>({...old,[axis]:raw}));if(!raw)patchTitle(axis,{size:null});else if(Number.isFinite(value)&&value>=8&&value<=48)patchTitle(axis,{size:value});}}/></label>
      <label className="lsv-title-bold"><input aria-label={`${axis.toUpperCase()} 轴标题加粗`} type="checkbox" checked={titleSettings[axis].bold} onChange={event=>patchTitle(axis,{bold:event.target.checked})}/>加粗</label>
      <button type="button" className="lsv-button secondary" onClick={()=>patchTitle(axis,DEFAULT_TITLE_SETTINGS[axis])}>恢复 {axis.toUpperCase()} 默认标题</button>
    </fieldset>)}</div><small>字号为 8～48 px，留空为自动；标题过长时随画布缩小，避免导出时被裁切。</small>
    <div className="lsv-title-actions"><button type="button" className="lsv-button secondary" onClick={()=>setXTitleShift({x:0,y:0})}>X 标题复位</button><button type="button" className="lsv-button secondary" onClick={()=>setYTitleShift({x:0,y:0})}>Y 标题复位</button><button type="button" className="lsv-button secondary" onClick={()=>{setXTitleShift({x:0,y:0});setYTitleShift({x:0,y:0});}}>全部位置复位</button></div></div>;
  const annotationControls=selectedAnnotationItem?<div className="lsv-annotation-props"><p>已选：<b>{{text:"文字",arrow:"箭头",hline:"水平参考线",vline:"垂直参考线"}[selectedAnnotationItem.kind]}</b></p>{selectedAnnotationItem.kind==="text"&&<><label className="lsv-axis-field">文字<input aria-label="注释文字内容" value={selectedAnnotationItem.text} onChange={event=>patchAnnotation(selectedAnnotationItem.id,{text:event.target.value.slice(0,500)})}/></label><label className="lsv-annotation-check"><input type="checkbox" aria-label="显示文字边框" checked={selectedAnnotationItem.border!==false} onChange={event=>patchAnnotation(selectedAnnotationItem.id,{border:event.target.checked})}/>显示文字边框</label></>}{selectedAnnotationItem.kind==="arrow"&&<div className="lsv-axis-pair"><label className="lsv-axis-field">线宽<input aria-label="箭头线宽" type="number" min=".5" max="20" step=".5" value={selectedAnnotationItem.width??1.8} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))patchAnnotation(selectedAnnotationItem.id,{width:Math.min(20,Math.max(.5,value))});}}/></label><label className="lsv-axis-field">箭头大小<input aria-label="箭头大小" type="number" min="2" max="60" step="1" value={selectedAnnotationItem.head??10} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))patchAnnotation(selectedAnnotationItem.id,{head:Math.min(60,Math.max(2,value))});}}/></label></div>}{selectedAnnotationItem.kind==="hline"&&<label className="lsv-axis-field">精确 Y 值<input aria-label="水平线位置" type="number" step="any" value={selectedAnnotationItem.y} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))patchAnnotation(selectedAnnotationItem.id,{y:value});}}/></label>}{selectedAnnotationItem.kind==="vline"&&<label className="lsv-axis-field">精确 X 值<input aria-label="垂直线位置" type="number" step="any" value={selectedAnnotationItem.x} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))patchAnnotation(selectedAnnotationItem.id,{x:value});}}/></label>}<p className="lsv-annotation-hint-line">选中后可用方向键微调：1 px；Shift 0.1 px；Ctrl 0.01 px；Alt 10 px。</p><button type="button" className="lsv-button secondary" onClick={()=>{setAnnotations(old=>old.filter(item=>item.id!==selectedAnnotationItem.id));setSelectedAnnotation(null);}}>删除这条注释</button></div>:<div className="lsv-annotation-props"><p>在画布中单击一条注释，或右键选择“注释属性…”，在这里精调。</p><p className="lsv-annotation-hint-line">选中后可用方向键微调：1 px；Shift 0.1 px；Ctrl 0.01 px；Alt 10 px。</p></div>;
  const tickControlsNode=<PlotTickSettingsPanel onApply={applyTicks} settings={tickSettings} embedded/>;
  const settingsTabs=[
    {id:"axes",label:"坐标轴",content:<>{rangeControls&&<section className="plot-settings-section"><h3>坐标范围</h3>{rangeControls}</section>}<section className="plot-settings-section"><h3>双 Y 轴 / 上轴</h3>{multiAxisControls}</section><section className="plot-settings-section"><h3>主刻度 / 次刻度</h3>{tickControlsNode}</section></>},
    {id:"titles",label:"标题",content:titleControls},
    {id:"annotations",label:"注释",content:annotationControls},
    ...(settingsContent?[{id:"page",label:"本页",content:settingsContent}]:[]),
  ];
  return <div className={`lsv-plot-panel ${axisControls?"lsv-custom-plot":""} ${compactToolbar?"lsv-compact-toolbar":""} ${ticksInToolbar?"lsv-toolbar-ticks":""} ${leftPanel?leftPanelDocked?"lsv-left-panel-docked":"lsv-left-panel-below":""} ${rightPanel?rightPanelDocked?"lsv-right-panel-docked":"lsv-right-panel-below":""}`}>
    <div className="lsv-plot-toolbar">{!compactToolbar&&<div className="lsv-chart-heading"><span className="lsv-small-label">交互画布</span><strong>{title}</strong></div>}{summary}{toolbar}<FigureExportDialog getSvg={()=>svg.current} defaultName={exportName ?? title} disabled={!active.length} compact={compactToolbar}/><PlotSettingsDialog tabs={settingsTabs} open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab}/><div className="lsv-plot-actions"><button title="缩小" aria-label="缩小图形" onClick={() => zoom(1.4)}><Minus size={17}/></button><button title="放大" aria-label="放大图形" onClick={() => zoom(1/1.4)}><Plus size={17}/></button><span/><button onClick={reset} title="恢复完整范围"><RotateCcw size={16}/><span>复位</span></button><button title="全屏显示图形" aria-label="全屏显示图形" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void host.current?.parentElement?.requestFullscreen(); }}><Maximize2 size={17}/></button></div></div>
    {draftText&&<div className="lsv-annotation-editor" data-testid="annotation-editor"><span>{draftText.id?"编辑注释":"放置注释"}</span><input autoFocus aria-label="注释文字" placeholder="输入注释文字，回车放置；支持换行" value={draftText.value} onChange={event=>setDraftText(old=>old?{...old,value:event.target.value}:old)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();commitText();}if(event.key==="Escape"){event.preventDefault();setDraftText(null);setAnnotationMode(null);}}}/><button type="button" className="lsv-button primary" onClick={commitText}>放置</button><button type="button" className="lsv-button secondary" onClick={()=>{setDraftText(null);setAnnotationMode(null);}}>取消</button></div>}
    {annotationMode==="arrow"&&!draftText&&<div className="lsv-annotation-hint" role="status">箭头：在图中从起点拖到终点；Esc 取消。</div>}
    {contextMenu&&<div className="lsv-annotate-menu lsv-context-menu" role="menu" aria-label="添加标注" style={{position:"fixed",left:contextMenu.x,top:contextMenu.y,right:"auto",zIndex:1000}} onPointerDown={event=>event.stopPropagation()} onClick={()=>svg.current?.focus({preventScroll:true})} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();setContextMenu(null);svg.current?.focus({preventScroll:true});}}}>
      <button type="button" role="menuitem" onClick={()=>{setDraftText({x:contextMenu.dataX,y:contextMenu.dataY,value:""});setContextMenu(null);}}>文字</button>
      <button type="button" role="menuitem" onClick={()=>{setAnnotationMode("arrow");setContextMenu(null);}}>箭头</button>
      <button type="button" role="menuitem" onClick={()=>{const id=nextAnnotationId();setAnnotations(old=>[...old,{id,kind:"hline",x:bounds.x0,y:contextMenu.dataY,text:"",color:"#6b8094"}]);setSelectedAnnotation(id);setContextMenu(null);}}>水平参考线</button>
      <button type="button" role="menuitem" onClick={()=>{const id=nextAnnotationId();setAnnotations(old=>[...old,{id,kind:"vline",x:contextMenu.dataX,y:bounds.y0,text:"",color:"#6b8094"}]);setSelectedAnnotation(id);setContextMenu(null);}}>垂直参考线</button>
      <button type="button" role="menuitem" onClick={()=>{const peak=nearestPeak({x:contextMenu.px,y:contextMenu.py});if(peak){const offset=(bounds.y1-bounds.y0)*.03;setDraftText({x:peak.point.x,y:peak.point.y+offset,value:`x = ${fmt(peak.point.x)}, y = ${fmt(peak.point.y)}`});}setContextMenu(null);}}>峰值标注</button>
      {selectedAnnotationItem?.kind==="text"&&<button type="button" role="menuitem" onClick={()=>{patchAnnotation(selectedAnnotationItem.id,{border:selectedAnnotationItem.border===false});setContextMenu(null);}}>{selectedAnnotationItem.border===false?"显示文字边框":"隐藏文字边框"}</button>}
      {selectedAnnotationItem&&<button type="button" role="menuitem" onClick={()=>{setContextMenu(null);openSettings("annotations");}}>注释属性…</button>}
      <button type="button" role="menuitem" disabled={!selectedAnnotation} onClick={()=>{if(selectedAnnotation)setAnnotations(old=>old.filter(item=>item.id!==selectedAnnotation));setSelectedAnnotation(null);setContextMenu(null);}}>删除所选</button>
      <button type="button" role="menuitem" className="danger" disabled={!annotations.length} onClick={()=>{setAnnotations([]);setSelectedAnnotation(null);setContextMenu(null);}}><Trash2 size={13}/>清除全部</button>
    </div>}
    {notice&&<div className="lsv-plot-notice" role="status">{notice}</div>}
    {tickWarnings.length>0&&<div className="lsv-tick-warning" role="status">{tickWarnings.join(" ")}</div>}
    {!legendInside&&active.length>0&&<div className="lsv-plot-legend">{active.map(c=><span key={c.id}><i style={{background:c.color}}/>{c.name}</span>)}</div>}
    <div className={`lsv-plot-host ${fileOver?"lsv-file-over":""}`} ref={host} data-file-drop={!!onFilesDrop} onDragEnter={event=>{if(!fileDrag(event))return;event.preventDefault();dragDepth.current++;setFileOver(true);}} onDragOver={event=>{if(!fileDrag(event))return;event.preventDefault();event.dataTransfer.dropEffect="copy";}} onDragLeave={event=>{if(!fileDrag(event))return;event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setFileOver(false);}} onDrop={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth.current=0;setFileOver(false);cancelPointer();setHover(null);onFilesDrop?.(Array.from(event.dataTransfer.files));}}>
      <div className="lsv-plot-canvas" style={{width:axisControls?size.width:"100%",height:axisControls?size.height:"100%"}}>
      <svg ref={svg} tabIndex={0} onKeyDown={canvasKey} onPointerDownCapture={event=>{const target=event.target as Element;if(!target.closest("[tabindex],input,button,select,textarea")||target.closest("[tabindex],input,button,select,textarea")===svg.current)svg.current?.focus({preventScroll:true});else if(target instanceof SVGElement&&target.hasAttribute("tabindex"))target.focus({preventScroll:true});}} width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`${title}交互图，${active.length}条曲线，横轴${xTitleText}${xScale==="log10"?"（对数）":xScale==="reciprocal"?"（倒数）":""}，纵轴${yTitleText}${yScale==="log10"?"（对数）":yScale==="reciprocal"?"（倒数）":""}${rightActive.length?"，含右轴":""}${topLabel.trim()?"，含上轴":""}`} data-testid="lsv-chart" data-equal-units={equalUnits} data-plot-width={w} data-plot-height={h} data-legend-position={legendRight?"right":legendAbove?"above":legendInside?"inside":"outside"} data-x-scale={xScale} data-y-scale={yScale} data-x-min={bounds.x0} data-x-max={bounds.x1} data-y-min={bounds.y0} data-y-max={bounds.y1} data-y2-min={rightActive.length?rightY.y0:undefined} data-y2-max={rightActive.length?rightY.y1:undefined} data-right-curves={rightActive.length} data-y-break-from={breakRange?.from} data-y-break-to={breakRange?.to} data-analysis-mode={analysis?.mode} onPointerMove={move} onPointerLeave={() => !dragRef.current&&!guideDrag.current && setHover(null)} onContextMenu={openContextMenu} onPointerDown={startPointer} onPointerUp={finish} onPointerCancel={cancelPointer} onLostPointerCapture={event=>{if(event.pointerId===(dragRef.current?.pointerId??guideDrag.current?.pointerId??annotationDrag.current?.pointerId??titleDrag.current?.pointerId))cancelPointer();}} onDoubleClick={()=>{if(!analysis||analysis.mode==="zoom")reset();}} onWheel={event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); if(dragRef.current||guideDrag.current)return;const p = clamp(coordinates(event).x,coordinates(event).y); zoom(event.deltaY > 0 ? 1.12 : 1/1.12, ix(p.x),iy(p.y)); }}>
        <defs><clipPath id={clip}>{breakRange?<><rect x={margin.left} y={margin.top} width={w} height={breakUpperH}/><rect x={margin.left} y={margin.top+breakUpperH+breakGap} width={w} height={breakLowerH}/></>:<rect x={margin.left} y={margin.top} width={w} height={h}/>}</clipPath></defs>
        <rect width={size.width} height={size.height} fill="white" data-plot-background="1"/>
        {topLabel.trim()&&<g data-testid="lsv-top-axis" data-axis="x-top" data-top-min={independentTop?topMinValue:undefined} data-top-max={independentTop?topMaxValue:undefined}>{topTicks.major.map(v=><g key={`xt-${v}`} data-tick-value={v}><line x1={topX(v)} x2={topX(v)} y1={margin.top} y2={margin.top+6} stroke="#111"/><text x={topX(v)} y={margin.top-10} textAnchor="middle" className="lsv-axis-tick" style={{fontSize:tickSize-1}}>{tickLabel(v,topTicks)}</text></g>)}<text x={margin.left+w/2} y={margin.top-28} textAnchor="middle" className="lsv-axis-title" style={{fontSize:12}}>{topLabel}</text>{topTicks.minor.map(v=><line key={`xtm-${v}`} x1={topX(v)} x2={topX(v)} y1={margin.top} y2={margin.top+3} stroke="#111" strokeWidth=".9"/>)}</g>}
        {xTicks.major.map(v => <g key={`x-${v}`} data-tick-kind="major" data-axis="x" data-tick-value={v} onDoubleClick={event=>{event.stopPropagation();openSettings("axes");}}><line x1={sx(v)} x2={sx(v)} y1={xAxisBottom} y2={xAxisBottom-7} stroke="#111"/><text x={sx(v)} y={xAxisBottom+(axisControls?shortCanvas?24:34:27)} textAnchor="middle" className="lsv-axis-tick" style={{fontSize:tickSize}}>{tickLabel(v,xTicks)}</text></g>)}
        {yTicks.major.map(v => <g key={`y-${v}`} data-tick-kind="major" data-axis="y" data-tick-value={v} onDoubleClick={event=>{event.stopPropagation();openSettings("axes");}}><line x1={margin.left} x2={margin.left+7} y1={sy(v)} y2={sy(v)} stroke="#111"/><text x={margin.left-(axisControls?16:13)} y={sy(v)+tickSize*.35} textAnchor="end" className="lsv-axis-tick" style={{fontSize:tickSize}}>{tickLabel(v,yTicks)}</text></g>)}
        {rightActive.length>0&&<g data-testid="lsv-right-axis">{y2Ticks.major.map(v=><g key={`y2-${v}`} data-tick-kind="major" data-axis="y2" data-tick-value={v}><line x1={margin.left+w} x2={margin.left+w-7} y1={sy2(v)} y2={sy2(v)} stroke="#111"/><text x={margin.left+w+11} y={sy2(v)+tickSize*.35} textAnchor="start" className="lsv-axis-tick" style={{fontSize:tickSize}}>{tickLabel(v,y2Ticks)}</text></g>)}{y2Ticks.minor.map(v=><line key={`y2m-${v}`} data-tick-kind="minor" data-axis="y2" data-tick-value={v} x1={margin.left+w} x2={margin.left+w-3.5} y1={sy2(v)} y2={sy2(v)} stroke="#111" strokeWidth=".9"/>)}<text transform={`translate(${size.width-28},${margin.top+h/2}) rotate(90)`} textAnchor="middle" className="lsv-axis-title" style={{fontSize:13}}>{y2Label.trim()||"右轴"}</text></g>}
        {xTicks.minor.map(v=><line key={`xm-${v}`} data-tick-kind="minor" data-axis="x" data-tick-value={v} x1={sx(v)} x2={sx(v)} y1={xAxisBottom} y2={xAxisBottom-3.5} stroke="#111" strokeWidth=".9"/>)}
        {yTicks.minor.map(v=><line key={`ym-${v}`} data-tick-kind="minor" data-axis="y" data-tick-value={v} x1={margin.left} x2={margin.left+3.5} y1={sy(v)} y2={sy(v)} stroke="#111" strokeWidth=".9"/>)}
        {breakRange?<g data-testid="lsv-axis-break"><rect x={margin.left} y={margin.top} width={w} height={breakUpperH} fill="none" stroke="#111" strokeWidth="1.5"/><rect x={margin.left} y={margin.top+breakUpperH+breakGap} width={w} height={breakLowerH} fill="none" stroke="#111" strokeWidth="1.5"/>{(breakRange?[margin.left,margin.left+w]:[]).map(x=><g key={x}>{[0,6].map(offset=><line key={offset} x1={x-5} x2={x+5} y1={margin.top+breakUpperH+breakGap/2+offset+3} y2={margin.top+breakUpperH+breakGap/2+offset-3} stroke="#111" strokeWidth="1.5"/>)}</g>)}</g>:<rect x={margin.left} y={margin.top} width={w} height={h} fill="none" stroke="#111" strokeWidth="1.5"/>}
        {analysis?.mode==="range"&&analysis.range&&<g clipPath={`url(#${clip})`} data-plot-transient pointerEvents="none"><rect x={sx(analysis.range.min)} y={margin.top} width={Math.max(0,sx(analysis.range.max)-sx(analysis.range.min))} height={h} fill="#ef44440d"/></g>}
        <g clipPath={`url(#${clip})`}>{curveShapes}{fitLine&&fit&&<line data-testid="tafel-fit-line" data-intercept={fit.intercept} data-slope={fit.slope} data-x-min={fit.xMin} data-x-max={fit.xMax} data-y-min={fit.intercept+fit.slope*fit.xMin} data-y-max={fit.intercept+fit.slope*fit.xMax} x1={fitLine.x1} x2={fitLine.x2} y1={fitLine.y1} y2={fitLine.y2} stroke={fit.color} strokeWidth="2.4" strokeDasharray="8 5" strokeLinecap="round" pointerEvents="none"/>}</g>
        {annotations.length>0&&<g data-testid="plot-annotations" data-annotation-count={annotations.length}>{annotations.map(annotation=>{
          const selected=selectedAnnotation===annotation.id;
          if(annotation.kind==="text"){
            const px=sx(annotation.x),py=sy(annotation.y);
            if(!Number.isFinite(px)||!Number.isFinite(py))return null;
            const lines=annotation.text.split("\n").slice(0,8);
            const width=Math.max(36,...lines.map(line=>Array.from(line).reduce((sum,char)=>sum+(char.charCodeAt(0)>255?13:7),0)))+12;
            const height=lines.length*17+8,color=annotation.color??"#1d4e79";
            return <g key={annotation.id} data-annotation-id={annotation.id} data-annotation-kind="text" data-annotation-border={annotation.border!==false} transform={`translate(${px},${py})`} onPointerDown={event=>beginAnnotationDrag(event,annotation)} onDoubleClick={event=>{event.stopPropagation();setDraftText({id:annotation.id,x:annotation.x,y:annotation.y,value:annotation.text});}} style={{cursor:"move"}}>
              <rect x={-width/2} y={-height/2} width={width} height={height} data-export-stroke={annotation.border===false?"none":"#d6e2ec"} data-export-width="1" data-export-dash="" rx={3} fill="#fff" fillOpacity={.86} stroke={annotation.border===false?"none":selected?"#1d6dce":"#d6e2ec"} strokeWidth={selected?1.5:1} strokeDasharray={selected?"4 3":undefined}/>
              <text textAnchor="middle" fontFamily="Arial, Microsoft YaHei, sans-serif" fontSize={13} fill={color} pointerEvents="none">{lines.map((line,index)=><tspan key={index} x={0} y={(index-(lines.length-1)/2)*17+4}>{line}</tspan>)}</text>
            </g>;
          }
          if(annotation.kind==="arrow"){
            const x1=sx(annotation.x),y1=sy(annotation.y),x2=sx(annotation.x2),y2=sy(annotation.y2);
            if(![x1,y1,x2,y2].every(Number.isFinite))return null;
            const angle=Math.atan2(y2-y1,x2-x1),head=annotation.head??10,color=annotation.color??"#b23b3b",lineWidth=annotation.width??1.8;
            return <g key={annotation.id} data-annotation-id={annotation.id} data-annotation-kind="arrow" data-annotation-width={lineWidth} data-annotation-head={head} onPointerDown={event=>beginAnnotationDrag(event,annotation)} onDoubleClick={event=>{event.stopPropagation();setSelectedAnnotation(annotation.id);openSettings("annotations");}} style={{cursor:"move"}}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={lineWidth}/>
              <polygon points={`${x2},${y2} ${x2-head*Math.cos(angle-.38)},${y2-head*Math.sin(angle-.38)} ${x2-head*Math.cos(angle+.38)},${y2-head*Math.sin(angle+.38)}`} fill={color}/>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(14,lineWidth*3)} pointerEvents="stroke"/>
              {selected&&<circle data-plot-transient cx={x1} cy={y1} r={4} fill="#fff" stroke="#1d6dce" strokeWidth={1.5}/>}
            </g>;
          }
          if(annotation.kind==="hline"){
            const py=sy(annotation.y);
            if(!Number.isFinite(py))return null;
            const color=annotation.color??"#6b8094";
            return <g key={annotation.id} data-annotation-id={annotation.id} data-annotation-kind="hline" data-annotation-value={annotation.y} onPointerDown={event=>beginAnnotationDrag(event,annotation)} onDoubleClick={event=>{event.stopPropagation();setSelectedAnnotation(annotation.id);openSettings("annotations");}} style={{cursor:"ns-resize"}}>
              <line x1={margin.left} x2={margin.left+w} y1={py} y2={py} data-export-stroke={color} data-export-width="1.5" stroke={selected?"#1d6dce":color} strokeWidth={selected?2:1.5} strokeDasharray="7 4"/>
              <line x1={margin.left} x2={margin.left+w} y1={py} y2={py} stroke="transparent" strokeWidth={12} pointerEvents="stroke"/>
              {annotation.text&&<text x={margin.left+w-5} y={py-5} textAnchor="end" fontSize={11} fill={color} pointerEvents="none">{annotation.text}</text>}
            </g>;
          }
          const px=sx(annotation.x);
          if(!Number.isFinite(px))return null;
          const color=annotation.color??"#6b8094";
          return <g key={annotation.id} data-annotation-id={annotation.id} data-annotation-kind="vline" data-annotation-value={annotation.x} onPointerDown={event=>beginAnnotationDrag(event,annotation)} onDoubleClick={event=>{event.stopPropagation();setSelectedAnnotation(annotation.id);openSettings("annotations");}} style={{cursor:"ew-resize"}}>
            <line x1={px} x2={px} y1={margin.top} y2={margin.top+h} data-export-stroke={color} data-export-width="1.5" stroke={selected?"#1d6dce":color} strokeWidth={selected?2:1.5} strokeDasharray="7 4"/>
            <line x1={px} x2={px} y1={margin.top} y2={margin.top+h} stroke="transparent" strokeWidth={12} pointerEvents="stroke"/>
            {annotation.text&&<text x={px+5} y={margin.top+12} fontSize={11} fill={color} pointerEvents="none">{annotation.text}</text>}
          </g>;
        })}</g>}
        {arrowDraft&&<g data-plot-transient pointerEvents="none"><line x1={sx(arrowDraft.x0)} y1={sy(arrowDraft.y0)} x2={sx(arrowDraft.x1)} y2={sy(arrowDraft.y1)} stroke="#b23b3b" strokeWidth={1.8} strokeDasharray="5 3"/></g>}
        {visibleReferences.length>0&&<g data-testid="xrd-reference-sticks" aria-label="参考卡片峰棒图"><line x1={margin.left} x2={margin.left+w} y1={xAxisBottom} y2={xAxisBottom} stroke="#24394e"/>{visibleReferences.map((card,lane)=>{
          const baseline=margin.top+h+8+(lane+1)*referenceLaneHeight;
          const max=Math.max(...card.peaks.map(peak=>peak.intensity),1);
          return <g key={card.id} data-reference-card={card.id}><line x1={margin.left} x2={margin.left+w} y1={baseline} y2={baseline} stroke="#dfe6ed"/>{card.peaks.filter(peak=>peak.x>=bounds.x0&&peak.x<=bounds.x1&&Number.isFinite(sx(peak.x))).map((peak,index)=><g key={index}><title>{`${card.name}\n2θ: ${peak.x.toFixed(5)}°\nd: ${peak.d.toFixed(6)} Å\nI/Imax: ${peak.intensityQualifier??""}${(peak.intensity/max*100).toFixed(3)}${peak.hkl?`\nhkl: ${peak.hkl}`:""}`}</title><line data-reference-peak data-x={peak.x} data-relative-intensity={peak.intensity/max*100} x1={sx(peak.x)} x2={sx(peak.x)} y1={baseline} y2={baseline-peak.intensity/max*Math.max(4,referenceLaneHeight-13)} stroke={card.color} strokeWidth="1.5"/><line x1={sx(peak.x)} x2={sx(peak.x)} y1={baseline} y2={baseline-Math.max(4,referenceLaneHeight-13)} stroke="transparent" strokeWidth="7"/></g>)}<text x={margin.left+w-4} y={baseline-3} textAnchor="end" fontSize="10" fill={card.color} stroke="white" strokeWidth="3" paintOrder="stroke"><title>{card.name}</title>{card.name.length>45?card.name.slice(0,44)+"…":card.name}</text></g>;
        })}</g>}
        <line data-testid="x-axis-hit" x1={margin.left} x2={margin.left+w} y1={xAxisBottom} y2={xAxisBottom} stroke="transparent" strokeWidth={14} onDoubleClick={event=>{event.stopPropagation();openSettings("axes");}} style={{cursor:"pointer"}}/>
        <line data-testid="y-axis-hit" x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top+h} stroke="transparent" strokeWidth={14} onDoubleClick={event=>{event.stopPropagation();openSettings("axes");}} style={{cursor:"pointer"}}/>
        <text data-testid="x-axis-title" tabIndex={0} x={xTitlePosition.x} y={xTitlePosition.y} textAnchor="middle" className="lsv-axis-title" style={{fontFamily:PLOT_FONT,fontWeight:titleSettings.x.bold?700:400,fontSize:xTitleSize,cursor:"move",pointerEvents:"auto"}} onPointerDown={event=>beginTitleDrag(event,"x")} onDoubleClick={event=>{event.stopPropagation();event.currentTarget.focus({preventScroll:true});openSettings("titles");}}>{xTitleText}</text>
        <text data-testid="y-axis-title" tabIndex={0} transform={`translate(${yTitlePosition.x},${yTitlePosition.y}) rotate(-90)`} textAnchor="middle" className="lsv-axis-title" style={{fontFamily:PLOT_FONT,fontWeight:titleSettings.y.bold?700:400,fontSize:yTitleSize,cursor:"move",pointerEvents:"auto"}} onPointerDown={event=>beginTitleDrag(event,"y")} onDoubleClick={event=>{event.stopPropagation();event.currentTarget.focus({preventScroll:true});openSettings("titles");}}>{yTitleText}</text>
        {legendInside&&active.length>0&&(legendRight?<g className="lsv-svg-legend" aria-label="样品图例" data-legend-position="right" transform={`translate(${rightLegendX},${rightLegendY})`}><rect width={rightLegendWidth} height={rightLegendHeight} fill="#fff" stroke="#333" strokeWidth="1"/>{rightLegendRows.map(({curve,lines,y})=><g key={curve.id} data-legend-curve={curve.id} transform={`translate(9,${y})`}><title>{curve.name}</title>{(curve.style??style)==="scatter"?<circle cx="11" cy={rightLegendFont*.65} r="4" fill="white" stroke={curve.color} strokeWidth="1.8"/>:<line x1="0" x2="22" y1={rightLegendFont*.65} y2={rightLegendFont*.65} stroke={curve.color} strokeWidth="2.3"/>}<text x="30" fontSize={rightLegendFont} fill="#35516d">{lines.map((line,index)=><tspan key={index} x="30" y={rightLegendFont+index*(rightLegendFont+3)}>{line}</tspan>)}</text></g>)}</g>:<g className="lsv-svg-legend" aria-label="样品图例" data-legend-position={legendAbove?"above":"inside"} transform={`translate(${legendAbove?legendLeft:margin.left+10},${legendAbove?10:margin.top+10})`}><rect width={legendColumnWidth*legendColumns} height={legendHeight} fill="#fff" stroke="#333" strokeWidth="1"/>{active.map((curve,index)=><g key={curve.id} data-legend-curve={curve.id} transform={`translate(${(index%legendColumns)*legendColumnWidth+9},${Math.floor(index/legendColumns)*legendRowHeight+19})`}><title>{curve.name}</title>{style==="scatter"?<circle cx="11" cy="-4" r="4" fill="white" stroke={curve.color} strokeWidth="1.8"/>:<line x1="0" x2="22" y1="-4" y2="-4" stroke={curve.color} strokeWidth="2.3"/>}<text x="30" fontSize="14" fill="#35516d">{legendName(curve.name)}</text></g>)}</g>)}
        {analysis?.mode==="range"&&analysis.range&&<g data-plot-transient clipPath={`url(#${clip})`} data-testid="tafel-range-guides">{(["min","max"] as const).map(edge=>{
          const value=analysis.range![edge],px=sx(value);
          if(!Number.isFinite(px))return null;
          return <g key={edge} data-testid={`tafel-range-${edge}`} data-range-value={value} role="slider" tabIndex={0} aria-label={edge==="min"?"拟合区间左边界":"拟合区间右边界"} aria-orientation="horizontal" aria-valuemin={bounds.x0} aria-valuemax={bounds.x1} aria-valuenow={value} onPointerDown={event=>startGuide(event,edge)} onKeyDown={event=>guideKey(event,edge)} style={{cursor:"ew-resize",outlineOffset:3}}>
            <title>左右拖动调整拟合区间；方向键微调，Shift 加方向键精细调整。</title>
            <line x1={px} x2={px} y1={margin.top} y2={margin.top+h} stroke="#d92d3e" strokeWidth="1.5" strokeDasharray="6 4" pointerEvents="none"/>
            <line x1={px} x2={px} y1={margin.top} y2={margin.top+h} stroke="transparent" strokeWidth="22" style={{cursor:"ew-resize"}}/>
            <rect x={px-5} y={margin.top+2} width="10" height="14" rx="3" fill="white" stroke="#d92d3e" strokeWidth="1.5" style={{cursor:"ew-resize"}}/>
            <rect x={px-5} y={margin.top+h-16} width="10" height="14" rx="3" fill="white" stroke="#d92d3e" strokeWidth="1.5" style={{cursor:"ew-resize"}}/>
          </g>;
        })}</g>}
        {hover && <g pointerEvents="none" data-plot-transient><line x1={hover.px} x2={hover.px} y1={margin.top} y2={margin.top+h} stroke="#9bacbc" strokeDasharray="4 4"/><circle cx={hover.px} cy={hover.py} r={5} stroke="white" strokeWidth={2} fill={hover.curve.color}/></g>}
        {drag && <rect data-plot-transient data-testid={drag.mode==="mask"?"tafel-mask-rectangle":"plot-zoom-rectangle"} x={Math.min(drag.x0,drag.x1)} y={Math.min(drag.y0,drag.y1)} width={Math.abs(drag.x1-drag.x0)} height={Math.abs(drag.y1-drag.y0)} fill={drag.mode==="mask"?"#dc596520":"#2374d520"} stroke={drag.mode==="mask"?"#cd3f51":"#2374d5"} strokeDasharray="5 3" pointerEvents="none"/>}
      </svg>
      {leftPanel&&<div ref={leftPanelElement} className="lsv-plot-left-panel" data-testid="lsv-sample-manager" data-placement={leftPanelDocked?"left":"below"} style={leftPanelDocked?{left:leftPanelInset,top:20,width:leftPanelWidth,height:size.height-40}:{left:0,top:size.height+16,width:"100%"}}>{leftPanel}</div>}
      {rightPanel&&rightPanelDocked&&<div className="lsv-plot-right-panel" data-testid="tafel-fit-results" data-placement="right" style={{position:"absolute",zIndex:2,right:16,top:20,width:rightPanelWidth,height:size.height-40,minWidth:0,overflowY:"auto",overscrollBehavior:"contain"}}>{rightPanel}</div>}
      {((!points.length&&!visibleReferences.length) || error) && <div className="lsv-chart-empty"><span className="lsv-empty-mark">∿</span><strong>{error ? "暂时无法绘图" : "把你的数据放到这里"}</strong><p>{error || emptyText || (onFilesDrop?"直接拖入 TXT、BIN（辰华）、Excel（XLSX）、CSV、DAT 或 TSV 文件。":`上传文件或粘贴数据，即可生成可交互的${title}。`)}</p></div>}
      {fileOver&&<div className="lsv-drop-overlay" role="status"><strong>松开文件，导入数据</strong><span>可同时拖入多个文件</span></div>}
      {hover && <div className="lsv-tooltip" data-testid="plot-tooltip" data-x={hover.point.x} data-y={hover.point.y} data-interpolated={!!hover.interpolated} style={{ left: Math.max(8,Math.min(size.width-(continuousHover?270:230),hover.px+18)), top: Math.max(8,Math.min(size.height-(continuousHover?160:135),hover.py-88)) }}>
        <strong style={{ color: hover.curve.color }}>{hover.curve.name}</strong>
        <div>{continuousHover?"2θ / °":"X"} <b>{continuousHover?Number(hover.point.x.toPrecision(10)).toString():fmt(hover.point.x)}</b></div>
        <div>{continuousHover?"图上强度":"Y"} <b>{continuousHover?Number(hover.point.y.toPrecision(10)).toString():fmt(hover.point.y)}</b></div>
        {continuousHover&&hover.point.y!==hover.point.current&&<div>原始强度 <b>{Number(hover.point.current.toPrecision(10)).toString()}</b></div>}
        <small>{hover.interpolated&&hover.endpointIndices?`线性插值 · 原始第 ${hover.endpointIndices[0]+1}–${hover.endpointIndices[1]+1} 点之间`:`原始第 ${(hover.exactIndex??hover.point.index)+1} 个数据点`}</small>
      </div>}
      </div>
    </div>
    {rightPanel&&!rightPanelDocked&&<>{leftPanel&&!leftPanelDocked&&<div aria-hidden="true" data-testid="tafel-panel-spacer" style={{height:leftPanelHeight+16,flexShrink:0}}/>}<div className="lsv-plot-right-panel" data-testid="tafel-fit-results" data-placement="below" style={{position:"relative",margin:16,minWidth:0,flexShrink:0}}>{rightPanel}</div></>}
    {showFooter&&<div className="lsv-plot-foot"><span>{onFilesDrop?"拖入文件导入 · ":""}{analysis?.mode==="mask"?"拖动矩形屏蔽数据 · Esc 取消框选":analysis?.mode==="range"?"左右拖动红线选择拟合区间 · 方向键微调":"拖动框选放大 · 双击复位"} · 悬停读取数据</span><span>{points.length.toLocaleString()} 个有效点{view ? " · 已缩放" : ""}</span></div>}
  </div>;
}
