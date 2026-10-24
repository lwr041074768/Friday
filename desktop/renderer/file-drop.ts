import { useEffect, useRef } from 'react';

export type DesktopWorkbench = 'lsv' | 'overpotential' | 'eis' | 'cdl' | 'cv' | 'tafel' | 'xrd' | 'raman' | 'ph';
type DesktopImportWorkbench = Exclude<DesktopWorkbench, 'overpotential'>;
const EVENT = 'scientific-plot:files-dropped';
type DroppedFiles = { workbench: DesktopImportWorkbench; files: File[] };

export function dispatchDesktopFileDrop(workbench: DesktopWorkbench, files: File[]) {
  const target = workbench === 'overpotential' ? 'lsv' : workbench;
  if (files.length) window.dispatchEvent(new CustomEvent<DroppedFiles>(EVENT, { detail: { workbench: target, files } }));
}

export function useDesktopFileDrop(workbench: DesktopImportWorkbench, onFiles: (files: File[]) => void) {
  const handler = useRef(onFiles);
  handler.current = onFiles;
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<DroppedFiles>).detail;
      if (detail?.workbench === workbench && Array.isArray(detail.files) && detail.files.length) handler.current(detail.files);
    };
    window.addEventListener(EVENT, receive);
    return () => window.removeEventListener(EVENT, receive);
  }, [workbench]);
}

export function isDesktopFileDrag(event: DragEvent): boolean {
  const data = event.dataTransfer;
  return !!data && (Array.from(data.types).includes('Files') || Array.from(data.items).some(item => item.kind === 'file'));
}
