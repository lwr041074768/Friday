import { ramanLines, RAMAN_LIMIT, type RamanCurve, type RamanYAxis } from "./raman-data";
import type { XyOriginPayload } from "./xy-origin-export";

export type RamanOriginOptions = {
  curves: RamanCurve[]; mode: "stack" | "contour"; normalize: boolean; offset: number;
  axis: RamanYAxis; xLabel: string; intensityLabel: string; xMin: string; xMax: string;
};
export type RamanOriginPayload = Omit<XyOriginPayload, "kind"> & { kind: "raman" };
const MISSING=-1.23456789e-300;
function text(value:string,label:string,maximum:number,empty=false) {
  if(typeof value!=="string"||value.length>maximum||value.includes("\0")||!empty&&!value.trim())throw Error(`${label}格式无效或超过 ${maximum} 个字符。`);
  return value;
}
function numeric(value:number):number|null {
  if(value===MISSING)throw Error("数据包含 Origin 保留的缺失值数字，请核对后再导出。");
  return Number.isFinite(value)?value:null;
}
/** Original rows and applied spectral intensity; viewport/grid interpolation never replaces source data. */
export function buildRamanOriginExport(options:RamanOriginOptions,requestId=crypto.randomUUID()):RamanOriginPayload {
  const {curves,mode,normalize,offset,axis,xLabel,intensityLabel,xMin,xMax}=options;
  if(!curves.length||curves.length>RAMAN_LIMIT)throw Error(`请导入 1–${RAMAN_LIMIT} 条 Raman 光谱。`);
  if(new Set(curves.map(c=>c.group)).size!==1)throw Error("每次导出当前一个数据组。");
  if(!["stack","contour"].includes(mode)||typeof normalize!=="boolean"||!["sequence","potential"].includes(axis))throw Error("Raman 导出设置无效。");
  if(!Number.isFinite(offset)||offset<0)throw Error("堆叠间距需为大于或等于 0 的数值。");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))throw Error("导出请求 ID 无效。");
  text(xLabel,"位移标题",256);text(intensityLabel,"强度标题",256);text(xMin,"位移下限",64,true);text(xMax,"位移上限",64,true);
  const lines=ramanLines(curves,normalize,mode==="stack",offset);
  let total=0;
  const samples=curves.map((curve,index)=>{
    text(curve.name,"光谱名称",256);text(curve.source,"源文件",2048,true);text(curve.group,"数据组",1024);
    text(curve.xColumn,"位移列",256);text(curve.yColumn,"强度列",256);text(curve.potential,"电位",64,true);
    if(curve.potential.trim()&&!Number.isFinite(Number(curve.potential)))throw Error(`${curve.name} 电位无效，未知时请留空。`);
    if(typeof curve.visible!=="boolean"||curve.points.length<2)throw Error("光谱显示状态或点数无效。");
    total+=curve.points.length;if(total>500000)throw Error("一次最多向 Origin 导出 500,000 个原始点，请分组导出。");
    const rows=curve.points.map((p,n)=>{
      const rawX=numeric(p.e),rawY=numeric(p.current),plot=lines[index].plotted[n];
      return [rawX,rawY,plot?numeric(plot.x):null,plot?numeric(plot.y):null];
    });
    const note=[`数据组: ${curve.group}`,`原始位移列: ${curve.xColumn}`,`所选强度列: ${curve.yColumn}`,
      `电位建议 / V: ${curve.potential||"未知"}；参比未核实，未换算为 RHE。`,
      "保留全部原始行、缺口、隐藏光谱与点序，不按视窗裁剪或抽稀。",
      mode==="stack"?"绘图强度含当前归一化和堆叠平移；原始强度单独保留。":"当前为等高线模式：导出各条光谱的完整位移与处理后强度，不以显示网格插值替代实测数据；电位和分组见备注。",
      `测量元数据: ${JSON.stringify(curve.metadata??{})}`].join("\r\n");
    text(note,"测量备注",16384,true);
    return {name:curve.name,source:curve.source,visible:curve.visible,demo:!!curve.demo,imaginary:null,rows,note};
  });
  return {schema:"xy-origin/v1",kind:"raman",requestId:requestId.toLowerCase(),createdAt:new Date().toISOString(),
    axes:{x:xLabel,y:intensityLabel},plot:{style:"line",equalUnits:false},
    settings:{mode,normalize,stack:mode==="stack",offset:mode==="stack"?offset:0,verticalAxis:axis,viewXMin:xMin,viewXMax:xMax,exportAllSourceRows:true,reference:"unverified"},
    columns:[{key:"rawX",label:"原始 Raman Shift",unit:"cm^-1",role:"x"},{key:"rawY",label:"所选列原始强度",unit:"a.u.",role:"y"},
      {key:"plotX",label:xLabel,unit:"cm^-1",role:"x"},{key:"plotY",label:intensityLabel,unit:"a.u.",role:"y"}],samples};
}
