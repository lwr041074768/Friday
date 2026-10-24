import {useEffect,useMemo,useRef,useState} from 'react';
import {Upload,FolderOpen,Plus,Trash2,Download,Eye,EyeOff,Settings2,MousePointer2} from 'lucide-react';
import {useProjectEpoch,useProjectState} from '@/lib/project-state';
import {COLORS,type CurrentUnit} from '@/lib/lsv-math';
import {DEFAULT_CV_SETTINGS,analyzeCv,type CvGroup,type CvSeries,type CvSettings} from '@/lib/cv-data';
import {readCvFiles,appendCvFilesToSample,nextCvSampleName,type CvImportItem} from '@/lib/cv-import';
import {cvTables,cvCsv,cvRawCsv,cvXlsx} from '@/lib/cv-export';
import CvFigure,{buildCvExportSvg,cvTraceColor} from '@/components/cv-figure';
import FigureExportDialog from '@/components/figure-export-dialog';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import type {CdlSaveTextFile,CdlSaveBinaryFile} from './cdl-workspace';
import './cv-workspace.css';

type Props={chooseFiles?:()=>Promise<File[]>;chooseFolder?:()=>Promise<File[]>;saveTextFile?:CdlSaveTextFile;saveBinaryFile?:CdlSaveBinaryFile};
const units:CurrentUnit[]=['A','mA','uA','nA','A/cm2','mA/cm2','uA/cm2'];
const unitLabel=(unit:string)=>unit.replace('uA','μA').replace('cm2','cm²');
const format=(value:number|undefined|null,digits=5)=>value===undefined||value===null||!Number.isFinite(value)?'—':Number(value.toPrecision(digits)).toString();
async function browserSave(data:Blob,name:string){const url=URL.createObjectURL(data),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return true;}
const textSave:CdlSaveTextFile=(text,name,mime)=>browserSave(new Blob([text],{type:mime}),name);
const binarySave:CdlSaveBinaryFile=(bytes,name,mime)=>browserSave(new Blob([new Uint8Array(bytes).buffer],{type:mime}),name);

export default function CvWorkspace({chooseFiles,chooseFolder,saveTextFile=textSave,saveBinaryFile=binarySave}:Props={}){
  const [groups,setGroups]=useProjectState<CvGroup[]>('cv','groups',[]);
  const [settings,setSettings]=useProjectState<CvSettings>('cv','settings',DEFAULT_CV_SETTINGS);
  const [activeGroup,setActiveGroup]=useProjectState('cv','active','');
  const [view,setView]=useProjectState<'cv'|'fit'>('cv','view','fit');
  const [selectedSeries,setSelectedSeries]=useState('');
  const [pickBranch,setPickBranch]=useState<'anodic'|'cathodic'|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [fourPointSelection,setFourPointSelection]=useState<{groupId:string;ids:string[]}|null>(null);
  const [pointDetailsOpen,setPointDetailsOpen]=useState(false);
  const [editingSeriesId,setEditingSeriesId]=useState(''),[calculationInfoOpen,setCalculationInfoOpen]=useState(false);
  const [filePage,setFilePage]=useState(0),[legendPage,setLegendPage]=useState(0),[compactViewport,setCompactViewport]=useState(false);
  const workspace=useRef<HTMLDivElement>(null);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [importOpen,setImportOpen]=useState(false),[pending,setPending]=useState<CvImportItem[]>([]);
  const [importWarnings,setImportWarnings]=useState<string[]>([]),[importError,setImportError]=useState(''),[importArea,setImportArea]=useState('1');
  const [removed,setRemoved]=useState<CvGroup[]|null>(null);
  const fileInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),figureHost=useRef<HTMLDivElement>(null),importTarget=useRef<string|null>(null);
  const epoch=useProjectEpoch();
  useEffect(()=>{setImportOpen(false);setSettingsOpen(false);setFourPointSelection(null);setPointDetailsOpen(false);setEditingSeriesId('');setCalculationInfoOpen(false);setFilePage(0);setLegendPage(0);setPending([]);setNotice('');setRemoved(null);setPickBranch(null);setSelectedSeries('');},[epoch]);
  const analysis=useMemo(()=>analyzeCv(groups,settings),[groups,settings]);
  const active=groups.find(group=>group.id===activeGroup)??groups[0];
  const selected=active?.series.find(series=>series.id===selectedSeries)??active?.series[0];
  const count=groups.reduce((sum,group)=>sum+group.series.length,0);
  const anyFit=analysis.groups.some(group=>group.fit),anyTrace=analysis.traces.some(trace=>trace.points.some(Boolean));
  const rows=analysis.groups.flatMap(group=>group.rows);
  const selectedRow=rows.find(row=>row.trace.series.id===selected?.id);
  const activeIndex=Math.max(0,groups.findIndex(group=>group.id===active?.id)),groupPage=Math.floor(activeIndex/3);
  const filePages=Math.max(1,Math.ceil((active?.series.length??0)/4)),safeFilePage=Math.min(filePage,filePages-1);
  const legendTraces=analysis.traces.filter(trace=>trace.visible&&trace.points.some(Boolean)),legendSize=compactViewport?3:6;
  const legendPages=Math.max(1,Math.ceil(legendTraces.length/legendSize)),safeLegendPage=Math.min(legendPage,legendPages-1);
  const currentResult=analysis.groups.find(result=>result.group.id===active?.id);
  const editingGroup=groups.find(group=>group.series.some(series=>series.id===editingSeriesId));
  const editingSeries=editingGroup?.series.find(series=>series.id===editingSeriesId),editingRow=rows.find(row=>row.trace.series.id===editingSeriesId);
  useEffect(()=>{const node=workspace.current;if(!node)return;const measure=()=>{const box=node.getBoundingClientRect();if(!box.width)return;node.style.setProperty('--cv-viewport-height',`${Math.max(420,window.innerHeight-box.top-8)}px`);setCompactViewport(window.innerHeight<850);};measure();const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[]);
  useEffect(()=>{const index=active?.series.findIndex(series=>series.id===selectedSeries)??-1;setFilePage(Math.floor(Math.max(0,index)/4));},[active?.id,selectedSeries]);
  const fourPointGroup=groups.find(group=>group.id===fourPointSelection?.groupId);
  const fourPointSeries=fourPointGroup?.series.filter(series=>fourPointSelection?.ids.includes(series.id))??[];
  const fourPointRates=fourPointSeries.map(series=>Number(series.rate));
  const fourPointValid=fourPointSeries.length===4&&fourPointRates.every(rate=>Number.isFinite(rate)&&rate>0)&&new Set(fourPointRates).size===4;
  const fourPointIssue=fourPointSeries.some(series=>!series.rate.trim()||!Number.isFinite(Number(series.rate))||Number(series.rate)<=0)?'请先核对所选文件的扫速，扫速需要大于 0。':new Set(fourPointRates).size!==fourPointRates.length?'四个拟合点应使用四个不同扫速，请调整重复项。':'';

  function option<K extends keyof CvSettings>(key:K,value:CvSettings[K]){setSettings(current=>({...current,[key]:value}));}
  function changeGroup(id:string,patch:Partial<CvGroup>){setGroups(current=>current.map(group=>group.id===id?{...group,...patch}:group));}
  function changeSeries(id:string,patch:Partial<CvSeries>){setGroups(current=>current.map(group=>({...group,series:group.series.map(series=>series.id===id?{...series,...patch}:series)})));}
  function selectGroup(id:string){setActiveGroup(id);setSelectedSeries('');setPickBranch(null);setFilePage(0);}
  function selectSeries(id:string){const group=groups.find(group=>group.series.some(series=>series.id===id));if(group){setActiveGroup(group.id);setFilePage(Math.floor(group.series.findIndex(series=>series.id===id)/4));}setSelectedSeries(id);setPickBranch(null);}
  function toggle(id:string){const series=groups.flatMap(group=>group.series).find(series=>series.id===id);if(series)changeSeries(id,{included:!series.included});}
  function setAllIncluded(value:boolean){if(active)changeGroup(active.id,{series:active.series.map(series=>({...series,included:value}))});}
  function chooseFourPoints(){
    if(!active)return;
    const included=active.series.filter(series=>series.included);
    const preferred=[20,30,40,80].map(rate=>active.series.find(series=>Number(series.rate)===rate));
    const ids=included.length===4?included.map(series=>series.id):preferred.every(Boolean)?preferred.map(series=>series!.id):included.length<=4?included.map(series=>series.id):[];
    setFourPointSelection({groupId:active.id,ids});
  }
  function toggleFourPoint(id:string){setFourPointSelection(current=>current?{...current,ids:current.ids.includes(id)?current.ids.filter(value=>value!==id):[...current.ids,id]}:current);}
  function applyFourPoints(){
    if(!fourPointSelection||!fourPointGroup||!fourPointValid)return;
    const target=fourPointSelection.groupId,selectedIds=new Set(fourPointSeries.map(series=>series.id));
    setGroups(current=>current.map(group=>group.id===target?{...group,series:group.series.map(series=>({...series,included:selectedIds.has(series.id)}))}:group));
    setFourPointSelection(null);
  }
  function pickPeak(id:string,branch:'anodic'|'cathodic',potential:number){changeSeries(id,{[branch]:String(Number(potential.toPrecision(10)))});setSelectedSeries(id);setPickBranch(null);}

  async function read(files:File[]){
    if(!files.length||busy)return;
    importTarget.current=active?.id??null;setImportArea(active?.series.at(-1)?.area??'1');setBusy(true);setImportError('');setNotice('');
    try{const result=await readCvFiles(files);setPending(result.items);setImportWarnings(result.warnings);setImportOpen(true);}
    catch(error){setNotice((error as Error).message);}finally{setBusy(false);}
  }
  async function pick(folder=false){if(busy)return;try{const choose=folder?chooseFolder:chooseFiles;if(choose)await read(await choose());else(folder?folderInput:fileInput).current?.click();}catch(error){setNotice((error as Error).message);}}
  function drop(files: File[]) {void read(files);}
  function confirmImport(){
    try{const next=appendCvFilesToSample(groups,pending,importArea,importTarget.current);setGroups(next.groups);setActiveGroup(next.groupId);setImportOpen(false);setPending([]);setSelectedSeries('');setPickBranch(null);}
    catch(error){setImportError((error as Error).message);}
  }
  function addGroup(){if(groups.length>=12){setNotice('每个项目最多支持 12 个样品组。');return;}const group:CvGroup={id:crypto.randomUUID(),name:nextCvSampleName(groups),color:COLORS[groups.length%COLORS.length],visible:true,series:[]};setGroups(current=>[...current,group]);selectGroup(group.id);}
  function removeGroup(){if(!active)return;setRemoved(groups);setGroups(current=>current.filter(group=>group.id!==active.id));setSelectedSeries('');setPickBranch(null);}
  function removeSeries(id:string){setRemoved(groups);setGroups(current=>current.map(group=>({...group,series:group.series.filter(series=>series.id!==id)})));if(selected?.id===id)setPickBranch(null);}
  function moveSeries(id:string,destination:string){if(!active||active.id===destination)return;const series=active.series.find(series=>series.id===id);if(!series)return;setGroups(current=>current.map(group=>group.id===active.id?{...group,series:group.series.filter(series=>series.id!==id)}:group.id===destination?{...group,series:[...group.series,series]}:group));setSelectedSeries('');setPickBranch(null);}
  async function save(kind:'xlsx'|'points'|'fits'|'fitted'|'raw'){
    if(busy)return;setBusy(true);setNotice('');
    try{
      if(kind==='xlsx')await saveBinaryFile(cvXlsx(cvTables(groups,settings,analysis)),'CV-Ks-完整Origin数据.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      else if(kind==='raw')await saveTextFile(cvRawCsv(groups,settings),'CV-Ks-完整原始数据.csv','text/csv;charset=utf-8');
      else{const tables=cvTables(groups,settings,analysis),name=kind==='points'?'FitPoints':kind==='fits'?'Fits':'FittedValues',label=kind==='points'?'取峰数据':kind==='fits'?'拟合与Ks参数':'主图拟合数据';const table=tables.find(table=>table.name===name);if(!table)throw Error('导出表正在准备，请稍后重试。');await saveTextFile(cvCsv(table),`CV-Ks-${label}.csv`,'text/csv;charset=utf-8');}
    }catch(error){setNotice((error as Error).message);}finally{setBusy(false);}
  }
  const dataMenu=<details className="cv-export-menu"><summary className="lsv-button secondary" aria-label="导出 CV 数据"><Download size={14}/>导出数据</summary><div>
    <button disabled={busy||!count} onClick={()=>void save('xlsx')}>Excel：完整 Origin 作图数据</button>
    <button disabled={busy||!count} onClick={()=>void save('points')}>CSV：峰位与逐扫速 Ks</button>
    <button disabled={busy||!count} onClick={()=>void save('fits')}>CSV：拟合与 Ks 参数</button>
    <button disabled={busy||!count} onClick={()=>void save('fitted')}>CSV：主图散点与拟合线</button>
    <button disabled={busy||!count} onClick={()=>void save('raw')}>CSV：全部原始 CV 数据</button>
  </div></details>;

  return <div ref={workspace} data-cv-viewport className="cv-workspace" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();drop(Array.from(event.dataTransfer.files));}}>
    <input hidden ref={fileInput} type="file" multiple accept=".txt,.bin,.csv,.tsv,.dat,.xlsx" onChange={event=>{void read(Array.from(event.target.files??[]));event.target.value='';}}/>
    <input hidden ref={folderInput} type="file" multiple {...{webkitdirectory:''}} onChange={event=>{void read(Array.from(event.target.files??[]));event.target.value='';}}/>
    <header className="cv-heading"><h1>CV</h1><div className="cv-actions"><button className="lsv-button secondary" disabled={busy} onClick={()=>void pick(true)}><FolderOpen size={16}/>导入文件夹</button><button className="lsv-button primary" disabled={busy} onClick={()=>void pick()}><Upload size={16}/>{busy?'处理中…':'导入数据'}</button></div></header>
    {notice&&<div className="cv-notice" role="status">{notice}<button aria-label="关闭 CV 提示" onClick={()=>setNotice('')}>×</button></div>}
    <div className="cv-layout"><aside className="cv-sidebar">
      <section className="cv-card"><div className="cv-card-heading"><h2>样品组 <small>{groups.length} / 12</small></h2><button aria-label="新增 CV 样品组" onClick={addGroup}><Plus size={17}/></button></div>
        <div className="cv-group-navigation"><button aria-label="上一页 CV 样品组" disabled={groupPage===0} onClick={()=>selectGroup(groups[(groupPage-1)*3].id)}>‹</button><div className="cv-group-tabs" data-cv-group-count={groups.length}>{groups.slice(groupPage*3,groupPage*3+3).map(group=><button className={active?.id===group.id?'active':''} key={group.id} onClick={()=>selectGroup(group.id)} title={group.name}><i style={{background:group.color}}/><span className="cv-group-name">{group.name}</span><span>{group.series.length}</span></button>)}</div><button aria-label="下一页 CV 样品组" disabled={(groupPage+1)*3>=groups.length} onClick={()=>selectGroup(groups[(groupPage+1)*3].id)}>›</button></div>
        {active?<><div className="cv-group-edit"><input type="color" aria-label="CV 当前样品组颜色" value={active.color} onChange={event=>changeGroup(active.id,{color:event.target.value})}/><input aria-label="CV 当前样品组名称" value={active.name} maxLength={60} onChange={event=>changeGroup(active.id,{name:event.target.value})}/><button aria-label="显示或隐藏 CV 样品组" onClick={()=>changeGroup(active.id,{visible:!active.visible})}>{active.visible?<Eye size={17}/>:<EyeOff size={17}/>}</button><button aria-label="删除 CV 当前样品组" onClick={removeGroup}><Trash2 size={16}/></button></div>
          <div className="cv-file-list" data-cv-file-total={active.series.length}>{active.series.slice(safeFilePage*4,safeFilePage*4+4).map(series=>{
            const row=rows.find(row=>row.trace.series.id===series.id);
            return <div key={series.id} data-cv-file-series={series.id} data-cv-file-rate={series.rate} className={`cv-file-row${series.included?'':' excluded'}${selected?.id===series.id?' selected':''}`}><input type="checkbox" aria-label={`${active.name} ${series.rate||'?'} mV/s 纳入拟合`} checked={series.included} onChange={event=>changeSeries(series.id,{included:event.target.checked})}/><button className="cv-file-select" aria-label={`选择 CV 文件 ${series.id}`} title={series.source} onClick={()=>selectSeries(series.id)}><span>{series.rate||'?'} mV/s<small>{series.name}</small></span><b>{row?.trace.selectedCycle?`第 ${row.trace.selectedCycle} 圈`:''}</b></button><button className="cv-file-edit" aria-label={`编辑 CV 文件 ${series.id}`} onClick={()=>{setSelectedSeries(series.id);setEditingSeriesId(series.id);}}>编辑</button></div>;
          })}</div>
          {active.series.length>0&&<div className="cv-pager"><button aria-label="上一页 CV 文件" disabled={safeFilePage===0} onClick={()=>setFilePage(safeFilePage-1)}>‹</button><span data-testid="cv-file-page">{safeFilePage+1} / {filePages} · {active.series.length} 份文件</span><button aria-label="下一页 CV 文件" disabled={safeFilePage>=filePages-1} onClick={()=>setFilePage(safeFilePage+1)}>›</button></div>}
          {!active.series.length&&<p className="cv-muted">选择文件或文件夹，即可追加到这个样品。</p>}
        </>:<p className="cv-muted">首次导入创建样品1，后续文件追加到当前样品；点击加号创建下一个样品。</p>}
        <div className="cv-sample-footer">{removed&&<div className="cv-undo">已移除数据<button onClick={()=>{setGroups(removed);setRemoved(null);}}>撤销移除</button></div>}<button className="cv-settings-trigger" onClick={()=>setSettingsOpen(true)}>取峰与计算设置</button></div>
      </section>
      <section className="cv-card"><div className="cv-card-heading"><h2>拟合点</h2><button aria-label="打开 CV 计算设置" onClick={()=>setSettingsOpen(true)}><Settings2 size={15}/></button></div><div className="cv-actions"><button className="lsv-button secondary" disabled={!active?.series.length} onClick={()=>setAllIncluded(true)}>全部扫速</button><button className="lsv-button secondary" disabled={!active?.series.length} onClick={chooseFourPoints}>选四个点…</button></div><p className="cv-muted">当前样品：{active?.series.filter(series=>series.included).length??0} 个扫速纳入 · 第 {settings.cycle==='last'?'末':settings.cycle} 圈</p></section>
    </aside><div className="cv-main"><div className={`cv-chart-layout${count>0?' has-results':''}`}>
      <section className="cv-card cv-plot-card"><div className="cv-plot-toolbar"><div className="cv-view-tabs" role="tablist" aria-label="CV 图形视图"><button role="tab" aria-selected={view==='fit'} className={view==='fit'?'active':''} onClick={()=>{setView('fit');setPickBranch(null);}}>Laviron / Ks</button><button role="tab" aria-selected={view==='cv'} className={view==='cv'?'active':''} onClick={()=>setView('cv')}>原始 CV 与取峰</button></div><div className="cv-actions">{dataMenu}<FigureExportDialog getSvg={()=>{const svg=figureHost.current?.querySelector<SVGSVGElement>('svg[data-cv-figure]');return svg?buildCvExportSvg(svg,analysis,settings):null;}} defaultName={view==='fit'?'CV-Laviron-Ks':'CV-原始曲线与取峰'} disabled={view==='fit'?!anyFit:!anyTrace} compact/></div></div>
        {view==='cv'&&<><div className="cv-raw-controls"><select aria-label="CV 当前取峰文件" value={selected?.id??''} onChange={event=>{selectSeries(event.target.value);setPickBranch(null);}}><option value="" disabled>选择取峰文件</option>{groups.flatMap(group=>group.series.map(series=><option key={series.id} value={series.id}>{group.name} · {series.rate||'?'} mV/s · {series.name}</option>))}</select><button className={`lsv-button secondary${pickBranch==='anodic'?' is-picking':''}`} disabled={!selectedRow?.trace.points.some(Boolean)} onClick={()=>setPickBranch(current=>current==='anodic'?null:'anodic')}><MousePointer2 size={13}/>点选氧化峰</button><button className={`lsv-button secondary${pickBranch==='cathodic'?' is-picking':''}`} disabled={!selectedRow?.trace.points.some(Boolean)} onClick={()=>setPickBranch(current=>current==='cathodic'?null:'cathodic')}><MousePointer2 size={13}/>点选还原峰</button></div>{pickBranch&&<p className="cv-pick-hint">在图中点击{pickBranch==='anodic'?'正扫氧化峰':'反扫还原峰'}，取当前文件的邻近原始点。</p>}</>}
        <div ref={figureHost} className="cv-figure"><CvFigure analysis={analysis} settings={settings} mode={view} selectedSeriesId={selected?.id} pickBranch={pickBranch} onSelectSeries={selectSeries} onPick={pickPeak} onToggle={toggle}/></div>
      </section>
      {count>0&&<section className="cv-card cv-results-card cv-summary-card" aria-label="CV 拟合与 Ks 结果">
        {view==='cv'&&<div className="cv-legend-panel" data-cv-legend-panel><div className="cv-card-heading"><h2>CV 图例</h2></div><div className="cv-legend-list">{legendTraces.slice(safeLegendPage*legendSize,safeLegendPage*legendSize+legendSize).map((trace,index)=><button key={trace.series.id} data-cv-legend-series={trace.series.id} data-cv-legend-rate={trace.series.rate} className={selected?.id===trace.series.id?'selected':''} title={`${trace.groupName} · ${trace.series.name}\n${trace.series.source}`} onClick={()=>selectSeries(trace.series.id)}><i style={{background:cvTraceColor(trace,safeLegendPage*legendSize+index,selectedRow?.trace.groupId)}}/><span>{trace.groupName} · {trace.series.rate} mV/s</span></button>)}</div><div className="cv-pager"><button aria-label="上一页 CV 图例" disabled={safeLegendPage===0} onClick={()=>setLegendPage(safeLegendPage-1)}>‹</button><span data-testid="cv-legend-page">{safeLegendPage+1} / {legendPages}</span><button aria-label="下一页 CV 图例" disabled={safeLegendPage>=legendPages-1} onClick={()=>setLegendPage(safeLegendPage+1)}>›</button></div></div>}
        <div className="cv-card-heading"><h2>Ks {settings.calculationMode==='trial'?'条件试算':'条件估算'} <small>s⁻¹</small></h2><button className="cv-settings-trigger" onClick={()=>setSettingsOpen(true)}>{settings.temperature} °C · n = {settings.n}</button></div>
        <div className="cv-pager cv-result-pager"><button aria-label="上一个 Ks 样品" disabled={activeIndex===0} onClick={()=>selectGroup(groups[activeIndex-1].id)}>‹</button><span>{activeIndex+1} / {groups.length} · {active?.name}</span><button aria-label="下一个 Ks 样品" disabled={activeIndex>=groups.length-1} onClick={()=>selectGroup(groups[activeIndex+1].id)}>›</button></div>
        {analysis.error&&<p className="cv-warning">{analysis.error}</p>}
        <div className="cv-results">{currentResult&&<div className="cv-result" data-cv-summary={currentResult.group.id}><div className="cv-result-name"><i style={{background:currentResult.group.color}}/>{currentResult.group.name}{!currentResult.group.visible&&<span className="cv-muted">图中已隐藏</span>}</div>{currentResult.fit&&<p className="cv-result-equation" style={{color:currentResult.group.color}}>y = {format(currentResult.fit.slope,6)} x {currentResult.fit.intercept<0?'−':'+'} {format(Math.abs(currentResult.fit.intercept),6)}</p>}<div className="cv-result-value" data-cv-ks={currentResult.group.id}>{format(currentResult.ksGeomean,6)}<small>s⁻¹</small></div><div className="cv-result-meta">几何平均 · {currentResult.ksCount} 个扫速<br/>范围 {format(currentResult.ksMin,5)} – {format(currentResult.ksMax,5)}<br/>α = {format(currentResult.alpha,5)} · R² = {format(currentResult.fit?.r2,5)}<br/>主图拟合 · {currentResult.fit?.n??0} 个点</div>{(currentResult.error||currentResult.warnings.length>0)&&<><p className="cv-result-status" title={currentResult.error??currentResult.warnings.join('；')}>{currentResult.error??currentResult.warnings.join('；')}</p><button className="cv-settings-trigger" onClick={()=>setCalculationInfoOpen(true)}>查看完整计算提示</button></>}</div>}</div>
        <button className="cv-point-details-trigger" disabled={!rows.length} onClick={()=>setPointDetailsOpen(true)}>逐扫速峰位与计算结果（{rows.length} 条）</button>
      </section>}
    </div></div></div>
    <Dialog open={!!editingSeries} onOpenChange={open=>{if(!open)setEditingSeriesId('');}}><DialogContent className="cv-file-settings-dialog cv-workspace"><DialogHeader><DialogTitle>CV 文件设置</DialogTitle><DialogDescription>{editingSeries?.name} · {editingGroup?.name}</DialogDescription></DialogHeader>{editingSeries&&<>
              <div className="cv-file-fields"><label>扫速 / mV·s⁻¹<input aria-label={`${editingSeries.id} CV扫速`} type="number" min="0" step="any" value={editingSeries.rate} onChange={event=>changeSeries(editingSeries.id,{rate:event.target.value})}/></label><label>有效面积 / cm²<input aria-label={`${editingSeries.id} CV面积`} type="number" min="0" step="any" value={editingSeries.area} onChange={event=>changeSeries(editingSeries.id,{area:event.target.value})}/></label>
                <label>原始电流单位<select aria-label={`${editingSeries.id} CV原始单位`} value={editingSeries.unit} onChange={event=>changeSeries(editingSeries.id,{unit:event.target.value as CurrentUnit})}><option value="">待确认</option>{units.map(unit=><option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select></label>
                <label>选取循环<input aria-label={`${editingSeries.id} CV循环`} value={editingSeries.cycle} placeholder={`跟随设置：${settings.cycle}`} onChange={event=>changeSeries(editingSeries.id,{cycle:event.target.value})}/></label>
                <label>氧化峰 Epa / V<input aria-label={`${editingSeries.id} 氧化峰电位`} type="number" step="any" value={editingSeries.anodic} placeholder={format(editingRow?.epa)} onChange={event=>changeSeries(editingSeries.id,{anodic:event.target.value})}/></label>
                <label>还原峰 Epc / V<input aria-label={`${editingSeries.id} 还原峰电位`} type="number" step="any" value={editingSeries.cathodic} placeholder={format(editingRow?.epc)} onChange={event=>changeSeries(editingSeries.id,{cathodic:event.target.value})}/></label>
                <label>氧化峰标记<select aria-label={`${editingSeries.id} 氧化峰标记`} value={editingSeries.anodicQuality} onChange={event=>changeSeries(editingSeries.id,{anodicQuality:event.target.value as CvSeries['anodicQuality']})}><option value="peak">峰顶</option><option value="shoulder">肩部估计</option></select></label>
                <label>还原峰标记<select aria-label={`${editingSeries.id} 还原峰标记`} value={editingSeries.cathodicQuality} onChange={event=>changeSeries(editingSeries.id,{cathodicQuality:event.target.value as CvSeries['cathodicQuality']})}><option value="peak">峰底</option><option value="shoulder">肩部估计</option></select></label>
                <label>所属样品组<select aria-label={`${editingSeries.id} 所属CV样品`} value={editingGroup!.id} onChange={event=>moveSeries(editingSeries.id,event.target.value)}>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              </div>
              {(editingSeries.anodic||editingSeries.cathodic)&&<button className="cv-reset-peak" onClick={()=>changeSeries(editingSeries.id,{anodic:'',cathodic:'',anodicQuality:'peak',cathodicQuality:'peak'})}>恢复自动取峰</button>}
              <small className="cv-source">{editingSeries.source} · {editingSeries.points.length.toLocaleString()} 点 · {editingRow?.trace.cycles??0} 个完整圈</small>
              <button className="cv-reset-peak" onClick={()=>{setSelectedSeries(editingSeries.id);setView('cv');setPickBranch(null);}}>在 CV 图中核对</button>
              {editingRow&&(editingRow.error||editingRow.warnings.length>0)&&<p className="cv-warning">{editingRow.error??editingRow.warnings.join('；')}</p>}
<button className="cv-text-button" onClick={()=>{removeSeries(editingSeries.id);setEditingSeriesId('');}}>移除此文件</button><div className="cv-actions cv-dialog-actions"><button className="lsv-button primary" onClick={()=>setEditingSeriesId('')}>完成</button></div></>}</DialogContent></Dialog>
    <Dialog open={calculationInfoOpen} onOpenChange={setCalculationInfoOpen}><DialogContent className="cv-settings-dialog cv-workspace"><DialogHeader><DialogTitle>计算提示</DialogTitle><DialogDescription>{active?.name}</DialogDescription></DialogHeader>{currentResult?.error&&<p className="cv-warning">{currentResult.error}</p>}{currentResult?.warnings.map((warning,index)=><p key={index} className="cv-warning">{warning}</p>)}<div className="cv-actions cv-dialog-actions"><button className="lsv-button primary" onClick={()=>setCalculationInfoOpen(false)}>关闭</button></div></DialogContent></Dialog>
    <Dialog open={fourPointSelection!==null} onOpenChange={open=>{if(!open)setFourPointSelection(null);}}><DialogContent className="cv-four-point-dialog cv-workspace"><DialogHeader><DialogTitle>选择四个拟合点</DialogTitle><DialogDescription>{fourPointGroup?.name??'当前样品'}：选择四个不同扫速，可使用非连续扫速。</DialogDescription></DialogHeader>
      <div className="cv-four-point-count" data-testid="cv-four-count" role="status">已选 {fourPointSeries.length} / 4 个点</div>
      <div className="cv-four-point-list">{fourPointGroup?.series.map(series=><label key={series.id} data-cv-four-series={series.id} data-cv-four-rate={series.rate} className={fourPointSelection?.ids.includes(series.id)?'selected':''} title={series.source}><input type="checkbox" aria-label={`CV 四点 ${series.id}`} checked={fourPointSelection?.ids.includes(series.id)??false} onChange={()=>toggleFourPoint(series.id)}/><span><b>{series.rate||'?'} mV/s</b><small>{series.name}</small><small className="cv-four-source">{series.source}</small></span></label>)}</div>
      {fourPointIssue&&<p className="cv-warning" role="alert">{fourPointIssue}</p>}<div className="cv-actions cv-dialog-actions"><button className="lsv-button secondary" onClick={()=>setFourPointSelection(null)}>取消</button><button className="lsv-button primary" disabled={!fourPointGroup||!fourPointValid} onClick={applyFourPoints}>应用四点拟合</button></div>
    </DialogContent></Dialog>
    <Dialog open={pointDetailsOpen} onOpenChange={setPointDetailsOpen}><DialogContent className="cv-point-details-dialog cv-workspace"><DialogHeader><DialogTitle>逐扫速峰位与计算结果</DialogTitle><DialogDescription>各文件的峰位、纳入状态和计算结果。</DialogDescription></DialogHeader><div className="cv-table-wrap"><table><thead><tr><th>纳入</th><th>样品</th><th>扫速 / mV·s⁻¹</th><th>Epa / V</th><th>Epc / V</th><th>ΔEp / V</th><th>Ks / s⁻¹</th><th>状态</th><th>源文件</th></tr></thead><tbody>{analysis.groups.flatMap(result=>result.rows.map(row=><tr key={row.trace.series.id} className={row.included?'':'excluded'}><td><input type="checkbox" aria-label={`${row.trace.series.id} 结果纳入拟合`} checked={row.included} onChange={()=>toggle(row.trace.series.id)}/></td><td>{result.group.name}</td><td>{format(row.rate,7)}</td><td>{format(row.epa,7)}</td><td>{format(row.epc,7)}</td><td>{format(row.delta,7)}</td><td>{format(row.ks,7)}</td><td className="cv-row-status">{row.error??row.status}</td><td className="cv-table-source" title={row.trace.series.source}>{row.trace.series.name}</td></tr>))}</tbody></table></div><div className="cv-actions cv-dialog-actions"><button className="lsv-button primary" onClick={()=>setPointDetailsOpen(false)}>关闭</button></div></DialogContent></Dialog>
    <Dialog open={importOpen} onOpenChange={open=>{if(!busy)setImportOpen(open);}}><DialogContent className="cv-import-dialog cv-workspace"><DialogHeader><DialogTitle>导入到 {groups.find(group=>group.id===importTarget.current)?.name??nextCvSampleName(groups)}</DialogTitle><DialogDescription>本次文件全部加入这个样品。核对扫速、数据列及原始电流单位后导入。</DialogDescription></DialogHeader>
      <div className="cv-import-defaults"><label>本次有效面积 / cm²<input aria-label="CV 导入有效面积" type="number" min="0" step="any" value={importArea} onChange={event=>setImportArea(event.target.value)}/></label></div>
      <div className="cv-table-wrap cv-import-table"><table><thead><tr><th>文件</th><th>扫速 / mV·s⁻¹</th><th>电位列（V）</th><th>电流列</th><th>原始单位</th></tr></thead><tbody>{pending.map(item=>{const change=(patch:Partial<CvImportItem>)=>setPending(current=>current.map(entry=>entry.id===item.id?{...entry,...patch}:entry));return <tr key={item.id}><td title={item.source}>{item.source.replaceAll('\\','/').split('/').slice(-3).join('/')}</td><td><input aria-label={`${item.id} CV导入扫速`} type="number" min="0" step="any" value={item.rate} onChange={event=>change({rate:event.target.value})}/></td><td><select aria-label={`${item.id} CV电位列`} value={item.pair.e} onChange={event=>change({pair:{...item.pair,e:Number(event.target.value)}})}>{item.table.headers.map((header,index)=><option key={index} value={index}>{header}</option>)}</select></td><td><select aria-label={`${item.id} CV电流列`} value={item.pair.current} onChange={event=>change({pair:{...item.pair,current:Number(event.target.value)}})}>{item.table.headers.map((header,index)=><option key={index} value={index}>{header}</option>)}</select></td><td><select aria-label={`${item.id} CV导入原始单位`} value={item.unit} onChange={event=>change({unit:event.target.value as CurrentUnit})}><option value="">待确认</option>{units.map(unit=><option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select></td></tr>;})}</tbody></table></div>
      {importWarnings.length>0&&<details className="cv-warning"><summary>{importWarnings.length} 条导入提示</summary>{importWarnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>}{importError&&<p className="cv-warning" role="alert">{importError}</p>}<div className="cv-actions cv-dialog-actions"><button className="lsv-button secondary" onClick={()=>setImportOpen(false)}>取消</button><button className="lsv-button primary" disabled={!pending.length||busy} onClick={confirmImport}>导入并作图（{pending.length} 条）</button></div>
    </DialogContent></Dialog>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="cv-settings-dialog cv-workspace"><DialogHeader><DialogTitle>取峰与计算设置</DialogTitle><DialogDescription>按所选循环核对同一氧化还原过程；手动指定的峰位和肩部标记随项目保存。</DialogDescription></DialogHeader>
      <div className="cv-two"><label>共同循环<input aria-label="CV 共同循环" value={settings.cycle} placeholder="4 或 last" onChange={event=>option('cycle',event.target.value)}/></label><label>温度 / °C<input aria-label="CV 温度" type="number" step="any" value={settings.temperature} onChange={event=>option('temperature',event.target.value)}/></label><label>电子转移数 n<input aria-label="CV 电子数" type="number" min="0" step="any" value={settings.n} onChange={event=>option('n',event.target.value)}/></label><label>峰间距阈值系数 / V<input aria-label="CV 峰间距阈值" type="number" min="0" step="any" value={settings.threshold} onChange={event=>option('threshold',event.target.value)}/><small className="cv-muted">实际阈值 = 系数 / n</small></label></div>
      <h3>自动取峰范围 / V</h3><div className="cv-two"><label>氧化峰下限<input aria-label="CV 氧化峰下限" type="number" step="any" value={settings.anodicMin} placeholder="自动" onChange={event=>option('anodicMin',event.target.value)}/></label><label>氧化峰上限<input aria-label="CV 氧化峰上限" type="number" step="any" value={settings.anodicMax} placeholder="自动" onChange={event=>option('anodicMax',event.target.value)}/></label><label>还原峰下限<input aria-label="CV 还原峰下限" type="number" step="any" value={settings.cathodicMin} placeholder="自动" onChange={event=>option('cathodicMin',event.target.value)}/></label><label>还原峰上限<input aria-label="CV 还原峰上限" type="number" step="any" value={settings.cathodicMax} placeholder="自动" onChange={event=>option('cathodicMax',event.target.value)}/></label></div>
      <label className="cv-field">Ks 计算方式<select aria-label="CV Ks计算方式" value={settings.calculationMode} onChange={event=>option('calculationMode',event.target.value as CvSettings['calculationMode'])}><option value="qualified">按峰间距条件筛选后计算</option><option value="trial">对当前所选点做条件试算</option></select></label>
      <p className="cv-muted">图形使用 ln[v / (1 mV·s⁻¹)] 与 (Epa − Epc) / 2；Ks 计算将扫速换算为 V/s。结果记录温度、n、α、取峰方式及筛选状态。</p><div className="cv-actions"><button className="lsv-button primary" onClick={()=>setSettingsOpen(false)}>完成</button></div>
    </DialogContent></Dialog>
  </div>;
}
