import { parseDataFile as parseSharedFile, parseText, type DataTable, type ImportProfile } from '../../lib/lsv-import';
import { decodeMeasurementText } from './text-decoding';
export * from '../../lib/lsv-import';

export async function parseDataFile(file: File, profile: ImportProfile = 'lsv'): Promise<DataTable[]> {
  const source=(file as File&{measurementSourcePath?:string}).measurementSourcePath||file.webkitRelativePath||file.name;
  if (!/\.(txt|csv|tsv|dat)$/i.test(file.name)) return (await parseSharedFile(file, profile)).map(table=>({...table,source}));
  if (file.size > 20 * 1024 * 1024) throw Error('单个文件不能超过 20 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return [parseText(decodeMeasurementText(bytes), file.name.replace(/\.[^.]+$/, ''), source, profile)];
}
