import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Touch the DB so a broken DATABASE_PATH shows up as a failed health check
  // rather than a mystery on the first real ingest.
  getDb();
  return NextResponse.json({ ok: true, db: process.env.DATABASE_PATH ?? "gaitsense.db" });
}
