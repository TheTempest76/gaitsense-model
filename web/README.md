# GaitSense website (Next.js)

A single Next.js App Router app that receives readings from the ESP32 node,
stores them in SQLite, and serves the dashboard: step counts, walking time,
cadence, 30 days of history, the model's gait-pattern indicator, and an
exercise plan. Ingest API and UI live in the same process — no separate
backend to run.

```
ESP32 ──POST /api/ingest──▶ Next.js route handlers ──▶ SQLite (gaitsense.db)
                                    │
                                    └──▶ dashboard at /  (React, polls every 5 s)
```

## Run it

```bash
cd web
npm install

# must match GAITSENSE_DEVICE_TOKEN in the firmware's menuconfig
cp .env.example .env.local   # then edit GAITSENSE_TOKEN

npm run dev      # http://localhost:3000
# or: npm run build && npm start
```

Point the firmware's `GAITSENSE_SERVER_URL` at this machine's LAN IP —
`npm run dev` binds to all interfaces by default, but confirm with `npm run
dev -- -H 0.0.0.0` if the device still can't reach it, and allow port 3000
through the host firewall.

The database is created at `web/gaitsense.db` on first request (override the
path with `DATABASE_PATH` in `.env.local`). It's gitignored — nothing to
clean up between runs.

## Trying it without hardware

```bash
# from the repo root, with the Python venv active
python tools/simulate_device.py --backfill-days 21 --live
```

This posts real synthetic readings (real features, real model scores, real
walking-gate logic — see the script's docstring) so you can see the dashboard
fully populated. Stop with Ctrl+C.

For a demo or deployment that needs to keep showing live-looking data for
hours or days with no real hardware attached, run it under
`tools/run_simulator_loop.ps1` (Windows) or `tools/run_simulator_loop.sh`
(macOS/Linux/WSL) instead — see `setups.md`'s "Keeping data flowing during a
demo" section.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/ingest` | Device upload. Requires the `X-Device-Token` header; 401 otherwise, 422 on a malformed body (validated with zod). |
| `GET /api/summary` | Header tiles, the current assessment, device status. |
| `GET /api/history?days=30` | Daily rollups for the history charts. |
| `GET /api/readings?limit=180` | Recent per-window rows. |
| `GET /api/exercises` | Recommended exercises plus the full library. |
| `GET /api/model` | The model card on its own. |
| `GET /api/healthz` | Liveness plus the database path in use. |

Any response carrying a probability also carries the model card from
`lib/risk.ts`. That coupling is deliberate — see below.

## How the risk number is presented, and why

The model has a **leave-one-subject-out AUC of 0.592** (chance is 0.5) and
classifies *fall history*, not future falls: the LTMM labels are falls
self-reported in the year **before** the recording. The root `README.md` has
the full analysis, including the likely sensor-orientation confound in the
model's strongest features.

So `lib/risk.ts` sets rules the UI cannot quietly drop:

- **Direct measurements lead the page.** Steps, walking time and cadence are
  things the device actually measures; they sit at the top and do not depend
  on the model.
- **Every score ships with its model card.** Accuracy, what it measures, what
  it does not measure, the known confound, and the not-a-medical-device
  statement travel in the same JSON object as the number.
- **A minimum sample before any band is shown.** Under ~2 minutes of walking
  the API returns `insufficient_data` rather than a score. One 10 s window is
  noise.
- **A deliberate dead band.** Between 0.35 and 0.65 the API says
  "inconclusive", because a model at this AUC genuinely cannot separate the
  middle of its own range. The chart shades that band in **neutral gray, not
  amber** — traffic-light colours would assert a confidence the evaluation
  does not support.
- **Exercise recommendations ignore the model entirely.** `lib/exercises.ts`
  keys on measured step count, cadence and walking time. Basing advice on a
  0.59-AUC output would give it weight the evaluation does not support.

If you change the presentation, keep these properties. They are the
difference between a research readout and a health claim the data cannot
back.

## What changed from the previous (FastAPI) version — and one dropped feature

This app replaced an earlier FastAPI + vanilla-JS site with the same
ingest/dashboard behaviour, ported to Next.js route handlers, SQLite via
`better-sqlite3`, and a React/Tailwind dashboard. The database schema,
banding rules and exercise-selection logic are line-for-line ports of the
Python originals (`lib/db.ts`, `lib/risk.ts`, `lib/exercises.ts`).

**One thing did not carry over.** The FastAPI version re-scored every posted
feature vector with the Python XGBoost booster as a drift check against the
flashed firmware — a mismatch meant the device's `model.c` was stale relative
to `models/model.json`. This app has no Python/XGBoost runtime, so that check
does not currently exist here; the device's own score is trusted as-is. If
you want it back, the cheapest fix is a small sidecar service exposing
`POST /score` (features → probability, loading `models/model.json`) that the
ingest route calls — `lib/db.ts`'s file header has a pointer to where that
would plug in.

## Model numbers are a static snapshot, not read live

`lib/model-metrics.json` is a copy of the relevant fields from
`results/metrics.json` and `models/feature_list.json`, taken at the time this
app was built. There is no Python runtime here to read those files live. **If
you retrain the model, re-copy the numbers by hand** (or wire up a small
export step) — otherwise the dashboard will describe a model that no longer
matches `models/model.c`.

## Data model

One row per analysed 10 s window, stored as reported. Nothing is aggregated
on write, so changing how a day is summarised never needs a migration.

Two details worth knowing:

- **Steps.** The device reports a cumulative counter that restarts at zero on
  reboot. `computeStepsDelta` (`lib/db.ts`) treats a counter that went
  backwards as a reboot and counts the new value as fresh steps, rather than
  recording a negative delta.
- **Timestamps.** The device stamps readings from its SNTP-synced clock so
  that anything buffered while the server was unreachable lands at the right
  point in history. Before SNTP syncs it sends `0`, and the server
  substitutes arrival time — trusting the raw value would file the reading in
  1970 and break every date rollup. Which one was used is recorded in
  `ts_source` and shown in the device panel.
- **Walking seconds.** Windows are 10 s but hop every 5 s, so they overlap by
  half. Walking time counts 5 s per walking window to avoid double-counting.

## Files

| Path | What it is |
|---|---|
| `app/api/*/route.ts` | Route handlers — ingest auth/validation, response shapes |
| `lib/db.ts` | SQLite schema and queries (better-sqlite3) |
| `lib/risk.ts` | Banding and the model card — the framing rules above |
| `lib/exercises.ts` | Exercise library and the selection rules |
| `lib/model-metrics.json` | Static copy of the trained model's evaluation numbers |
| `components/Dashboard.tsx` | Client-side orchestrator — SWR polling every 5 s |
| `components/charts/` | Hand-built SVG charts (bar + line), no charting library |
| `app/globals.css` | Design tokens — the validated data-viz palette, light/dark |

The charts are hand-built SVG with no external dependency: every chart plots
one measure against one axis, colours come from a validated palette
(`app/globals.css`), and every chart has a table view as the accessibility
fallback for the one series that sits below 3:1 contrast on the light
surface.

## Requirements

Node.js 18.18+ (Next.js 16). `better-sqlite3` is a native module — if `npm
install` fails to build it, you're most likely missing a C++ build toolchain;
see [node-gyp's platform setup](https://github.com/nodejs/node-gyp#installation).
