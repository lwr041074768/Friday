import { referencePeaksAtWavelength, type ReferenceCard, type ReferencePeak } from "./xrd-reference-types";

export type XrdReferenceComparisonOptions = {
  targetWavelength?: number;
  toleranceDeg?: number;
  minIntensity?: number;
  minTwoTheta?: number;
  maxTwoTheta?: number;
};
export type XrdReferencePeakMatch = {
  cod: ReferencePeak;
  jade: ReferencePeak;
  /** Always COD minus imported JADE/TXT, in degrees. */
  deltaTwoTheta: number;
  /** Independently normalized within comparison range. Null at different source wavelengths. */
  deltaIntensity: number | null;
};
export type XrdReferenceComparison = {
  matches: XrdReferencePeakMatch[];
  unmatchedCod: ReferencePeak[];
  unmatchedJade: ReferencePeak[];
  excludedCodCount: number;
  excludedJadeCount: number;
  summary: {
    matchedCount: number;
    codCount: number;
    jadeCount: number;
    meanAbsDeltaTwoTheta: number | null;
    maxAbsDeltaTwoTheta: number | null;
    meanAbsDeltaIntensity: number | null;
  };
  wavelength: number;
  toleranceDeg: number;
  range: { min: number; max: number };
  intensityComparable: boolean;
  warnings: string[];
};

function prepared(card: ReferenceCard, wavelength: number): ReferencePeak[] {
  return referencePeaksAtWavelength(card, wavelength)
    .filter(peak => Number.isFinite(peak.twoTheta) && peak.twoTheta > 0 && peak.twoTheta < 180 && Number.isFinite(peak.intensity) && peak.intensity >= 0 && Number.isFinite(peak.d) && peak.d > 0)
    .sort((a, b) => a.twoTheta - b.twoTheta);
}

function normalize(peaks: ReferencePeak[]): ReferencePeak[] {
  const maximum = Math.max(0, ...peaks.map(peak => peak.intensity));
  return maximum > 0 ? peaks.map(peak => ({ ...peak, intensity: peak.intensity / maximum * 100 })) : peaks.map(peak => ({ ...peak }));
}

/**
 * Sorted one-dimensional matching admits a noncrossing optimum for |position
 * residual|. Dynamic programming first maximizes cardinality, then minimizes
 * total absolute residual. Every peak can be used once; nearest-neighbour
 * greedy matching can lose valid pairs and is intentionally not used.
 */
function assign(cod: ReferencePeak[], jade: ReferencePeak[], tolerance: number): [number, number][] {
  const n = cod.length, m = jade.length;
  if (n > 4000 || m > 4000) throw new Error("单张参考卡不能超过 4,000 个峰，请缩小比较范围。");
  const directions = new Uint8Array(n * m);
  let previousCounts = new Uint16Array(m + 1), currentCounts = new Uint16Array(m + 1);
  let previousCosts = new Float64Array(m + 1), currentCosts = new Float64Array(m + 1);
  for (let i = 1; i <= n; i++) {
    currentCounts[0] = 0; currentCosts[0] = 0;
    for (let j = 1; j <= m; j++) {
      let count = previousCounts[j], cost = previousCosts[j], direction = 1;
      if (currentCounts[j - 1] > count || (currentCounts[j - 1] === count && currentCosts[j - 1] < cost - 1e-12)) {
        count = currentCounts[j - 1]; cost = currentCosts[j - 1]; direction = 2;
      }
      const residual = Math.abs(cod[i - 1].twoTheta - jade[j - 1].twoTheta);
      if (residual <= tolerance + 1e-10) {
        const pairCount = previousCounts[j - 1] + 1, pairCost = previousCosts[j - 1] + residual;
        if (pairCount > count || (pairCount === count && pairCost < cost - 1e-12)) {
          count = pairCount; cost = pairCost; direction = 3;
        }
      }
      currentCounts[j] = count; currentCosts[j] = cost; directions[(i - 1) * m + j - 1] = direction;
    }
    [previousCounts, currentCounts] = [currentCounts, previousCounts];
    [previousCosts, currentCosts] = [currentCosts, previousCosts];
  }
  const pairs: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const direction = directions[(i - 1) * m + j - 1];
    if (direction === 3) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (direction === 1) i--;
    else j--;
  }
  return pairs.reverse();
}

export function compareXrdReferenceCards(codCard: ReferenceCard, jadeCard: ReferenceCard, options: XrdReferenceComparisonOptions = {}): XrdReferenceComparison {
  if (codCard.source !== "cod" || jadeCard.source !== "jade") throw new Error("请选择一张 COD 计算参考卡和一张本地 JADE/TXT 卡，差值方向统一为 COD − JADE。");
  const wavelength = options.targetWavelength ?? jadeCard.wavelength;
  const toleranceDeg = options.toleranceDeg ?? 0.15;
  const minimumIntensity = options.minIntensity ?? 0;
  if (!Number.isFinite(wavelength) || wavelength <= 0 || wavelength > 10) throw new Error("比较波长需为 0–10 Å 之间的有效数值。");
  if (!Number.isFinite(toleranceDeg) || toleranceDeg <= 0 || toleranceDeg > 5) throw new Error("峰位匹配容差需大于 0、不超过 5°。");
  if (!Number.isFinite(minimumIntensity) || minimumIntensity < 0 || minimumIntensity > 100) throw new Error("最低相对强度需在 0–100 之间。");
  const allCod = prepared(codCard, wavelength), allJade = prepared(jadeCard, wavelength);
  if (!allCod.length || !allJade.length) throw new Error("某张卡在该波长下没有有效衍射峰，无法比较。");
  // The hull union keeps shifted boundary peaks available for pairing. A peak
  // list's endpoints cannot establish experimental scan coverage; explicit
  // equal bounds are needed when the cards have different documented coverage.
  const min = options.minTwoTheta ?? Math.min(allCod[0].twoTheta, allJade[0].twoTheta);
  const max = options.maxTwoTheta ?? Math.max(allCod.at(-1)!.twoTheta, allJade.at(-1)!.twoTheta);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max >= 180 || min > max) throw new Error("没有有效的 2θ 比较范围；请填写相同的比较范围。");
  const inRange = (peak: ReferencePeak) => peak.twoTheta >= min - 1e-10 && peak.twoTheta <= max + 1e-10;
  const cod = normalize(allCod.filter(inRange)).filter(peak => peak.intensity >= minimumIntensity);
  const jade = normalize(allJade.filter(inRange)).filter(peak => peak.intensity >= minimumIntensity);
  if (!cod.length || !jade.length) throw new Error("比较范围和强度筛选后某张卡没有峰，请调整范围或最低强度。");
  const wavelengthTolerance = 1e-4;
  const intensityComparable = Math.abs(codCard.wavelength - jadeCard.wavelength) <= wavelengthTolerance && Math.abs(wavelength - codCard.wavelength) <= wavelengthTolerance;
  const warnings: string[] = ["一对一匹配按峰位容差最大化配对数，再最小化峰位残差；配对不等于物相鉴定，也不表示准确率。"];
  if (options.minTwoTheta === undefined || options.maxTwoTheta === undefined) warnings.push("未指定完整范围，使用两张卡已提供峰位的并集；条目覆盖不同可能产生未匹配峰，请指定相同范围以比较。这不代表完整实验扫描范围。");
  if (!intensityComparable) warnings.push("源波长或比较波长不同，仅按 d 换算后比较峰位；强度未进行波长相关修正，ΔI 暂不比较。请按 JADE 波长重新计算 COD 后比较强度。");
  warnings.push("两张卡强度分别按比较范围内最大值归一到 100；择优取向、峰重叠及实验条件仍可能影响相对强度。");
  const pairs = assign(cod, jade, toleranceDeg), usedCod = new Set(pairs.map(pair => pair[0])), usedJade = new Set(pairs.map(pair => pair[1]));
  const matches = pairs.map(([codIndex, jadeIndex]) => ({
    cod: cod[codIndex], jade: jade[jadeIndex], deltaTwoTheta: cod[codIndex].twoTheta - jade[jadeIndex].twoTheta,
    deltaIntensity: intensityComparable ? cod[codIndex].intensity - jade[jadeIndex].intensity : null,
  }));
  const residuals = matches.map(match => Math.abs(match.deltaTwoTheta));
  const intensityResiduals = matches.flatMap(match => match.deltaIntensity === null ? [] : [Math.abs(match.deltaIntensity)]);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    matches, unmatchedCod: cod.filter((_, index) => !usedCod.has(index)), unmatchedJade: jade.filter((_, index) => !usedJade.has(index)),
    excludedCodCount: codCard.peaks.length - cod.length, excludedJadeCount: jadeCard.peaks.length - jade.length,
    summary: { matchedCount: matches.length, codCount: cod.length, jadeCount: jade.length, meanAbsDeltaTwoTheta: average(residuals), maxAbsDeltaTwoTheta: residuals.length ? Math.max(...residuals) : null, meanAbsDeltaIntensity: average(intensityResiduals) },
    wavelength, toleranceDeg, range: { min, max }, intensityComparable, warnings,
  };
}

function csvCell(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
  return /[,"\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function formatXrdReferenceComparisonCsv(result: XrdReferenceComparison, codCard: ReferenceCard, jadeCard: ReferenceCard): string {
  const rows: (string | number | null | undefined)[][] = [
    ["COD 卡", codCard.name, "COD 编号", codCard.sourceId],
    ["JADE/TXT 卡", jadeCard.name, "卡号", jadeCard.sourceId, "文件", jadeCard.sourceFile],
    ["COD 源波长/Å", codCard.wavelength, "JADE 源波长/Å", jadeCard.wavelength, "比较波长/Å", result.wavelength],
    ["比较范围/°", result.range.min, result.range.max, "匹配容差/°", result.toleranceDeg],
    ["强度", "各卡按比较范围最大值=100", "Δ方向", "COD−JADE", "ΔI可比较", result.intensityComparable ? "是" : "否，波长不同"],
    ["已配对数", result.summary.matchedCount, "COD 范围内峰数", result.summary.codCount, "JADE 范围内峰数", result.summary.jadeCount],
    ["COD 已排除峰数", result.excludedCodCount, "JADE 已排除峰数", result.excludedJadeCount],
    ["平均|Δ2θ|/°", result.summary.meanAbsDeltaTwoTheta, "最大|Δ2θ|/°", result.summary.maxAbsDeltaTwoTheta, "平均|ΔI|", result.summary.meanAbsDeltaIntensity],
    ["说明", ...result.warnings], [],
    ["状态", "COD 2θ/°", "JADE 2θ/°", "Δ2θ(COD−JADE)/°", "COD d/Å", "JADE d/Å", "COD Irel", "JADE Irel", "ΔI(COD−JADE)", "COD hkl", "JADE hkl"],
    ...result.matches.map(match => ["已配对", match.cod.twoTheta, match.jade.twoTheta, match.deltaTwoTheta, match.cod.d, match.jade.d, match.cod.intensity, match.jade.intensity, match.deltaIntensity, match.cod.hkl, match.jade.hkl]),
    ...result.unmatchedCod.map(peak => ["仅 COD", peak.twoTheta, null, null, peak.d, null, peak.intensity, null, null, peak.hkl, null]),
    ...result.unmatchedJade.map(peak => ["仅 JADE/TXT", null, peak.twoTheta, null, null, peak.d, null, peak.intensity, null, null, peak.hkl]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
