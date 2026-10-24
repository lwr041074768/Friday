import path from 'node:path';
import {pathToFileURL} from 'node:url';
/** Optional UI verification dependency; callers may provide an explicit module. */
export async function loadPlaywright(legacyName){
  const modulePath=process.env.PLAYWRIGHT_MODULE||(legacyName?process.env[legacyName]:undefined);
  if(modulePath)return import(modulePath.startsWith('file:')?modulePath:pathToFileURL(path.resolve(modulePath)).href);
  try{return await import('playwright');}catch(error){
    if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
    console.log('SKIP UI verification: install playwright or set PLAYWRIGHT_MODULE to its index.mjs.');process.exit(0);
  }
}
