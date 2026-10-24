import type { PlotCurve, PlotPoint } from "./lsv-math";

type RunAxis = "x" | "y" | "point";
type Box = { x0: number; x1: number; y0: number; y1: number };
type Run = Box & { curve: PlotCurve; start: number; end: number; axis: RunAxis; direction: number };
type Node = Box & { run: Run; left: Node | null; right: Node | null };
export type XrdHoverIndex = { root: Node | null; runCount: number };
export type XrdHoverQuery = {
  x: number; y: number;
  /** CSS pixels per data unit, rather than SVG viewBox units. */
  scaleX: number; scaleY: number;
  hitRadius?: number;
  bounds?: Box;
};
export type XrdHoverResult = {
  curve: PlotCurve; point: PlotPoint; interpolated: boolean;
  endpointIndices: [number, number]; exactIndex?: number; distancePx: number;
};

const finitePoint = (point: PlotPoint | null): point is PlotPoint => !!point &&
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.e) && Number.isFinite(point.current);
function edge(a: PlotPoint, b: PlotPoint): { axis: RunAxis; direction: number } {
  if (a.x !== b.x) return { axis: "x", direction: Math.sign(b.x - a.x) };
  if (a.y !== b.y) return { axis: "y", direction: Math.sign(b.y - a.y) };
  return { axis: "point", direction: 0 };
}

/** Build once after curve changes. Never reorder, decimate, or bridge source points. */
export function buildXrdHoverIndex(curves: PlotCurve[]): XrdHoverIndex {
  const runs: Run[] = [];
  for (const curve of curves) {
    if (!curve.visible || curve.error) continue;
    let run: Run | null = null;
    let previous: PlotPoint | null = null;
    let previousPosition = -1;
    for (let position = 0; position < curve.plotted.length; position++) {
      const point = curve.plotted[position];
      if (!finitePoint(point)) {
        if (run) runs.push(run);
        run = null; previous = null;
        continue;
      }
      if (!previous) {
        run = { curve, start: position, end: position, axis: "point", direction: 0,
          x0: point.x, x1: point.x, y0: point.y, y1: point.y };
      } else {
        const segment = edge(previous, point);
        if (run && run.start === run.end) {
          run.axis = segment.axis; run.direction = segment.direction;
        } else if (run && (run.axis !== segment.axis || run.direction !== segment.direction)) {
          runs.push(run);
          run = { curve, start: previousPosition, end: previousPosition, ...segment,
            x0: previous.x, x1: previous.x, y0: previous.y, y1: previous.y };
        }
        if (run) {
          run.end = position;
          run.x0 = Math.min(run.x0, point.x); run.x1 = Math.max(run.x1, point.x);
          run.y0 = Math.min(run.y0, point.y); run.y1 = Math.max(run.y1, point.y);
        }
      }
      previous = point; previousPosition = position;
    }
    if (run) runs.push(run);
  }
  // Only index records are sorted; curve.plotted remains in acquisition order.
  runs.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || a.y0 - b.y0 || a.y1 - b.y1);
  function tree(start: number, end: number): Node | null {
    if (start >= end) return null;
    const middle = (start + end) >>> 1;
    const run = runs[middle], left = tree(start, middle), right = tree(middle + 1, end);
    const node: Node = { run, left, right, x0: run.x0, x1: run.x1, y0: run.y0, y1: run.y1 };
    for (const child of [left, right]) if (child) {
      node.x0 = Math.min(node.x0, child.x0); node.x1 = Math.max(node.x1, child.x1);
      node.y0 = Math.min(node.y0, child.y0); node.y1 = Math.max(node.y1, child.y1);
    }
    return node;
  }
  return { root: tree(0, runs.length), runCount: runs.length };
}

function blend(a: number, b: number, t: number) {
  // A weighted sum avoids overflow from b-a for oppositely signed finite values.
  return a * (1 - t) + b * t;
}
function fraction(a: number, b: number, value: number) {
  const delta = b - a;
  return Number.isFinite(delta) ? (value - a) / delta : (value / 2 - a / 2) / (b / 2 - a / 2);
}
function sampleRun(run: Run, query: XrdHoverQuery): Omit<XrdHoverResult, "distancePx"> | null {
  const points = run.curve.plotted;
  const first = points[run.start]!, last = points[run.end]!;
  const exact = (point: PlotPoint): Omit<XrdHoverResult, "distancePx"> => ({ curve: run.curve,
    point, interpolated: false, endpointIndices: [point.index, point.index], exactIndex: point.index });
  if (run.axis === "point") return exact(first);
  let value: number;
  if (run.axis === "x") {
    // No extrapolation. A vertical/isolated point is the only horizontally snapped case.
    if (query.x < run.x0 || query.x > run.x1) return null;
    value = Math.max(run.x0, Math.min(run.x1, query.x));
  } else value = Math.max(run.y0, Math.min(run.y1, query.y));
  const key = run.axis;
  if (value === first[key]) return exact(first);
  if (value === last[key]) return exact(last);
  let lower = run.start, upper = run.end;
  while (upper - lower > 1) {
    const middle = (lower + upper) >>> 1, point = points[middle]!;
    if (value === point[key]) return exact(point);
    if ((point[key] - value) * run.direction < 0) lower = middle;
    else upper = middle;
  }
  const a = points[lower]!, b = points[upper]!;
  const t = Math.max(0, Math.min(1, fraction(a[key], b[key], value)));
  const point: PlotPoint = {
    x: key === "x" ? value : a.x,
    y: key === "y" ? value : blend(a.y, b.y, t),
    e: blend(a.e, b.e, t), current: blend(a.current, b.current, t), index: a.index,
  };
  return { curve: run.curve, point, interpolated: true, endpointIndices: [a.index, b.index] };
}

/** Find the nearest curve at the pointer's exact X; Y is linear between measured endpoints.
 * Each monotonic run uses binary search, with a spatial run tree to prune unrelated runs.
 * Dense overlapping nonmonotonic runs can require more candidates, but there is no raw-point scan fallback.
 */
export function readXrdHover(index: XrdHoverIndex, query: XrdHoverQuery): XrdHoverResult | null {
  const radius = query.hitRadius ?? 12;
  if (![query.x, query.y, query.scaleX, query.scaleY, radius].every(Number.isFinite) ||
      query.scaleX <= 0 || query.scaleY <= 0 || radius < 0) return null;
  let best: XrdHoverResult | null = null, bestSquared = radius ** 2;
  function distanceToBox(box: Box) {
    const dx = Math.max(box.x0 - query.x, 0, query.x - box.x1) * query.scaleX;
    const dy = Math.max(box.y0 - query.y, 0, query.y - box.y1) * query.scaleY;
    return dx * dx + dy * dy;
  }
  function inspect(node: Node | null) {
    if (!node || distanceToBox(node) > bestSquared || bestSquared === 0 && best) return;
    if (distanceToBox(node.run) <= bestSquared) {
      const candidate = sampleRun(node.run, query);
      if (candidate) {
        const { point } = candidate, bounds = query.bounds;
        const inside = !bounds || point.x >= bounds.x0 && point.x <= bounds.x1 && point.y >= bounds.y0 && point.y <= bounds.y1;
        const dx = (query.x - point.x) * query.scaleX, dy = (query.y - point.y) * query.scaleY;
        const distance = dx * dx + dy * dy;
        if (inside && Number.isFinite(distance) && distance <= bestSquared && (!best || distance < bestSquared)) {
          bestSquared = distance;
          best = { ...candidate, distancePx: Math.sqrt(distance) };
        }
      }
    }
    const leftDistance = node.left ? distanceToBox(node.left) : Infinity;
    const rightDistance = node.right ? distanceToBox(node.right) : Infinity;
    if (leftDistance <= rightDistance) { inspect(node.left); inspect(node.right); }
    else { inspect(node.right); inspect(node.left); }
  }
  inspect(index.root);
  return best;
}
