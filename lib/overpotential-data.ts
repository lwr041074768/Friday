import type { PlotCurve } from "./lsv-math";
import { readTarget, type TargetReading, type TargetSettings } from "./lsv-target";
import type { ScanMode } from "./scan-branches";

export type OverpotentialSnapshot = { curves: PlotCurve[]; scan: ScanMode; demo: boolean };
export type OverpotentialRow = { curve: PlotCurve; reading: TargetReading };

// Shared with the LSV summary: read the current plotted X/Y; smoothing only
// locates the peak, while the intersection uses adjacent original points.
export const OVERPOTENTIAL_TARGET_SETTINGS: TargetSettings = { smoothPoints: 3, prominence: 1 };
export const TARGET_SETTINGS = OVERPOTENTIAL_TARGET_SETTINGS;
export const DEFAULT_OVERPOTENTIAL_SNAPSHOT: OverpotentialSnapshot = { curves: [], scan: "all", demo: false };

export function buildOverpotentialRows(snapshot: OverpotentialSnapshot): OverpotentialRow[] {
  // Visibility only controls the LSV plot. Imported samples remain in this
  // comparison; unavailable readings retain undefined rather than becoming 0.
  return snapshot.curves.map(curve => ({ curve, reading: readTarget(curve, snapshot.scan, TARGET_SETTINGS) }));
}
