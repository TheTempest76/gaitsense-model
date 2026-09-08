"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { fmt, fmtInt } from "@/lib/chart-utils";
import type { ExercisesResponse, HistoryResponse, RecentReading, SummaryResponse } from "@/lib/types";
import { Header } from "./Header";
import { StatTile } from "./StatTile";
import { AssessmentCard } from "./AssessmentCard";
import { StepsChart } from "./charts/StepsChart";
import { RiskChart } from "./charts/RiskChart";
import { CadenceChart } from "./charts/CadenceChart";
import { ExercisesSection } from "./ExercisesSection";
import { DevicesPanel } from "./DevicesPanel";

const REFRESH_MS = 5000;

export function Dashboard() {
  const { data: summary } = useSWR<SummaryResponse>("/api/summary", fetcher, {
    refreshInterval: REFRESH_MS,
  });
  const { data: history } = useSWR<HistoryResponse>("/api/history?days=30", fetcher, {
    refreshInterval: REFRESH_MS,
  });
  const { data: readingsResp } = useSWR<{ readings: RecentReading[] }>(
    "/api/readings?limit=180",
    fetcher,
    { refreshInterval: REFRESH_MS }
  );
  const { data: exercises } = useSWR<ExercisesResponse>("/api/exercises", fetcher, {
    refreshInterval: REFRESH_MS * 6,
  });

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-6 pb-16 sm:px-6">
      <Header devices={summary?.devices ?? null} />

      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Steps today"
          value={summary?.steps ?? null}
          foot={summary?.avg_daily_steps ? `30-day average ${fmtInt(summary.avg_daily_steps)}` : undefined}
          delay={0}
        />
        <StatTile
          label="Walking time today"
          value={summary ? (summary.walking_sec || 0) / 60 : null}
          unit="min"
          foot={summary ? `${fmtInt(summary.windows)} windows recorded` : undefined}
          delay={0.04}
        />
        <StatTile
          label="Average cadence"
          value={summary?.cadence_spm ?? null}
          unit="steps/min"
          foot={summary?.stride_time_mean ? `Stride time ${fmt(summary.stride_time_mean, 2)} s` : undefined}
          delay={0.08}
        />
        <StatTile
          label="Windows analysed"
          value={summary?.scored_windows ?? null}
          foot={
            summary
              ? `of ${fmtInt(summary.windows)} met the walking + complete-features bar`
              : undefined
          }
          delay={0.12}
        />
      </section>

      <div className="mt-4">
        <AssessmentCard assessment={summary?.assessment ?? null} />
      </div>

      <div className="mt-4">
        <StepsChart days={history?.days ?? null} />
      </div>

      <div className="mt-4">
        <RiskChart
          days={history?.days ?? null}
          bandLow={history?.bands.low ?? 0.35}
          bandHigh={history?.bands.high ?? 0.65}
        />
      </div>

      <div className="mt-4">
        <CadenceChart readings={readingsResp?.readings ?? null} />
      </div>

      <div className="mt-4">
        <ExercisesSection data={exercises ?? null} />
      </div>

      <div className="mt-4">
        <DevicesPanel devices={summary?.devices ?? null} />
      </div>

      <footer className="mt-7 text-center text-xs text-ink-muted">
        GaitSense research prototype — not a medical device. Firmware posts to{" "}
        <code className="rounded border border-hairline-border bg-surface px-1.5 py-0.5 text-[11.5px]">
          /api/ingest
        </code>
        ; the model card above is served from{" "}
        <code className="rounded border border-hairline-border bg-surface px-1.5 py-0.5 text-[11.5px]">
          /api/model
        </code>
        .
      </footer>
    </div>
  );
}
