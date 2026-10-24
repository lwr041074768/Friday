"use client";

import { useId, type ReactNode } from "react";
import type { EisCircuitKind } from "@/lib/eis-circuit";
import { zsimpModel, type ZsimpCircuitNode } from "@/lib/eis-zsimp-models";

type Layout = { node: ZsimpCircuitNode; width: number; height: number; children: Layout[] };
const element = (symbol: "R" | "Q" | "W", id: string): ZsimpCircuitNode => ({ type: "element", symbol, id, keyPrefix: id, label: id });
const group = (type: "series" | "parallel", ...children: ZsimpCircuitNode[]): ZsimpCircuitNode => ({ type, children });

export function eisCircuitTree(kind: EisCircuitKind): ZsimpCircuitNode | null {
  const catalog = kind.startsWith("zsimp:") ? zsimpModel(kind) : undefined;
  if (catalog) return catalog.tree;
  if (kind === "r-cpe") return group("series", element("R", "Rs"), group("parallel", element("R", "Rct"), element("Q", "Q")));
  if (kind === "r-cpe-w") return group("series", element("R", "Rs"), group("parallel", element("Q", "Q"), group("series", element("R", "Rct"), element("W", "W"))));
  if (kind === "rq-rq") return group("series", element("R", "Rs"), group("parallel", element("R", "R1"), element("Q", "Q1")), group("parallel", element("R", "R2"), element("Q", "Q2")));
  return null;
}

function measure(node: ZsimpCircuitNode): Layout {
  if (node.type === "element") return { node, width: 84, height: 56, children: [] };
  const children = node.children.map(measure);
  if (node.type === "series") return { node, children, width: children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, children.length - 1) * 16, height: Math.max(56, ...children.map(child => child.height)) };
  return { node, children, width: Math.max(84, ...children.map(child => child.width)) + 48, height: children.reduce((sum, child) => sum + child.height, 0) + Math.max(0, children.length - 1) * 8 };
}

function wire(x1: number, y1: number, x2: number, y2: number, key: string) {
  return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2}/>;
}

function draw(layout: Layout, x: number, y: number, path: string): ReactNode {
  const mid = y + layout.height / 2, end = x + layout.width;
  if (layout.node.type === "element") {
    const { symbol, label } = layout.node, left = x + 21, right = end - 21;
    let mark: ReactNode;
    if (symbol === "C") mark = <>{wire(left, mid, x + 36, mid, "lead-a")}<line x1={x + 36} y1={mid - 12} x2={x + 36} y2={mid + 12}/><line x1={x + 48} y1={mid - 12} x2={x + 48} y2={mid + 12}/>{wire(x + 48, mid, right, mid, "lead-b")}</>;
    else if (symbol === "L") mark = <path d={`M ${left} ${mid} h 3 ${Array.from({ length: 4 }, () => "a 4.5 7 0 0 1 9 0").join(" ")} h 3`} fill="none"/>;
    else if (symbol === "R") mark = <rect x={left} y={mid - 7} width={right - left} height={14} rx={1} className="eis-element-fill"/>;
    else mark = <><rect x={left} y={mid - 11} width={right - left} height={22} rx={2} className="eis-element-fill"/><text x={x + 42} y={mid + 4} className="eis-element-symbol">{symbol === "Q" ? "CPE" : symbol}</text></>;
    return <g key={path} data-element={layout.node.id}>{wire(x, mid, left, mid, "in")}{mark}{wire(right, mid, end, mid, "out")}<text x={x + 42} y={mid - 17} className="eis-element-label">{label}</text></g>;
  }
  if (layout.node.type === "series") {
    let nextX = x;
    return <g key={path}>{layout.children.map((child, index) => {
      const childX = nextX; nextX += child.width + 16;
      return <g key={index}>{index > 0 && wire(childX - 16, mid, childX, mid, `series-${index}`)}{draw(child, childX, mid - child.height / 2, `${path}-${index}`)}</g>;
    })}</g>;
  }
  let nextY = y;
  const centers = layout.children.map(child => { const center = nextY + child.height / 2; nextY += child.height + 8; return center; });
  const input = x + 12, output = end - 12;
  return <g key={path}>{wire(x, mid, input, mid, "parallel-in")}{wire(output, mid, end, mid, "parallel-out")}{wire(input, Math.min(mid, ...centers), input, Math.max(mid, ...centers), "bus-in")}{wire(output, Math.min(mid, ...centers), output, Math.max(mid, ...centers), "bus-out")}{layout.children.map((child, index) => {
    const childX = x + (layout.width - child.width) / 2, center = centers[index];
    return <g key={index}>{wire(input, center, childX, center, `branch-in-${index}`)}{draw(child, childX, center - child.height / 2, `${path}-${index}`)}{wire(childX + child.width, center, output, center, `branch-out-${index}`)}</g>;
  })}<circle cx={input} cy={mid} r={2.3}/><circle cx={output} cy={mid} r={2.3}/></g>;
}

export default function EisCircuitDiagram({ kind, label }: { kind: EisCircuitKind; label: string }) {
  const titleId = useId(), tree = eisCircuitTree(kind);
  if (!tree) return null;
  const layout = measure(tree), width = layout.width + 40, height = layout.height + 24;
  return <div className="eis-circuit-scroll" tabIndex={0} aria-label="等效电路图，宽图可横向滚动"><svg xmlns="http://www.w3.org/2000/svg" data-testid="eis-circuit-diagram" role="img" aria-labelledby={titleId} viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
    <title id={titleId}>{`${label} 等效电路，连线表示串联和并联关系`}</title>
    <g className="eis-circuit-drawing">{wire(7, height / 2, 20, height / 2, "terminal-a")}{draw(layout, 20, 12, "root")}{wire(width - 20, height / 2, width - 7, height / 2, "terminal-b")}<circle cx={6} cy={height / 2} r={3.5} className="eis-element-fill"/><circle cx={width - 6} cy={height / 2} r={3.5} className="eis-element-fill"/></g>
  </svg></div>;
}
