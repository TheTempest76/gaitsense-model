"use client";

import { useState } from "react";
import { Card, CardHeading } from "../ui/Card";
import { GhostButton } from "../ui/Pill";
import { DataTable } from "./DataTable";
import { LineChart } from "./LineChart";
import { fmt, fmtDay, fmtInt } from "@/lib/chart-utils";
import type { DailyRow } from "@/lib/types";

export function RiskChart({
  days,
  bandLow,
  bandHigh,
}: {
  days: DailyRow[] | null;
  bandLow: number;
  bandHigh: number;
}) {
  const [showTable, setShowTable] = useState(false);
  const rows = (days ?? []).slice(-30);
  const points = rows.map((d) => ({ ...d, v: d.prob_median }));

  return (
    <Card delay={0.15}>
      <CardHeading
        title="Gait pattern indicator over time"
        hint={`Median of each day's scored windows. Read the shaded middle as "the model cannot tell" — it is not an amber warning.`}
        action={
          <GhostButton pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Chart" : "Table"}
          </GhostButton>
        }
      />
      {showTable ? (
        <DataTable
          head={["Day", "Median indicator", "Scored windows"]}
          rows={rows.map((d) => [
            fmtDay(d.day),
            d.prob_median === null ? "—" : fmt(d.prob_median, 3),
            fmtInt(d.scored_windows),
          ])}
        />
      ) : (
        <LineChart
          points={points}
          yMin={0}
          yMax={1}
          fmtTick={(v) => fmt(v, 2)}
          bands={[{ lo: bandLow, hi: bandHigh, label: "model cannot separate" }]}
          xLabel={(p) => fmtDay(p.day)}
          emptyMsg="No scored windows yet — needs a couple of minutes of walking."
          ariaLabel="Daily median gait pattern indicator for the last 30 days"
          tipContent={(p) => (
            <div>
              <div className="text-ink-secondary">{fmtDay(p.day)}</div>
              <div>
                <span className="tabular-nums font-semibold">{fmt(p.v, 3)}</span> median indicator
              </div>
              <div className="text-ink-secondary">{fmtInt(p.scored_windows)} scored windows</div>
            </div>
          )}
        />
      )}
    </Card>
  );
}
