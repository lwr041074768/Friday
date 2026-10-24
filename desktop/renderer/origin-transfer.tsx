import { useState } from 'react';
import { ExternalLink, Settings2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { desktop } from './native';

export default function OriginTransfer({ enabled, prepare, title, description }: { enabled: boolean; prepare: () => string; title: string; description: string }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  async function transfer() {
    if (busy) return;
    setBusy(true); setError(''); setStatus('正在打开 Origin，写入并核对数据…');
    try { const result = await desktop().exportOrigin(prepare()); setStatus(result.message); }
    catch (cause) { setStatus(''); setError(cause instanceof Error ? cause.message : '导入 Origin 失败。'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="lsv-origin-controls xy-origin-controls">
      <button className="lsv-button secondary lsv-origin-button" disabled={!enabled || busy} onClick={() => void transfer()}><ExternalLink size={16}/>{busy ? '正在导入 Origin…' : '导出至Origin'}</button>
      <button className="lsv-origin-settings" aria-label={`${title} Origin 连接设置`} title="Origin 连接说明" onClick={() => setOpen(true)}><Settings2 size={17}/></button>
    </div>
    {(status || error) && <div className="lsv-origin-toast" role={error ? 'alert' : 'status'}>
      {!busy && <button aria-label="关闭导出提示" onClick={() => { setError(''); setStatus(''); }}><X size={16}/></button>}
      <div>{error || status}</div>
      {!error && <small>{busy ? '数据在本机传递，请等待核对完成。' : '已新建可编辑的 Origin 工作表，请在 Origin 中保存项目。'}</small>}
    </div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="lsv-help-modal lsv-origin-modal"><DialogHeader><DialogTitle>导出至 Origin</DialogTitle><DialogDescription>桌面版已内置连接程序。</DialogDescription></DialogHeader><div className="desktop-native-help"><p>本机安装 Origin 后即可点击“导出至Origin”。应用会直接传递数据并创建新的 Origin 窗口及工作表。</p><p>{description}</p><p>全部样品按原始行序导出，包含隐藏样品、缺口和当前绘图坐标；不按屏幕显示抽稀。已有项目保持独立。</p><button className="lsv-button primary" onClick={() => setOpen(false)}>知道了</button></div></DialogContent></Dialog>
  </>;
}
