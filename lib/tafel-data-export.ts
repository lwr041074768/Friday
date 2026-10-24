import type { PlotCurve } from "./lsv-math";
import { selectScan, type ScanMode } from "./scan-branches";
import type { TafelFitResult } from "./tafel-analysis";
import { tafelDerivedMetrics, TAFEL_DERIVED_NOTE } from "./tafel-derived";

export type TafelExportAnalysis = {
  masks: Record<string, readonly number[]>;
  fit: TafelFitResult | null;
  globalResistance?: string;
};

type CsvValue = string | number;
function cell(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = String(value ?? "");
  return '"' + (/^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
}
function csv(rows: CsvValue[][]) {
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function buildTafelCsv(curves:PlotCurve[],scan:ScanMode,formulas:{x:string;y:string},axes:{x:string;y:string},analysis?:TafelExportAnalysis) {
  if(!curves.length)throw Error("请先导入 Tafel 数据。");
  if(curves.length>20||curves.reduce((n,c)=>n+c.points.length,0)>500000)throw Error("一次最多导出 20 条曲线、500,000 个原始点。");
  const selected=selectScan(curves,scan).curves;
  const rows:CsvValue[][]=[['样品','源文件','原始点序','原始电位_V','导入电流','导入电流单位',axes.x,axes.y,'在所选扫描段内','可见','扫描选择','X公式','Y公式','样品Rs_ohm','面积_cm2','补偿状态',
    '屏蔽','参与拟合','拟合样品','拟合扫描选择','拟合X范围下限','拟合X范围上限','拟合点数_n','截距_a_V','截距标准误差_V','斜率_b_V_per_dec','斜率标准误差_V_per_dec','Tafel斜率_mV_per_dec','Tafel斜率标准误差_mV_per_dec','残差平方和_SSE_V2','Pearson_r','R平方_COD','调整后R平方','全局Rs_ohm','有效Rs_ohm',
    '斜率置信水平','斜率置信区间自由度','斜率置信区间下限_mV_per_dec','斜率置信区间上限_mV_per_dec','交换电流量','交换电流数值','交换电流单位','log10交换电流_按所列单位','交换电流状态','派生结果说明']];
  curves.forEach(curve=>{
    const included=new Set(selected.find(c=>c.id===curve.id)?.plotted.filter(p=>p!==null).map(p=>p!.index)??[]);
    const masked=new Set(analysis?.masks[curve.id]??[]);
    const fit=analysis?.fit?.curveId===curve.id?analysis.fit:null;
    const fitIndices=new Set(fit?.indices??[]);
    const derived=fit?tafelDerivedMetrics(fit):null;
    const derivedContext:CsvValue[]=derived?[derived.slopeCI.level,derived.slopeCI.dof??"",derived.slopeCI.low??"",derived.slopeCI.high??"",derived.exchange.symbol,derived.exchange.value??"",derived.exchange.unit,derived.exchange.log10??"",derived.exchange.status,TAFEL_DERIVED_NOTE]:Array(10).fill("");
    const fitContext:CsvValue[]=fit?[fit.curveName,fit.scan,fit.range.min,fit.range.max,fit.n,fit.intercept,fit.interceptSE,fit.slope,fit.slopeSE,fit.slopeMvPerDec,fit.slopeSEmvPerDec,fit.sse,fit.pearsonR??"",fit.rSquared??"",fit.adjustedRSquared??""]:Array(15).fill("");
    curve.points.forEach((p,i)=>{const plotted=curve.error?null:curve.plotted[i];rows.push([curve.name,curve.source,i+1,p.e,p.current,curve.unit,plotted?.x??"",plotted?.y??"",included.has(i)?1:0,curve.visible?1:0,scan,formulas.x,formulas.y,curve.resistance,curve.area,curve.compensation,
      masked.has(i)?1:0,fitIndices.has(i)&&!masked.has(i)?1:0,...fitContext,analysis?.globalResistance??"",curve.resistance.trim()||analysis?.globalResistance||"",...derivedContext]);});
  });
  return csv(rows);
}

/** Export one fit with the exact original rows used, without silently dropping gaps. */
export function buildTafelFitCsv(fit: TafelFitResult, curve: PlotCurve, context?: { globalResistance: string }): string {
  if (fit.curveId !== curve.id) throw Error("拟合结果与当前样品不一致，请重新拟合。");
  if (!Number.isInteger(fit.n) || fit.n < 3 || fit.indices.length !== fit.n || new Set(fit.indices).size !== fit.n) {
    throw Error("拟合点序或点数不完整，请重新拟合。");
  }
  const stats = [fit.range.min, fit.range.max, fit.xMin, fit.xMax, fit.intercept, fit.slope,
    fit.interceptSE, fit.slopeSE, fit.sse, fit.residualSD, fit.slopeMvPerDec, fit.slopeSEmvPerDec];
  const correlations = [fit.pearsonR, fit.rSquared, fit.adjustedRSquared];
  if (!stats.every(Number.isFinite) || correlations.some(value => value !== null && !Number.isFinite(value))) {
    throw Error("拟合统计值无效或超出数值范围，请重新拟合。");
  }
  const byIndex = new Map<number, NonNullable<PlotCurve["plotted"][number]>>();
  for (const point of curve.plotted) {
    if (!point) continue;
    const previous = byIndex.get(point.index);
    if (previous && (previous.x !== point.x || previous.y !== point.y)) {
      throw Error("同一原始点存在不同坐标，请重新拟合后导出。");
    }
    byIndex.set(point.index, point);
  }
  const points = fit.indices.map(index => {
    const point = byIndex.get(index);
    if (!Number.isInteger(index) || index < 0 || index >= curve.points.length || !point
      || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw Error(`原始点 ${index + 1} 的拟合坐标缺失或无效，请重新拟合后导出。`);
    }
    return point;
  });

  // The same shifted centering as the fit avoids cancellation when a large X
  // offset and a large intercept nearly cancel. Residuals keep their true sign.
  const originX = points[0].x, originY = points[0].y;
  let sumX = 0, correctionX = 0, sumY = 0, correctionY = 0;
  for (const point of points) {
    const dx = point.x - originX, dy = point.y - originY;
    const nextX = sumX + dx, nextY = sumY + dy;
    correctionX += Math.abs(sumX) >= Math.abs(dx) ? (sumX - nextX) + dx : (dx - nextX) + sumX;
    correctionY += Math.abs(sumY) >= Math.abs(dy) ? (sumY - nextY) + dy : (dy - nextY) + sumY;
    sumX = nextX; sumY = nextY;
  }
  const meanDX = (sumX + correctionX) / fit.n, meanDY = (sumY + correctionY) / fit.n;
  if (![meanDX, meanDY].every(Number.isFinite)) throw Error("拟合数据超出数值范围，无法导出。");
  const pointRows = points.map(point => {
    const residual = ((point.y - originY) - meanDY) - fit.slope * ((point.x - originX) - meanDX);
    const prediction = point.y - residual;
    if (![residual, prediction].every(Number.isFinite)) throw Error("拟合数据超出数值范围，无法导出。");
    return [point.index + 1, point.x, point.y, prediction, residual];
  });
  const rows: CsvValue[][] = [
    ["指标", "数值", "标准误差", "单位"],
    ["方程", "y = a + b*x", "", ""],
    ["样品", fit.curveName, "", ""],
    ["源文件", curve.source, "", ""],
    ["原始电流单位", curve.unit, "", ""],
    ["电极面积", curve.area, "", "cm²"],
    ["原始补偿状态", curve.compensation, "", ""],
    ["全局Rs", context?.globalResistance??"", "", "Ω"],
    ["有效Rs", curve.resistance.trim()||context?.globalResistance||"", "", "Ω"],
    ["扫描选择", fit.scan, "", ""],
    ["横轴计算", fit.basis === "density" ? "电流密度" : "总电流", "", ""],
    ["横轴单位定义", tafelDerivedMetrics(fit).exchange.xLabel, "", ""],
    ["权重", "不加权", "", ""],
    ["拟合X范围下限", fit.range.min, "", "dec"],
    ["拟合X范围上限", fit.range.max, "", "dec"],
    ["实际X最小值", fit.xMin, "", "dec"],
    ["实际X最大值", fit.xMax, "", "dec"],
    ["有效点数 n", fit.n, "", ""],
    ["截距 a", fit.intercept, fit.interceptSE, "V"],
    ["斜率 b", fit.slope, fit.slopeSE, "V/dec"],
    ["Tafel斜率", fit.slopeMvPerDec, fit.slopeSEmvPerDec, "mV/dec"],
    ...derivedReportRows(fit),
    ["残差平方和 SSE", fit.sse, "", "V²"],
    ["Pearson r", fit.pearsonR ?? "不可用", "", ""],
    ["R平方(COD)", fit.rSquared ?? "不可用", "", ""],
    ["调整后R平方", fit.adjustedRSquared ?? "不可用", "", ""],
    ["残差标准差", fit.residualSD, "", "V"],
    ["参数误差说明", "标准误差（1 SE）", "", ""],
    [], ["原始点序", "X", "Y", "拟合Y", "残差"], ...pointRows,
  ];
  return csv(rows);
}

function derivedReportRows(fit: TafelFitResult): CsvValue[][] {
  const { exchange, slopeCI } = tafelDerivedMetrics(fit);
  return [
    ["斜率置信水平", slopeCI.level, "", ""],
    ["斜率置信区间自由度", slopeCI.dof ?? "", "", ""],
    ["斜率95%置信区间下限", slopeCI.low ?? "", "", slopeCI.unit],
    ["斜率95%置信区间上限", slopeCI.high ?? "", "", slopeCI.unit],
    [exchange.label, exchange.value ?? "", "", exchange.unit],
    [exchange.logLabel, exchange.log10 ?? "", "", ""],
    ["交换电流计算状态", exchange.status, "", ""],
    ["派生结果说明", TAFEL_DERIVED_NOTE, "", ""],
  ];
}
