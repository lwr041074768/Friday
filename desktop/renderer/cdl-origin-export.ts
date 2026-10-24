import { prepareCdlOriginExport } from '@/lib/cdl-origin-export';
import type { CdlResult, CdlSample, CdlSettings } from '@/lib/cdl-math';
import { desktop } from './native';

export async function exportCdlToOrigin(samples:CdlSample[],settings:CdlSettings,calculated:CdlResult,label:string){
  return desktop().exportCdl(JSON.stringify(prepareCdlOriginExport(samples,settings,calculated,label)));
}
