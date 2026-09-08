"""Stand-in for the ESP32 node, for testing the website without hardware.

Generates synthetic lower-back acceleration, runs it through the same
extractor the firmware ports (src/features.py) and the same booster the
firmware compiles (models/model.json), and POSTs to /api/ingest with the
identical payload shape net.c produces -- including the walking gate, so the
"not scoreable" path gets exercised too.

    # 21 days of history, then stream live windows every 5 s
    # (defaults to the Next.js dev server at localhost:3000; pass --url to
    # point elsewhere)
    python tools/simulate_device.py --backfill-days 21 --live

    # history only
    python tools/simulate_device.py --backfill-days 30

The point is that this is not a mock: the features and probabilities are
computed by the real code, so anything the dashboard shows is something the
device could actually send.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import features as ref  # noqa: E402

FS = 100.0
N = 1000
DEPLOYED = json.loads((ROOT / "models" / "feature_list.json").read_text())

# Must mirror the constants in firmware/main/main.c, or the simulator would
# report a different walking/scored mix than the real node.
WALK_MIN_MAGNITUDE_STD = 0.06
WALK_MIN_STEPS = 8
WALK_MIN_CADENCE = 40.0
WALK_MAX_CADENCE = 200.0


def load_model():
    import xgboost as xgb

    model = xgb.XGBClassifier()
    model.load_model(str(ROOT / "models" / "model.json"))
    model.set_params(base_score=float(model.get_params()["base_score"]))
    return model


def make_window(rng, *, walking: bool, step_hz: float, vigour: float):
    t = np.arange(N) / FS

    if not walking:
        # Sitting or standing: gravity plus a little sensor noise.
        v = 0.98 + rng.normal(0, 0.004, N)
        ml = -0.05 + rng.normal(0, 0.004, N)
        ap = -0.12 + rng.normal(0, 0.004, N)
        return v, ml, ap

    stride_hz = step_hz / 2.0
    v = (1.0
         + vigour * np.sin(2 * np.pi * step_hz * t)
         + 0.35 * vigour * np.sin(2 * np.pi * 2 * step_hz * t)
         + rng.normal(0, 0.03, N))
    ml = (-0.16
          + 0.6 * vigour * np.sin(2 * np.pi * stride_hz * t + 0.4)
          + 0.15 * vigour * np.sin(2 * np.pi * 2 * stride_hz * t)
          + rng.normal(0, 0.03, N))
    ap = (-0.36
          + 0.7 * vigour * np.sin(2 * np.pi * step_hz * t + 1.1)
          + rng.normal(0, 0.03, N))
    return v, ml, ap


def analyse(v, ml, ap, model):
    """The firmware's per-window pipeline, in Python."""
    # float32 quantisation, as the device buffers samples.
    v, ml, ap = (a.astype(np.float32).astype(np.float64) for a in (v, ml, ap))

    feats = ref.extract_window_features(v, ml, ap, FS, ref.WINDOW_SEC)
    vec = [float(feats[k]) for k in DEPLOYED]

    peaks = ref.detect_steps(v, FS)
    n_steps = int(len(peaks))
    n_fresh = int(np.sum(peaks >= 500))
    cadence = feats.get("cadence")

    mag = np.sqrt(v ** 2 + ml ** 2 + ap ** 2)
    mag_std = float(np.std(mag))

    walking = (mag_std >= WALK_MIN_MAGNITUDE_STD
               and n_steps >= WALK_MIN_STEPS
               and cadence is not None and np.isfinite(cadence)
               and WALK_MIN_CADENCE <= cadence <= WALK_MAX_CADENCE)

    all_finite = bool(np.all(np.isfinite(vec)))
    scored = bool(walking and all_finite)

    prob = None
    if scored:
        prob = float(model.predict_proba(np.array([vec], dtype=float))[0, 1])

    def j(x):
        return None if x is None or not np.isfinite(x) else float(x)

    return {
        "walking": walking,
        "scored": scored,
        "prob_faller": prob,
        "steps_window": n_steps,
        "steps_fresh": n_fresh if walking else 0,
        "cadence_spm": j(cadence),
        "stride_time_mean": j(feats.get("stride_time_mean")),
        "magnitude_std": mag_std,
        "features": [j(x) for x in vec],
    }


def post(session, url, token, payload, verbose=False):
    try:
        r = session.post(f"{url}/api/ingest", json=payload,
                         headers={"X-Device-Token": token}, timeout=10)
        if r.status_code != 200:
            print(f"  ingest failed: HTTP {r.status_code} {r.text[:200]}")
            return False
        if verbose:
            print(f"  -> {r.json()}")
        return True
    except requests.RequestException as e:
        print(f"  ingest error: {e}")
        return False


def main():
    ap_ = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap_.add_argument("--url", default="http://127.0.0.1:3000",
                     help="base URL of the website (default: the Next.js dev server)")
    ap_.add_argument("--token", default="change-me")
    ap_.add_argument("--device-id", default="gaitsense-sim01")
    ap_.add_argument("--backfill-days", type=int, default=0,
                     help="days of history to generate before streaming")
    ap_.add_argument("--live", action="store_true",
                     help="keep streaming one window every 5 s")
    ap_.add_argument("--seed", type=int, default=7)
    args = ap_.parse_args()

    rng = np.random.default_rng(args.seed)
    py_rng = random.Random(args.seed)
    model = load_model()
    session = requests.Session()

    steps_total = 0
    now_ms = int(time.time() * 1000)

    if args.backfill_days:
        print(f"backfilling {args.backfill_days} days into {args.url} ...")
        for day in range(args.backfill_days, 0, -1):
            day_start = now_ms - day * 86_400_000
            # A plausible day: a few walking bouts of varying length and pace.
            n_bouts = py_rng.randint(2, 5)
            sent = 0
            for _ in range(n_bouts):
                # Offset the bout somewhere in waking hours.
                bout_start = day_start + py_rng.randint(8, 20) * 3_600_000
                n_windows = py_rng.randint(12, 60)      # 1-5 minutes of walking
                step_hz = py_rng.uniform(1.4, 2.2)
                vigour = py_rng.uniform(0.18, 0.42)

                for w in range(n_windows):
                    v, ml, apx = make_window(rng, walking=True,
                                             step_hz=step_hz, vigour=vigour)
                    a = analyse(v, ml, apx, model)
                    steps_total += a["steps_fresh"]
                    payload = {
                        "device_id": args.device_id,
                        "fw": "1.0.0-sim",
                        "unix_ms": bout_start + w * 5000,
                        "window_sec": 10.0,
                        "steps_total": steps_total,
                        "steps_window": a["steps_window"],
                        "walking": a["walking"],
                        "scored": a["scored"],
                        "prob_faller": a["prob_faller"],
                        "cadence_spm": a["cadence_spm"],
                        "stride_time_mean": a["stride_time_mean"],
                        "magnitude_std": a["magnitude_std"],
                        "rssi": py_rng.randint(-72, -45),
                        "features": a["features"],
                    }
                    if post(session, args.url, args.token, payload):
                        sent += 1
            print(f"  day -{day:>2}: {sent} windows, cumulative steps {steps_total:,}")

    if not args.live:
        print("done (use --live to keep streaming)")
        return

    print("streaming live windows every 5 s -- Ctrl+C to stop")
    step_hz = 1.8
    walking = True
    remaining = py_rng.randint(10, 40)

    while True:
        if remaining <= 0:
            # Alternate between walking bouts and rest, so the dashboard shows
            # the not-scoreable path as well as the scored one.
            walking = not walking
            remaining = py_rng.randint(10, 40) if walking else py_rng.randint(4, 12)
            step_hz = py_rng.uniform(1.4, 2.2)
        remaining -= 1

        v, ml, apx = make_window(rng, walking=walking, step_hz=step_hz,
                                 vigour=py_rng.uniform(0.2, 0.4))
        a = analyse(v, ml, apx, model)
        steps_total += a["steps_fresh"]

        payload = {
            "device_id": args.device_id,
            "fw": "1.0.0-sim",
            "unix_ms": int(time.time() * 1000),
            "window_sec": 10.0,
            "steps_total": steps_total,
            "steps_window": a["steps_window"],
            "walking": a["walking"],
            "scored": a["scored"],
            "prob_faller": a["prob_faller"],
            "cadence_spm": a["cadence_spm"],
            "stride_time_mean": a["stride_time_mean"],
            "magnitude_std": a["magnitude_std"],
            "rssi": py_rng.randint(-72, -45),
            "features": a["features"],
        }
        ok = post(session, args.url, args.token, payload)
        prob = "—" if a["prob_faller"] is None else f"{a['prob_faller']:.3f}"
        print(f"  walking={a['walking']!s:<5} steps={a['steps_window']:>3} "
              f"cadence={a['cadence_spm'] or 0:>5.0f} P={prob:<6} "
              f"total={steps_total:,} {'ok' if ok else 'FAILED'}")
        time.sleep(5)


if __name__ == "__main__":
    main()
