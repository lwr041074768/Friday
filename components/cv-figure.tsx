import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Minus,Plus,RotateCcw} from 'lucide-react';
import {axisTicks,formatTick,type AxisTicks} from '@/lib/plot-ticks';
import type {CvAnalysis,CvSettings,CvTrace,CvTracePoint} from '@/lib/cv-data';

type Props={analysis:CvAnalysis;settings:CvSettings;mode:'cv'|'fit';selectedSeriesId?:string;onSelectSeries?:(id:string)=>void;pickBranch?:'anodic'|'cathodic'|null;onPick?:(id:string,branch:'anodic'|'cathodic',e:number)=>void;onToggle?:(id:string)=>void};
type Bounds={x0:number;x1:number;y0:number;y1:number};
const num=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'—':Number(n.toPrecision(5)).toString();
const finite=(p:CvTracePoint|null):p is CvTracePoint=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.j);
function range(values:number[],fallback:[number,number]):[number,number]{let lo=Infinity,hi=-Infinity;for(const v of values)if(Number.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}if(!Number.isFinite(lo))return fallback;const pad=(hi-lo)*.08||Math.max(Math.abs(lo)*.1,.05);return[lo-pad,hi+pad];}
function ticks(lo:number,hi:number):AxisTicks{try{return axisTicks(lo,hi,{anchor:0,minorCount:1});}catch{return{major:[lo,hi],minor:[],step:hi-lo};}}
function short(s:string,n=25){let text='',width=0;for(const ch of s){width+=/[^\x00-\x7F]/.test(ch)?1.8:1;if(width>n-1)return text+'…';text+=ch;}return text;}
const shades=['#1d6db5','#d64939','#2b9279','#9964b5','#cf8b26','#468ea6','#b45783','#758338','#5b75b5'];
export const cvTraceColor=(trace:CvTrace,index:number,selectedGroupId?:string)=>trace.groupId===selectedGroupId?shades[index%shades.length]:trace.color;

/** Keep the exported scientific figure self-contained while the screen uses a separate results column. */
export function buildCvExportSvg(source:SVGSVGElement,analysis:CvAnalysis,settings:CvSettings):SVGSVGElement{
  const svg=source.cloneNode(true) as SVGSVGElement,ns='http://www.w3.org/2000/svg';
  const originalTexts=source.querySelectorAll('text,tspan'),copies=svg.querySelectorAll('text,tspan');
  originalTexts.forEach((node,index)=>{const style=source.ownerDocument.defaultView?.getComputedStyle(node);if(!style)return;for(const key of ['font-family','font-size','font-weight','font-style','fill','fill-opacity','letter-spacing','text-anchor','dominant-baseline']){const value=style.getPropertyValue(key);if(value)copies[index]?.setAttribute(key,value);}});
  const raw=source.getAttribute('data-cv-figure')==='cv',traces=analysis.traces.filter(t=>t.visible&&t.points.some(finite));
  const exportWidth=raw?1240:1000,exportHeight=raw?Math.max(720,64+traces.length*19):720,summaryX=raw?985:735;
  svg.setAttribute('viewBox',`0 0 ${exportWidth} ${exportHeight}`);
  svg.setAttribute('style','display:block');
  const background=svg.querySelector('[data-plot-background]');background?.setAttribute('width',String(exportWidth));background?.setAttribute('height',String(exportHeight));
  if(raw){
    const legend=document.createElementNS(ns,'g');legend.setAttribute('data-cv-export-legend','');legend.setAttribute('font-family','Arial, Microsoft YaHei, sans-serif');
    traces.forEach((trace,index)=>{
      const item=document.createElementNS(ns,'g'),paint=cvTraceColor(trace,index,source.getAttribute('data-cv-selected-group')??undefined),y=55+index*19;item.setAttribute('data-cv-legend-item',trace.series.id);
      const title=document.createElementNS(ns,'title');title.textContent=`${trace.groupName} · ${trace.series.rate} mV/s · ${trace.series.source}`;item.append(title);
      const line=document.createElementNS(ns,'line');for(const [key,value] of Object.entries({x1:'735',x2:'760',y1:String(y),y2:String(y),stroke:paint,'stroke-width':'2.5'}))line.setAttribute(key,value);item.append(line);
      const label=document.createElementNS(ns,'text');label.setAttribute('x','770');label.setAttribute('y',String(y+5));label.setAttribute('font-size','13');label.setAttribute('fill','#25374b');label.textContent=short(`${trace.groupName} · ${trace.series.rate} mV/s`,25);item.append(label);legend.append(item);
    });svg.append(legend);
  }
  const group=document.createElementNS(ns,'g');group.setAttribute('data-cv-export-results','');
  group.setAttribute('font-family','Arial, Microsoft YaHei, sans-serif');
  const results=analysis.groups.filter(g=>g.group.visible&&g.group.series.length),spacing=Math.min(150,650/Math.max(1,results.length)),font=results.length>8?10:results.length>5?12:17;
  for(let i=0;i<results.length;i++){
    const result=results[i],fit=result.fit,lines=[short(result.group.name,27),fit?`y = ${num(fit.slope)} x ${fit.intercept<0?'−':'+'} ${num(Math.abs(fit.intercept))}`:'峰对与拟合条件待核对',`kₛ,${settings.calculationMode==='trial'?'trial':'app'} = ${num(result.ksGeomean)} s⁻¹`,`α = ${num(result.alpha)} · R² = ${num(fit?.r2)}`,`${result.ksCount} 个扫速 · ${num(result.ksMin)} – ${num(result.ksMax)}`];
    for(let j=0;j<lines.length;j++){
      const node=document.createElementNS(ns,'text');node.setAttribute('x',String(summaryX));node.setAttribute('y',String(45+i*spacing+j*(font+3)));node.setAttribute('font-size',String(font));node.setAttribute('fill',j<2?result.group.color:'#34495e');if(j===0)node.setAttribute('font-weight','bold');node.textContent=lines[j];
      const estimated=Array.from(lines[j]).reduce((n,ch)=>n+(/[^\x00-\x7F]/.test(ch)?1:.58)*font,0);if(estimated>245){node.setAttribute('textLength','245');node.setAttribute('lengthAdjust','spacingAndGlyphs');}group.append(node);
    }
  }
  svg.append(group);return svg;
}

/** Both views retain raw point provenance. Selecting a peak snaps to its acquisition branch. */
export default function CvFigure({analysis,settings,mode,selectedSeriesId,onSelectSeries,pickBranch,onPick,onToggle}:Props){
  const clip='cv-'+useId().replace(/[^a-zA-Z0-9_-]/g,''),svg=useRef<SVGSVGElement>(null),viewport=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState(420);
  useEffect(()=>{const node=viewport.current;if(!node)return;const measure=()=>{const box=node.getBoundingClientRect(),next=Math.max(1,Math.floor(Math.min(box.width,box.height)));if(box.width>0&&box.height>0)setSize(previous=>Math.abs(next-previous)>1?next:previous);};measure();const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[]);
  const [view,setView]=useState<Bounds|null>(null),[hover,setHover]=useState<{trace:CvTrace;point:CvTracePoint}|null>(null);
  const [viewKey,setViewKey]=useState('');
  const key=mode+':'+analysis.traces.map(t=>t.series.id+':'+t.selectedCycle+':'+t.series.area+':'+t.series.unit).join('|');
  if(viewKey!==key){setViewKey(key);if(view)setView(null);if(hover)setHover(null);}
  const traces=analysis.traces.filter(t=>t.visible&&t.points.some(finite)),results=analysis.groups.filter(g=>g.group.visible);
  const left=90,top=45,width=560,height=560,right=left+width,bottom=top+height;
  const rows=results.flatMap(g=>g.rows).filter(r=>Number.isFinite(r.lnRate)&&r.halfDelta!==undefined);
  const full=useMemo(()=>{
    if(mode==='fit'){const rr=analysis.groups.filter(g=>g.group.visible).flatMap(g=>g.rows).filter(r=>Number.isFinite(r.lnRate)&&r.halfDelta!==undefined),xr=range(rr.map(r=>r.lnRate),[2,5]),yr=range(rr.map(r=>r.halfDelta!),[0,.3]);return{x0:xr[0],x1:xr[1],y0:yr[0],y1:yr[1]};}
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const t of analysis.traces)if(t.visible)for(const p of t.points)if(finite(p)){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.j);y1=Math.max(y1,p.j);}
    const xr=range([x0,x1],[0,1]),yr=range([y0,y1],[-1,1]);return{x0:xr[0],x1:xr[1],y0:yr[0],y1:yr[1]};
  },[analysis,mode]);
  const bounds=mode==='cv'&&view?view:full,sx=(x:number)=>left+(x-bounds.x0)/(bounds.x1-bounds.x0)*width,sy=(y:number)=>top+(bounds.y1-y)/(bounds.y1-bounds.y0)*height;
  const xt=ticks(bounds.x0,bounds.x1),yt=ticks(bounds.y0,bounds.y1),selected=traces.find(t=>t.series.id===selectedSeriesId);
  const color=(trace:CvTrace,i:number)=>cvTraceColor(trace,i,selected?.groupId);
  function reset(){setView(null);setHover(null);}
  function zoom(factor:number){const b=view??full,mx=(b.x0+b.x1)/2,my=(b.y0+b.y1)/2;setView({x0:mx+(b.x0-mx)*factor,x1:mx+(b.x1-mx)*factor,y0:my+(b.y0-my)*factor,y1:my+(b.y1-my)*factor});setHover(null);}
  function nearest(event:React.PointerEvent|React.MouseEvent,forPick=false){
    const rect=svg.current?.getBoundingClientRect();if(!rect)return null;
    const px=(event.clientX-rect.left)*720/rect.width,py=(event.clientY-rect.top)*720/rect.height;
    if(px<left||px>right||py<top||py>bottom)return null;
    let best:{trace:CvTrace;point:CvTracePoint}|null=null,distance=forPick?Infinity:24**2;
    for(const trace of forPick?(selected?[selected]:[]):traces)for(const p of trace.points){
      if(!finite(p)||p.x<bounds.x0||p.x>bounds.x1||p.j<bounds.y0||p.j>bounds.y1)continue;
      if(forPick&&pickBranch&&p.direction!==(pickBranch==='anodic'?'up':'down'))continue;
      const d=(sx(p.x)-px)**2+(sy(p.j)-py)**2;if(d<distance){distance=d;best={trace,point:p};}
    }return best;
  }
  return <div className="cv-figure-host">
    {mode==='cv'&&<div className="cv-figure-tools"><span>{pickBranch?`点选${pickBranch==='anodic'?'氧化':'还原'}峰 · ${selected?.series.name??'请先选择文件'}`:hover?`${hover.trace.series.name} · E ${num(hover.point.rawE)} V · j ${num(hover.point.j)} mA cm⁻² · 原始行 ${hover.point.index+1}`:`${traces.length} 条 CV · 双击复位`}</span><div><button aria-label="缩小 CV 图" onClick={()=>zoom(1.4)} disabled={!traces.length}><Minus size={15}/></button><button aria-label="放大 CV 图" onClick={()=>zoom(1/1.4)} disabled={!traces.length}><Plus size={15}/></button><button aria-label="复位 CV 图" onClick={reset}><RotateCcw size={15}/></button></div></div>}
    <div ref={viewport} className="cv-svg-viewport"><svg ref={svg} data-cv-figure={mode} data-cv-selected-group={selected?.groupId??''} data-x-min={bounds.x0} data-x-max={bounds.x1} data-y-min={bounds.y0} data-y-max={bounds.y1} viewBox="0 0 720 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={mode==='fit'?'CV 峰间距与扫速对数拟合':'原始 CV 曲线与取峰位置'} style={{display:'block',width:size,height:size,maxWidth:'100%',maxHeight:'100%',touchAction:'none',cursor:pickBranch?'crosshair':'default'}}
      onPointerMove={e=>{if(mode==='cv')setHover(nearest(e));}} onPointerLeave={()=>setHover(null)} onDoubleClick={reset}
      onClick={e=>{if(mode!=='cv')return;const p=nearest(e,!!pickBranch);if(p){if(pickBranch)onPick?.(p.trace.series.id,pickBranch,p.point.rawE);else onSelectSeries?.(p.trace.series.id);}}}>
      <rect data-plot-background width="720" height="720" fill="white"/>
      <defs><clipPath id={clip}><rect x={left} y={top} width={width} height={height}/></clipPath></defs>
      <g fontFamily="Arial, Microsoft YaHei, sans-serif" fontSize="18" fill="#15202b">
        <rect data-cv-frame x={left} y={top} width={width} height={height} fill="none" stroke="#17212b" strokeWidth="1.7"/>
        {xt.major.map(v=><g key={v}><path d={`M${sx(v)},${bottom}v-8 M${sx(v)},${top}v8`} stroke="#17212b"/><text x={sx(v)} y={bottom+29} textAnchor="middle">{formatTick(v,xt.step)}</text></g>)}
        {yt.major.map(v=><g key={v}><path d={`M${left},${sy(v)}h8 M${right},${sy(v)}h-8`} stroke="#17212b"/><text x={left-13} y={sy(v)+6} textAnchor="end" fontSize="16">{formatTick(v,yt.step)}</text></g>)}
        <text data-cv-axis-title="x" x={left+width/2} y={bottom+65} textAnchor="middle" fontSize="22" fontWeight="bold">{mode==='fit'?'ln[v / (mV s⁻¹)]':'Recorded potential (V)'}</text>
        <text data-cv-axis-title="y" transform={`translate(25 ${top+height/2}) rotate(-90)`} textAnchor="middle" fontSize="22" fontWeight="bold">{mode==='fit'?'(Epa − Epc) / 2 (V)':'Current density (mA cm⁻²)'}</text>
        <g clipPath={`url(#${clip})`}>
          {mode==='cv'?traces.map((trace,i)=>{
            let start=true;const commands:string[]=[];
            // Preserve gap boundaries and endpoints when reducing display vertices.
            const stride=Math.max(1,Math.ceil(trace.points.length/16000));
            for(let j=0;j<trace.points.length;j++){const p=trace.points[j];if(!finite(p)){start=true;continue;}if(j%stride&&j!==trace.points.length-1&&finite(trace.points[j+1]??null))continue;commands.push(`${start?'M':'L'}${sx(p.x).toFixed(3)},${sy(p.j).toFixed(3)}`);start=false;}
            const paint=color(trace,i),opacity=(selected && selected.series.id !== trace.series.id) ? 0.65 : 1;
            return <g key={trace.series.id} opacity={opacity}><path data-cv-trace={trace.series.id} data-cv-source={trace.series.source} d={commands.join(' ')} fill="none" stroke={paint} strokeWidth={trace.series.id===selectedSeriesId?2.5:1.6}><title>{`${trace.groupName} · ${trace.series.name}\n${trace.series.rate} mV/s · 第${trace.selectedCycle}圈\n${trace.series.source}`}</title></path>{(['anodic','cathodic'] as const).map(branch=>{const p=trace[branch];return p?<circle key={branch} data-cv-peak={branch} data-cv-series={trace.series.id} data-cv-e={p.e} data-cv-index={p.index} cx={sx(p.e)} cy={sy(p.j)} r="6" fill={p.quality==='shoulder'?'white':paint} stroke={paint} strokeWidth="2"><title>{`${branch==='anodic'?'Epa':'Epc'} = ${p.e} V · 原始行 ${p.index+1} · ${p.manual?'手动':'自动'}${p.quality==='shoulder'?' · 肩部':''}`}</title></circle>:null;})}</g>;
          }):results.map(result=><g key={result.group.id}>{result.fit&&<path data-cv-fit={result.group.name} data-cv-n={result.fit.n} data-cv-slope={result.fit.slope} d={`M${sx(result.fit.min)},${sy(result.fit.slope*result.fit.min+result.fit.intercept)}L${sx(result.fit.max)},${sy(result.fit.slope*result.fit.max+result.fit.intercept)}`} fill="none" stroke={result.group.color} strokeWidth="2.5" strokeDasharray="8 5"/>}{result.rows.filter(r=>Number.isFinite(r.lnRate)&&r.halfDelta!==undefined).map(row=><circle data-cv-point={row.trace.series.id} data-cv-included={row.included} data-cv-used={row.usedForKs} key={row.trace.series.id} cx={sx(row.lnRate)} cy={sy(row.halfDelta!)} r="6" fill={row.included&&row.trace.anodic?.quality!=='shoulder'&&row.trace.cathodic?.quality!=='shoulder'?result.group.color:'white'} stroke={result.group.color} strokeWidth="2" opacity={row.included?1:.45} tabIndex={onToggle?0:undefined} role={onToggle?'button':undefined} aria-label={`${result.group.name} ${row.rate} mV/s ${row.included?'移出':'加入'}拟合`} style={{cursor:onToggle?'pointer':'default'}} onClick={e=>{e.stopPropagation();onToggle?.(row.trace.series.id);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onToggle?.(row.trace.series.id);}}}><title>{`${result.group.name} · ${row.rate} mV/s\nΔEp/2 = ${row.halfDelta} V\n${row.status}\n${row.trace.series.source}`}</title></circle>)}</g>)}
          {mode==='cv'&&hover&&<g data-plot-transient pointerEvents="none"><path d={`M${sx(hover.point.x)},${top}V${bottom} M${left},${sy(hover.point.j)}H${right}`} stroke="#66798e" strokeDasharray="3 4" opacity=".5"/><circle cx={sx(hover.point.x)} cy={sy(hover.point.j)} r="5" fill="white" stroke="#162b40" strokeWidth="2"/></g>}
        </g>
        {mode==='fit'?<>
          <g transform={`translate(${left+16} ${top+25})`}>{results.map((g,i)=><g key={g.group.id} transform={`translate(${Math.floor(i/8)*220} ${i%8*25})`}><line x2="24" stroke={g.group.color} strokeWidth="3"/><text x="33" y="6" fontSize="16"><title>{g.group.name}</title>{short(g.group.name,18)}</text></g>)}</g>
          {!rows.length&&<text x={left+width/2} y={top+height/2} textAnchor="middle" fill="#82909e" fontSize="18">{analysis.traces.length?'核对循环与峰位后显示拟合点':'导入各扫速 CV 后显示拟合'}</text>}
        </>:<>
          {!traces.length&&<text x={left+width/2} y={top+height/2} textAnchor="middle" fill="#82909e">{analysis.traces.length?'请核对文件的循环和单位':'导入文件后显示原始 CV'}</text>}
        </>}
      </g>
    </svg></div>
  </div>;
}
