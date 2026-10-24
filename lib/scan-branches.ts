import type { Point, PlotCurve } from "./lsv-math";
export type ScanMode = "all" | "up" | "down";
export type ScanSegment = { direction: "up" | "down"; start: number; end: number };

// Determine direction from the original potential, before iR correction.
// A quarter of the median step suppresses small potential jitter; this is
// a scan-direction heuristic, not identification of a physical redox peak.
export function scanSegments(points: Point[]): ScanSegment[] {
  if (points.length < 2) return [];
  const values = points.map(p => p.e);
  let min=Infinity,max=-Infinity;
  for (const e of values) { min=Math.min(min,e); max=Math.max(max,e); }
  const epsilon = Math.max(1,Math.abs(min),Math.abs(max))*Number.EPSILON*32;
  const steps=values.slice(1).map((e,i)=>Math.abs(e-values[i])).filter(d=>d>epsilon).sort((a,b)=>a-b);
  if (!steps.length) return [];
  const middle=Math.floor(steps.length/2), step=steps.length%2?steps[middle]:(steps[middle-1]+steps[middle])/2;
  const threshold=Math.max(epsilon*4,step*.25), segments:ScanSegment[]=[];
  let direction:"up"|"down"|null=null,start=0,extreme=0;
  for(let i=1;i<values.length;i++) {
    if (!direction) { if(Math.abs(values[i]-values[0])>threshold) { direction=values[i]>values[0]?"up":"down";extreme=i; } continue; }
    const forward=direction==="up"?values[i]>=values[extreme]-epsilon:values[i]<=values[extreme]+epsilon;
    if(forward) { extreme=i; continue; }
    if(Math.abs(values[i]-values[extreme])>threshold) {
      if(extreme>start)segments.push({direction,start,end:extreme});
      start=extreme;direction=direction==="up"?"down":"up";extreme=i;
    }
  }
  if(direction&&values.length-1>start)segments.push({direction,start,end:values.length-1});
  return segments;
}

export function selectScan(curves: PlotCurve[], mode: ScanMode): { curves: PlotCurve[]; missing: string[] } {
  if(mode==="all")return {curves,missing:[]};
  const missing:string[]=[];
  return {missing,curves:curves.map(curve=>{
    if(curve.error)return curve;
    const segments=scanSegments(curve.points).filter(s=>s.direction===mode);
    if(!segments.length) { if(curve.visible)missing.push(curve.name);return {...curve,plotted:[]}; }
    const plotted:PlotCurve["plotted"]=[];
    segments.forEach((s,n)=>{if(n)plotted.push(null);plotted.push(...curve.plotted.slice(s.start,s.end+1));});
    return {...curve,plotted};
  })};
}
