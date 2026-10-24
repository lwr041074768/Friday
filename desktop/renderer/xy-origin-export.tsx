import { useRef } from 'react';
import { createXyOriginExportSession } from '@/lib/xy-origin-session';
import type { XyExportOptions } from '@/lib/xy-origin-export';
import OriginTransfer from './origin-transfer';

export default function XyOriginExport(options: XyExportOptions) {
  const session = useRef(createXyOriginExportSession());
  return <OriginTransfer enabled={!!options.curves.length} title={options.kind.toUpperCase()} prepare={() => session.current.prepare(options).serialized} description={options.kind === 'eis' ? 'EIS 每组仅四列：原始 Z′、导入虚部列、绘图 Z′、绘图 −Z″。' : 'XRD 每组包含原始 2θ、原始强度、绘图 X/Y，处理设置写入备注。'}/>;
}
