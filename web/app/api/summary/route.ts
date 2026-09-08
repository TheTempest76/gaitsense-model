import { NextRequest, NextResponse } from "next/server";
import { dailyHistory, devices, windowSummary } from "@/lib/db";
import { assessment } from "@/lib/risk";
import type { SummaryResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const deviceId = searchParams.get("device_id");
  const hours = Math.min(24 * 30, Math.max(1, Number(searchParams.get("hours") ?? 24)));

  const today = windowSummary(hours, deviceId);
  const history = dailyHistory(30, deviceId);

  const past = (history.length > 1 ? history.slice(0, -1) : history).map((d) => d.steps || 0);
  const avgDailySteps = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;

  const body: SummaryResponse = {
    window_hours: hours,
    steps: today.steps,
    walking_sec: today.walking_sec,
    cadence_spm: today.cadence_spm,
    stride_time_mean: today.stride_time_mean,
    windows: today.windows,
    scored_windows: today.scored_windows,
    prob_median: today.prob_median,
    prob_n: today.prob_n,
    avg_daily_steps: avgDailySteps,
    assessment: assessment(today.prob_median, today.prob_n),
    devices: devices(),
  };

  return NextResponse.json(body);
}
