import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Settings2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readJadeClipboardPacket } from '@/lib/xrd-jade';
import { XRD_REFERENCE_COLORS, type ReferenceCard } from '@/lib/xrd-reference-types';
import { desktop } from './native';

export default function XrdJadeReader({ cards, onCardsChange, wavelength, onWavelengthChange }: { cards: ReferenceCard[]; onCardsChange: (cards: ReferenceCard[]) => void; wavelength: number; onWavelengthChange: (n: number) => void }) {
  const [setup, setSetup] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [wave, setWave] = useState(String(wavelength));
  const latest = useRef(cards); latest.current = cards;
  const pending = useRef('');
  useEffect(() => () => { if (pending.current) void desktop().cancelJade(pending.current); pending.current = ''; }, []);
  useEffect(() => setWave(String(wavelength)), [wavelength]);
  async function read() {
    if (reading) return;
    const id = crypto.randomUUID(); pending.current = id;
    setReading(true); setError(''); setStatus('正在读取 JADE 当前卡片；Windows 询问权限时请确认。');
    try {
      const value = await desktop().readJade(id);
      if (pending.current !== id) return;
      const card = readJadeClipboardPacket(value, id);
      if (!card) throw Error('JADE 未返回本次卡片数据，请重新读取。');
      const existing = latest.current, same = existing.find(item => item.sourceId === card.sourceId && item.source === 'jade');
      if (!same && existing.length >= 20) throw Error('最多保留 20 张卡片，请先移除一张。');
      if (same) onCardsChange(existing.map(item => item.id === same.id ? { ...card, id: same.id, color: same.color, visible: same.visible } : item));
      else onCardsChange([...existing, { ...card, color: XRD_REFERENCE_COLORS[existing.length % XRD_REFERENCE_COLORS.length], visible: existing.filter(item => item.visible).length < 6 }]);
      setStatus(`已读取 PDF#${card.sourceId} · ${card.peaks.length} 条峰线，峰棒已加入画布。`);
    } catch (cause) { if (pending.current === id) { setStatus(''); setError(cause instanceof Error ? cause.message : '读取 JADE 失败。'); } }
    finally { if (pending.current === id) { setReading(false); pending.current = ''; } }
  }
  function cancel() {
    const id = pending.current; pending.current = '';
    setReading(false); setStatus('已取消本次读取。');
    if (id) void desktop().cancelJade(id);
  }
  function toggle(card: ReferenceCard) {
    if (!card.visible && cards.filter(item => item.visible).length >= 6) { setError('最多同时显示 6 张卡片，请先隐藏一张。'); return; }
    onCardsChange(cards.map(item => item.id === card.id ? { ...item, visible: !item.visible } : item)); setError('');
  }
  return <>
    <section className="lsv-curves-panel xrd-jade-reader">
      <div className="lsv-curves-heading"><h2>JADE 标准卡</h2><button aria-label="JADE 连接设置" title="JADE 连接说明" onClick={() => setSetup(true)}><Settings2 size={16}/></button></div>
      <button className="lsv-button primary" onClick={() => void read()} disabled={reading}>{reading ? '正在读取…' : '从 JADE 读取'}</button>
      {reading && <button className="lsv-button secondary" onClick={cancel}>取消读取</button>}
      <p className="lsv-subtle">在 JADE 9 中打开一张卡片详细窗口，即可直接读取。</p>
      {status && <p className="lsv-import-message" role="status">{status}</p>}{error && <p className="lsv-error" role="alert">{error}</p>}
      {cards.map(card => <div className="xrd-reference-managed" key={card.id}><div><button aria-label={`${card.visible ? '隐藏' : '显示'} JADE 卡片 ${card.sourceId}`} onClick={() => toggle(card)}>{card.visible ? <Eye size={16}/> : <EyeOff size={16}/>}</button><input type="color" aria-label={`JADE 卡片 ${card.sourceId}颜色`} value={card.color} onChange={e => onCardsChange(cards.map(item => item.id === card.id ? { ...item, color: e.target.value } : item))}/><strong>PDF#{card.sourceId}</strong><button aria-label={`删除 JADE 卡片 ${card.sourceId}`} onClick={() => onCardsChange(cards.filter(item => item.id !== card.id))}><Trash2 size={15}/></button></div><small>{card.name} · {card.peaks.length} 条峰线</small><details><summary>来源与说明</summary><p>{card.calculation}</p><p>{card.citation}</p>{card.warnings.map((note, i) => <p key={i}>{note}</p>)}</details></div>)}
      {cards.length > 0 && <details><summary>显示波长 {wavelength} Å</summary><div className="xrd-reference-wave"><label>波长 / Å<input aria-label="JADE 谱图显示波长" type="number" step="any" value={wave} onChange={e => setWave(e.target.value)}/></label><button className="lsv-button secondary" onClick={() => { const n = Number(wave); if (!wave.trim() || !Number.isFinite(n) || n <= 0 || n > 10) { setError('波长需大于 0、不超过 10 Å。'); return; } onWavelengthChange(n); setError(''); }}>应用</button></div><p className="lsv-subtle">请核对仪器波长。改波长只换算峰位，保留源卡片强度。</p></details>}
    </section>
    <Dialog open={setup} onOpenChange={setSetup}><DialogContent className="lsv-help-modal lsv-origin-modal"><DialogHeader><DialogTitle>从 JADE 读取</DialogTitle><DialogDescription>桌面版已内置连接程序。</DialogDescription></DialogHeader><div className="desktop-native-help"><p>在本机 JADE 9 中文版中打开一张标准卡片的详细窗口，点击“从 JADE 读取”，卡片峰棒便会叠加到 XRD 画布。</p><p>只读取当前打开的卡片。卡片号、波长、峰位、强度及来源说明在本机传递。</p><p>当前适配 JADE 9 中文版。JADE 以管理员运行时，Windows 会要求同等权限。</p><button className="lsv-button primary" onClick={() => setSetup(false)}>知道了</button></div></DialogContent></Dialog>
  </>;
}
