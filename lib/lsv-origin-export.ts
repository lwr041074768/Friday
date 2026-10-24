import { INITIAL_X, INITIAL_Y, type Curve, type CurrentUnit, type PlotCurve, type PlotPoint } from "./lsv-math";
import { readTarget } from "./lsv-target";
import { scanSegments, type ScanMode } from "./scan-branches";

// Raw columns retain the imported units. Derived columns are the full-precision
// values already calculated by the fixed LSV formulas, with nulls for gaps.
export type OriginExportRow = [
  rawE: number | null,
  rawCurrent: number | null,
  adjustedX: number | null,
  adjustedY: number | null,
];

export type OriginExportSample = {
  name: string;
  source: string;
  unit: CurrentUnit;
  area: string;
  ir: number;
  compensation: Curve["compensation"];
  visible: boolean;
  demo: boolean;
  rows: OriginExportRow[];
  eta10MV: number | null;
  note: string;
};

export type OriginExportPayload = {
  schema: "lsv-origin/v1";
  requestId: string;
  createdAt: string;
  formulas: { x: string; y: string };
  scan: ScanMode;
  samples: OriginExportSample[];
};

const MAX_POINTS = 500_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_SETTINGS = { smoothPoints: 3, prominence: 1 };

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/** Build data only; no formula strings or sample metadata are executed as code. */
export function buildOriginExport(curves: PlotCurve[], scan: ScanMode, requestId?: string): OriginExportPayload {
  if (!curves.length) throw new Error("请先导入 LSV 数据，再导出到 Origin。");
  if (curves.length > 20) throw new Error("一次最多导出 20 条 LSV 曲线。");
  if (!["all", "up", "down"].includes(scan)) throw new Error("扫描方向无效。");

  let total = 0;
  const irValues = curves.map(curve => {
    total += curve.points.length;
    if (total > MAX_POINTS) throw new Error("一次最多导出 500,000 个原始数据点，请拆分后导出。");
    const rawIR = curve.irVoltage ?? "0";
    const ir = typeof rawIR === "string" && rawIR.trim() ? Number(rawIR) : NaN;
    if (!Number.isFinite(ir)) throw new Error(`${curve.name} 的 IR 数值无效，请确认后导出。`);
    // The caller must pass result.curves, before selectScan, display decimation,
    // or clipping. A curve error legitimately has no derived points at all.
    if (!curve.error && curve.plotted.length !== curve.points.length) {
      throw new Error("Origin 导出需要完整曲线数据，不能使用筛选或抽稀后的绘图数据。");
    }
    return ir;
  });
  if (!total) throw new Error("没有可导出的原始数据点。");

  const id = requestId ?? crypto.randomUUID();
  if (!UUID.test(id)) throw new Error("Origin 导出请求 ID 必须是有效的 UUID。");

  let exportedRows = 0;
  const samples = curves.map((curve, curveIndex): OriginExportSample => {
    const plotted = new Map<number, PlotPoint>();
    for (const point of curve.plotted) {
      if (point && Number.isInteger(point.index) && point.index >= 0 && point.index < curve.points.length) {
        plotted.set(point.index, point);
      }
    }
    let gaps = 0;
    const rowAt = (index: number): OriginExportRow => {
      const point = curve.points[index];
      const rawE = finite(point.e), rawCurrent = finite(point.current);
      const derived = plotted.get(index);
      // Keep both derived cells empty at a gap, rather than bridging it with a
      // zero or a partially valid coordinate. Never change the raw point order.
      if (curve.error || rawE === null || rawCurrent === null || !derived || !Number.isFinite(derived.x) || !Number.isFinite(derived.y)) {
        gaps++;
        return [rawE, rawCurrent, null, null];
      }
      return [rawE, rawCurrent, derived.x, derived.y];
    };
    const rows: OriginExportRow[] = [];
    if (scan === "all") curve.points.forEach((_, index) => rows.push(rowAt(index)));
    else {
      const segments = scanSegments(curve.points).filter(segment => segment.direction === scan);
      if (!segments.length) throw new Error(`${curve.name} 没有${scan === "up" ? "正向" : "反向"}扫描段，无法按当前选择导出。请选择“全部”或移除该样品后重试。`);
      for (const segment of segments) {
        // Disconnected cycles must not become one connected Origin curve.
        if (rows.length) rows.push([null, null, null, null]);
        for (let index = segment.start; index <= segment.end; index++) rows.push(rowAt(index));
      }
    }
    exportedRows += rows.length;
    if (exportedRows > MAX_POINTS) throw new Error("导出数据及扫描段分隔行合计超过 500,000 行，请拆分后导出。");

    // Select from original indices, just like the on-page scan filter. Keep
    // full precision and all samples without viewport clipping or decimation.
    // η10 uses the current chart X/Y, including the already-applied software IR.
    const reading = readTarget(curve, scan, TARGET_SETTINGS);
    const notes = [
      `${reading.candidate ? "候选读数：" : ""}${reading.note}`,
      `导出${scan === "all" ? "全部扫描段" : scan === "up" ? "氧化峰（正向扫描段）" : "还原峰（反向扫描段）"}；η10 按${scan === "down" ? "降电位" : "升电位"}扫描读取。`,
      "当前 X/Y 按固定原始列公式导出，不根据单位或面积再次换算。",
      "η10 = (图中 X@10 − 1.23) × 1000 mV；X 已包含当前应用的 IR，不再次扣除 IR。OER 含义以电位已正确换算至 RHE 为前提。",
    ];
    if (curve.unit !== "A/cm2" && (curve.unit !== "A" || Number(curve.area) !== 1)) {
      notes.push("当前 Y 按原始第二列 × 1000；其电流密度单位需核对，未按标注单位或面积重新换算。");
    }
    if (gaps) notes.push(`${gaps} 行公式结果缺失，导出保留空值及曲线缺口。`);
    if (!curve.visible) notes.push("该样品当前隐藏，仍保留所选扫描段的完整数据。");
    if (curve.demo) notes.push("模拟数据，仅用于体验操作。");
    return {
      name: curve.name,
      source: curve.source,
      unit: curve.unit,
      area: curve.area,
      ir: irValues[curveIndex],
      compensation: curve.compensation,
      visible: curve.visible,
      demo: !!curve.demo,
      rows,
      eta10MV: Number.isFinite(reading.etaMV) ? reading.etaMV! : null,
      note: notes.join(" "),
    };
  });

  return {
    schema: "lsv-origin/v1",
    requestId: id,
    createdAt: new Date().toISOString(),
    formulas: { x: INITIAL_X, y: INITIAL_Y },
    scan,
    samples,
  };
}
