export type CurrentUnit = "A" | "mA" | "uA" | "nA" | "A/cm2" | "mA/cm2" | "uA/cm2";
export type Point = { e: number; current: number; frequency?: number };
export type Curve = { id: string; name: string; color: string; visible: boolean; points: Point[]; unit: CurrentUnit; resistance: string; irVoltage?: string; area: string; compensation: "raw" | "corrected" | "unknown"; source: string; demo?: boolean; imaginary?: "raw" | "negative" };
export type PlotPoint = { x: number; y: number; e: number; current: number; index: number };
export type PlotCurve = Curve & { plotted: (PlotPoint | null)[]; error?: string; invalid: number };
export const COLORS = ["#2374d5", "#e56a41", "#179d83", "#8961c6", "#dbb033", "#d4578b", "#427c98", "#9c774f", "#697489", "#5c9c38"];
export const INITIAL_X = "第一列 - iR * B1 + 0.059 * 13.65 + 0.197";
export const INITIAL_Y = "第二列 * 1000";
type Expr = ((vars: Record<string, number>) => number) & { variables?: Set<string> };
const VARIABLES = new Set(["E", "I", "j", "R", "Rs", "IR", "f", "S", "A", "iR", "a", "b", "pi"]);

// A small arithmetic grammar. Expressions never execute JavaScript.
export function compileFormula(source: string): Expr {
  if (source.length > 400) throw new Error("公式不能超过 400 个字符");
  const normalized = source.replace(/col\(\s*A\s*\)|\bA1\b|第一列/gi, "a").replace(/col\(\s*B\s*\)|\bB1\b|第二列/gi, "b").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/\*\*/g, "^").replace(/\bLOG\b/gi, "log10").replace(/\bABS\b/gi, "abs");
  const tokens: string[] = [];
  let position = 0;
  while (position < normalized.length) {
    if (/\s/.test(normalized[position])) { position++; continue; }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_][A-Za-z_0-9]*|^[+\-*/^()]/.exec(normalized.slice(position));
    if (!match) throw new Error(`不支持的字符：${normalized[position]}`);
    tokens.push(match[0]); position += match[0].length;
    if (tokens.length > 200) throw new Error("公式过于复杂");
  }
  let cursor = 0, depth = 0; const usedVariables = new Set<string>();
  const functions: Record<string, (x: number) => number> = { abs: Math.abs, log10: Math.log10, ln: Math.log, sqrt: Math.sqrt, exp: Math.exp };
  function atom(): Expr {
    if (++depth > 32) throw new Error("括号嵌套过深");
    const token = tokens[cursor++];
    let result: Expr;
    if (!token) throw new Error("公式不完整");
    if (token === "(") { result = sum(); if (tokens[cursor++] !== ")") throw new Error("缺少右括号"); }
    else if (/^(?:\d|\.)/.test(token)) { const value = Number(token); if (!Number.isFinite(value)) throw new Error("数值过大"); result = () => value; }
    else if (Object.prototype.hasOwnProperty.call(functions, token.toLowerCase())) {
      if (tokens[cursor++] !== "(") throw new Error(`${token} 后需要括号`);
      const argument = sum(); if (tokens[cursor++] !== ")") throw new Error("缺少右括号");
      result = vars => functions[token.toLowerCase()](argument(vars));
    } else if (VARIABLES.has(token)) { usedVariables.add(token); result = vars => vars[token]; }
    else throw new Error(`未知变量：${token}`);
    depth--; return result;
  }
  function power(): Expr { const left = atom(); if (tokens[cursor] !== "^") return left; cursor++; const right = unary(); return vars => left(vars) ** right(vars); }
  function unary(): Expr { if (tokens[cursor] === "+") { cursor++; return unary(); } if (tokens[cursor] === "-") { cursor++; const expr = unary(); return vars => -expr(vars); } return power(); }
  function product(): Expr { let left = unary(); while (tokens[cursor] === "*" || tokens[cursor] === "/") { const op = tokens[cursor++], a = left, b = unary(); left = vars => op === "*" ? a(vars) * b(vars) : a(vars) / b(vars); } return left; }
  function sum(): Expr { let left = product(); while (tokens[cursor] === "+" || tokens[cursor] === "-") { const op = tokens[cursor++], a = left, b = product(); left = vars => op === "+" ? a(vars) + b(vars) : a(vars) - b(vars); } return left; }
  const expression = sum();
  if (cursor !== tokens.length) throw new Error(`无法解析：${tokens[cursor]}`);
  expression.variables = usedVariables; return expression;
}

export function plotCurves(curves: Curve[], settings: { x: string; y: string; resistance: string; fraction: string; irMode: "resistance" | "voltage"; voltage: string }): { curves: PlotCurve[]; error?: string } {
  let x: Expr, y: Expr;
  try { x = compileFormula(settings.x); y = compileFormula(settings.y); } catch (error) { return { curves: [], error: (error as Error).message }; }
  const fraction = settings.fraction.trim() ? Number(settings.fraction) / 100 : NaN;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return { curves: [], error: "补偿比例需为 0～100%" };
  const variables = new Set([...(x.variables ?? []), ...(y.variables ?? [])]);
  return { curves: curves.map(curve => {
    const rawR = curve.resistance.trim() || settings.resistance;
    const resistance = rawR.trim() ? Number(rawR) : NaN;
    const rawVoltage = curve.irVoltage ?? settings.voltage;
    const voltage = rawVoltage.trim() ? Number(rawVoltage) : NaN;
    const area = curve.area.trim() ? Number(curve.area) : NaN;
    let error: string | undefined;
    if (settings.irMode === "resistance" && (!Number.isFinite(resistance) || resistance < 0)) error = "Rs 需为大于或等于 0 的数值";
    if (curve.area.trim() && (!Number.isFinite(area) || area <= 0)) error = "面积需大于 0";
    const density = curve.unit.includes("/cm2"), usesResistance = ["R","Rs","IR"].some(v=>variables.has(v));
    const needsTotal = variables.has("I") || (variables.has("iR") && settings.irMode === "resistance" && resistance > 0);
    if ((variables.has("S") || variables.has("A") || (!density && variables.has("j")) || (density && needsTotal)) && !(area > 0)) error = "需要填写电极面积（cm²）";
    if (curve.compensation === "corrected" && ((usesResistance && resistance > 0) || (variables.has("iR") && ((settings.irMode === "resistance" && resistance > 0) || (settings.irMode === "voltage" && voltage !== 0))))) error = "原数据已补偿；请将公式使用的 Rs / iR 设为 0，避免重复补偿";
    if (settings.irMode === "voltage" && !Number.isFinite(voltage)) error = "iR 需为有限数值";
    if (error) return { ...curve, plotted: [], invalid: 0, error };
    let invalid = 0;
    const plotted = curve.points.map((point, index): PlotPoint | null => {
      const scale = curve.unit.startsWith("mA") ? 1e-3 : curve.unit.startsWith("uA") ? 1e-6 : curve.unit === "nA" ? 1e-9 : 1;
      const I = point.current * scale * (density ? area : 1), j = density ? point.current * scale * 1000 : I * 1000 / area;
      const vars = { E: point.e, I, j, R: resistance, Rs: resistance, IR: resistance, f: fraction, S: area, A: area, iR: settings.irMode === "voltage" ? voltage : resistance === 0 ? 0 : I * resistance, a: point.e, b: point.current, pi: Math.PI };
      const px = x(vars), py = y(vars);
      if (!Number.isFinite(px) || !Number.isFinite(py)) { invalid++; return null; }
      return { x: px, y: py, e: point.e, current: point.current, index };
    });
    return { ...curve, plotted, invalid, error: invalid === curve.points.length ? "公式结果均无效，请检查除零、对数或变量" : undefined };
  }) };
}

export function demoCurves(): Curve[] {
  return [0, 1, 2].map((sample, index) => ({ id: `demo-${index}`, name: `模拟样品 ${String.fromCharCode(65 + index)}`, color: COLORS[index], visible: true, unit: "A", resistance: "", area: "", compensation: "raw", source: "模拟数据 · 用于体验操作", demo: true, points: Array.from({ length: 241 }, (_, n) => { const e = 0.32 + n * 0.0018; return { e, current: Math.max(0, (Math.exp((e - 0.50 - sample * 0.027) * 13) - 0.08) * 0.0018) }; }) }));
}
