"""GaitSense website: device ingest, storage, and the dashboard API.

Run:  uvicorn web.server.app:app --host 0.0.0.0 --port 8000
      (from the repo root, with the project venv active)

Bind to 0.0.0.0 rather than 127.0.0.1 -- the ESP32 has to reach this over the
LAN, and localhost on the device means the device.
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, exercises, risk
from .scoring import ServerScorer

ROOT = Path(__file__).resolve().parent.parent.parent
STATIC_DIR = ROOT / "web" / "static"

# Must match GAITSENSE_DEVICE_TOKEN in the firmware's menuconfig.
DEVICE_TOKEN = os.environ.get("GAITSENSE_TOKEN", "change-me")

_conn = None
_scorer: ServerScorer | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _conn, _scorer
    _conn = db.connect()
    db.init(_conn)
    _scorer = ServerScorer()
    yield
    if _conn is not None:
        _conn.close()


app = FastAPI(
    title="GaitSense",
    description="Gait monitoring dashboard for the ESP32 GaitSense node.",
    lifespan=lifespan,
)

# The dashboard is served from this same origin; CORS is here only so the API
# stays usable from a separate front-end during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

class Reading(BaseModel):
    """One analysed 10 s window as posted by the firmware.

    Non-finite doubles arrive as JSON null (see append_num in net.c), so every
    measurement field is optional.
    """
    device_id: str = Field(min_length=1, max_length=64)
    fw: str | None = None
    unix_ms: int = 0
    window_sec: float | None = None

    steps_total: int | None = None
    steps_window: int | None = None

    walking: bool = False
    scored: bool = False
    prob_faller: float | None = None

    cadence_spm: float | None = None
    stride_time_mean: float | None = None
    magnitude_std: float | None = None
    rssi: int | None = None

    features: list[float | None] | None = None


def require_device_token(x_device_token: str = Header(default="")) -> None:
    if x_device_token != DEVICE_TOKEN:
        raise HTTPException(status_code=401, detail="bad device token")


@app.post("/api/ingest", dependencies=[Depends(require_device_token)])
def ingest(reading: Reading) -> dict[str, Any]:
    payload = reading.model_dump()

    # Recompute the probability from the posted features with the Python
    # booster. This is a cross-check, not the source of truth: the device's own
    # score is what gets displayed. A drift here means the flashed model.c and
    # models/model.json have diverged -- usually a stale flash after a retrain.
    server_prob = None
    if reading.scored and reading.features and _scorer is not None:
        server_prob = _scorer.score(reading.features)

    row_id = db.insert_reading(_conn, payload, server_prob=server_prob)

    resp: dict[str, Any] = {"ok": True, "id": row_id}
    if server_prob is not None and reading.prob_faller is not None:
        drift = abs(server_prob - reading.prob_faller)
        resp["server_prob"] = server_prob
        resp["drift"] = drift
        if drift > 1e-4:
            resp["warning"] = (
                "device and server probabilities disagree; the flashed model "
                "may be out of date relative to models/model.json"
            )
    return resp


# ---------------------------------------------------------------------------
# Dashboard API
# ---------------------------------------------------------------------------

@app.get("/api/summary")
def summary(device_id: str | None = None,
            hours: int = Query(default=24, ge=1, le=24 * 30)) -> dict[str, Any]:
    today = db.window_summary(_conn, hours=hours, device_id=device_id)
    history = db.daily_history(_conn, days=30, device_id=device_id)

    past = [d["steps"] or 0 for d in history[:-1]] or [d["steps"] or 0 for d in history]
    avg_daily_steps = (sum(past) / len(past)) if past else None

    return {
        "window_hours": hours,
        "steps": today["steps"],
        "walking_sec": today["walking_sec"],
        "cadence_spm": today["cadence_spm"],
        "stride_time_mean": today["stride_time_mean"],
        "windows": today["windows"],
        "scored_windows": today["scored_windows"],
        "avg_daily_steps": avg_daily_steps,
        "assessment": risk.assessment(today["prob_median"], today["prob_n"]),
        "model_drift": today["max_prob_drift"],
        "devices": db.devices(_conn),
    }


@app.get("/api/history")
def history(device_id: str | None = None,
            days: int = Query(default=30, ge=1, le=365)) -> dict[str, Any]:
    rows = db.daily_history(_conn, days=days, device_id=device_id)
    return {
        "days": rows,
        # Bands travel with the series so the chart cannot draw its own,
        # differently-framed thresholds.
        "bands": {"low": risk.BAND_LOW, "high": risk.BAND_HIGH},
        "model_card": risk.model_card(),
    }


@app.get("/api/readings")
def readings(device_id: str | None = None,
             limit: int = Query(default=180, ge=1, le=2000)) -> dict[str, Any]:
    return {"readings": db.recent_readings(_conn, limit=limit, device_id=device_id)}


@app.get("/api/exercises")
def exercise_plan(device_id: str | None = None) -> dict[str, Any]:
    today = db.window_summary(_conn, hours=24, device_id=device_id)
    hist = db.daily_history(_conn, days=30, device_id=device_id)
    past = [d["steps"] or 0 for d in hist[:-1]] or [d["steps"] or 0 for d in hist]

    plan = exercises.recommend(
        steps_today=today["steps"],
        avg_daily_steps=(sum(past) / len(past)) if past else None,
        cadence_spm=today["cadence_spm"],
        walking_sec=today["walking_sec"],
    )
    return {**plan, "library": exercises.LIBRARY}


@app.get("/api/devices")
def devices() -> dict[str, Any]:
    return {"devices": db.devices(_conn)}


@app.get("/api/model")
def model_info() -> dict[str, Any]:
    return {
        "model_card": risk.model_card(),
        "features": json.loads((ROOT / "models" / "feature_list.json").read_text()),
        "server_scoring_available": _scorer is not None and _scorer.available,
    }


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "db": str(db.DB_PATH)}


# ---------------------------------------------------------------------------
# Static dashboard -- mounted last so it cannot shadow the API routes.
# ---------------------------------------------------------------------------

@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
