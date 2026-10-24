import type {PlotCurve,PlotPoint} from './lsv-math';
import {scanSegments,type ScanMode} from './scan-branches';

export type TargetSettings={peakMin?:number;peakMax?:number;smoothPoints:number;prominence:number};
export type TargetReading={status:string;note:string;e?:number;x?:number;etaMV?:number;candidate?:boolean;peak?:number;valley?:number;firstCrossing?:number;crossings?:number[]};
type Sample={e:number;j:number;plot:PlotPoint|null;index:number};
type Crossing={e:number;x:number;index:number;plateau:boolean};

function crossings(points:Sample[],direction:'up'|'down'):Crossing[]{
  const result:Crossing[]=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    if(!a.plot||!b.plot||!Number.isFinite(a.j)||!Number.isFinite(b.j)||a.j===b.j)continue;
    const matches=direction==='up'?a.j<10&&b.j>=10:a.j>10&&b.j<=10;
    if(!matches)continue;
    const fraction=(10-a.j)/(b.j-a.j);
    const e=a.e+fraction*(b.e-a.e),x=a.plot.x+fraction*(b.plot.x-a.plot.x);
    if(!Number.isFinite(e)||!Number.isFinite(x))continue;
    const plateau=b.j===10&&points[i+2]?.j===10;
    result.push({e,x,index:i+fraction,plateau});
  }
  return result;
}

// Smoothing locates a peak/valley only. Target crossings use adjacent raw points.
function peakAndValley(points:Sample[],settings:TargetSettings,found:Crossing[]):{peak:number;valley:number}|undefined{
  if(points.length<3||points.some(p=>!p.plot||!Number.isFinite(p.j)))return;
  const half=Math.floor(settings.smoothPoints/2),prefix=[0];
  for(const p of points)prefix.push(prefix[prefix.length-1]+p.j);
  const smooth=points.map((_,i)=>{const lo=Math.max(0,i-half),hi=Math.min(points.length,i+half+1);return (prefix[hi]-prefix[lo])/(hi-lo);});
  const slope=smooth.slice(1).map((v,i)=>v-smooth[i]),maxima:number[]=[],minima:number[]=[];
  let magnitude=1;for(const value of smooth)magnitude=Math.max(magnitude,Math.abs(value));
  const epsilon=magnitude*Number.EPSILON*64;
  let previousSign=0,previousIndex=-1;
  for(let i=0;i<slope.length;i++){
    const sign=Math.abs(slope[i])<=epsilon?0:Math.sign(slope[i]);if(!sign)continue;
    const extremum=previousIndex+1;
    if(previousSign===1&&sign===-1&&(settings.peakMin===undefined||points[extremum].e>=settings.peakMin)&&(settings.peakMax===undefined||points[extremum].e<=settings.peakMax))maxima.push(extremum);
    if(previousSign===-1&&sign===1)minima.push(extremum);
    previousSign=sign;previousIndex=i;
  }
  let best:{peak:number;valley:number;prominence:number}|undefined;
  let beforeTarget:typeof best;
  let valleyCursor=0;
  for(const peak of maxima){
    while(valleyCursor<minima.length&&minima[valleyCursor]<=peak)valleyCursor++;
    const valley=minima[valleyCursor];if(valley===undefined)continue;
    const prominence=smooth[peak]-smooth[valley];if(prominence<settings.prominence)continue;
    const candidate={peak,valley,prominence};
    if(!best||prominence>best.prominence)best=candidate;
    // High-current OER fluctuations after the target must not replace the
    // earlier oxidation peak. Associate peak/valley candidates with an actual
    // subsequent upward Y=10 crossing, rather than gating on the valley value.
    if(found.some(c=>c.index>valley)&&(!beforeTarget||prominence>beforeTarget.prominence))beforeTarget=candidate;
  }
  return beforeTarget??best;
}

export function readTarget(curve:PlotCurve,scan:ScanMode,settings:TargetSettings):TargetReading{
  if(curve.error)return {status:'invalid_curve',note:curve.error};
  const windowSet=settings.peakMin!==undefined&&settings.peakMax!==undefined;
  if((settings.peakMin===undefined)!==(settings.peakMax===undefined)||(windowSet&&(!(settings.peakMin!<settings.peakMax!)||!Number.isFinite(settings.peakMin)||!Number.isFinite(settings.peakMax)))||!Number.isInteger(settings.smoothPoints)||settings.smoothPoints<1||settings.smoothPoints>101||settings.smoothPoints%2===0||!Number.isFinite(settings.prominence)||settings.prominence<0)return {status:'invalid_settings',note:'请检查氧化峰区间、奇数平滑点数和峰谷差阈值'};
  const direction=scan==='down'?'down':'up';
  const segments=scanSegments(curve.points).filter(s=>s.direction===direction);
  if(!segments.length)return {status:'no_scan',note:`没有${direction==='up'?'正向':'反向'}扫描段`};
  if(segments.length>1)return {status:'multiple_scans',note:`有 ${segments.length} 段${direction==='up'?'正扫':'反扫'}，请拆分周期后导入`};
  const lookup=new Map(curve.plotted.filter((p):p is PlotPoint=>p!==null).map(p=>[p.index,p]));
  // The requested target is on the displayed Y axis. Never recalculate a
  // second current-density series from unit/area metadata behind the chart.
  const segment=segments[0],points=curve.points.slice(segment.start,segment.end+1).map((p,i):Sample=>{const plot=lookup.get(segment.start+i)??null;return {e:p.e,j:plot?.y??NaN,plot,index:segment.start+i};});
  if(points.some(p=>!p.plot||!Number.isFinite(p.j)))return {status:'peak_detection_gap',note:`${direction==='up'?'正扫有无效点，无法确认峰后交点':'反扫有无效点，无法确认首次交点'}`};
  const found=crossings(points,direction);
  let chosen:Crossing|undefined,status:string,note:string,candidate=false,peak:number|undefined,valley:number|undefined;
  if(direction==='down'){
    chosen=found[0];status=chosen?'reverse_crossing':'no_target_crossing';note=chosen?'反扫首次向下经过目标电流':'反扫未经过 +10 mA·cm⁻²';
  }else{
    const extrema=peakAndValley(points,settings,found);
    if(extrema){
      peak=points[extrema.peak].e;valley=points[extrema.valley].e;
      const candidates=found.filter(c=>c.index>extrema.valley&&c.e>valley!);
      chosen=candidates[candidates.length-1];
      status=chosen?'forward_postpeak':'no_postpeak_target_crossing';
      note=chosen?'正扫峰后图中 Y=10 的上升交点':'峰后曲线未上升经过图中 Y=10 mA·cm⁻²';
      candidate=!windowSet;
    }else{
      chosen=found[found.length-1];status=chosen?'no_resolved_peak_assumed_oer':'no_target_crossing';note=chosen?'未识别出峰，采用最后一个上升交点（候选）':'未经过 +10 mA·cm⁻²';candidate=!!chosen;
    }
    if(chosen&&!windowSet)note+='；峰检索区间待核对';
  }
  const diagnostics={peak,valley,firstCrossing:found[0]?.e,crossings:found.map(c=>c.e)};
  if(!chosen)return {status,note,...diagnostics};
  if(chosen.plateau){note+='；目标平台取首次到达点';candidate=true;}
  // X already includes this curve's applied IR. Subtract the user-specified
  // 1.23 V once, then convert the overpotential to mV; keep the plotted X intact.
  const etaMV=(chosen.x-1.23)*1000;
  if(!Number.isFinite(etaMV))return {status:'invalid_conversion',note:'交点横坐标读值无效',...diagnostics};
  if(etaMV<0)note+='；过电位为负（交点横坐标低于 1.23 V），请核对 IR 和原始数据';
  return {status,note,e:chosen.e,x:chosen.x,etaMV,candidate,...diagnostics};
}
