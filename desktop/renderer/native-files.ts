import { desktop, type DesktopDataFile } from './native';
export function preservePhDropSources(files:File[]):File[]{
  for(const file of files){
    if((file as File&{measurementSourcePath?:string}).measurementSourcePath)continue;
    try{const source=desktop().getPathForFile(file);if(source)Object.defineProperty(file,'measurementSourcePath',{value:source});}
    catch{ /* Browser-created files have no native path and remain importable. */ }
  }
  return files;
}
export async function resolveDroppedFiles(profile:'ph'|'lsv'|'cv'|'eis',files:File[]):Promise<File[]>{
  const paths:string[]=[],fallback:File[]=[];
  for(const file of files){
    let source='';try{source=desktop().getPathForFile(file);}catch{ /* Non-native File. */ }
    if(source)paths.push(source);else fallback.push(file);
  }
  // Native directory entries are zero-byte Files; only the main process can
  // discover their measurement files while preserving the acquisition paths.
  const resolved=paths.length?browserFiles(await desktop().readDroppedData(profile,paths)):[];
  return [...resolved,...preservePhDropSources(fallback)];
}
function browserFiles(files:DesktopDataFile[]):File[]{return files.map(item=>{const file=new File([item.data],item.name,{lastModified:item.lastModified});if(item.relativePath)Object.defineProperty(file,'webkitRelativePath',{value:item.relativePath});if(item.sourcePath)Object.defineProperty(file,'measurementSourcePath',{value:item.sourcePath});return file;});}
export async function chooseLsvFiles(): Promise<File[]> {
  return chooseDataFiles('lsv');
}
export async function chooseDataFiles(profile: 'lsv' | 'eis' | 'cdl' | 'cv' | 'xrd' | 'raman' | 'ph'): Promise<File[]> {
  const files = await desktop().chooseDataFiles(profile);
  return browserFiles(files);
}
export async function chooseCdlFolder():Promise<File[]>{return browserFiles(await desktop().chooseCdlFolder());}
export async function choosePhFolder():Promise<File[]>{return browserFiles(await desktop().choosePhFolder());}
export async function chooseCvFolder():Promise<File[]>{return browserFiles(await desktop().chooseCvFolder());}
export async function chooseEisFolder():Promise<File[]>{return browserFiles(await desktop().chooseEisFolder());}
