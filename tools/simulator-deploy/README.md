# Deploying the device simulator

`tools/simulate_device.py` pretends to be the ESP32 node: it generates
synthetic lower-back acceleration, runs it through the **real**
`src/features.py` extractor and the **real** `models/model.json` booster, and
POSTs the result to `POST /api/ingest` in the exact shape the firmware sends.
Nothing about the numbers on the dashboard is faked — only the "person
walking" input is.

This folder packages it so it can run **detached from the repo**, as an
always-on worker next to a deployed website, so a demo keeps showing live and
historical data with no hardware attached.

By default ~35 % of days (history) and walking bouts (live) use a *high-risk*
gait profile that is **calibrated at start-up** against the actual model to
score a high `P(faller)` — so the dashboard's "closer to the past-faller
pattern" band gets exercised too, not just the low end. Control it with
`FALLER_SHARE` (0 disables it; so does `EXTRA_ARGS=--no-faller`).

---

## What you need first: a website that can persist readings

`/api/ingest` writes to **SQLite via `better-sqlite3`** (`web/lib/db.ts`).
That needs a **real, persistent filesystem**. It will *not* work on Vercel,
Netlify, Cloudflare Pages or any serverless target — there each request can
get a fresh, empty disk, so `/api/ingest` and `/api/summary` don't see the
same database.

Deploy the website somewhere with a persistent disk:

| Host | How |
|---|---|
| **Render** | Web Service (Docker or Node), attach a Disk mounted where `DATABASE_PATH` points |
| **Fly.io** | `fly launch` in `web/`, `fly volumes create`, set `DATABASE_PATH=/data/gaitsense.db` |
| **Railway** | Node service + a Volume |
| **A VPS** | `npm run build && npm start` behind nginx/Caddy, or the same Docker image |

Set on the website:

```
GAITSENSE_TOKEN=<a shared secret>
DATABASE_PATH=/data/gaitsense.db        # a path on the persistent disk
```

The simulator sends that same token as `X-Device-Token`. Ingest is a
server-to-server POST, so there is no CORS or browser origin to configure.

---

## Deploy the simulator

All four options build the **same image** from
`tools/simulator-deploy/Dockerfile`. Build context is the **repo root** (the
image needs `src/`, `models/model.json`, `models/feature_list.json`,
`tools/simulate_device.py`).

### Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `GAITSENSE_URL` | — **(required)** | Base URL of the deployed site, e.g. `https://gait.example.com` |
| `GAITSENSE_TOKEN` | `change-me` | Must equal the site's `GAITSENSE_TOKEN` |
| `GAITSENSE_DEVICE_ID` | `gaitsense-sim01` | Name shown on the dashboard |
| `BACKFILL_DAYS` | `21` | Days of history to seed on first run (`0` = none) |
| `FALLER_SHARE` | `0.35` | Fraction of days/bouts using the calibrated high-risk profile |
| `SEED` | `7` | RNG seed |
| `STATE_DIR` | `/tmp` | Where the "already seeded" marker goes — point at a mounted volume so a restart doesn't replay 21 days of history |
| `EXTRA_ARGS` | — | Appended verbatim, e.g. `--no-faller` |

### Option A — Render (blueprint)

`render.yaml` here defines a `worker` service with a 1 GB disk at `/data`.
In Render: **New → Blueprint**, pick this repo, then set `GAITSENSE_URL` and
`GAITSENSE_TOKEN` when prompted.

### Option B — Fly.io

```bash
cd <repo root>
fly launch --no-deploy --copy-config --name gaitsense-simulator   # uses tools/simulator-deploy/fly.toml
fly secrets set GAITSENSE_URL=https://your-site.example.com GAITSENSE_TOKEN=your-secret
fly volumes create sim_state --size 1
fly deploy
```

Keep it to **one machine** — two would double-post as the same device id.

### Option C — Any box with Docker (compose)

```bash
cd tools/simulator-deploy
GAITSENSE_URL=https://your-site.example.com GAITSENSE_TOKEN=your-secret \
  docker compose up -d --build
docker compose logs -f
```

### Option D — Plain `docker run`

```bash
# from the repo root
docker build -f tools/simulator-deploy/Dockerfile -t gaitsense-sim .
docker run -d --name gaitsense-sim --restart unless-stopped \
  -e GAITSENSE_URL=https://your-site.example.com \
  -e GAITSENSE_TOKEN=your-secret \
  -v gaitsense-sim-state:/data -e STATE_DIR=/data \
  gaitsense-sim
```

---

## What the container does on start

1. If `BACKFILL_DAYS > 0` **and** `$STATE_DIR/.gaitsense-backfilled` is
   absent: run one `--backfill-days N` pass, then write the marker. With a
   mounted volume this happens once; on ephemeral disk it repeats every
   restart (harmless, but it stacks extra history each time).
2. `exec` the simulator with `--live` — one window every 5 s, forever.

Start-up cost: the first calibration does ~280 short model evaluations
(~15–30 s) plus a cold scientific-Python import. It prints the resulting
healthy vs high-risk median `P(faller)` so you can see the split it will
produce.

---

## How the website shows it

`web/lib/db.ts` flags any device whose firmware string contains `sim`
(the simulator sends `fw: "1.0.0-sim"`) as `is_sim`. When every reporting
device is simulated, the dashboard header reads **"Demo data — a simulated
device, not real hardware"** and the Devices panel tags the row `simulated`.
Nothing else about the dashboard changes — the features, scores and banding
are computed the same way they would be for a real node.

To hand the page back to real hardware later, just power up an ESP32 with a
real firmware build; its non-`sim` firmware string clears the banner. Old
simulated rows stay in the database — delete them directly if you want a
clean history (`DELETE FROM readings WHERE device_id = 'gaitsense-sim01'`).

---

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Slim Python image; installs `requirements-sim.txt`, copies the simulate → features → score path |
| `requirements-sim.txt` | Minimal pinned deps (no `antropy` — its one feature isn't in the deployed 10) |
| `entrypoint.sh` | Env → CLI flags; first-run backfill guarded by a marker file; then `--live` |
| `render.yaml` | Render blueprint (worker + disk) |
| `fly.toml` | Fly.io app (no ports, one machine, a volume) |
| `docker-compose.yml` | Same image for a VPS / spare box |
