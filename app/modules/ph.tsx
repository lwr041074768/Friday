import {FlaskConical} from 'lucide-react';
import PhWorkspace from '@/app/ph-workspace';
import type {ModuleDefinition} from './types';
export const phModule:ModuleDefinition={id:'ph',label:'pH 依赖性',scope:'ph',icon:FlaskConical,
  render:runtime=><PhWorkspace chooseFiles={runtime.choosePhFiles} chooseFolder={runtime.choosePhFolder} saveTextFile={runtime.saveCdlFile} saveBinaryFile={runtime.saveCdlBinaryFile} onExportOrigin={runtime.exportPhToOrigin}/>};
