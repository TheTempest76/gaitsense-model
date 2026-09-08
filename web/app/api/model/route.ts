import { NextResponse } from "next/server";
import { modelCard } from "@/lib/risk";
import metrics from "@/lib/model-metrics.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    model_card: modelCard(),
    features: metrics.features,
  });
}
