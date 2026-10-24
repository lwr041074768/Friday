import { useRef } from 'react';
import { createOriginExportSession } from '@/lib/lsv-origin-session';
import type { PlotCurve } from '@/lib/lsv-math';
import type { ScanMode } from '@/lib/scan-branches';
import LsvDataExport from '@/components/lsv-data-export';
import OriginTransfer from './origin-transfer';

export default function LsvOriginExport({ curves, scan }: { curves: PlotCurve[]; scan: ScanMode }) {
  const session = useRef(createOriginExportSession());
  return <div className="lsv-export-stack"><OriginTransfer enabled={!!curves.length} title="LSV" prepare={() => session.current.prepare(curves, scan).serialized} description="按当前扫描选择保留原始电位、电流、校正 X/Y 和备注，每组五列。"/><LsvDataExport curves={curves} scan={scan}/></div>;
}
