/**
 * Device ingest endpoint. The ESP32 firmware (firmware/main/net.c) POSTs one
 * analysed 10 s window here roughly every 5 seconds, authenticated with the
 * X-Device-Token header (must equal GAITSENSE_TOKEN in this app's env).
 *
 * better-sqlite3 is a native module, so this route must run on the Node.js
 * runtime rather than the Edge runtime.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { insertReading } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Non-finite doubles arrive as JSON null (see append_num in the firmware's
// net.c), so every measurement field is nullable/optional.
const IngestSchema = z.object({
  device_id: z.string().min(1).max(64),
  fw: z.string().nullable().optional(),
  unix_ms: z.number().int().optional().default(0),
  window_sec: z.number().nullable().optional(),

  steps_total: z.number().int().nullable().optional(),
  steps_window: z.number().int().nullable().optional(),

  walking: z.boolean().optional().default(false),
  scored: z.boolean().optional().default(false),
  prob_faller: z.number().nullable().optional(),

  cadence_spm: z.number().nullable().optional(),
  stride_time_mean: z.number().nullable().optional(),
  magnitude_std: z.number().nullable().optional(),
  rssi: z.number().int().nullable().optional(),

  features: z.array(z.number().nullable()).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const expected = process.env.GAITSENSE_TOKEN ?? "change-me";
  const got = request.headers.get("x-device-token") ?? "";
  if (got !== expected) {
    return NextResponse.json({ detail: "bad device token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "invalid JSON body" }, { status: 400 });
  }

  const parsed = IngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { detail: "invalid payload", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const id = insertReading(parsed.data);
  return NextResponse.json({ ok: true, id });
}
