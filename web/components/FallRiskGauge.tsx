import { Card, CardHeading } from "./ui/Card";
import { fmt, fmtInt } from "@/lib/chart-utils";
import { BAND_LOW, BAND_HIGH } from "@/lib/risk";
import type { Assessment } from "@/lib/types";

/** One visual for the model output: a half-dial from 0 to 1 with the marker
 * sitting where this person's recent walking lands. The shaded arc in the
 * middle is the range where a 0.59-AUC classifier genuinely cannot separate
 * the two groups, so it is drawn neutral grey, not amber. */
export function FallRiskGauge({ assessment }: { assessment: Assessment | null }) {
  const p = assessment?.probability ?? null;
  const enough = assessment != null && p != null;

  // Half-dial geometry: p = 0 at the left end, p = 1 at the right end.
  const cx = 140;
  const cy = 140;
  const R = 116;
  const pt = (f: number) => {
    const a = Math.PI * (1 - f);
    return [cx + R * Math.cos(a), cy - R * Math.sin(a)] as const;
  };
  const arc = (f0: number, f1: number) => {
    const [x0, y0] = pt(f0);
    const [x1, y1] = pt(f1);
    return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`;
  };
  const [mx, my] = pt(enough ? p! : 0);

  return (
    <Card delay={0.05}>
      <CardHeading
        title="How close are you to falling?"
        hint="How closely your recent walking resembles that of people who reported two or more falls in the year before recording — a research signal, not a fall prediction (AUC 0.59)."
      />

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
        <svg
          viewBox="0 0 280 168"
          className="w-full max-w-[280px] shrink-0"
          role="img"
          aria-label={
            enough
              ? `Indicator ${fmt(p!, 2)} on a 0 to 1 scale — ${assessment!.label}`
              : "Not enough walking recorded yet"
          }
        >
          {/* track */}
          <path
            d={arc(0, 1)}
            fill="none"
            stroke="var(--gridline)"
            strokeWidth={16}
            strokeLinecap="round"
          />
          {/* "cannot separate" band */}
          <path
            d={arc(BAND_LOW, BAND_HIGH)}
            fill="none"
            stroke="var(--band-edge)"
            strokeWidth={16}
          />
          {/* value fill */}
          {enough && (
            <path
              d={arc(0, Math.max(0.001, p!))}
              fill="none"
              stroke="var(--accent-solid)"
              strokeWidth={16}
              strokeLinecap="round"
            />
          )}
          {/* marker */}
          {enough && (
            <>
              <line
                x1={cx}
                y1={cy}
                x2={mx}
                y2={my}
                stroke="var(--text-primary)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <circle cx={mx} cy={my} r={7} fill="var(--text-primary)" />
              <circle cx={cx} cy={cy} r={5} fill="var(--text-primary)" />
            </>
          )}
          <text x={pt(0)[0]} y={cy + 20} textAnchor="middle" className="fill-[var(--text-muted)] text-[11px]">
            0
          </text>
          <text x={cx} y={18} textAnchor="middle" className="fill-[var(--text-muted)] text-[11px]">
            model can&apos;t separate
          </text>
          <text x={pt(1)[0]} y={cy + 20} textAnchor="middle" className="fill-[var(--text-muted)] text-[11px]">
            1
          </text>
          <text x={cx} y={cy - 24} textAnchor="middle" className="fill-[var(--text-primary)] text-[30px] font-semibold tabular-nums">
            {enough ? fmt(p!, 2) : "—"}
          </text>
        </svg>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="text-[18px] font-semibold tracking-tight">
            {assessment?.label ?? "Loading…"}
          </div>
          {assessment && <p className="mt-1.5 text-[13px] text-ink-secondary">{assessment.detail}</p>}
          {enough && (
            <p className="mt-2 tabular-nums text-[12px] text-ink-muted">
              median of {fmtInt(assessment!.n_scored_windows)} scored windows
            </p>
          )}
          <p className="mt-3 border-t border-hairline-border pt-3 text-[12px] text-ink-muted">
            Not medical advice. The labels are self-reported past falls, so there is no
            forward-looking claim in this data — talk to a clinician about falls risk.
          </p>
        </div>
      </div>
    </Card>
  );
}
