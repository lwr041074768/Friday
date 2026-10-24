// Circuit catalog transcribed from the installed ZSimpWin CDC library.
// Parameter conventions follow its help and original element definitions.
export type ZsimpElementSymbol = "B" | "C" | "G" | "H" | "I" | "J" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "T" | "U" | "V" | "W" | "X";
export type ZsimpCircuitNode = {
    type: "element";
    symbol: ZsimpElementSymbol;
    id: string;
    keyPrefix: string;
    label: string;
} | {
    type: "series" | "parallel";
    children: ZsimpCircuitNode[];
};
export type ZsimpModelKind = `zsimp:${string}`;
export type ZsimpComplex = {
    re: number;
    im: number;
};
export type ZsimpParameter = {
    key: string;
    label: string;
    unit: string;
};
export type ZsimpTransform = "log" | "n" | "identity";
export type ZsimpCircuitSpec = {
    parameters: readonly ZsimpParameter[];
    transforms: readonly ZsimpTransform[];
    impedance: (params: Readonly<Record<string, number>>, omega: number) => ZsimpComplex;
};
type FitPoint = {
    frequency: number;
    zReal: number;
    minusZImag: number;
};
const SYMBOLS = "BCGHIJLMNOPQRTUVWX";
export function zsimpParseExpression(expression: string): ZsimpCircuitNode {
    let at = 0, ordinal = 0;
    function group(depth: number): ZsimpCircuitNode {
        const children: ZsimpCircuitNode[] = [];
        while (at < expression.length && expression[at] !== ")") {
            const char = expression[at++];
            if (char === "(") {
                children.push(group(depth + 1));
                if (expression[at++] !== ")")
                    throw new Error("电路括号缺失");
            }
            else {
                if (!SYMBOLS.includes(char))
                    throw new Error(`未知电路元件 ${char}`);
                const id = `${char}${++ordinal}`;
                children.push({ type: "element", symbol: char as ZsimpElementSymbol, id, keyPrefix: id, label: id });
            }
        }
        if (!children.length)
            throw new Error("电路分支为空");
        return children.length === 1 ? children[0] : { type: depth % 2 === 0 ? "series" : "parallel", children };
    }
    const result = group(0);
    if (at !== expression.length)
        throw new Error("电路表达式括号未配对");
    return result;
}
function leaves(node: ZsimpCircuitNode): Extract<ZsimpCircuitNode, {
    type: "element";
}>[] { return node.type === "element" ? [node] : node.children.flatMap(leaves); }
type Field = {
    name: string;
    label: string;
    unit: string;
    transform: ZsimpTransform;
};
const f = (name: string, label: string, unit: string, transform: ZsimpTransform = "log"): Field => ({ name, label, unit, transform });
const y = f("Y0", "导纳系数 Y₀", "S·s^0.5"), freq = (name: string) => f(name, `特征角频率 ${name}`, "s⁻¹"), resistance = (name: string) => f(name, `电阻 ${name}`, "Ω"), power = (name = "n") => f(name, `指数 ${name}`, "", "n");
const ELEMENT_FIELDS: Record<ZsimpElementSymbol, Field[]> = {
    R: [resistance("R")], C: [f("C", "电容 C", "F")], L: [f("L", "电感 L", "H")], W: [y], Q: [f("Y0", "CPE 系数 Y₀", "S·s^n"), power()],
    T: [y, f("B", "扩散时间平方根 B", "s^0.5")], O: [y, f("B", "扩散时间平方根 B", "s^0.5")], G: [y, f("Ka", "速率常数 Kₐ", "s⁻¹")],
    H: [f("dC", "介电弛豫电容 ΔC", "F"), f("tau", "弛豫时间 τ", "s"), power("mu"), power("psi")],
    P: [resistance("RW"), freq("w0")],
    U: [resistance("Xa"), resistance("Xb"), freq("w0"), freq("w1"), f("K", "无量纲 k·a/D", ""), freq("w3")],
    V: [resistance("Xa"), freq("w0"), freq("w1"), f("K", "无量纲 k·a/D", ""), freq("w3")],
    M: [resistance("Xa"), resistance("Xb"), freq("w0"), freq("w1"), f("K", "无量纲 k·a/D", ""), freq("w3")],
    N: [resistance("Xa"), freq("w0"), freq("w1"), f("K", "无量纲 k·a/D", ""), freq("w3")],
    B: [f("Y0", "归一化导纳系数 Y₀", "S"), freq("w0"), f("K", "扩散边界系数 K", ""), power()],
    I: [f("Y0", "归一化导纳系数 Y₀", "S"), freq("w0"), f("A", "双层扩散系数 A", ""), f("lambda", "厚度比 λ", "")],
    J: [f("Y0", "归一化导纳系数 Y₀", "S"), freq("w0"), f("A", "双层扩散系数 A", ""), f("lambda", "厚度比 λ", "")],
    X: [resistance("Rp"), f("Cdl", "界面电容 Cdl", "F"), power(), resistance("Rs"), f("L", "层长度 L", "cm"), f("Xw", "层宽度 Xw", "cm")],
};
const EXPRESSIONS = `(C(CQ))
(C(R(CR)))
(C(R(LR)))
(C(RW))
(CR(CR)(CR)(CR)(CR))
(CR(CR)(CR)(CR))
(CR(CR)(CR))
(CR(CR))
(CR(LR)(LR)(LR)(LR))
(CR(LR)(LR)(LR))
(CR(LR)(LR))
(CR(LR))
(HC)
(Q(RQ))
(QR(RO)(RC)(RL)(RQ))
(R(OR))
LR(C(QR))
LR(C(R(CR)))
LR(C(R(Q(R(C(RW))))))
LR(C(R(Q(R(LR)(CR)))))
LR(C(R(QR)))(CR)
LR(CR(QR)(LR)(CR))
LR(CR(QR)(RW))
LR(CR(QR))
LR(CR)
LR(CR)(QR)
LR(Q(R(C(R(LR)(CR)))))
LR(Q(R(CR)))
LR(Q(R(LR)(CR)))
LR(Q(R(QR)))
LR(QR(CR)(LR)(CR))
LR(QR(CR))
LR(QR(LR)(CR))
LR(QR)
LR(QR)(CR)
LR(QR)(QR)
LRQ(CR)
R(C(R(C(R(CR)))))
R(C(R(C(RO))))
R(C(R(C(RT))))
R(C(R(C(RW))))
R(C(R(CR)))
R(C(R(Q(R(C(RW))))))
R(C(R(Q(R(CR)))))
R(C(R(Q(R(LR)(CR)))))
R(C(R(Q(R(QR)))))
R(C(R(Q(RW))))
R(C(R(Q(RW))))(CR)
R(C(R(QR)))(CR)
R(C(RO))
R(C(RT))
R(C(RW))
R(CR(CR)(CR))
R(CR(CR))
R(CR(OR)(LR)(LR))
R(CR(QR)(LR)(CR))
R(CR(QR)(QR))
R(CR(QR))
R(CR(QR))(CR)
R(CR)
R(CR)(CR)
R(CR)(CR)(CR)
R(CR)(CR)O
R(CR)(CR)T
R(CR)(CR)W
R(CR)(QR)(CR)
R(CR)O
R(CR)T
R(CR)W
R(CRQ(RW))
R(Q(R(C(R(C(RW))))))(CR)
R(Q(R(C(R(LR)(CR)))))
R(Q(R(CR)))
R(Q(R(Q(R(CR)))))
R(Q(R(Q(R(Q(R(CR)))))))
R(Q(R(Q(RW))))
R(Q(R(QR)(Q(RW))))
R(Q(R(QR)))
R(Q(RO))
R(Q(RW))
R(Q(RW))(CR)
R(Q(RW))(QR)
R(QR(CR)(CR))
R(QR(CR)(LR)(OR))
R(QR(CR)(OR))
R(QR(CR)(RW))(CR)
R(QR(LR)(LR))
R(QR(LR))
R(QR(OR)(LR)(LR)(QR))
R(QR(OR)(LR)(LR))
R(QR(OR))
R(QR(QR)(CR))
R(QR(QR)(OR))
R(QR(QR)(QR)(CR))
R(QR(QR))
R(QR)
R(QR)(QR)
R(QR)(QR)(CR)
R(QR)(R(OR))
RB
RG
RI
RJ
RM
RN
RO
RP
RQ
RT
RU
RV
RX`.split(/\s+/);
export const ZSIMP_MODELS = EXPRESSIONS.map(expression => {
    const tree = zsimpParseExpression(expression);
    const elements = leaves(tree);
    return { value: `zsimp:${expression}` as ZsimpModelKind, label: expression, equation: expression, expression, tree, elementCount: elements.length, parameterCount: elements.reduce((n, e) => n + ELEMENT_FIELDS[e.symbol].length, 0) };
});
export function zsimpModel(kind: string) { const model = ZSIMP_MODELS.find(m => m.value === kind); if (!model)
    throw new Error(`未知 ZSimpWin 电路 ${kind}`); return model; }
const cx = (re: number, im = 0): ZsimpComplex => ({ re, im });
const add = (a: ZsimpComplex, b: ZsimpComplex) => cx(a.re + b.re, a.im + b.im);
const sub = (a: ZsimpComplex, b: ZsimpComplex) => cx(a.re - b.re, a.im - b.im);
const scale = (a: ZsimpComplex, k: number) => cx(a.re * k, a.im * k);
const mul = (a: ZsimpComplex, b: ZsimpComplex) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
function div(a: ZsimpComplex, b: ZsimpComplex): ZsimpComplex {
    if (Math.abs(b.re) >= Math.abs(b.im)) {
        const r = b.im / b.re, d = b.re + b.im * r;
        return cx((a.re + a.im * r) / d, (a.im - a.re * r) / d);
    }
    const r = b.re / b.im, d = b.im + b.re * r;
    return cx((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}
const inv = (a: ZsimpComplex) => div(cx(1), a);
const pow = (a: ZsimpComplex, n: number) => { const r = Math.pow(Math.hypot(a.re, a.im), n), t = Math.atan2(a.im, a.re) * n; return cx(r * Math.cos(t), r * Math.sin(t)); };
function tanh(a: ZsimpComplex): ZsimpComplex {
    if (a.re > 20)
        return cx(1);
    if (a.re < -20)
        return cx(-1);
    const d = Math.cosh(2 * a.re) + Math.cos(2 * a.im);
    return cx(Math.sinh(2 * a.re) / d, Math.sin(2 * a.im) / d);
}
// Analytic small-argument limits avoid cancellation in transmission-line elements.
function xCothX(z: ZsimpComplex): ZsimpComplex {
    const t = mul(z, z);
    if (Math.hypot(z.re, z.im) < 1e-3)
        return add(cx(1), add(scale(t, 1 / 3), add(scale(mul(t, t), -1 / 45), scale(mul(mul(t, t), t), 2 / 945))));
    return div(z, tanh(z));
}
function cothOverX(z: ZsimpComplex): ZsimpComplex { return div(xCothX(z), mul(z, z)); }
function tanhOverX(z: ZsimpComplex): ZsimpComplex {
    if (Math.hypot(z.re, z.im) < 1e-3) {
        const t = mul(z, z);
        return add(cx(1), add(scale(t, -1 / 3), add(scale(mul(t, t), 2 / 15), scale(mul(mul(t, t), t), -17 / 315))));
    }
    return div(tanh(z), z);
}
function invXSinhX(z: ZsimpComplex): ZsimpComplex {
    // csch(z) = 2 exp(-z)/(1-exp(-2z)); this stays finite for large Re(z).
    const r = Math.exp(-z.re), e = cx(r * Math.cos(z.im), -r * Math.sin(z.im));
    return div(scale(e, 2), mul(z, sub(cx(1), mul(e, e))));
}
function porousImpedance(symbol: "U" | "V" | "M" | "N", get: (field: string) => number, omega: number): ZsimpComplex {
    const u = pow(cx(0, omega / get("w3")), .5);
    let local: ZsimpComplex;
    if (symbol === "U" || symbol === "V")
        local = cothOverX(u);
    else {
        const t = mul(u, u);
        const denominator = Math.hypot(u.re, u.im) < 1e-3
            ? add(scale(t, 1 / 3), add(scale(mul(t, t), -1 / 45), scale(mul(mul(t, t), t), 2 / 945)))
            : sub(xCothX(u), cx(1));
        local = inv(denominator);
    }
    const h = pow(scale(add(cx(0, omega), scale(inv(add(cx(1), scale(local, get("K")))), get("w0"))), 1 / get("w1")), .5);
    if (symbol === "V" || symbol === "N")
        return scale(tanhOverX(h), get("Xa"));
    return add(scale(cothOverX(h), get("Xa")), scale(add(cx(1), scale(invXSinhX(h), 2)), get("Xb")));
}
function elementImpedance(symbol: ZsimpElementSymbol, get: (field: string) => number, omega: number): ZsimpComplex {
    const jw = cx(0, omega), sqrt = pow(jw, 0.5);
    switch (symbol) {
        case "R": return cx(get("R"));
        case "C": return cx(0, -1 / (omega * get("C")));
        case "L": return cx(0, omega * get("L"));
        case "Q": return inv(scale(pow(jw, get("n")), get("Y0")));
        case "W": return inv(scale(sqrt, get("Y0")));
        case "T": return inv(scale(mul(sqrt, tanh(scale(sqrt, get("B")))), get("Y0")));
        case "O": return div(tanh(scale(sqrt, get("B"))), scale(sqrt, get("Y0")));
        case "G": return inv(scale(pow(cx(get("Ka"), omega), 0.5), get("Y0")));
        case "H": return div(pow(add(cx(1), pow(scale(jw, get("tau")), get("mu"))), get("psi")), scale(jw, get("dC")));
        case "P": return scale(cothOverX(pow(scale(jw, 1 / get("w0")), .5)), get("RW"));
        case "U":
        case "V":
        case "M":
        case "N": return porousImpedance(symbol, get, omega);
        case "B": {
            const t = scale(jw, 1 / get("w0")), s = pow(t, .5), h = xCothX(s), q = pow(t, get("n"));
            return scale(div(add(scale(q, get("K")), h), add(scale(mul(q, h), get("K")), t)), 1 / get("Y0"));
        }
        case "J": {
            const t = scale(jw, 1 / get("w0")), s = pow(t, .5), a = tanhOverX(s), b = tanhOverX(scale(s, get("lambda")));
            return scale(div(add(scale(b, get("A")), scale(a, 1 / get("lambda"))), add(scale(mul(t, mul(a, b)), get("A")), cx(1 / get("lambda")))), 1 / get("Y0"));
        }
        case "I": {
            const t = scale(jw, 1 / get("w0")), s = pow(t, .5), a = xCothX(s), b = xCothX(scale(s, get("lambda")));
            return scale(div(add(scale(mul(a, b), get("A")), scale(t, get("lambda"))), mul(t, add(scale(a, get("lambda")), scale(b, get("A"))))), 1 / get("Y0"));
        }
        case "X": {
            const z = scale(inv(add(cx(1), pow(scale(jw, get("Cdl") * get("Rp")), get("n")))), get("Rp"));
            const h = pow(scale(inv(z), get("Rs")), .5);
            return mul(scale(pow(scale(z, get("Rs")), .5), 1 / get("L")), inv(tanh(scale(h, get("Xw")))));
        }
    }
}
function evaluate(node: ZsimpCircuitNode, params: Readonly<Record<string, number>>, omega: number): ZsimpComplex {
    if (node.type === "element")
        return elementImpedance(node.symbol, name => params[`${node.keyPrefix}_${name}`], omega);
    if (node.type === "series")
        return node.children.reduce((sum, child) => add(sum, evaluate(child, params, omega)), cx(0));
    return inv(node.children.reduce((sum, child) => add(sum, inv(evaluate(child, params, omega))), cx(0)));
}
const SPECS = new Map<string, ZsimpCircuitSpec>();
export function zsimpSpec(kind: string): ZsimpCircuitSpec {
    const cached = SPECS.get(kind);
    if (cached)
        return cached;
    const model = zsimpModel(kind), elements = leaves(model.tree);
    const parameters = elements.flatMap(e => ELEMENT_FIELDS[e.symbol].map(field => ({ key: `${e.keyPrefix}_${field.name}`, label: `${e.id} · ${field.label}`, unit: field.unit })));
    const transforms = elements.flatMap(e => ELEMENT_FIELDS[e.symbol].map(field => field.transform));
    const spec = { parameters, transforms, impedance: (params: Readonly<Record<string, number>>, omega: number) => evaluate(model.tree, params, omega) };
    SPECS.set(kind, spec);
    return spec;
}
const median = (values: number[]) => { const a = [...values].sort((x, y) => x - y), m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export function zsimpInitialGuess(kind: string, points: readonly FitPoint[]): Record<string, number> {
    const ordered = [...points].sort((a, b) => b.frequency - a.frequency);
    if (!ordered.length)
        throw new Error("EIS 数据为空");
    const band = Math.max(1, Math.ceil(ordered.length * .15));
    const high = median(ordered.slice(0, band).map(p => p.zReal)), low = median(ordered.slice(-band).map(p => p.zReal));
    const span = Math.max(Math.abs(low - high), Math.max(...ordered.map(p => Math.abs(p.minusZImag))) * 2, 1e-6);
    const rs = Math.max(high, span * 1e-3, 1e-9), elements = leaves(zsimpModel(kind).tree), rCount = Math.max(1, elements.filter(e => e.symbol === "R").length - 1);
    const reactive = elements.filter(e => "CQHOTWGPBIMNUVX".includes(e.symbol));
    const peak = ordered.reduce((a, b) => b.minusZImag > a.minusZImag ? b : a).frequency;
    const maxW = 2 * Math.PI * ordered[0].frequency, minW = 2 * Math.PI * ordered[ordered.length - 1].frequency;
    const top = zsimpModel(kind).tree;
    const seriesResistance = top.type === "series" ? top.children.find(child => child.type === "element" && child.symbol === "R") : undefined;
    const seriesId = seriesResistance?.type === "element" ? seriesResistance.id : undefined;
    const params: Record<string, number> = {};
    for (const e of elements) {
        const index = reactive.findIndex(x => x.id === e.id), t = index < 0 ? .5 : (index + .5) / Math.max(1, reactive.length);
        const w = reactive.length === 1 ? 2 * Math.PI * peak : Math.exp(Math.log(maxW) * (1 - t) + Math.log(minW) * t);
        const r = span / rCount;
        for (const field of ELEMENT_FIELDS[e.symbol]) {
            let v = 1;
            switch (field.name) {
                case "R":
                    v = e.id === seriesId ? rs : r;
                    break;
                case "C":
                case "dC":
                case "Cdl":
                    v = 1 / (r * w);
                    break;
                case "Y0":
                    v = "BIJ".includes(e.symbol) ? 1 / r : 1 / (r * Math.pow(w, e.symbol === "Q" ? .85 : .5));
                    break;
                case "n":
                case "mu":
                case "psi":
                    v = .85;
                    break;
                case "L":
                    v = e.symbol === "L" ? Math.max(Math.abs(ordered[0].minusZImag) / maxW, r / maxW * .01, 1e-12) : 1;
                    break;
                case "B":
                    v = 1 / Math.sqrt(w);
                    break;
                case "tau":
                    v = 1 / w;
                    break;
                case "Ka":
                case "w0":
                case "w1":
                case "w3":
                    v = w;
                    break;
                case "RW":
                case "Xa":
                case "Xb":
                case "Rp":
                    v = r;
                    break;
                case "Rs":
                    v = rs;
                    break;
                case "K":
                case "A":
                case "lambda":
                case "Xw":
                    v = 1;
                    break;
            }
            params[`${e.keyPrefix}_${field.name}`] = Math.max(v, 1e-18);
        }
    }
    return params;
}
// Finite DC limit is defined explicitly; a diverging low-frequency response is NaN.
export function zsimpTotalResistance(kind: string, params: Readonly<Record<string, number>>): number {
    function dc(node: ZsimpCircuitNode): number {
        if (node.type === "element") {
            const get = (n: string) => params[`${node.keyPrefix}_${n}`];
            switch (node.symbol) {
                case "R": return get("R");
                case "L": return 0;
                case "O": return get("B") / get("Y0");
                case "G": return 1 / (get("Y0") * Math.sqrt(get("Ka")));
                case "J": return (1 + get("A") * get("lambda")) / get("Y0");
                case "V":
                case "N": return get("Xa");
                case "X": {
                    const h = get("Xw") * Math.sqrt(get("Rs") / get("Rp"));
                    return Math.sqrt(get("Rs") * get("Rp")) / get("L") / Math.tanh(h);
                }
                default: return Infinity;
            }
        }
        if (node.type === "series")
            return node.children.reduce((sum, c) => sum + dc(c), 0);
        const values = node.children.map(dc);
        if (values.includes(0))
            return 0;
        const y = values.reduce((sum, r) => sum + 1 / r, 0);
        return y > 0 ? 1 / y : Infinity;
    }
    const value = dc(zsimpModel(kind).tree);
    return Number.isFinite(value) ? value : Number.NaN;
}
