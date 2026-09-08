import { NextRequest, NextResponse } from "next/server";
import { recentReadings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const deviceId = searchParams.get("device_id");
  const limit = Math.min(2000, Math.max(1, Number(searchParams.get("limit") ?? 180)));

  return NextResponse.json({ readings: recentReadings(limit, deviceId) });
}
