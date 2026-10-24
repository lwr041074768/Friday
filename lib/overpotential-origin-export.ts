import { buildOverpotentialRows, type OverpotentialSnapshot } from './overpotential-data';
import { resolveOverpotentialAxes, type OverpotentialAxisSettings } from './overpotential-axes';

export type OverpotentialOriginSample = {
  id: string; order: number; name: string; color: string; source: string;
  eta10MV: number | null; xAt10: number | null; eAt10: number | null;
  status: string; note: string; candidate: boolean; demo: boolean; visible: boolean;
  irVoltage: number | null; unit: string; area: string; compensation: string;
};
export type OverpotentialOriginAxis = {
  min: number; max: number; major: number; minorCount: number;
  majorTicks: number[]; minorTicks: number[];
};
export type OverpotentialOriginPayload = {
  schema: 'overpotential-origin/v1'; requestId: string; createdAt: string;
  scan: OverpotentialSnapshot['scan']; demo: boolean;
  target: { current: 10; equilibriumVoltage: 1.23; unit: 'mV' };
  axes: { x: OverpotentialOriginAxis; y: OverpotentialOriginAxis };
  samples: OverpotentialOriginSample[];
};

const finite = (value: number | undefined): number | null => Number.isFinite(value) ? value! : null;

export function prepareOverpotentialOriginExport(snapshot: OverpotentialSnapshot, settings: OverpotentialAxisSettings, requestId = crypto.randomUUID()): OverpotentialOriginPayload {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) throw Error('Origin 导出请求 ID 无效。');
  if (!snapshot.curves.length || snapshot.curves.length > 20) throw Error('每次需导出 1–20 个样品。');
  const rows = buildOverpotentialRows(snapshot);
  const axes = resolveOverpotentialAxes(rows, settings);
  return {
    schema: 'overpotential-origin/v1', requestId, createdAt: new Date().toISOString(),
    scan: snapshot.scan, demo: snapshot.demo,
    target: { current: 10, equilibriumVoltage: 1.23, unit: 'mV' },
    axes: {
      x: { ...axes.x, minorCount: Number(settings.xMinor.trim() || '1') },
      y: { ...axes.y, minorCount: Number(settings.yMinor.trim() || '1') },
    },
    samples: rows.map(({ curve, reading }, index) => ({
      id: curve.id, order: index + 1, name: curve.name, color: curve.color, source: curve.source,
      eta10MV: finite(reading.etaMV), xAt10: finite(reading.x), eAt10: finite(reading.e),
      status: reading.status, note: reading.note, candidate: !!reading.candidate,
      demo: snapshot.demo || !!curve.demo, visible: curve.visible,
      irVoltage: curve.irVoltage?.trim() ? finite(Number(curve.irVoltage)) : 0,
      unit: curve.unit, area: curve.area, compensation: curve.compensation,
    })),
  };
}
