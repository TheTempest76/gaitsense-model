"use client";

import { useEffect, useState } from "react";
import { CheckIcon, FlameIcon } from "@/components/icons";
import { computeStreak, getCompletedDays, type Streak } from "@/lib/streaks";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function StreakStrip() {
  // localStorage doesn't exist during SSR, so streak state starts empty and
  // is filled in after mount — the same pattern as the theme toggle.
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreak(computeStreak(getCompletedDays()));
  }, []);

  if (!streak) {
    return <div className="h-[92px] rounded-[var(--radius-card)] border border-hairline-border bg-surface" />;
  }

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-hairline-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent-wash text-accent">
          <FlameIcon className="h-5 w-5" />
        </span>
        <div>
          <div className="text-[22px] font-semibold leading-none tracking-tight">
            {streak.current} day{streak.current === 1 ? "" : "s"}
          </div>
          <div className="mt-1 text-[12.5px] text-ink-secondary">
            current streak · best {streak.best} day{streak.best === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {streak.last7.map((d) => {
          const label = DAY_LABELS[new Date(d.date).getDay()];
          return (
            <div key={d.date} className="flex flex-col items-center gap-1">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-medium ${
                  d.done ? "bg-accent-solid text-accent-on-solid" : "bg-page text-ink-muted"
                }`}
                title={d.date}
              >
                {d.done ? <CheckIcon className="h-4 w-4" /> : label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
