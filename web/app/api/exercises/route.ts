import { NextRequest, NextResponse } from "next/server";
import { dailyHistory, windowSummary } from "@/lib/db";
import { recommend } from "@/lib/exercises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const deviceId = searchParams.get("device_id");

  const today = windowSummary(24, deviceId);
  const history = dailyHistory(30, deviceId);
  const past = (history.length > 1 ? history.slice(0, -1) : history).map((d) => d.steps || 0);
  const avgDailySteps = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;

  const plan = recommend({
    avgDailySteps,
    cadenceSpm: today.cadence_spm,
    walkingSec: today.walking_sec,
  });

  return NextResponse.json(plan);
}
