import { useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { OverpotentialSnapshot } from '@/lib/overpotential-data';
import type { OverpotentialAxisSettings } from '@/lib/overpotential-axes';
import { prepareOverpotentialOriginExport } from '@/lib/overpotential-origin-export';
import { desktop } from './native';

export default function OverpotentialOriginExport({ snapshot, axisSettings }: { snapshot: OverpotentialSnapshot; axisSettings: OverpotentialAxisSettings }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function transfer() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('正在打开 Origin 并创建柱状图…');
    try {
      const payload = prepareOverpotentialOriginExport(snapshot, axisSettings);
      const result = await desktop().exportOverpotential(JSON.stringify(payload));
      setMessage(result.message);
    } catch (cause) { setMessage(''); setError(cause instanceof Error ? cause.message : '导出至 Origin 失败。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <><button className="lsv-button secondary" disabled={!snapshot.curves.length || busy} onClick={() => void transfer()}><ExternalLink size={16}/>{busy ? '正在导入 Origin…' : '导出至Origin'}</button>{(message || error) && <div className="lsv-origin-toast" role={error ? 'alert' : 'status'}>{!busy && <button aria-label="关闭导出提示" onClick={() => { setMessage(''); setError(''); }}><X size={16}/></button>}<div>{error || message}</div></div>}</>;
}
