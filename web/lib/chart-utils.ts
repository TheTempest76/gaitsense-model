/** Shared math/formatting for the hand-built SVG charts.
 *
 * Charts are custom SVG rather than a charting library: every chart here
 * plots one measure on one axis, uses direct labels sparingly, and shades
 * the risk band in neutral gray per the data-viz skill's rules — easier to
 * guarantee by owning the marks than by fighting a library's defaults.
 */

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString();
}

export function fmt(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n) ? "—" : Number(n).toFixed(digits);
}

export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Nice round axis maximum, so ticks land on readable numbers. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** SVG path for a bar with rounded top corners, anchored square to the baseline. */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0) return "";
  return (
    `M${x},${y + h}V${y + rad}A${rad},${rad} 0 0 1 ${x + rad},${y}` +
    `H${x + w - rad}A${rad},${rad} 0 0 1 ${x + w},${y + rad}` +
    `V${y + h}Z`
  );
}

export const CHART_PAD = { top: 16, right: 18, bottom: 30, left: 46 };
