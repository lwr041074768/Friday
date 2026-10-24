import ProjectToolbar from './project-toolbar';
import {projectStore,useProjectState} from '@/lib/project-state';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, FolderOpen, HardDrive, Moon, PlayCircle, RefreshCw, Sun, Upload, X } from 'lucide-react';
import { modules, moduleIds, moduleById, type ModuleId } from '../../app/modules';
import type { ModuleRuntime } from '../../app/modules/types';
import { preventStaticTextCaret } from '@/lib/plot-ui';
import { DEFAULT_OVERPOTENTIAL_SNAPSHOT, type OverpotentialSnapshot } from '@/lib/overpotential-data';
import { desktop } from './native';
import { registerVectorPdfRenderer } from '@/lib/figure-export';
import { chooseDataFiles, chooseCdlFolder, choosePhFolder, chooseCvFolder, resolveDroppedFiles } from './native-files';
import {buildPhOrigin} from '../../lib/ph-export';
import type {PhExportOrigin} from '../../app/ph-workspace';
import { exportCdlToOrigin } from './cdl-origin-export';
import { buildRamanOriginExport, type RamanOriginOptions } from '../../lib/raman-origin-export';
import type { CdlSaveTextFile, CdlSaveBinaryFile } from '../../app/cdl-workspace';
import { dispatchDesktopFileDrop, isDesktopFileDrag } from './file-drop';
import StartupIntro from './startup-intro';
import UpdateDialog from './update-dialog';
import './styles.css';

registerVectorPdfRenderer(async request => new Uint8Array(await desktop().renderFigurePdf(request)));
type Tab = ModuleId;
type DesktopTheme = 'day' | 'night';
const themePreferenceKey = 'scientific-plot-studio:desktop-theme';
const initialTheme = (): DesktopTheme => {
  try { return localStorage.getItem(themePreferenceKey) === 'night' ? 'night' : 'day'; }
  catch { return 'day'; }
};
const saveCdlFile: CdlSaveTextFile = async (text,filename,mime) => (await desktop().saveDataFile({text,filename,mime})).saved;
const saveCdlBinaryFile:CdlSaveBinaryFile=async(data,filename,mime)=>(await desktop().saveDataFile({bytes:new Uint8Array(data).buffer,filename,mime})).saved;
const chooseCdlFiles=()=>chooseDataFiles('cdl');
const choosePhFiles=()=>chooseDataFiles('ph');
const chooseCvFiles=()=>chooseDataFiles('cv');
const exportPhToOrigin:PhExportOrigin=(groups,settings)=>desktop().exportPh(JSON.stringify(buildPhOrigin(groups,settings)));
const exportRamanToOrigin=(options:RamanOriginOptions)=>desktop().exportOrigin(JSON.stringify(buildRamanOriginExport(options)));
const initialTab = (): Tab => {
  const value = location.hash.slice(1) || localStorage.getItem('desktop-last-tab');
  return moduleIds.includes(value as Tab) ? value as Tab : 'lsv';
};

function StudioNavigation({tab}:{tab:Tab}){
 useSyncExternalStore(projectStore.subscribe,projectStore.getRevision,projectStore.getRevision);
 const counts=projectStore.summary();
 return <nav className="lsv-tabs studio-tool-rail" aria-label="绘图类型">{modules.map(module=>{const Icon=module.icon,count=counts.find(row=>row.scope===module.scope)?.count??0;return <a key={module.id} href={`#${module.id}`} className={tab===module.id?'active':''} aria-current={tab===module.id?'page':undefined} title={`${module.label} 工作台`}><Icon size={20}/><b>{module.label}</b><span>工作台</span>{count>0&&<i>{count}</i>}</a>;})}<div className="studio-rail-footer">EC<span>LOCAL</span></div></nav>;
}
function DesktopStudio() {
  const [tab, setTab] = useProjectState<Tab>('shell','tab',initialTab);
  const [theme, setTheme] = useState<DesktopTheme>(initialTheme);
  const [showIntro, setShowIntro] = useState(true);
  const [showUpdates, setShowUpdates] = useState(false);
  const finishIntro = useCallback(() => setShowIntro(false), []);
  const closeUpdates = useCallback(() => setShowUpdates(false), []);
  const [lsvSnapshot, setLsvSnapshot] = useState<OverpotentialSnapshot>(DEFAULT_OVERPOTENTIAL_SNAPSHOT);
  const [download, setDownload] = useState('');
  const [fileOver, setFileOver] = useState(false);
  const [dropError,setDropError]=useState('');
  useLayoutEffect(() => {
    document.documentElement.dataset.desktopTheme = theme;
    try { localStorage.setItem(themePreferenceKey, theme); } catch { /* The active theme still works if preference storage is unavailable. */ }
  }, [theme]);
  useLayoutEffect(() => {
    if (!showIntro) return;
    const root = document.getElementById('root');
    const portals = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], [role="listbox"], [data-slot="dialog-overlay"]')].filter(node => !root?.contains(node));
    const saved = portals.map(node => ({ node, inert: node.inert }));
    for (const { node } of saved) node.inert = true;
    return () => { for (const { node, inert } of saved) if (node.isConnected) node.inert = inert; };
  }, [showIntro]);
  useEffect(() => {
    let depth = 0,importing=false;
    const enter = (event: DragEvent) => { if (!isDesktopFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); depth++; setFileOver(true); };
    const over = (event: DragEvent) => { if (!isDesktopFileDrag(event)) return; event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; setFileOver(true); };
    const leave = (event: DragEvent) => { if (!isDesktopFileDrag(event) && !depth) return; event.stopPropagation(); depth = Math.max(0, depth - 1); if (!depth) setFileOver(false); };
    const drop = async (event: DragEvent) => {
      if (!isDesktopFileDrag(event)) return;
      event.preventDefault(); event.stopPropagation(); depth = 0; setFileOver(false);
      setShowIntro(false);
      const current = initialTab(), target = current === 'overpotential' ? 'lsv' : current;
      if (current === 'overpotential') { location.hash = 'lsv'; setTab('lsv'); }
      const files=Array.from(event.dataTransfer?.files || []);
      if(!files.length)return;
      if(importing){setDropError('正在读取文件夹，请稍后再拖入。');return;}
      setDropError('');importing=true;
      try{
        if(target==='ph'||target==='lsv'||target==='cv'||target==='eis')dispatchDesktopFileDrop(target,await resolveDroppedFiles(target,files));
        else{
          const directory=Array.from(event.dataTransfer?.items||[]).some(item=>item.webkitGetAsEntry?.()?.isDirectory);
          if(directory)throw Error('此页面暂不支持拖入文件夹，请直接拖入数据文件。');
          dispatchDesktopFileDrop(target,files);
        }
      }catch(error){setDropError((error as Error).message);}
      finally{importing=false;}
    };
    const end = () => { depth = 0; setFileOver(false); };
    // Capture native Explorer drops before a child plot or upload zone consumes
    // them, so every part of the window imports once into the active workbench.
    window.addEventListener('dragenter', enter, true); window.addEventListener('dragover', over, true);
    window.addEventListener('dragleave', leave, true); window.addEventListener('drop', drop, true);
    window.addEventListener('dragend', end, true);
    return () => {
      window.removeEventListener('dragenter', enter, true); window.removeEventListener('dragover', over, true);
      window.removeEventListener('dragleave', leave, true); window.removeEventListener('drop', drop, true);
      window.removeEventListener('dragend', end, true);
    };
  }, []);
  useEffect(() => {
    document.title = `Friday · 桌面版 v${desktop().version}`;
    const sync = () => setTab(initialTab());
    window.addEventListener('hashchange', sync);
    const removeNavigate = desktop().onNavigate(value => {
      if(document.querySelector('[role="dialog"][data-state="open"]'))return;
      if (moduleIds.includes(value as Tab)) { setShowIntro(false); location.hash = value; }
    });
    const removeIntro = desktop().onStartupIntro?.(() => setShowIntro(true));
    const removeUpdates = desktop().onOpenUpdates(() => { setShowIntro(false); setShowUpdates(true); });
    const removeDownload = desktop().onDownload(setDownload);
    const removeImport = desktop().onOpenImport(() => {
      setShowIntro(false);
      const current = initialTab(), target = current === 'overpotential' ? 'lsv' : current;
      if (current === 'overpotential') { location.hash = 'lsv'; setTab('lsv'); }
      const panel = document.getElementById(`panel-${target}`);
      const button = [...(panel?.querySelectorAll<HTMLButtonElement>('button') || [])].find(item => item.textContent?.trim() === '导入数据');
      button?.click();
    });
    return () => { window.removeEventListener('hashchange', sync); removeNavigate(); removeDownload(); removeImport(); removeIntro?.(); removeUpdates(); };
  }, []);
  useEffect(() => { localStorage.setItem('desktop-last-tab', tab);if(location.hash!=='#'+tab)location.hash=tab; }, [tab]);
  useEffect(() => {
    if (!download) return;
    const timer = setTimeout(() => setDownload(''), 6500);
    return () => clearTimeout(timer);
  }, [download]);
  const runtime: ModuleRuntime = { active: false, snapshot: lsvSnapshot, onSnapshot: setLsvSnapshot, saveCdlFile, saveCdlBinaryFile, chooseCdlFiles, chooseCdlFolder, chooseCvFiles, chooseCvFolder, exportCdlToOrigin, exportRamanToOrigin,choosePhFiles,choosePhFolder,exportPhToOrigin };
  return <><main className="lsv-app desktop-app studio-shell" inert={showIntro} aria-hidden={showIntro || undefined} onMouseDownCapture={preventStaticTextCaret}>
    <header className="lsv-header studio-shell-header"><div className="studio-primary-row">
      <div className="desktop-brand-controls"><a className="lsv-brand" href="#lsv"><span><Activity size={24}/></span><div>Friday<small>ELECTROCATALYSIS STUDIO</small></div></a><button className="desktop-theme-toggle" data-desktop-theme-toggle aria-label={theme === 'night' ? '切换到白天模式' : '切换到夜晚模式'} aria-pressed={theme === 'night'} title={theme === 'night' ? '当前为夜晚模式，点击切换到白天' : '当前为白天模式，点击切换到夜晚'} onClick={() => setTheme(value => value === 'day' ? 'night' : 'day')}>{theme === 'night' ? <Moon size={16}/> : <Sun size={16}/>}<span>{theme === 'night' ? '夜晚' : '白天'}</span></button></div>

      <div className="desktop-status"><span><HardDrive size={15}/>本机运行<span className="desktop-version">v{desktop().version}</span></span><button className="desktop-update-trigger" aria-label="检查更新" title="检查软件更新" onClick={() => setShowUpdates(true)}><RefreshCw size={15}/><span>检查更新</span></button><button aria-label="重播启动动画" title="重播启动动画" onClick={() => setShowIntro(true)}><PlayCircle size={18}/></button><button aria-label="打开本机数据文件夹" title="打开本机数据文件夹" onClick={() => void desktop().showDataFolder()}><FolderOpen size={18}/></button></div>
    </div><ProjectToolbar/></header><StudioNavigation tab={tab}/>
    {modules.map(module => <section key={module.id} id={`panel-${module.id}`} hidden={tab !== module.id} aria-label={`${module.label} 工作台`}>
      {module.render({ ...runtime, active: tab === module.id })}
    </section>)}
    {download && <div className="desktop-download-notice" role="status">已保存：{download}<button aria-label="关闭保存提示" onClick={() => setDownload('')}><X size={15}/></button></div>}
    {dropError&&<div className="desktop-download-notice desktop-import-error" role="alert">{dropError}<button aria-label="关闭导入提示" onClick={()=>setDropError('')}><X size={15}/></button></div>}
    {fileOver && <div className="desktop-file-drop-hint" role="status"><Upload size={30}/><strong>松开文件，导入到 {moduleById.get(tab === 'overpotential' ? 'lsv' : tab)?.label ?? 'LSV'}</strong><span>可一次拖入多个数据文件</span></div>}
  </main><UpdateDialog open={showUpdates} onClose={closeUpdates}/>{showIntro && <StartupIntro onComplete={finishIntro}/>}</>;
}

document.body.classList.add('desktop-body');
document.documentElement.dataset.desktopTheme = initialTheme();
createRoot(document.getElementById('root')!).render(<DesktopStudio/>);
