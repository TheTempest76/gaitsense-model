import { NextRequest, NextResponse } from "next/server";
import { dailyHistory } from "@/lib/db";
import { BAND_HIGH, BAND_LOW, modelCard } from "@/lib/risk";
import type { HistoryResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const deviceId = searchParams.get("device_id");
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days") ?? 30)));

  const body: HistoryResponse = {
    days: dailyHistory(days, deviceId),
    // Bands travel with the series so the chart cannot draw its own,
    // differently-framed thresholds.
    bands: { low: BAND_LOW, high: BAND_HIGH },
    model_card: modelCard(),
  };

  return NextResponse.json(body);
}
