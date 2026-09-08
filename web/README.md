# GaitSense website

A single FastAPI process that receives readings from the ESP32 node, stores
them in SQLite, and serves the dashboard: step counts, walking time, cadence,
30 days of history, the model's gait-pattern indicator, and an exercise plan.

```
ESP32 ──POST /api/ingest──▶ FastAPI ──▶ SQLite (gaitsense.db)
                               │
                               └──▶ dashboard at /  (static HTML/CSS/JS)
```

## Run it

```bash
# from the repo root, with the project venv active
uv pip install -r web/requirements-web.txt

# the token must match GAITSENSE_DEVICE_TOKEN in the firmware's menuconfig
export GAITSENSE_TOKEN=some-shared-secret        # PowerShell: $env:GAITSENSE_TOKEN="..."
uvicorn web.server.app:app --host 0.0.0.0 --port 8000
```

Then open <http://localhost:8000>.

Bind to `0.0.0.0`, not `127.0.0.1` — the ESP32 has to reach this over the LAN.
Point the firmware's `GAITSENSE_SERVER_URL` at this machine's LAN IP
(`http://192.168.1.x:8000`), and allow the port through the host firewall.

The database defaults to `web/gaitsense.db`; override with `GAITSENSE_DB`.

## Trying it without hardware

`tools/simulate_device.py` stands in for the node. It is not a mock: it
generates synthetic acceleration, runs it through the same extractor the
firmware ports (`src/features.py`) and the same booster the firmware compiles
(`models/model.json`), applies the same walking gate, and posts the identical
payload shape.

```bash
# 21 days of history, then stream a window every 5 s
python tools/simulate_device.py --backfill-days 21 --live

# history only
python tools/simulate_device.py --backfill-days 30
```

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/ingest` | Device upload. Requires the `X-Device-Token` header; 401 otherwise. |
| `GET /api/summary` | Header tiles, the current assessment, device status. |
| `GET /api/history?days=30` | Daily rollups for the history charts. |
| `GET /api/readings?limit=180` | Recent per-window rows. |
| `GET /api/exercises` | Recommended exercises plus the full library. |
| `GET /api/model` | The model card on its own. |
| `GET /healthz` | Liveness plus the database path in use. |

Any response carrying a probability also carries the model card from
`risk.py`. That coupling is deliberate — see below.

## How the risk number is presented, and why

The model has a **leave-one-subject-out AUC of 0.592** (chance is 0.5) and
classifies *fall history*, not future falls: the LTMM labels are falls
self-reported in the year **before** the recording. The root `README.md` has
the full analysis, including the likely sensor-orientation confound in the
model's strongest features.

So `risk.py` sets rules the front-end cannot quietly drop:

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
- **Exercise recommendations ignore the model entirely.** They key on measured
  step count, cadence and walking time. Basing advice on a 0.59-AUC output
  would give it weight the evaluation does not support.

If you change the presentation, keep these properties. They are the difference
between a research readout and a health claim the data cannot back.

## Model drift detection

Inference runs on the device. On ingest the server *also* re-scores the posted
feature vector with the Python booster and stores both. If they disagree by
more than 1e-4, the ingest response carries a warning and the dashboard shows
a "Model mismatch" banner — the usual cause being firmware flashed from an
older `model.c` than the current `models/model.json`.

The check degrades gracefully: if xgboost cannot be imported, it switches off
and device scores are still stored and displayed.

## Data model

One row per analysed 10 s window, stored as reported. Nothing is aggregated on
write, so changing how a day is summarised never needs a migration.

Two details worth knowing:

- **Steps.** The device reports a cumulative counter that restarts at zero on
  reboot. `compute_steps_delta` treats a counter that went backwards as a
  reboot and counts the new value as fresh steps, rather than recording a
  negative delta.
- **Timestamps.** The device stamps readings from its SNTP-synced clock so
  that anything buffered while the server was unreachable lands at the right
  point in history. Before SNTP syncs it sends `0`, and the server substitutes
  arrival time — trusting the raw value would file the reading in 1970 and
  break every date rollup. Which one was used is recorded in `ts_source` and
  shown in the device panel.
- **Walking seconds.** Windows are 10 s but hop every 5 s, so they overlap by
  half. Walking time counts 5 s per walking window to avoid double-counting.

## Files

| File | What it is |
|---|---|
| `server/app.py` | FastAPI routes, ingest auth, response shapes |
| `server/db.py` | Schema and queries |
| `server/risk.py` | Banding and the model card — the framing rules above |
| `server/exercises.py` | Exercise library and the selection rules |
| `server/scoring.py` | Server-side re-scoring for drift detection |
| `static/index.html`, `app.js`, `styles.css` | The dashboard |

The charts are hand-built SVG with no external dependency, because the
dashboard is expected to run on a LAN that may have no internet route — a
CDN-loaded charting library would leave the page blank exactly when it is
needed. Colours come from a validated palette; each chart plots one measure
against one axis, and every chart has a table view.
