import { buildOriginExport, type OriginExportPayload } from "./lsv-origin-export";
import type { PlotCurve } from "./lsv-math";
import type { ScanMode } from "./scan-branches";

export type PreparedOriginTransfer = {
  payload: OriginExportPayload;
  serialized: string;
  // The caller sets this only after requesting a browser download. It does not
  // confirm that a file was saved, or that Origin received the data.
  downloadRequested: boolean;
};

export type OriginExportSession = {
  prepare(curves: PlotCurve[], scan: ScanMode, forceNew?: boolean): PreparedOriginTransfer;
};

/** Retain one export snapshot. Callers must update curve data immutably. */
export function createOriginExportSession(): OriginExportSession {
  let previousCurves: PlotCurve[] | undefined;
  let previousScan: ScanMode | undefined;
  let content = "";
  let prepared: PreparedOriginTransfer | undefined;

  return {
    prepare(curves, scan, forceNew = false) {
      if (!forceNew && prepared && previousCurves === curves && previousScan === scan) {
        return prepared;
      }

      const payload = buildOriginExport(curves, scan);
      // Only exported content determines freshness. A color change or applying
      // the same IR again can produce new curve objects without new export data.
      const nextContent = JSON.stringify({
        formulas: payload.formulas,
        scan: payload.scan,
        samples: payload.samples,
      });
      if (!forceNew && prepared && content === nextContent) {
        previousCurves = curves;
        previousScan = scan;
        return prepared;
      }

      const next: PreparedOriginTransfer = {
        payload,
        serialized: JSON.stringify(payload),
        downloadRequested: false,
      };
      previousCurves = curves;
      previousScan = scan;
      content = nextContent;
      prepared = next;
      return next;
    },
  };
}
