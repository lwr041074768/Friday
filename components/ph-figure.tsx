import {useId} from 'react';
import {axisTicks,formatTick} from '@/lib/plot-ticks';
import {phLogLabel,phFitEquation,type PhAnalysis,type PhSettings} from '@/lib/ph-data';

type Props={analysis:PhAnalysis;settings:PhSettings;onToggle:(id:string)=>void;showAll:boolean};
const SIZE=1000,LEFT=85,TOP=40,SIDE=540,RESULTS_X=660,RESULTS_WIDTH=315;
function extent(values:number[],fallback:[number,number]):[number,number]{
  const finite=values.filter(Number.isFinite);if(!finite.length)return fallback;
  const min=Math.min(...finite),max=Math.max(...finite),pad=(max-min)*.08||Math.max(Math.abs(min)*.1,.1);
  return [min-pad,max+pad];
}
function ticks(range:[number,number]){try{return axisTicks(range[0],range[1],{anchor:0,minorCount:1});}catch{return{major:range,minor:[],step:range[1]-range[0]};}}
export default function PhFigure({analysis,settings,onToggle,showAll}:Props){
  const clip=useId().replaceAll(':',''),results=analysis.groups.filter(g=>g.group.visible),fits=results.filter(g=>g.fit);
  const points=results.flatMap(g=>g.points).filter(p=>p.logJ!==undefined);
  const side=SIDE,right=LEFT+side,bottom=TOP+side;
  const resultHeight=Math.min(126,900/Math.max(fits.length,1)),resultTop=Math.max(TOP,TOP+side/2-fits.length*resultHeight/2);
  const resultLine=resultHeight<85?14:resultHeight<100?17:resultHeight<120?19:24;
  const resultFont=resultHeight<85?13:resultHeight<100?14:resultHeight<120?16:18;
  const xr=extent(points.map(p=>p.ph),[9.5,14.5]);
  const fitEnds=results.flatMap(g=>[g.fit,...(showAll?[g.allFit]:[])].flatMap(f=>f?[f.slope*f.min+f.intercept,f.slope*f.max+f.intercept]:[]));
  const yr=extent([...points.map(p=>p.logJ!),...fitEnds],[0,5]);
  const x=(v:number)=>LEFT+(v-xr[0])/(xr[1]-xr[0])*side,y=(v:number)=>TOP+(yr[1]-v)/(yr[1]-yr[0])*side,xt=ticks(xr),yt=ticks(yr);
  return <svg data-ph-figure="fit" data-ph-canvas="square" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="pH 依赖性散点与线性拟合">
    <rect data-plot-background width={SIZE} height={SIZE} fill="white"/>
    <defs><clipPath id={clip}><rect x={LEFT} y={TOP} width={side} height={side}/></clipPath></defs>
    <g fontFamily="Arial, Microsoft YaHei, sans-serif" fill="#111" fontSize="16">
      <rect data-ph-frame x={LEFT} y={TOP} width={side} height={side} fill="none" stroke="#111" strokeWidth="1.7"/>
      {xt.major.map(v=><g key={v}><path d={`M${x(v)},${bottom}v-8 M${x(v)},${TOP}v8`} stroke="#111"/><text x={x(v)} y={bottom+27} textAnchor="middle">{formatTick(v,xt.step)}</text></g>)}
      {yt.major.map(v=><g key={v}><path d={`M${LEFT},${y(v)}h8 M${right},${y(v)}h-8`} stroke="#111"/><text x={LEFT-14} y={y(v)+5} textAnchor="end">{formatTick(v,yt.step)}</text></g>)}
      <text x={LEFT+side/2} y={bottom+60} textAnchor="middle" fontWeight="bold" fontSize="21">pH</text>
      <text transform={`translate(28 ${TOP+side/2}) rotate(-90)`} textAnchor="middle" fontWeight="bold" fontSize="21">{phLogLabel(settings)}</text>
      <g clipPath={`url(#${clip})`}>{results.map(result=>{
        const fit=result.fit,all=result.allFit,different=result.points.some(p=>!p.included);
        return <g key={result.group.id}>
          {showAll&&different&&all&&<path d={`M${x(all.min)},${y(all.slope*all.min+all.intercept)}L${x(all.max)},${y(all.slope*all.max+all.intercept)}`} stroke={result.group.color} strokeDasharray="8 6" strokeWidth="1.7" opacity=".4"/>}
          {fit&&<path data-ph-fit={result.group.name} data-ph-slope={fit.slope} data-ph-r2={fit.r2??''} data-ph-n={fit.n} d={`M${x(fit.min)},${y(fit.slope*fit.min+fit.intercept)}L${x(fit.max)},${y(fit.slope*fit.max+fit.intercept)}`} stroke={result.group.color} strokeWidth="2.7"><title>{`${result.group.name}：k=${fit.slope}，b=${fit.intercept}，R²=${fit.r2??'未定义'}，n=${fit.n}`}</title></path>}
          {result.points.filter(p=>p.logJ!==undefined).map(p=><circle key={p.trace.series.id} cx={x(p.ph)} cy={y(p.logJ!)} r="6.2" stroke={result.group.color} strokeWidth="2" fill={p.included?result.group.color:'white'} style={{cursor:'pointer'}} role="button" tabIndex={0} aria-label={`${result.group.name} pH ${p.ph} ${p.included?'排除':'纳入'}拟合`} onClick={()=>onToggle(p.trace.series.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onToggle(p.trace.series.id);}}}><title>{`${result.group.name} · pH ${p.ph}\nj = ${p.j}\nlog₁₀ j = ${p.logJ}\n${p.included?'已纳入':'已排除'}；点击切换\n${p.trace.series.source}`}</title></circle>)}
        </g>;
      })}</g>
      <g transform={`translate(${LEFT+17},${TOP+25})`}>{results.map((entry,i)=><g key={entry.group.id} transform={`translate(${Math.floor(i/6)*245},${i%6*25})`}><title>{entry.group.name}</title><line x2="25" stroke={entry.group.color} strokeWidth="2.7"/><text x="35" y="5" fontSize="14" textLength={entry.group.name.length>16?180:undefined} lengthAdjust="spacingAndGlyphs">{entry.group.name.length>24?entry.group.name.slice(0,23)+'…':entry.group.name}</text></g>)}</g>
      {!points.length&&<text x={LEFT+side/2} y={TOP+side/2} fill="#82909e" textAnchor="middle">{analysis.groups.some(g=>g.group.series.length)?'请确认共同电位及文件条件':'导入文件后自动取点拟合'}</text>}
      {fits.map((result,i)=>{
        const fit=result.fit!,value=(n:number|null)=>n===null?'—':Number(n.toPrecision(6)).toString();
        const name=result.group.name.length>22?result.group.name.slice(0,21)+'…':result.group.name,equation=phFitEquation(fit);
        const lines=[equation,`斜率 k = ${value(fit.slope)}`,`截距 b = ${value(fit.intercept)}`,`R² = ${value(fit.r2)} · n = ${fit.n}`];
        return <g key={result.group.id} data-ph-result={result.group.name} transform={`translate(${RESULTS_X},${resultTop+i*resultHeight})`}>
          <title>{`${result.group.name}：${equation}`}</title>
          <text y="12" fontSize={resultFont+1} fill={result.group.color} fontWeight="bold" textLength={name.length*(resultFont+1)>.85*RESULTS_WIDTH?RESULTS_WIDTH:undefined} lengthAdjust="spacingAndGlyphs">{name}</text>
          {lines.map((line,j)=><text key={j} y={12+(j+1)*resultLine} fontSize={resultFont} fill={j===0?result.group.color:'#42566b'} textLength={line.length*resultFont*.58>RESULTS_WIDTH?RESULTS_WIDTH:undefined} lengthAdjust="spacingAndGlyphs">{line}</text>)}
        </g>;
      })}
    </g>
  </svg>;
}
