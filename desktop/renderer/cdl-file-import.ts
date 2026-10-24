import { parseCdlDataFile as parseSharedFile } from '../../lib/cdl-import';
import { decodeMeasurementText } from './text-decoding';
export * from '../../lib/cdl-import';

export async function parseCdlDataFile(file: File) {
  if (!/\.(txt|csv|tsv|dat)$/i.test(file.name)) return parseSharedFile(file);
  if (file.size > 20 * 1024 * 1024) throw Error('单个文件不能超过 20 MB');
  const text = decodeMeasurementText(new Uint8Array(await file.arrayBuffer()));
  // Normalize instrument text before both parsing and missing-row recovery.
  // Keep the original filename and timestamp used in source metadata.
  const normalized=new File([text],file.name,{lastModified:file.lastModified});
  if(file.webkitRelativePath)Object.defineProperty(normalized,'webkitRelativePath',{value:file.webkitRelativePath});
  const originalSource=(file as File&{measurementSourcePath?:string}).measurementSourcePath;
  if(originalSource)Object.defineProperty(normalized,'measurementSourcePath',{value:originalSource});
  return parseSharedFile(normalized);
}
