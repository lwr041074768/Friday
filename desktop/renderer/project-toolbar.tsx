import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {FilePlus2,FolderOpen,Save,SaveAll,Undo2,Redo2,Check,Folder,LoaderCircle} from 'lucide-react';
import {projectStore} from '@/lib/project-state';
import {desktop,type RecoveryInfo} from './native';
const formatStamp=(iso:string)=>{const date=new Date(iso);return Number.isNaN(date.getTime())?iso:date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});};
export default function ProjectToolbar(){
 const revision=useSyncExternalStore(projectStore.subscribe,projectStore.getRevision,projectStore.getRevision),status=projectStore.status();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),lock=useRef(false);
 const [recovery,setRecovery]=useState<RecoveryInfo|null>(null),[autoSaved,setAutoSaved]=useState('');
 useEffect(()=>{
  let cancelled=false;
  desktop().recoveryInfo().then(info=>{if(!cancelled&&info&&!projectStore.hasData())setRecovery(info);}).catch(()=>{});
  return()=>{cancelled=true;};
 },[]);
 useEffect(()=>{
  // Best-effort snapshot for crash/second-launch recovery. Only a dirty project with data is written.
  let running=false;
  const snapshot=async()=>{
   if(running)return;
   const current=projectStore.status();
   if(!current.dirty||!projectStore.hasData())return;
   running=true;
   try{
    const result=await desktop().saveRecovery({text:projectStore.serialize(desktop().version)});
    if(result.saved)setAutoSaved(new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}));
   }catch{/* Autosave must never interrupt editing or saving. */}
   finally{running=false;}
  };
  const timer=window.setInterval(()=>void snapshot(),60000);
  const onVisibility=()=>{if(document.visibilityState==='hidden')void snapshot();};
  document.addEventListener('visibilitychange',onVisibility);
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility);};
 },[]);
 useEffect(()=>{void desktop().setProjectStatus({dirty:status.dirty,hasData:projectStore.hasData()||!!status.fileName||status.name!=='未命名项目'}).catch(()=>{});},[revision]);
 const action=useCallback(async(kind:string)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
  try{
   if(document.querySelector('[role="dialog"][data-state="open"]'))throw Error('请先完成或关闭当前对话框，再操作项目。');
   if(kind==='undo'){projectStore.undo();return;}if(kind==='redo'){projectStore.redo();return;}
   const current=projectStore.status();
   if(kind==='new'||kind==='open'){
    if(document.querySelector('[role="dialog"][data-state="open"]'))throw Error('请先完成或关闭当前对话框，再切换项目。');
    if(current.dirty&&(projectStore.hasData()||current.fileName||current.name!=='未命名项目')&&!await desktop().confirmProjectReplace(kind))return;
    if(kind==='new'){await desktop().resetProjectPath();projectStore.reset();setMessage('已新建空白项目');}
    else{const file=await desktop().openProject();if(file){projectStore.load(file.text,file.fileName);await desktop().acceptProject(file.token);setMessage('已恢复项目中的数据、分析和窗口');}}
    setRecovery(null);
    void desktop().clearRecovery().catch(()=>{});
    setAutoSaved('');
   }else if(kind==='save'||kind==='save-as'){
    const text=projectStore.serialize(desktop().version),captured=projectStore.getRevision(),result=await desktop().saveProject({text,saveAs:kind==='save-as'});
    if(result.saved&&result.fileName){projectStore.saved(result.fileName,captured);setMessage(`已保存 ${result.fileName}`);void desktop().clearRecovery().catch(()=>{});setAutoSaved('');}
   }
  }catch(error){setMessage(error instanceof Error?error.message:'项目操作失败，请重试。');}
  finally{lock.current=false;setBusy(false);}
 },[]);
 useEffect(()=>desktop().onProjectAction(kind=>{void action(kind);}),[action]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{if(!(event.ctrlKey||event.metaKey))return;const text=event.target instanceof Element&&event.target.closest('input,textarea,[contenteditable=true]');const value=event.key.toLowerCase();if(value==='s'){event.preventDefault();void action(event.shiftKey?'save-as':'save');}else if(value==='z'&&!text){event.preventDefault();void action(event.shiftKey?'redo':'undo');}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[action]);
 async function restoreRecovery(){
  if(!recovery)return;
  try{
   const file=await desktop().readRecovery();
   if(!file){setRecovery(null);setMessage('自动恢复副本已不存在。');return;}
   projectStore.recover(file.text);
   setRecovery(null);setAutoSaved('');
   setMessage(`已恢复 ${formatStamp(recovery.savedAt)} 的自动保存副本，请确认后保存项目`);
  }catch(error){setMessage(error instanceof Error?error.message:'恢复失败，请重试。');}
 }
 async function discardRecovery(){
  setRecovery(null);await desktop().clearRecovery().catch(()=>{});setMessage('已忽略自动恢复副本。');
 }
 return <>{recovery&&<div className="studio-recovery-banner" role="alert">
  <div className="studio-recovery-copy"><strong>发现未保存的自动恢复副本</strong><span>{recovery.name||'未命名项目'} · {formatStamp(recovery.savedAt)} · {(recovery.bytes/1024/1024).toFixed(1)} MB</span></div>
  <div className="studio-recovery-actions"><button className="lsv-button primary" onClick={()=>void restoreRecovery()}>恢复</button><button className="lsv-button secondary" onClick={()=>void discardRecovery()}>忽略并删除</button></div>
 </div>}<div className="studio-project-bar" aria-label="项目操作">
  <div className="studio-project-identity"><span className="studio-project-glyph"><Folder size={16}/></span><input aria-label="项目名称" title={status.fileName||'项目名称'} value={status.name} onChange={e=>projectStore.rename(e.target.value)} maxLength={120}/><span className={`studio-project-state ${status.dirty?'is-dirty':''}`} aria-live="polite">{busy?<LoaderCircle size={12}/>:status.dirty?<i/>:<Check size={12}/>}<span>{busy?'处理中':status.dirty?'未保存':status.fileName?'已保存':'已就绪'}</span></span></div>
  <div className="studio-project-actions"><button disabled={busy} onClick={()=>void action('new')} title="新建项目 · Ctrl+N"><FilePlus2 size={15}/><span>新建</span></button><button disabled={busy} onClick={()=>void action('open')} title="打开项目 · Ctrl+Shift+O"><FolderOpen size={15}/><span>打开项目</span></button><button className="studio-save-project" disabled={busy} onClick={()=>void action('save')} title="保存项目 · Ctrl+S"><Save size={15}/><span>保存项目</span></button><button disabled={busy} onClick={()=>void action('save-as')} title="项目另存为 · Ctrl+Shift+S" aria-label="项目另存为"><SaveAll size={15}/></button><span className="studio-action-divider"/><button disabled={busy||!status.canUndo} onClick={()=>void action('undo')} title="撤销分析操作" aria-label="撤销分析操作"><Undo2 size={15}/></button><button disabled={busy||!status.canRedo} onClick={()=>void action('redo')} title="重做分析操作" aria-label="重做分析操作"><Redo2 size={15}/></button></div>
  <span className="studio-project-message" role="status" title={message||status.fileName}>{message||status.fileName||(autoSaved?`已自动保存 ${autoSaved}`:'数据 · 分析 · 图形，随项目一起保存')}</span>
 </div></>;
}
