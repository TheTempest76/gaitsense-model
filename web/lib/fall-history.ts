/**
 * Synthetic monthly fall-count history for the dashboard's history chart.
 *
 * This is demo content, not a real record — this device does not detect
 * falls (nothing in the pipeline classifies a fall event; the gait-pattern
 * indicator elsewhere on this page classifies self-reported fall *history*
 * in a research dataset, which is a different thing entirely, see
 * lib/risk.ts). There is no real per-user fall log to show, so this
 * generates a plausible-looking sample instead of leaving the chart empty —
 * the same "mock data, clearly labelled" approach as the exercise programs
 * on /exercises. The component that renders this carries a visible "Sample
 * data" caption for exactly that reason; don't drop it if you reuse this.
 */

export interface MonthlyFalls {
  /** e.g. "Apr 2026" */
  label: string;
  count: number;
}

// A mildly declining trend, oldest to newest — a demo narrative, not a
// measured outcome. Deterministic (no Math.random) so server and client
// render the same values with no hydration mismatch.
const SAMPLE_COUNTS = [2, 1, 2, 1, 1, 0];

export function syntheticFallHistory(monthsBack = SAMPLE_COUNTS.length): MonthlyFalls[] {
  const now = new Date();
  const months: MonthlyFalls[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const count = SAMPLE_COUNTS[SAMPLE_COUNTS.length - 1 - i] ?? 0;
    months.push({ label, count });
  }
  return months;
}
