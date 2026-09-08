/**
 * SQLite storage for GaitSense readings.
 *
 * One row per analysed 10 s window, stored exactly as the device reported it,
 * plus a few derived columns the dashboard needs. Nothing is aggregated on
 * write — daily rollups are computed on read so that changing how a day is
 * summarised never requires a migration or a backfill.
 *
 * Ported from the original FastAPI site's web/server/db.py. One behaviour
 * did NOT carry over: that version re-scored every posted feature vector
 * with the Python XGBoost booster as a drift check against the flashed
 * firmware. This app has no Python/XGBoost runtime, so there is currently no
 * equivalent check here — the device's own score is trusted as-is. If that
 * matters to you, the cheapest fix is a tiny sidecar service exposing
 * POST /score (features -> probability) that this route calls; see
 * models/model.json for what it would load.
 */

import Database from "better-sqlite3";
import path from "node:path";
import type { DailyRow, DeviceInfo, IngestPayload, RecentReading, WindowSummary } from "./types";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "gaitsense.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS readings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id     TEXT    NOT NULL,
    ts_ms         INTEGER NOT NULL,   -- when the window ended
    ts_source     TEXT    NOT NULL,   -- 'device' (SNTP-synced) or 'server' (arrival)
    received_ms   INTEGER NOT NULL,
    fw            TEXT,
    window_sec    REAL,

    steps_total   INTEGER,            -- cumulative on the device, resets on reboot
    steps_delta   INTEGER,            -- new steps since the previous reading
    steps_window  INTEGER,

    walking       INTEGER NOT NULL,
    scored        INTEGER NOT NULL,
    prob_faller   REAL,               -- from the device's own score() call

    cadence_spm      REAL,
    stride_time_mean REAL,
    magnitude_std    REAL,
    rssi              INTEGER,
    features          TEXT             -- JSON array, model input order
);

CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts_ms);
`;

// better-sqlite3 opens a real file handle; Next.js dev re-evaluates this
// module on almost every hot reload, and a fresh handle each time eventually
// hits "too many open files" and can collide with WAL locking. Cache the
// connection on the Node global object, the same trick the Prisma docs use,
// so it survives HMR and is created exactly once per process.
declare global {
  var __gaitsenseDb: Database.Database | undefined;
}

function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!global.__gaitsenseDb) {
    global.__gaitsenseDb = openDb();
  }
  return global.__gaitsenseDb;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function previousStepsTotal(deviceId: string): number | null {
  const row = getDb()
    .prepare(
      "SELECT steps_total FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(deviceId) as { steps_total: number | null } | undefined;
  return row ? row.steps_total : null;
}

/**
 * New steps represented by this reading.
 *
 * The device reports a counter that restarts at zero on reboot, so a value
 * lower than the last one means the node restarted rather than that the
 * wearer walked backwards — in that case the whole new count is fresh.
 */
export function computeStepsDelta(previous: number | null, current: number | null): number {
  if (current === null || current === undefined) return 0;
  if (previous === null || current < previous) return Math.max(0, current);
  return current - previous;
}

export function insertReading(payload: IngestPayload): number {
  const nowMs = Date.now();

  const deviceTs = payload.unix_ms ?? 0;
  // A device that has not reached SNTP sends 0; trusting it would file the
  // reading in 1970 and silently break every date rollup.
  let tsMs: number;
  let tsSource: "device" | "server";
  if (deviceTs && deviceTs > 1_600_000_000_000) {
    tsMs = deviceTs;
    tsSource = "device";
  } else {
    tsMs = nowMs;
    tsSource = "server";
  }

  const stepsTotal = payload.steps_total ?? null;
  const stepsDelta = computeStepsDelta(previousStepsTotal(payload.device_id), stepsTotal);

  const stmt = getDb().prepare(`
    INSERT INTO readings (
      device_id, ts_ms, ts_source, received_ms, fw, window_sec,
      steps_total, steps_delta, steps_window,
      walking, scored, prob_faller,
      cadence_spm, stride_time_mean, magnitude_std, rssi, features
    ) VALUES (@device_id, @ts_ms, @ts_source, @received_ms, @fw, @window_sec,
              @steps_total, @steps_delta, @steps_window,
              @walking, @scored, @prob_faller,
              @cadence_spm, @stride_time_mean, @magnitude_std, @rssi, @features)
  `);

  const info = stmt.run({
    device_id: payload.device_id,
    ts_ms: tsMs,
    ts_source: tsSource,
    received_ms: nowMs,
    fw: payload.fw ?? null,
    window_sec: payload.window_sec ?? null,
    steps_total: stepsTotal,
    steps_delta: stepsDelta,
    steps_window: payload.steps_window ?? null,
    walking: payload.walking ? 1 : 0,
    scored: payload.scored ? 1 : 0,
    prob_faller: payload.prob_faller ?? null,
    cadence_spm: payload.cadence_spm ?? null,
    stride_time_mean: payload.stride_time_mean ?? null,
    magnitude_std: payload.magnitude_std ?? null,
    rssi: payload.rssi ?? null,
    features: payload.features ? JSON.stringify(payload.features) : null,
  });

  return Number(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function deviceClause(deviceId: string | null): { sql: string; params: unknown[] } {
  return deviceId ? { sql: "AND device_id = ?", params: [deviceId] } : { sql: "", params: [] };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dayProbMedian(day: string, deviceId: string | null): number | null {
  const { sql, params } = deviceClause(deviceId);
  const rows = getDb()
    .prepare(
      `SELECT prob_faller FROM readings
       WHERE scored = 1 AND prob_faller IS NOT NULL
         AND date(ts_ms / 1000, 'unixepoch', 'localtime') = ? ${sql}`
    )
    .all(day, ...params) as { prob_faller: number }[];
  return median(rows.map((r) => r.prob_faller));
}

export function dailyHistory(days: number, deviceId: string | null = null): DailyRow[] {
  const { sql, params } = deviceClause(deviceId);
  const rows = getDb()
    .prepare(
      `SELECT date(ts_ms / 1000, 'unixepoch', 'localtime') AS day,
              SUM(steps_delta)                              AS steps,
              -- Windows are window_sec long but hop every window_sec/2, so
              -- they overlap by half; counting the hop avoids double-counting.
              SUM(walking * COALESCE(window_sec, 10.0) / 2.0) AS walking_sec,
              COUNT(*)                                      AS windows,
              SUM(scored)                                   AS scored_windows,
              AVG(CASE WHEN walking THEN cadence_spm END)   AS cadence_spm,
              AVG(CASE WHEN walking THEN stride_time_mean END) AS stride_time_mean
       FROM readings
       WHERE ts_ms >= (strftime('%s', 'now', ?) * 1000) ${sql}
       GROUP BY day
       ORDER BY day`
    )
    .all(`-${days} days`, ...params) as Omit<DailyRow, "prob_median">[];

  return rows.map((r) => ({ ...r, prob_median: dayProbMedian(r.day, deviceId) }));
}

export function windowSummary(hours: number, deviceId: string | null = null): WindowSummary {
  const { sql, params } = deviceClause(deviceId);
  const since = `-${hours} hours`;

  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(steps_delta), 0)              AS steps,
              COUNT(*)                                    AS windows,
              COALESCE(SUM(walking * COALESCE(window_sec, 10.0) / 2.0), 0)
                                                          AS walking_sec,
              COALESCE(SUM(scored), 0)                    AS scored_windows,
              AVG(CASE WHEN walking THEN cadence_spm END) AS cadence_spm,
              AVG(CASE WHEN walking THEN stride_time_mean END) AS stride_time_mean
       FROM readings
       WHERE ts_ms >= (strftime('%s', 'now', ?) * 1000) ${sql}`
    )
    .get(since, ...params) as Omit<WindowSummary, "prob_median" | "prob_n">;

  const probs = (
    getDb()
      .prepare(
        `SELECT prob_faller FROM readings
         WHERE scored = 1 AND prob_faller IS NOT NULL
           AND ts_ms >= (strftime('%s', 'now', ?) * 1000) ${sql}`
      )
      .all(since, ...params) as { prob_faller: number }[]
  ).map((r) => r.prob_faller);

  return { ...row, prob_median: median(probs), prob_n: probs.length };
}

export function recentReadings(limit: number, deviceId: string | null = null): RecentReading[] {
  const { sql, params } = deviceClause(deviceId);
  const rows = getDb()
    .prepare(
      `SELECT ts_ms, walking, scored, prob_faller, cadence_spm,
              stride_time_mean, magnitude_std, steps_delta, steps_window, rssi
       FROM readings
       WHERE 1 = 1 ${sql}
       ORDER BY ts_ms DESC
       LIMIT ?`
    )
    .all(...params, limit) as (Omit<RecentReading, "walking" | "scored"> & {
    walking: number;
    scored: number;
  })[];

  return rows.reverse().map((r) => ({ ...r, walking: !!r.walking, scored: !!r.scored }));
}

export function devices(): DeviceInfo[] {
  const rows = getDb()
    .prepare(
      `SELECT device_id,
              MAX(received_ms) AS last_seen_ms,
              COUNT(*)         AS total_windows,
              MAX(steps_total) AS steps_total
       FROM readings
       GROUP BY device_id
       ORDER BY last_seen_ms DESC`
    )
    .all() as Omit<DeviceInfo, "fw" | "rssi" | "ts_source" | "online" | "is_sim">[];

  const now = Date.now();
  return rows.map((r) => {
    const extra = getDb()
      .prepare(
        "SELECT fw, rssi, ts_source FROM readings WHERE device_id = ? ORDER BY id DESC LIMIT 1"
      )
      .get(r.device_id) as { fw: string | null; rssi: number | null; ts_source: "device" | "server" } | undefined;

    const fw = extra?.fw ?? null;
    return {
      ...r,
      fw,
      rssi: extra?.rssi ?? null,
      ts_source: extra?.ts_source ?? "server",
      online: now - r.last_seen_ms < 30_000,
      is_sim: (fw ?? "").toLowerCase().includes("sim"),
    };
  });
}
