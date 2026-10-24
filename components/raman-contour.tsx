"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { ramanContourPaths, type RamanGrid, type RamanYAxis } from "@/lib/raman-data";
import { axisTicks, DEFAULT_TICKS, formatTick, type AxisTicks, type PlotTickSettings } from "@/lib/plot-ticks";
import { useProjectEpoch, useProjectState } from "@/lib/project-state";
import PlotSettingsDialog from "@/components/plot-settings-dialog";
import PlotTickSettingsPanel from "@/components/plot-tick-settings";

export function ramanColor(t:number,palette:string) {
  const anchors=palette==="warm"?["#172976","#237cb4","#39b9ad","#f0e66b","#f27c35","#aa1637"]:["#440154","#414487","#2a788e","#22a884","#7ad151","#fde725"];
  const scaled=Math.max(0,Math.min(1,t))*(anchors.length-1),i=Math.min(anchors.length-2,Math.floor(scaled)),f=scaled-i;
  const rgb=[1,3,5].map(n=>Math.round(parseInt(anchors[i].slice(n,n+2),16)*(1-f)+parseInt(anchors[i+1].slice(n,n+2),16)*f));
  return `rgb(${rgb.join(",")})`;
}
const format=(v:number)=>Math.abs(v)>=10000||Math.abs(v)>0&&Math.abs(v)<.001?v.toExponential(2):Number(v.toPrecision(5)).toString();
export default function RamanContour({grid,axis,bands,palette,normalize,xLabel,yLabel,onFilesDrop,toolbar,settingsContent}:{grid:RamanGrid;axis:RamanYAxis;bands:number;palette:string;normalize:boolean;xLabel:string;yLabel:string;onFilesDrop:(files:File[])=>void;toolbar?:React.ReactNode;settingsContent?:React.ReactNode}) {
  const paths=useMemo(()=>ramanContourPaths(grid,bands),[grid,bands]);
  const [hover,setHover]=useState<{x:number;y:number;z:number;name:string}|null>(null),[over,setOver]=useState(false);
  const [manual,setManual]=useProjectState<{x?:[number,number];y?:[number,number]}>('raman.contour','manual',{});
  const [ranges,setRanges]=useProjectState('raman.contour','ranges',{x0:'',x1:'',y0:'',y1:''});
  const [tickSettings,setTickSettings]=useProjectState<PlotTickSettings>('raman.contour','tickSettings',DEFAULT_TICKS);
  const [rangeError,setRangeError]=useState(''),projectEpoch=useProjectEpoch();
  useEffect(()=>{setHover(null);setRangeError('');},[grid,manual,projectEpoch]);
  const gradient=useId().replace(/:/g,"");
  const l=105,t=42,w=690,h=440,b=482;
  const source={x0:grid.x[0]??0,x1:grid.x.at(-1)??1,y0:grid.y[0]??0,y1:grid.y.at(-1)??1};
  const usableSource=grid.x.length>=2&&grid.y.length>=2&&Object.values(source).every(Number.isFinite)&&source.x1>source.x0&&source.y1>source.y0&&Number.isFinite(source.x1-source.x0)&&Number.isFinite(source.y1-source.y0);
  const full=usableSource?source:{x0:0,x1:1,y0:0,y1:1};
  const view={x0:manual.x?.[0]??full.x0,x1:manual.x?.[1]??full.x1,y0:manual.y?.[0]??full.y0,y1:manual.y?.[1]??full.y1};
  const {x0,x1,y0,y1}=view;
  const viewport=[(x0-full.x0)/(full.x1-full.x0)*1000,(full.y1-y1)/(full.y1-full.y0)*1000,(x1-x0)/(full.x1-full.x0)*1000,(y1-y0)/(full.y1-full.y0)*1000];
  const usableView=viewport.every(Number.isFinite)&&viewport[2]>0&&viewport[3]>0;
  const contourViewBox=usableView?viewport.join(' '):'0 0 1000 1000';
  const error=grid.error||(!usableSource?'等高线图至少需要两条光谱和两个有效位移点。':!usableView?'坐标范围超出可显示的数值尺度，请在设置中调整范围或复位。':undefined);
  const tickWarnings:string[]=[];
  const settingsFor=(dimension:'x'|'y',settings:PlotTickSettings)=>dimension==='y'&&axis==='sequence'&&settings.y.step===undefined?{...settings.y,step:Math.max(1,Math.ceil((y1-y0)/10))}:settings[dimension];
  function ticksFor(dimension:'x'|'y'):AxisTicks {
    try{return axisTicks(view[`${dimension}0`],view[`${dimension}1`],settingsFor(dimension,tickSettings));}
    catch(issue){tickWarnings.push(`${dimension.toUpperCase()} 轴：${(issue as Error).message}；当前范围暂用自动刻度。`);try{return axisTicks(view[`${dimension}0`],view[`${dimension}1`],settingsFor(dimension,DEFAULT_TICKS));}catch{return {major:[],minor:[],step:1};}}
  }
  const xTicks=ticksFor('x'),yTicks=ticksFor('y');
  function applyTicks(settings:PlotTickSettings):string|undefined {
    for(const dimension of ['x','y'] as const){try{axisTicks(view[`${dimension}0`],view[`${dimension}1`],settingsFor(dimension,settings));}catch(issue){return `${dimension.toUpperCase()} 轴：${(issue as Error).message}`;}}
    setTickSettings(settings);return;
  }
  function reset(){setManual({});setRanges({x0:'',x1:'',y0:'',y1:''});setRangeError('');setHover(null);}
  function applyRanges(){
    const next:{x?:[number,number];y?:[number,number]}={};
    for(const dimension of ['x','y'] as const){
      const lower=ranges[`${dimension}0`].trim(),upper=ranges[`${dimension}1`].trim();
      if(!lower&&!upper)continue;
      const min=Number(lower),max=Number(upper);
      if(!lower||!upper||!Number.isFinite(min)||!Number.isFinite(max)||min>=max||!Number.isFinite(max-min)){setRangeError(`${dimension.toUpperCase()} 轴请同时填写有效的最小值和最大值，且最小值须小于最大值。`);return;}
      const sourceSpan=full[`${dimension}1`]-full[`${dimension}0`];
      if(!Number.isFinite((min-full[`${dimension}0`])/sourceSpan*1000)||!Number.isFinite((max-min)/sourceSpan*1000)||(max-min)/sourceSpan*1000<=0){setRangeError(`${dimension.toUpperCase()} 轴范围超出可显示的数值尺度，请调整范围。`);return;}
      next[dimension]=[min,max];
    }
    setManual(next);setRangeError('');setHover(null);
  }
  const rangeControls=<div className="lsv-axis-controls">
    {(['x','y'] as const).map(dimension=><div className="lsv-axis-range" key={dimension} role="group" aria-label={`${dimension.toUpperCase()} 轴范围`}><strong>{dimension.toUpperCase()} 轴范围</strong><input type="number" step="any" aria-label={`${dimension.toUpperCase()} 轴最小值`} placeholder={`最小 ${format(full[`${dimension}0`])}`} value={ranges[`${dimension}0`]} onChange={e=>setRanges(old=>({...old,[`${dimension}0`]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')applyRanges();}}/><span>至</span><input type="number" step="any" aria-label={`${dimension.toUpperCase()} 轴最大值`} placeholder={`最大 ${format(full[`${dimension}1`])}`} value={ranges[`${dimension}1`]} onChange={e=>setRanges(old=>({...old,[`${dimension}1`]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')applyRanges();}}/></div>)}
    <button className="lsv-button secondary" onClick={applyRanges}>应用范围</button><button className="lsv-button secondary" onClick={reset}>恢复自动范围</button>
    {rangeError&&<div className="lsv-error" role="alert">{rangeError}</div>}
  </div>;
  function move(e:React.PointerEvent<SVGSVGElement>){
    if(error)return;const matrix=e.currentTarget.getScreenCTM();if(!matrix)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse()),px=point.x,py=point.y;
    if(px<l||px>l+w||py<t||py>t+h){setHover(null);return;}
    const position=x0+(px-l)/w*(x1-x0),value=y0+(t+h-py)/h*(y1-y0);
    if(position<source.x0||position>source.x1||value<source.y0||value>source.y1){setHover(null);return;}
    const c=Math.min(grid.x.length-1,Math.max(0,Math.round((position-source.x0)/(source.x1-source.x0)*(grid.x.length-1))));
    let r=0;grid.y.forEach((v,i)=>{if(Math.abs(v-value)<Math.abs(grid.y[r]-value))r=i;});
    setHover({x:grid.x[c],y:grid.y[r],z:grid.values[r]?.[c]??NaN,name:grid.names[r]??''});
  }
  return <div className="lsv-plot-card raman-contour-card" onDragOver={e=>{if(Array.from(e.dataTransfer.types).includes("Files")){e.preventDefault();setOver(true);}}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);onFilesDrop(Array.from(e.dataTransfer.files));}}>
    <div className="lsv-plot-toolbar">{toolbar}<PlotSettingsDialog rangeControls={rangeControls} tickControls={<PlotTickSettingsPanel onApply={applyTicks} settings={tickSettings} embedded/>}>{settingsContent}</PlotSettingsDialog><div className="lsv-plot-actions"><button onClick={reset} title="恢复完整范围"><RotateCcw size={16}/><span>复位</span></button></div></div>
    {tickWarnings.length>0&&<div className="lsv-error" role="status">{tickWarnings.join(' ')}</div>}
    <div className="raman-contour-canvas">
      <svg viewBox="0 0 960 590" width="100%" role="img" aria-label={`Raman 等高线图，${grid.y.length} 条光谱，横轴 ${xLabel}，纵轴 ${yLabel}`} data-testid="raman-contour" data-spectra={grid.y.length} data-x-min={x0} data-x-max={x1} data-y-min={y0} data-y-max={y1} onPointerMove={move} onPointerLeave={()=>setHover(null)}>
        <rect width="960" height="590" fill="white" data-plot-background="1"/>
        {!error&&<>
          <defs><linearGradient id={gradient} x1="0" y1="1" x2="0" y2="0">{Array.from({length:bands+1},(_,i)=><stop key={i} offset={`${100*i/bands}%`} stopColor={ramanColor(i/bands,palette)}/>)}</linearGradient></defs>
          <svg x={l} y={t} width={w} height={h} viewBox={contourViewBox} preserveAspectRatio="none" overflow="hidden" data-contour-viewport>
            {paths.map((d,i)=><path key={i} d={d} fill={ramanColor((i+.5)/bands,palette)} stroke={ramanColor((i+.5)/bands,palette)} strokeWidth=".2" data-contour-band={i}/>)}
          </svg>
          <rect x={l} y={t} width={w} height={h} fill="none" stroke="#29445e" strokeWidth="1.5"/>
          {xTicks.minor.map((v,i)=><path key={`xm${i}`} d={`M${l+(v-x0)/(x1-x0)*w},${b}v4`} stroke="#29445e" data-axis="x" data-tick="minor" data-value={v}/>)}
          {yTicks.minor.map((v,i)=><path key={`ym${i}`} d={`M${l},${t+h-(v-y0)/(y1-y0)*h}h-4`} stroke="#29445e" data-axis="y" data-tick="minor" data-value={v}/>)}
          {xTicks.major.map((v,i)=>{const x=l+(v-x0)/(x1-x0)*w;return <g key={i} data-axis="x" data-tick="major" data-value={v}><path d={`M${x},${b}v7`} stroke="#29445e"/><text x={x} y={b+28} textAnchor="middle" fontSize="15" fill="#29445e" fontFamily="Arial, sans-serif">{formatTick(v,xTicks.step)}</text></g>;})}
          {yTicks.major.map((v,i)=>{const y=t+h-(v-y0)/(y1-y0)*h;return <g key={i} data-axis="y" data-tick="major" data-value={v}><path d={`M${l},${y}h-7`} stroke="#29445e"/><text x={l-14} y={y+5} textAnchor="end" fontSize="15" fill="#29445e" fontFamily="Arial, sans-serif">{formatTick(v,yTicks.step)}</text></g>;})}
          <text x={l+w/2} y="555" textAnchor="middle" fontSize="20" fontFamily="Arial, sans-serif" fill="#233c53">{xLabel}</text>
          <text transform={`translate(28 ${t+h/2}) rotate(-90)`} textAnchor="middle" fontSize="19" fontFamily="Arial, sans-serif" fill="#233c53">{yLabel}</text>
          {Array.from({length:bands},(_,i)=><rect key={i} x="823" y={t+h-(i+1)*h/bands} width="22" height={h/bands+.3} fill={ramanColor((i+.5)/bands,palette)}/>)}
          <rect x="823" y={t} width="22" height={h} fill="none" stroke="#29445e"/>
          {Array.from({length:6},(_,i)=><text key={i} x="854" y={t+h-i*h/5+5} fontSize="14" fontFamily="Arial, sans-serif" fill="#29445e">{format(grid.min+(grid.max-grid.min)*i/5)}</text>)}
          <text x="823" y="25" fontSize="13" fontFamily="Arial, sans-serif" fill="#29445e">{normalize?"Normalized I":"Intensity / a.u."}</text>
        </>}
      </svg>
      {error&&<div className="lsv-chart-empty"><span className="lsv-empty-mark">∿</span><strong>{grid.x.length?"检查等高线设置":"导入 Raman 光谱"}</strong><p>{error}</p></div>}
      {over&&<div className="lsv-drop-overlay"><strong>松开文件，导入光谱</strong></div>}
    </div>
    <div className="raman-contour-reading" role="status">{hover?<><strong>{hover.name}</strong><span>位移 {format(hover.x)} cm⁻¹ · {axis==="potential"?"电位":"序号"} {format(hover.y)}{axis==="potential"?" V":""} · 强度 {Number.isFinite(hover.z)?format(hover.z):"缺失"}</span><small>最近实测光谱在显示网格上的线性插值</small></>:<span>{grid.note||"可直接拖入多个 TXT 数据文件。"}</span>}</div>
  </div>;
}
