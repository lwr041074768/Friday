import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(desktop);

export default defineConfig({
  root: path.join(desktop, 'renderer'),
  base: '/',
  envDir: desktop,
  publicDir: false,
  resolve: {
    // Only the desktop build replaces browser/native handoff controls. The
    // hosted website and its build configuration remain independent.
    alias: [
      { find: '@/lib/cdl-import', replacement: path.join(desktop, 'renderer/cdl-file-import.ts') },
      { find: '@/lib/lsv-import', replacement: path.join(desktop, 'renderer/lsv-file-import.ts') },
      { find: '@/components/lsv-origin-export', replacement: path.join(desktop, 'renderer/lsv-origin-export.tsx') },
      { find: '@/components/overpotential-origin-export', replacement: path.join(desktop, 'renderer/overpotential-origin-export.tsx') },
      { find: '@/components/xy-origin-export', replacement: path.join(desktop, 'renderer/xy-origin-export.tsx') },
      { find: '@/components/xrd-jade-reader', replacement: path.join(desktop, 'renderer/xrd-jade-reader.tsx') },
      { find: '@', replacement: root },
    ],
  },
  css: { postcss: root },
  plugins: [{
    name: 'desktop-workbench-adapters', enforce: 'pre',
    transform(code, id) {
      const dropImport = 'import {useDesktopFileDrop} from ' + JSON.stringify(path.join(desktop, 'renderer/file-drop.ts')) + ';\n';
      if (/app[\\/]electrochem-workspace\.tsx$/.test(id)) {
        const marker = 'const displayed=demoMode?samples:curves;';
        if (!code.includes(marker)) throw Error('Electrochem workbench changed; review the desktop file drop adapter.');
        return dropImport + code.replace(marker, 'useDesktopFileDrop(kind,dropFiles);\n' + marker);
      }
      if (/app[\\/](?:eis|cdl|cv|xrd|raman|ph)-workspace\.tsx$/.test(id)) {
        const marker = 'function drop(files: File[])';
        const kind = /ph-workspace/.test(id) ? 'ph' : /cv-workspace/.test(id) ? 'cv' : /eis-workspace/.test(id) ? 'eis' : /cdl-workspace/.test(id) ? 'cdl' : /raman-workspace/.test(id) ? 'raman' : 'xrd';
        if (!code.includes(marker)) throw Error('XY workbench changed; review the desktop file drop adapter.');
        return dropImport + code.replace(marker, `useDesktopFileDrop('${kind}',drop);\n` + marker);
      }
      if (/app[\\/]xy-workspace\.tsx$/.test(id)) {
        const marker = 'const displayed=demo?samples:curves;';
        if (!code.includes(marker) || !code.includes('<XyImportDialog kind={kind}')) throw Error('Spectroscopy workbench changed; review the desktop file drop adapter.');
        return dropImport + code.replace(marker, `const [desktopFileRequest,setDesktopFileRequest]=useState<{id:number;files:File[]}>();
          useDesktopFileDrop(kind,files=>{setDesktopFileRequest(last=>({id:(last?.id??0)+1,files}));setOpen(true);});
          ${marker}`).replace('<XyImportDialog kind={kind}', '<XyImportDialog fileRequest={desktopFileRequest} kind={kind}');
      }
      if (/components[\\/]cdl-import-dialog\.tsx$/.test(id)) {
        const marker = 'const sampleCount =';
        if (!code.includes(marker) || !code.includes('fileInput.current?.click()')) throw Error('Cdl import dialog changed; review the native picker integration.');
        if(!code.includes('folderInput.current?.click()'))throw Error('Cdl folder import changed; review the native folder picker.');
        code = 'import {chooseDataFiles as chooseDesktopCdlFiles,chooseCdlFolder} from ' + JSON.stringify(path.join(desktop, 'renderer/native-files.ts')) + ';\n' + code;
        return code.replace(marker, `async function pickDesktopCdlFiles(){
          if(busy)return;
          setBusy(true);setError('');
          try{const files=await chooseDesktopCdlFiles('cdl');if(files.length)await readFiles(files);}
          catch(cause){setError(cause instanceof Error?cause.message:'无法读取所选数据文件。');}
          finally{setBusy(false);}
        }
        async function pickDesktopCdlFolder(){if(busy)return;setBusy(true);setError('');try{const files=await chooseCdlFolder();if(files.length)await readFiles(files);}catch(cause){setError(cause instanceof Error?cause.message:'无法读取文件夹。');}finally{setBusy(false);}}
        ${marker}`).replaceAll('fileInput.current?.click()', 'void pickDesktopCdlFiles()').replaceAll('folderInput.current?.click()','void pickDesktopCdlFolder()');
      }
      // Raman uses Chromium's local file/folder chooser; unlike the older
      // electrochemistry picker it supports a complete multi-folder batch.
      if (/components[\\/]raman-import-dialog\.tsx$/.test(id)) return code.replaceAll('浏览器中读取', '本机读取');
      if (!/components[\\/](?:xy|lsv)-import-dialog\.tsx$/.test(id)) return;
      code = code.replaceAll('浏览器中读取', '本机读取');
      if (/components[\\/]lsv-import-dialog\.tsx$/.test(id)) {
        const marker = 'const total=pending.reduce';
        if (!code.includes(marker) || !code.includes('fileInput.current?.click()')) throw Error('LSV import dialog changed; review the native picker integration.');
        code = 'import {chooseLsvFiles as chooseDesktopLsvFiles} from ' + JSON.stringify(path.join(desktop, 'renderer/native-files.ts')) + ';\n' + code;
        code = code.replace(marker, `async function pickDesktopLsvFiles(){
          if(busy)return;
          setBusy(true);setError('');
          try{const files=await chooseDesktopLsvFiles();if(files.length)await readFiles(files);}
          catch(cause){setError(cause instanceof Error?cause.message:'无法读取所选数据文件。');}
          finally{setBusy(false);}
        }
        ${marker}`).replaceAll('fileInput.current?.click()', 'void pickDesktopLsvFiles()');
      } else {
        const marker = 'const total=pending.reduce';
        if (!code.includes(marker) || !code.includes('input.current?.click()')) throw Error('XY import dialog changed; review the native picker integration.');
        if (!code.includes('folderInput.current?.click()')) throw Error('EIS folder import changed; review the native picker integration.');
        code = 'import {chooseDataFiles as chooseDesktopDataFiles,chooseEisFolder} from ' + JSON.stringify(path.join(desktop, 'renderer/native-files.ts')) + ';\n' + code;
        code = code.replace(marker, `async function pickDesktopDataFiles(){
          if(busy)return;
          setBusy(true);setError('');
          try{const files=await chooseDesktopDataFiles(kind);if(files.length)await read(files);}
          catch(cause){setError(cause instanceof Error?cause.message:'无法读取所选数据文件。');}
          finally{setBusy(false);}
        }
        async function pickDesktopEisFolder(){
          if(busy)return;
          setBusy(true);setError('');
          try{const files=await chooseEisFolder();if(files.length)await read(files);}
          catch(cause){setError(cause instanceof Error?cause.message:'无法读取 EIS 文件夹。');}
          finally{setBusy(false);}
        }
        ${marker}`).replaceAll('input.current?.click()', 'void pickDesktopDataFiles()').replaceAll('folderInput.current?.click()', 'void pickDesktopEisFolder()');
      }
      return code;
    },
  }, react()],
  build: {
    outDir: path.join(desktop, 'build/app/renderer'),
    emptyOutDir: true,
    target: 'chrome148',
    sourcemap: false,
  },
});
