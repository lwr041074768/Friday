"use client";
import { preventStaticTextCaret } from "@/lib/plot-ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function LsvHelpDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onMouseDownCapture={preventStaticTextCaret} className="lsv-help-modal">
    <DialogHeader><DialogTitle>LSV 基础知识</DialogTitle><DialogDescription>了解曲线、IR 校正与 10 mA·cm⁻² 读数。</DialogDescription></DialogHeader>
    <div className="lsv-help-content">
      <section><h3>LSV 是什么？</h3><p>线性扫描伏安法：让电极电位随时间线性变化，同时记录电流，得到电流随电位变化的曲线。<a href="https://goldbook.iupac.org/terms/view/09141/plain" target="_blank" rel="noreferrer">IUPAC 定义 ↗</a></p></section>
      <section><h3>横纵轴怎么读？</h3><p>横轴按本页固定公式校正电位，纵轴为原始第二列 × 1000。电流密度 j = I × 1000 / S；原始电流为 A、面积为 1 cm² 时，当前纵轴数值才等于 mA·cm⁻²。</p></section>
      <section><h3>扫描速度有什么影响？</h3><p>扫描速度是电位变化速率，常用 mV/s。它会影响电容电流、峰形和非稳态响应；比较样品时应保持扫描速度及测试条件一致。<a href="https://www.biologic.net/topics/what-is-cv-a-comprehensive-guide-to-cyclic-voltammetry/" target="_blank" rel="noreferrer">BioLogic 说明 ↗</a></p></section>
      <section><h3>IR 框表示什么？</h3><p>欧姆损失通常按 I × R 校正。本页输入值直接乘原始第二列 B1；第二列单位为 A 时，输入系数的单位为 Ω。已补偿的数据应避免重复扣除。<a href="https://my.biologic.net/documents/ohmic-drop-effect-on-measurements-electrochemistry-battery-corrosion-application-note-27/" target="_blank" rel="noreferrer">IR 校正说明 ↗</a></p></section>
      <section><h3>η₁₀ 怎么计算？</h3><p>读取当前 IR 调整后的曲线在 10 mA·cm⁻² 处的横坐标，计算 η₁₀ = (E@10 − 1.23) × 1000 mV。其 OER 过电位含义以电位已正确换算至 RHE 为前提；参比电极、填充液及 pH 应与公式一致。<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6858349/" target="_blank" rel="noreferrer">研究中的定义 ↗</a></p></section>
      <section><h3>氧化峰就是产氧吗？</h3><p>不一定。材料自身氧化可出现在催化产氧之前，不能把前峰的首次 10 mA·cm⁻² 交点直接当作 OER 性能。本页“氧化峰／还原峰”按钮按你的设置切换升电位／降电位扫描段；正扫读数优先选取氧化峰后的交点，自动定位结果仍需核对。<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6858349/" target="_blank" rel="noreferrer">Ni/Fe 原始研究 ↗</a></p></section>
    </div>
  </DialogContent></Dialog>;
}
