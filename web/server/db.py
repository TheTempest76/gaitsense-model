"""SQLite storage for GaitSense readings.

One row per analysed 10 s window, exactly as the device reported it, plus a few
derived columns the dashboard needs. Nothing is aggregated on write -- daily
rollups are computed on read so that changing how a day is summarised never
requires a migration or a backfill.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable

DB_PATH = Path(os.environ.get(
    "GAITSENSE_DB", Path(__file__).resolve().parent.parent / "gaitsense.db"))

SCHEMA = """
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
    server_prob   REAL,               -- server recomputation, for drift detection
    prob_drift    REAL,

    cadence_spm      REAL,
    stride_time_mean REAL,
    magnitude_std    REAL,
    rssi             INTEGER,
    features         TEXT              -- JSON array, model input order
);

CREATE INDEX IF NOT EXISTS idx_readings_device_ts ON readings(device_id, ts_ms);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts_ms);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # WAL keeps the dashboard's reads from blocking on device writes, which
    # arrive every 5 s per device.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _previous_steps_total(conn: sqlite3.Connection, device_id: str) -> int | None:
    row = conn.execute(
        "SELECT steps_total FROM readings WHERE device_id = ? "
        "ORDER BY id DESC LIMIT 1", (device_id,)).fetchone()
    return None if row is None else row["steps_total"]


def compute_steps_delta(previous: int | None, current: int | None) -> int:
    """New steps represented by this reading.

    The device reports a counter that restarts at zero on reboot, so a value
    lower than the last one means the node restarted rather than that the
    wearer walked backwards -- in that case the whole new count is fresh.
    """
    if current is None:
        return 0
    if previous is None or current < previous:
        return max(0, current)
    return current - previous


def insert_reading(conn: sqlite3.Connection, payload: dict[str, Any],
                   server_prob: float | None = None) -> int:
    now_ms = int(time.time() * 1000)

    device_ts = payload.get("unix_ms") or 0
    # A device that has not reached SNTP sends 0; trusting it would file the
    # reading in 1970 and silently break every date rollup.
    if device_ts and device_ts > 1_600_000_000_000:
        ts_ms, ts_source = int(device_ts), "device"
    else:
        ts_ms, ts_source = now_ms, "server"

    device_id = payload["device_id"]
    steps_total = payload.get("steps_total")
    steps_delta = compute_steps_delta(_previous_steps_total(conn, device_id), steps_total)

    prob = payload.get("prob_faller")
    drift = None if (prob is None or server_prob is None) else abs(prob - server_prob)

    cur = conn.execute(
        """
        INSERT INTO readings (
            device_id, ts_ms, ts_source, received_ms, fw, window_sec,
            steps_total, steps_delta, steps_window,
            walking, scored, prob_faller, server_prob, prob_drift,
            cadence_spm, stride_time_mean, magnitude_std, rssi, features
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            device_id, ts_ms, ts_source, now_ms,
            payload.get("fw"), payload.get("window_sec"),
            steps_total, steps_delta, payload.get("steps_window"),
            int(bool(payload.get("walking"))), int(bool(payload.get("scored"))),
            prob, server_prob, drift,
            payload.get("cadence_spm"), payload.get("stride_time_mean"),
            payload.get("magnitude_std"), payload.get("rssi"),
            json.dumps(payload.get("features")),
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def _device_clause(device_id: str | None) -> tuple[str, tuple]:
    return ("AND device_id = ?", (device_id,)) if device_id else ("", ())


def daily_history(conn: sqlite3.Connection, days: int,
                  device_id: str | None = None) -> list[dict]:
    """One row per local calendar day.

    Median rather than mean for the day's probability: a handful of windows at
    the start or end of a walk sit at the edge of the walking gate and produce
    outliers that a mean would chase.
    """
    clause, params = _device_clause(device_id)
    rows = conn.execute(
        f"""
        SELECT date(ts_ms / 1000, 'unixepoch', 'localtime') AS day,
               SUM(steps_delta)                              AS steps,
               -- Windows are window_sec long but hop every window_sec/2, so
               -- they overlap by half; counting the hop avoids double-counting.
               -- window_sec is referenced inside the aggregate, not beside it:
               -- a bare column in a grouped query would take an arbitrary row's
               -- value.
               SUM(walking * COALESCE(window_sec, 10.0) / 2.0) AS walking_sec,
               COUNT(*)                                      AS windows,
               SUM(scored)                                   AS scored_windows,
               AVG(CASE WHEN walking THEN cadence_spm END)   AS cadence_spm,
               AVG(CASE WHEN walking THEN stride_time_mean END) AS stride_time_mean
        FROM readings
        WHERE ts_ms >= (strftime('%s', 'now', ?) * 1000) {clause}
        GROUP BY day
        ORDER BY day
        """,
        (f"-{days} days", *params),
    ).fetchall()

    out = []
    for r in rows:
        d = dict(r)
        d["prob_median"] = _day_prob_median(conn, r["day"], device_id)
        out.append(d)
    return out


def _day_prob_median(conn: sqlite3.Connection, day: str,
                     device_id: str | None) -> float | None:
    clause, params = _device_clause(device_id)
    probs = [r[0] for r in conn.execute(
        f"""
        SELECT prob_faller FROM readings
        WHERE scored = 1 AND prob_faller IS NOT NULL
          AND date(ts_ms / 1000, 'unixepoch', 'localtime') = ? {clause}
        ORDER BY prob_faller
        """, (day, *params)).fetchall()]
    return _median(probs)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def window_summary(conn: sqlite3.Connection, hours: int,
                   device_id: str | None = None) -> dict:
    """Aggregate over a trailing window of hours, for the dashboard header."""
    clause, params = _device_clause(device_id)
    since = (f"-{hours} hours",)

    row = conn.execute(
        f"""
        SELECT COALESCE(SUM(steps_delta), 0)              AS steps,
               COUNT(*)                                    AS windows,
               COALESCE(SUM(walking * COALESCE(window_sec, 10.0) / 2.0), 0)
                                                           AS walking_sec,
               COALESCE(SUM(scored), 0)                    AS scored_windows,
               AVG(CASE WHEN walking THEN cadence_spm END) AS cadence_spm,
               AVG(CASE WHEN walking THEN stride_time_mean END) AS stride_time_mean,
               MAX(prob_drift)                             AS max_prob_drift
        FROM readings
        WHERE ts_ms >= (strftime('%s', 'now', ?) * 1000) {clause}
        """, (*since, *params)).fetchone()

    probs = [r[0] for r in conn.execute(
        f"""
        SELECT prob_faller FROM readings
        WHERE scored = 1 AND prob_faller IS NOT NULL
          AND ts_ms >= (strftime('%s', 'now', ?) * 1000) {clause}
        """, (*since, *params)).fetchall()]

    d = dict(row)
    d["prob_median"] = _median(probs)
    d["prob_n"] = len(probs)
    return d


def recent_readings(conn: sqlite3.Connection, limit: int,
                    device_id: str | None = None) -> list[dict]:
    clause, params = _device_clause(device_id)
    rows = conn.execute(
        f"""
        SELECT ts_ms, walking, scored, prob_faller, cadence_spm,
               stride_time_mean, magnitude_std, steps_delta, steps_window, rssi
        FROM readings
        WHERE 1 = 1 {clause}
        ORDER BY ts_ms DESC
        LIMIT ?
        """, (*params, limit)).fetchall()
    return [dict(r) for r in reversed(rows)]


def devices(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT device_id,
               MAX(received_ms) AS last_seen_ms,
               COUNT(*)         AS total_windows,
               MAX(steps_total) AS steps_total
        FROM readings
        GROUP BY device_id
        ORDER BY last_seen_ms DESC
        """).fetchall()

    out = []
    for r in rows:
        extra = conn.execute(
            "SELECT fw, rssi, ts_source FROM readings WHERE device_id = ? "
            "ORDER BY id DESC LIMIT 1", (r["device_id"],)).fetchone()
        d = dict(r)
        d.update(dict(extra) if extra else {})
        d["online"] = (time.time() * 1000 - r["last_seen_ms"]) < 30_000
        out.append(d)
    return out
