"use client";
import {useMemo,type ReactNode} from 'react';
import type {PlotCurve} from '@/lib/lsv-math';
import type {ScanMode} from '@/lib/scan-branches';
import {readTarget} from '@/lib/lsv-target';
import {OVERPOTENTIAL_TARGET_SETTINGS} from '@/lib/overpotential-data';

export default function LsvEtaSummary({curves,scan,action}:{curves:PlotCurve[];scan:ScanMode;action?:ReactNode}){
  const readings=useMemo(()=>curves.filter(c=>c.visible).map(c=>({curve:c,reading:readTarget(c,scan,OVERPOTENTIAL_TARGET_SETTINGS)})),[curves,scan]);
  return <div className="lsv-eta-panel" aria-label="10 mA每平方厘米的交点读数">
    <div className="lsv-eta-content"><div className="lsv-eta-title"><strong title="10 mA·cm⁻² 时的过电位：按当前 LSV 曲线已应用的 IR 读取">η₁₀ · 已应用 IR</strong><span>{scan==='down'?'反扫':'正扫'}</span></div>
    <div className="lsv-eta-readings" aria-live="polite">{readings.length?readings.map(({curve,reading})=><div className="lsv-eta-row" key={curve.id} data-eta-curve-id={curve.id} data-eta-status={reading.status} data-eta-mv={reading.etaMV??''} data-target-e={reading.e??''} data-target-x={reading.x??''} title={reading.note}>
      <i style={{background:curve.color}} aria-hidden="true"/><span className="lsv-eta-name">{curve.name}</span><b>{reading.etaMV===undefined?'—':`≈ ${reading.etaMV.toFixed(1)} mV`}</b>{reading.x!==undefined&&<small className="lsv-eta-coordinate">X = {Number(reading.x.toPrecision(7))} V</small>}{(reading.etaMV===undefined||reading.etaMV<0)&&<small>{reading.etaMV===undefined?reading.note:'过电位为负，请核对 IR 与数据'}</small>}
    </div>):<p>导入样品后显示对应的 η₁₀。</p>}</div>
    <small className="lsv-eta-basis" title="X@10 为当前曲线的交点横坐标，已包含该样品已应用的 IR，计算时不再重复校正">η₁₀ =（X@10 − 1.23 V）×1000 mV</small></div>
    {action&&<div className="lsv-eta-export">{action}</div>}
  </div>;
}
