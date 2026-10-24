import type { DataTable, ColumnPair } from "./lsv-import";
import type { Curve, PlotCurve } from "./lsv-math";

export type RamanCurve = Curve & { group: string; potential: string; xColumn: string; yColumn: string; metadata?: Record<string, unknown> };
export const RAMAN_LIMIT = 80;
export type RamanYAxis = "sequence" | "potential";
export type RamanRange = { min?: number; max?: number };

export function ramanIdentity(name: string, source: string) {
  const parts=source.replace(/\\/g,"/").split("/");parts.pop();
  const stem=name.replace(/\.(?:txt|csv|tsv|dat|xlsx)$/i, "");
  const match=/(?:^|[-_ ])(0[1-6](?:5)?|[+-]?\d+\.\d+)\s*(?:V)?(?:[-_ ]\d+)?$/i.exec(stem);
  let potential="";
  if(match)potential=String(match[1].includes(".")?Number(match[1]):Number(match[1])/10**(match[1].length-1));
  const prefix=match?stem.slice(0,match.index):stem.replace(/[-_ ](?:dry|wet|ocp)(?:[-_ ].*)?$/i,"");
  return {group:parts.length?parts.join("/"):prefix||"未分组",potential};
}

export function makeRamanCurve(table:DataTable,pair:ColumnPair,group:string,potential:string,color:string):RamanCurve {
  if(pair.e===pair.current)throw new Error("Raman 位移列和强度列不能相同。");
  const xColumn=table.headers[pair.e],yColumn=table.headers[pair.current];
  if(/pixel|像素|wavelength|波长|\bnm\b|\b(?:eV|THz|GHz|Hz)\b/i.test(xColumn))throw new Error("横轴请选择 Raman Shift（cm⁻¹），不能使用像素、波长或频率。");
  if(/(?:^|[/(\s\[])m\s*(?:\^?-1|⁻¹)/.test(xColumn))throw new Error("横轴单位为 m⁻¹，请先换算为 cm⁻¹。");
  if(/^dark$|^pixel$|raman\s*shift/i.test(yColumn))throw new Error("强度列不能选择暗背景、像素或位移列。");
  // Preserve gaps as NaN so the line renderer and contour interpolation break there.
  const points=table.rows.map(row=>({e:row[pair.e]??NaN,current:row[pair.current]??NaN}));
  if(points.filter(p=>Number.isFinite(p.e)&&Number.isFinite(p.current)).length<2)throw new Error(`${pair.name} 不足两个有效点。`);
  if(!pair.name.trim()||!group.trim())throw new Error("请填写曲线名称和数据组。");
  if(potential.trim()&&!Number.isFinite(Number(potential)))throw new Error("电位须为数值，未知时请留空。");
  return {id:crypto.randomUUID(),name:pair.name.trim(),group:group.trim(),potential:potential.trim(),xColumn,yColumn,metadata:table.metadata,
    points,color,visible:true,source:table.source,unit:"A",resistance:"",area:"",compensation:"unknown"};
}

export function ramanLines(curves:RamanCurve[],normalize:boolean,stack:boolean,offset:number):PlotCurve[] {
  let n=0;
  return curves.map(curve=>{
    const magnitude=curve.points.reduce((m,p)=>Number.isFinite(p.current)?Math.max(m,Math.abs(p.current)):m,0);
    const shift=stack&&curve.visible?n*offset:0;if(curve.visible)n++;
    return {...curve,invalid:0,plotted:curve.points.map((p,index)=>Number.isFinite(p.e)&&Number.isFinite(p.current)?{x:p.e,y:(normalize&&magnitude?p.current/magnitude:p.current)+shift,e:p.e,current:p.current,index}:null)};
  });
}

export type RamanGrid = {x:number[]; y:number[]; values:number[][]; names:string[]; min:number; max:number; error?:string; note?:string};
export function ramanGrid(curves:RamanCurve[],normalize:boolean,axis:RamanYAxis,range:RamanRange={}):RamanGrid {
  const empty=(error:string):RamanGrid=>({x:[],y:[],values:[],names:[],min:0,max:1,error});
  let selected=curves.filter(c=>c.visible);
  if(selected.length<2)return empty("等高线图至少需要同一数据组的两条可见光谱。");
  if(new Set(selected.map(c=>c.group)).size>1)return empty("等高线图每次显示一个数据组，请先选择数据组。");
  let skipped=0;
  if(axis==="potential") {
    skipped=selected.filter(c=>!c.potential.trim()).length;
    selected=selected.filter(c=>c.potential.trim());
    if(selected.length<2)return empty("至少两条光谱需要填写电位；dry、wet 等未知电位不会自动赋值。");
    if(selected.some(c=>!Number.isFinite(Number(c.potential))))return empty("有无效电位，请核对曲线管理中的数值。");
    if(new Set(selected.map(c=>Number(c.potential))).size!==selected.length)return empty("存在相同电位的重复测量，请隐藏其中一条或使用光谱序号轴。");
    selected=[...selected].sort((a,b)=>Number(a.potential)-Number(b.potential));
  }
  const spectra=selected.map(c=>{
    const finite=c.points.map((p,index)=>({...p,index})).filter(p=>Number.isFinite(p.e));
    const ascending=finite.every((p,i)=>i===0||p.e>finite[i-1].e),descending=finite.every((p,i)=>i===0||p.e<finite[i-1].e);
    const magnitude=c.points.reduce((m,p)=>Number.isFinite(p.current)?Math.max(m,Math.abs(p.current)):m,0);
    return {valid:ascending||descending,points:descending?[...finite].reverse():finite,scale:normalize&&magnitude?magnitude:1};
  });
  if(spectra.some(s=>!s.valid))return empty("等高线图要求每条光谱的 Raman Shift 严格递增或递减；请检查重复值或扫描回程。");
  if(spectra.some(s=>s.points.length<2))return empty("光谱没有足够的有效位移点。");
  const x0=Math.max(...spectra.map(s=>s.points[0].e),range.min??-Infinity),x1=Math.min(...spectra.map(s=>s.points.at(-1)!.e),range.max??Infinity);
  if(!Number.isFinite(x0)||!Number.isFinite(x1)||x1<=x0)return empty("所选光谱与横轴范围没有共同的位移区间。");
  // The display grid is interpolated; exports retain every source row separately.
  const columns=Math.min(650,Math.max(...selected.map(c=>c.points.length)));
  const x=Array.from({length:columns},(_,i)=>x0+(x1-x0)*i/(columns-1));
  const values=spectra.map(s=>{
    let j=0;
    const row=x.map(position=>{
      while(j<s.points.length-2&&s.points[j+1].e<position)j++;
      const a=s.points[j],b=s.points[j+1];
      if(position===a.e)return a.current/s.scale;if(position===b.e)return b.current/s.scale;
      return Math.abs(a.index-b.index)===1&&Number.isFinite(a.current)&&Number.isFinite(b.current)?(a.current+(b.current-a.current)*(position-a.e)/(b.e-a.e))/s.scale:NaN;
    });
    // Preserve narrow missing intervals even when the display grid is coarser
    // than the source. One missing display sample also breaks adjoining cells.
    for(let i=0;i<s.points.length;i++) {
      const p=s.points[i],next=s.points[i+1];
      if(!Number.isFinite(p.current)||next&&Math.abs(p.index-next.index)>1) {
        const missingX=Number.isFinite(p.current)&&next?(p.e+next.e)/2:p.e;
        if(missingX>=x0&&missingX<=x1)row[Math.max(0,Math.min(columns-1,Math.round((missingX-x0)/(x1-x0)*(columns-1))))]=NaN;
      }
    }
    return row;
  });
  let min=Infinity,max=-Infinity;for(const row of values)for(const z of row)if(Number.isFinite(z)){min=Math.min(min,z);max=Math.max(max,z);}
  if(!Number.isFinite(min))return empty("当前区间没有有效强度。");
  return {x,y:selected.map((c,i)=>axis==="potential"?Number(c.potential):i+1),values,names:selected.map(c=>c.name),min,max,
    note:`仅在光谱共同位移区间内做线性插值；颜色表示${normalize?"各谱归一化后的":"所选列的"}强度。${skipped?`已排除 ${skipped} 条未知电位光谱。`:""}`};
}

type Vertex={x:number;y:number;z:number};
function clipAt(poly:Vertex[],level:number,above:boolean):Vertex[] {
  const result:Vertex[]=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],insideA=above?a.z>=level:a.z<=level,insideB=above?b.z>=level:b.z<=level;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=(level-a.z)/(b.z-a.z);result.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),z:level});}
  }
  return result;
}
// Piecewise-linear filled contours on triangles, using physical Y coordinates.
export function ramanContourPaths(grid:RamanGrid,bands:number) {
  const paths=Array.from({length:bands},()=>"");if(grid.error||grid.x.length<2||grid.y.length<2)return paths;
  const min=grid.min,max=grid.max===min?min+1:grid.max,step=(max-min)/bands;
  const x0=grid.x[0],dx=grid.x.at(-1)!-x0,y0=grid.y[0],dy=grid.y.at(-1)!-y0;
  for(let r=0;r<grid.y.length-1;r++)for(let c=0;c<grid.x.length-1;c++){
    const a={x:grid.x[c],y:grid.y[r],z:grid.values[r][c]},b={x:grid.x[c+1],y:grid.y[r],z:grid.values[r][c+1]},d={x:grid.x[c],y:grid.y[r+1],z:grid.values[r+1][c]},e={x:grid.x[c+1],y:grid.y[r+1],z:grid.values[r+1][c+1]};
    for(const triangle of [[a,b,e],[a,e,d]]){
      if(triangle.some(v=>!Number.isFinite(v.z)))continue;
      const lo=Math.max(0,Math.min(bands-1,Math.floor((Math.min(...triangle.map(v=>v.z))-min)/step))),hi=Math.min(bands-1,Math.floor((Math.max(...triangle.map(v=>v.z))-min)/step));
      for(let band=lo;band<=hi;band++){
        const poly=clipAt(clipAt(triangle,min+band*step,true),min+(band+1)*step,false);
        if(poly.length<3)continue;
        paths[band]+="M"+poly.map(v=>`${((v.x-x0)/dx*1000).toFixed(2)},${(1000-(v.y-y0)/dy*1000).toFixed(2)}`).join("L")+"Z";
      }
    }
  }
  return paths;
}

export function ramanCsv(curves:RamanCurve[],normalize:boolean,stack:boolean,offset:number) {
  const cell=(v:unknown)=>{const s=String(v??"");return '"'+(/^[\s\uFEFF]*[=+\-@]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';};
  const lines=ramanLines(curves,normalize,stack,offset);
  const rows=["数据组,曲线名称,源文件,位移列,强度列,电位数值_V_参比待核对,可见,原始点序,Raman_shift_cm-1,所选列原始强度,绘图强度,测量元数据"];
  curves.forEach((c,n)=>c.points.forEach((p,i)=>{
    const plot=lines[n].plotted[i];
    rows.push([cell(c.group),cell(c.name),cell(c.source),cell(c.xColumn),cell(c.yColumn),c.potential.trim()?Number(c.potential):"",c.visible?1:0,i+1,Number.isFinite(p.e)?p.e:"",Number.isFinite(p.current)?p.current:"",plot?.y??"",cell(JSON.stringify(c.metadata??{}))].join(","));
  }));
  return "\uFEFF"+rows.join("\r\n");
}
