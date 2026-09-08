"use client";

import { useState } from "react";
import { Card, CardHeading } from "../ui/Card";
import { GhostButton } from "../ui/Pill";
import { DataTable } from "./DataTable";
import { LineChart } from "./LineChart";
import { fmt, fmtInt, niceMax } from "@/lib/chart-utils";
import type { RecentReading } from "@/lib/types";

export function CadenceChart({ readings }: { readings: RecentReading[] | null }) {
  const [showTable, setShowTable] = useState(false);
  const walking = (readings ?? []).filter((r) => r.walking);
  const values = walking.map((r) => r.cadence_spm).filter((v): v is number => v !== null);
  const yMax = niceMax(Math.max(120, ...values));

  // In live use these windows span an hour or so and a clock time is enough.
  // Over a longer history they cross midnight, where a bare clock time reads
  // as going backwards — so add the date whenever the range spans more than
  // one calendar day. Comparing calendar dates rather than elapsed
  // milliseconds, because 23:00 to 09:00 crosses midnight in well under 24h.
  const localDay = (ms: number) => new Date(ms).toLocaleDateString();
  const multiDay =
    walking.length > 1 && localDay(walking[0].ts_ms) !== localDay(walking[walking.length - 1].ts_ms);
  const stamp = (ms: number) =>
    multiDay
      ? `${new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${new Date(
          ms
        ).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
      : new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const points = walking.map((r) => ({ ...r, v: r.cadence_spm }));

  return (
    <Card delay={0.2}>
      <CardHeading
        title="Recent cadence"
        hint="One point per analysed 10 s window while walking, newest on the right."
        action={
          <GhostButton pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Chart" : "Table"}
          </GhostButton>
        }
      />
      {showTable ? (
        <DataTable
          head={["Time", "Cadence", "Steps in window", "Scored"]}
          rows={walking.map((r) => [
            stamp(r.ts_ms),
            fmt(r.cadence_spm, 0),
            fmtInt(r.steps_window),
            r.scored ? "yes" : "no",
          ])}
        />
      ) : (
        <LineChart
          points={points}
          yMin={0}
          yMax={yMax}
          alt
          fmtTick={(v) => fmt(v, 0)}
          xLabel={(p) => stamp(p.ts_ms)}
          emptyMsg="No walking detected yet."
          ariaLabel="Cadence per analysed window"
          tipContent={(p) => (
            <div>
              <div className="text-ink-secondary">{stamp(p.ts_ms)}</div>
              <div>
                <span className="tabular-nums font-semibold">{fmt(p.v, 0)}</span> steps/min
              </div>
              <div className="text-ink-secondary">
                {fmtInt(p.steps_window)} steps in window {p.scored ? "· scored" : "· not scored"}
              </div>
            </div>
          )}
        />
      )}
    </Card>
  );
}
