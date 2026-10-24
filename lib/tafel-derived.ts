import { exchangeCurrentDensity, slopeConfidence } from "./tafel-auto";
import type { TafelFitResult } from "./tafel-analysis";

/** Shared by the result table and both CSV exports: X already uses mA or mA/cm². */
export function tafelDerivedMetrics(fit: Pick<TafelFitResult, "basis" | "slope" | "intercept" | "slopeSE" | "n">) {
  const density = fit.basis === "density";
  const exchange = exchangeCurrentDensity(fit);
  const value = exchange && Number.isFinite(exchange.value) && exchange.value > 0 ? exchange.value : null;
  const status = !exchange ? "不适用（斜率或截距无效，或斜率为 0）"
    : !Number.isFinite(exchange.value) ? "指数溢出，仅保留 log₁₀ 值"
    : exchange.value === 0 ? "指数下溢，仅保留 log₁₀ 值" : "有效";
  const interval = slopeConfidence(fit, .95);
  const low = interval.low * 1000, high = interval.high * 1000;
  return {
    exchange: {
      symbol: density ? "j₀" : "I₀",
      label: density ? "外推交换电流密度 j₀" : "外推交换电流 I₀",
      unit: density ? "mA cm⁻²" : "mA",
      xLabel: density ? "log₁₀ |j / (mA cm⁻²)|" : "log₁₀ |I / mA|",
      logLabel: density ? "log₁₀(j₀ / (mA cm⁻²))" : "log₁₀(I₀ / mA)",
      value, log10: exchange?.log10 ?? null, status,
    },
    slopeCI: {
      level: .95,
      dof: Number.isInteger(fit.n) && fit.n >= 3 ? fit.n - 2 : null,
      low: Number.isFinite(low) ? low : null,
      high: Number.isFinite(high) ? high : null,
      unit: "mV/dec",
    },
  };
}

export const TAFEL_DERIVED_NOTE = "交换电流为所选直线外推至 η=0 的数值，单位沿用横轴；需核对参比、IR 与适用区间。95% 区间仅表示固定所选区间下普通最小二乘的斜率不确定度，不含选区和实验参数不确定度。";
