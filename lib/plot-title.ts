export type AxisTitleStyle = { text: string | null; size: number | null; bold: boolean };
export type PlotTitleSettings = { x: AxisTitleStyle; y: AxisTitleStyle };
export const DEFAULT_TITLE_SETTINGS: PlotTitleSettings = {
  x: { text: null, size: null, bold: true }, y: { text: null, size: null, bold: true },
};
export const PLOT_FONT = 'Arial, "Microsoft YaHei", sans-serif';

/** Keep rotated text inside the exported viewBox as well as the live canvas.
 * Resizing only changes this derived position; it never changes the project. */
export function titleLayout(axis: "x" | "y", center: { x: number; y: number }, canvas: { width: number; height: number }, metrics: { width: number; ascent: number; descent: number }) {
  const pad = 6, half = metrics.width / 2;
  const extents = axis === "x"
    ? { left: half, right: half, top: metrics.ascent, bottom: metrics.descent }
    : { left: metrics.ascent, right: metrics.descent, top: half, bottom: half };
  const clamp = (value: number, min: number, max: number) => max >= min ? Math.max(min, Math.min(max, value)) : (min + max) / 2;
  return { x: clamp(center.x, pad + extents.left, canvas.width - pad - extents.right), y: clamp(center.y, pad + extents.top, canvas.height - pad - extents.bottom) };
}

export function measureTitle(text: string, requestedSize: number, bold: boolean, available: number) {
  const context = document.createElement("canvas").getContext("2d");
  const measure = (size: number) => {
    if (!context) return { width: text.length * size, ascent: size, descent: size * .25 };
    context.font = `${bold ? 700 : 400} ${size}px ${PLOT_FONT}`;
    const result = context.measureText(text);
    return { width: Math.max(result.width, result.actualBoundingBoxLeft + result.actualBoundingBoxRight), ascent: result.actualBoundingBoxAscent, descent: result.actualBoundingBoxDescent };
  };
  const initial = measure(requestedSize);
  const size = initial.width > available ? requestedSize * Math.max(1, available) / initial.width : requestedSize;
  return { size, ...measure(size) };
}
