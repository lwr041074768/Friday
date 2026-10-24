import { buildXyOriginExport, type XyExportOptions, type XyOriginPayload } from "./xy-origin-export";

export type PreparedXyOriginTransfer = { payload: XyOriginPayload; serialized: string; downloadRequested: boolean };

/** Reuse a handoff ID until exported data or applied settings actually change. */
export function createXyOriginExportSession() {
  let content = "", prepared: PreparedXyOriginTransfer | undefined;
  return {
    prepare(options: XyExportOptions, forceNew = false): PreparedXyOriginTransfer {
      const payload = buildXyOriginExport(options, undefined, "origin");
      const { requestId: _id, createdAt: _time, ...data } = payload;
      const nextContent = JSON.stringify(data);
      if (!forceNew && prepared && content === nextContent) return prepared;
      const serialized = JSON.stringify(payload);
      if (new TextEncoder().encode(serialized).length > 50 * 1024 * 1024) throw new Error("Origin 交接文件超过 50 MB，请减少样品或数据点后分批导出。");
      prepared = { payload, serialized, downloadRequested: false };
      content = nextContent;
      return prepared;
    },
  };
}
