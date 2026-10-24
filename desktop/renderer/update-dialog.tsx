import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Download, LoaderCircle, RefreshCw, RotateCw, X } from 'lucide-react';
import { desktop, type UpdateState } from './native';
import './update-dialog.css';

type UpdateAction = 'check' | 'download' | 'install';
type UpdateDialogProps = { open: boolean; onClose: () => void };
const busyPhases = new Set<UpdateState['phase']>(['checking', 'downloading', 'installing']);

function formatBytes(value: number) {
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function releaseDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
}

export default function UpdateDialog({ open, onClose }: UpdateDialogProps) {
  const [state, setState] = useState<UpdateState>({ phase: 'idle', currentVersion: desktop().version });
  const [pendingAction, setPendingAction] = useState<UpdateAction | null>(null);
  const stateRef = useRef(state);
  const eventRevision = useRef(0);
  const operation = useRef<UpdateAction | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const notesId = useId();
  const progressId = useId();

  const applyState = useCallback((next: UpdateState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const fail = useCallback((error: unknown, retryAction: UpdateAction) => {
    applyState({
      ...stateRef.current,
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
      retryAction,
    });
  }, [applyState]);

  const runAction = useCallback(async (action: UpdateAction) => {
    if (operation.current || busyPhases.has(stateRef.current.phase)) return;
    if (action === 'download' && stateRef.current.phase !== 'available' && stateRef.current.phase !== 'error') return;
    if (action === 'install' && stateRef.current.phase !== 'ready' && stateRef.current.phase !== 'error') return;
    operation.current = action;
    setPendingAction(action);
    const revision = eventRevision.current;
    try {
      if (action === 'install') {
        const result = await desktop().installUpdate();
        if (!result.started) applyState(await desktop().getUpdateState());
        else if (stateRef.current.phase !== 'installing') applyState({ ...stateRef.current, phase: 'installing' });
      } else {
        const next = await (action === 'check' ? desktop().checkForUpdates() : desktop().downloadUpdate());
        // A progress event may already be newer than the returned snapshot.
        if (revision === eventRevision.current) applyState(next);
      }
    } catch (error) {
      fail(error, action);
    } finally {
      operation.current = null;
      setPendingAction(null);
    }
  }, [applyState, fail]);

  useEffect(() => {
    let mounted = true;
    const remove = desktop().onUpdateState(next => {
      eventRevision.current++;
      applyState(next);
    });
    const revision = eventRevision.current;
    void desktop().getUpdateState().then(next => {
      if (mounted && revision === eventRevision.current) applyState(next);
    }).catch(() => { /* Opening the dialog provides a visible retry path. */ });
    return () => { mounted = false; remove(); };
  }, [applyState]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    let cancelled = false;
    const revision = eventRevision.current;
    void desktop().getUpdateState().then(next => {
      if (cancelled) return;
      if (revision === eventRevision.current) applyState(next);
      if (['idle', 'current', 'error'].includes(stateRef.current.phase)) void runAction('check');
    }).catch(error => { if (!cancelled) fail(error, 'check'); });
    return () => { cancelled = true; };
  }, [open, applyState, fail, runAction]);

  useEffect(() => {
    // The action button disappears after confirmation. Keep a useful focus
    // target in the modal while every close control is temporarily disabled.
    if (open && state.phase === 'installing') headingRef.current?.focus({ preventScroll: true });
  }, [open, state.phase]);

  const phase = pendingAction === 'check' ? 'checking' : state.phase;
  const busy = !!pendingAction || busyPhases.has(phase);
  const title = phase === 'checking' ? '正在检查更新' : phase === 'available' ? '发现新版本' : phase === 'current' ? '当前已是最新版本' : phase === 'downloading' ? '正在下载更新' : phase === 'ready' ? '更新已准备就绪' : phase === 'installing' ? '正在准备更新' : phase === 'error' ? '更新未完成' : '检查软件更新';
  const description = phase === 'checking' ? '正在获取最新版本信息，请稍候。' : phase === 'available' ? '下载完成后，可重启软件并安装更新。' : phase === 'current' ? '已完成检查，无需更新。' : phase === 'downloading' ? '下载期间可以关闭此窗口，软件会继续下载。' : phase === 'ready' ? '点击“重启并更新”后，软件将关闭并安装新版本。' : phase === 'installing' ? '正在后台准备更新文件，完成后将自动关闭并重启软件。请稍候。' : phase === 'error' ? '请查看下方原因后重试。' : '检查是否有可下载的新版本。';
  const percent = typeof state.percent === 'number' && Number.isFinite(state.percent) ? Math.min(100, Math.max(0, state.percent)) : undefined;
  const downloaded = typeof state.downloadedBytes === 'number' && Number.isFinite(state.downloadedBytes) ? Math.max(0, state.downloadedBytes) : 0;
  const total = typeof state.totalBytes === 'number' && Number.isFinite(state.totalBytes) && state.totalBytes > 0 ? state.totalBytes : undefined;
  const published = releaseDate(state.publishedAt);
  const retry = state.retryAction ?? 'check';

  return <dialog ref={dialogRef} className="desktop-update-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); if (stateRef.current.phase !== 'installing') onClose(); }} onClose={onClose}>
    <div className="desktop-update-topline"><span>软件更新</span><button type="button" className="desktop-update-close" aria-label="关闭更新窗口" disabled={phase === 'installing'} onClick={onClose}><X size={18}/></button></div>
    <div className="desktop-update-content">
      <div className="desktop-update-heading" role="status" aria-live="polite">
        <span className="desktop-update-symbol" aria-hidden="true">{busy ? <LoaderCircle className="desktop-update-spinner" size={25}/> : phase === 'current' || phase === 'ready' ? <CheckCircle2 size={25}/> : <RefreshCw size={25}/>}</span>
        <div><h2 ref={headingRef} tabIndex={-1} id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
      </div>
      <dl className="desktop-update-versions"><div><dt>当前版本</dt><dd>v{state.currentVersion}</dd></div><div><dt>最新版本</dt><dd>{state.version ? `v${state.version}` : phase === 'current' ? `v${state.currentVersion}` : phase === 'checking' ? '检查中…' : '尚未获取'}</dd></div></dl>
      {published && <p className="desktop-update-published">发布日期：{published}</p>}
      {state.notes && <section className="desktop-update-notes" aria-labelledby={notesId}><h3 id={notesId}>更新内容</h3><p>{state.notes}</p></section>}
      {phase === 'downloading' && <div className="desktop-update-progress"><div><label htmlFor={progressId}>下载进度</label><span>{percent === undefined ? '正在下载…' : `${Math.round(percent)}%`}</span></div><progress id={progressId} max={100} value={percent} aria-label="更新下载进度"/><p>{formatBytes(downloaded)}{total ? ` / ${formatBytes(total)}` : ''}</p></div>}
      {phase === 'error' && <p className="desktop-update-error" role="alert">{state.error || '暂时无法完成更新，请稍后重试。'}</p>}
    </div>
    <footer className="desktop-update-actions">
      <button type="button" className="desktop-update-secondary" disabled={phase === 'installing'} onClick={onClose}>关闭</button>
      {(phase === 'idle' || phase === 'current') && <button type="button" className="desktop-update-primary" disabled={busy} onClick={() => void runAction('check')}><RefreshCw size={16}/>再次检查</button>}
      {phase === 'available' && <button type="button" className="desktop-update-primary" disabled={busy} onClick={() => void runAction('download')}><Download size={16}/>下载更新</button>}
      {phase === 'ready' && <button type="button" className="desktop-update-primary" disabled={busy} onClick={() => void runAction('install')}><RotateCw size={16}/>重启并更新</button>}
      {phase === 'error' && <button type="button" className="desktop-update-primary" disabled={busy} onClick={() => void runAction(retry)}><RefreshCw size={16}/>{retry === 'download' ? '重新下载' : retry === 'install' ? '重试安装' : '重新检查'}</button>}
    </footer>
  </dialog>;
}
