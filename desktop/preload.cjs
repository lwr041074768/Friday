const { contextBridge, ipcRenderer, webUtils } = require('electron');
async function invoke(channel, ...args) {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (error) { throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
}
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('scientificPlot', {
  version: '0.6.0',
  platform: process.platform,
  getPathForFile: file => webUtils.getPathForFile(file),
  readDroppedData: (profile,paths) => invoke('studio:read-dropped-data',profile,paths),
  renderFigurePdf: request=>invoke('studio:figure-pdf',request),
  saveProject: request=>invoke('studio:project-save',request),
  openProject:()=>invoke('studio:project-open'),
  acceptProject:token=>invoke('studio:project-accept',token),
  resetProjectPath:()=>invoke('studio:project-reset-path'),
  confirmProjectReplace:action=>invoke('studio:project-confirm',action),
  setProjectStatus:state=>invoke('studio:project-status',state),
  saveRecovery:request=>invoke('studio:recovery-save',request),
  recoveryInfo:()=>invoke('studio:recovery-info'),
  readRecovery:()=>invoke('studio:recovery-read'),
  clearRecovery:()=>invoke('studio:recovery-clear'),
  onProjectAction:callback=>subscribe('studio:project-action',callback),
  exportOrigin: text => invoke('studio:origin', text),
  exportOverpotential: text => invoke('studio:overpotential-origin', text),
  exportCdl: text => invoke('studio:cdl-origin', text),
  exportPh:text=>invoke('studio:ph-origin',text),
  choosePhFolder:()=>invoke('studio:choose-ph-folder'),
  chooseCvFolder:()=>invoke('studio:choose-cv-folder'),
  chooseEisFolder:()=>invoke('studio:choose-eis-folder'),
  readJade: requestId => invoke('studio:jade', requestId),
  cancelJade: requestId => invoke('studio:cancel-jade', requestId),
  showDataFolder: () => invoke('studio:data-folder'),
  saveDataFile: request => invoke('studio:save-data-file', request),
  chooseLsvFiles: () => invoke('studio:choose-lsv-files'),
  chooseDataFiles: profile => invoke('studio:choose-data-files', profile),
  chooseCdlFolder: () => invoke('studio:choose-cdl-folder'),
  onOpenImport: callback => subscribe('studio:open-import', callback),
  onNavigate: callback => subscribe('studio:navigate', callback),
  onStartupIntro: callback => subscribe('studio:startup-intro', callback),
  onDownload: callback => subscribe('studio:download', callback),
  getUpdateState: () => invoke('studio:update-state'),
  checkForUpdates: () => invoke('studio:update-check'),
  downloadUpdate: () => invoke('studio:update-download'),
  installUpdate: () => invoke('studio:update-install'),
  onUpdateState: callback => subscribe('studio:update-state', callback),
  onOpenUpdates: callback => subscribe('studio:open-updates', callback),
});
