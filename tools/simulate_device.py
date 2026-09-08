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

    # point at a deployed site, all-healthy gait
    python tools/simulate_device.py --url https://gait.example.com \
        --token "$GAITSENSE_TOKEN" --backfill-days 21 --live --no-faller

The point is that this is not a mock: the features and probabilities are
computed by the real code, so anything the dashboard shows is something the
device could actually send.

By default ~35 % of days/bouts use a "high-risk" gait profile that is
calibrated at startup to actually score a high P(faller) against
models/model.json -- so the dashboard exercises the "closer to the
past-faller pattern" band too, not just the low end. Tune with
--faller-share, or turn it off with --no-faller.
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

# Gait "profiles" fed to make_window. HEALTHY is the original waveform (a
# little cycle-to-cycle jitter added, which real gait always has). The
# high-risk profile is NOT hand-tuned: calibrate_high_risk() samples
# HIGH_RISK_SPACE and keeps whatever actually scores a high P(faller) against
# the real booster, so "throw in some high falling values" stays true even if
# models/model.json is retrained.
HEALTHY = {
    "v_off": 1.0, "ml_off": -0.16, "ap_off": -0.36,
    "sway": 0.0, "hf": 0.0, "asym": 0.05, "irreg": 0.12, "noise": 0.03,
}

# (lo, hi) ranges the calibrator draws a candidate high-risk profile from.
# Wide static-axis-mean ranges on purpose: those means are the model's
# strongest features (see results/feature_importances_shap.csv). "irreg" and
# "noise" are kept moderate -- past a point they just add window-to-window
# variance, which drags the daily median back into the dead band rather than
# up.
HIGH_RISK_SPACE = {
    "v_off": (0.86, 1.12), "ml_off": (-0.32, 0.04), "ap_off": (-0.58, -0.10),
    "sway": (0.35, 1.15), "hf": (0.15, 0.55), "asym": (0.20, 0.60),
    "irreg": (0.28, 0.52), "noise": (0.035, 0.065),
}
# Used only if calibration somehow produces no scoreable window.
HIGH_RISK_FALLBACK = {
    "v_off": 0.95, "ml_off": -0.05, "ap_off": -0.20,
    "sway": 0.9, "hf": 0.4, "asym": 0.5, "irreg": 0.8, "noise": 0.06,
}


def _smooth(x, k):
    return x if k <= 1 else np.convolve(x, np.ones(k) / k, mode="same")


def load_model():
    import xgboost as xgb

    model = xgb.XGBClassifier()
    model.load_model(str(ROOT / "models" / "model.json"))
    model.set_params(base_score=float(model.get_params()["base_score"]))
    return model


def make_window(rng, *, walking: bool, step_hz: float, vigour: float, profile=None):
    t = np.arange(N) / FS
    p = profile or HEALTHY

    if not walking:
        # Sitting or standing: gravity plus a little sensor noise, around the
        # resting orientation this profile implies. (For HEALTHY this is the
        # original 0.98 / -0.05 / -0.12 g.)
        v = p["v_off"] - 0.02 + rng.normal(0, 0.004, N)
        ml = p["ml_off"] + 0.11 + rng.normal(0, 0.004, N)
        ap = p["ap_off"] + 0.24 + rng.normal(0, 0.004, N)
        return v, ml, ap

    stride_hz = step_hz / 2.0
    noise = p["noise"]

    # Cycle-to-cycle variability: a slow phase random walk (step-timing
    # jitter) and a slow amplitude modulation, both scaled by "irreg".
    phase_jitter = p["irreg"] * np.cumsum(rng.normal(0, 0.02, N))
    amp_mod = 1.0 + p["irreg"] * 0.6 * _smooth(rng.normal(0, 1, N), 45)

    step_ph = 2 * np.pi * step_hz * t + phase_jitter
    stride_ph = 2 * np.pi * stride_hz * t + 0.5 * phase_jitter

    v = (p["v_off"]
         + vigour * amp_mod * np.sin(step_ph)
         + 0.35 * vigour * np.sin(2 * step_ph)
         + p["asym"] * vigour * np.sin(stride_ph + 0.3)          # limp -> vertical skew
         + p["hf"] * vigour * (np.sin(2 * np.pi * 3.3 * step_hz * t)
                               + 0.6 * np.sin(2 * np.pi * 4.1 * step_hz * t))
         + rng.normal(0, noise, N))
    ml = (p["ml_off"]
          + 0.6 * vigour * amp_mod * np.sin(stride_ph + 0.4)
          + 0.15 * vigour * np.sin(2 * stride_ph)
          + p["sway"] * vigour * np.sin(2 * np.pi * (stride_hz * 0.5) * t + 0.2)  # low-freq sway
          + p["asym"] * 0.4 * vigour * np.sin(step_ph)           # breaks ML odd/even symmetry
          + rng.normal(0, noise, N))
    ap = (p["ap_off"]
          + 0.7 * vigour * amp_mod * np.sin(step_ph + 1.1)
          + p["hf"] * 0.7 * vigour * np.sin(2 * np.pi * 3.0 * step_hz * t)
          + rng.normal(0, noise, N))
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


# Cadence / vigour the faller profile is generated with, in both calibration
# and the backfill/live loops -- keep these in sync so the calibrated number
# reflects what actually gets sent.
FALLER_STEP_HZ = (1.25, 1.70)   # slower, shorter steps
FALLER_VIGOUR = (0.15, 0.30)


def _score_profile(rng, model, profile, n=12):
    """Lower-quartile P(faller) over n freshly generated faller-cadence
    windows. Lower-quartile, not median, so a profile is only accepted if the
    *bulk* of its windows score high -- that's what keeps a whole day's
    median inside the 'resembles fallers' band rather than the dead band."""
    probs = []
    for _ in range(n):
        v, ml, apx = make_window(rng, walking=True,
                                 step_hz=rng.uniform(*FALLER_STEP_HZ),
                                 vigour=rng.uniform(*FALLER_VIGOUR), profile=profile)
        a = analyse(v, ml, apx, model)
        if a["scored"] and a["prob_faller"] is not None:
            probs.append(a["prob_faller"])
    if len(probs) < max(3, n // 2):
        return float("nan")
    return float(np.percentile(probs, 25))


def _median_prob(rng, model, profile, step_lo, step_hi, vig_lo, vig_hi, n=10):
    """Plain median P(faller) over n windows -- used for the healthy readout."""
    probs = []
    for _ in range(n):
        v, ml, apx = make_window(rng, walking=True,
                                 step_hz=rng.uniform(step_lo, step_hi),
                                 vigour=rng.uniform(vig_lo, vig_hi), profile=profile)
        a = analyse(v, ml, apx, model)
        if a["scored"] and a["prob_faller"] is not None:
            probs.append(a["prob_faller"])
    return float(np.median(probs)) if probs else float("nan")


# Aim the calibrated profile here, not at the model's ceiling: clear of
# BAND_HIGH (0.65 in web/lib/risk.ts) with margin for window-to-window
# spread, without pinning every window at 0.99.
HIGH_RISK_TARGET_P = 0.82
HIGH_RISK_MIN_P = 0.68


def calibrate_high_risk(rng, model, n_candidates=28, n_windows=10):
    """Search HIGH_RISK_SPACE for the profile whose lower-quartile P(faller)
    against the real booster lands nearest HIGH_RISK_TARGET_P (and above
    HIGH_RISK_MIN_P). Returns (profile, score)."""
    best_profile, best_score, best_gap = None, float("nan"), 1e9
    ceil_profile, ceil_score = None, -1.0
    for _ in range(n_candidates):
        cand = {k: rng.uniform(lo, hi) for k, (lo, hi) in HIGH_RISK_SPACE.items()}
        score = _score_profile(rng, model, cand, n=n_windows)
        if not np.isfinite(score):
            continue
        if score > ceil_score:
            ceil_profile, ceil_score = cand, score
        gap = abs(score - HIGH_RISK_TARGET_P)
        if score >= HIGH_RISK_MIN_P and gap < best_gap:
            best_profile, best_score, best_gap = cand, score, gap
    if best_profile is not None:
        return best_profile, best_score
    if ceil_profile is not None:  # nothing cleared the floor; take the best we saw
        return ceil_profile, ceil_score
    return HIGH_RISK_FALLBACK, float("nan")


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
    ap_.add_argument("--faller-share", type=float, default=0.35,
                     help="fraction of days (backfill) and walking bouts "
                          "(live) that use a calibrated high-P(faller) gait "
                          "profile instead of the healthy one (default 0.35)")
    ap_.add_argument("--no-faller", action="store_true",
                     help="disable the high-risk profile; all synthetic "
                          "walking uses the healthy pattern")
    args = ap_.parse_args()

    rng = np.random.default_rng(args.seed)
    py_rng = random.Random(args.seed)
    model = load_model()
    session = requests.Session()

    high_risk = None
    if not args.no_faller and args.faller_share > 0:
        print("calibrating a high-risk gait profile against models/model.json ...")
        high_risk, hr_p = calibrate_high_risk(np.random.default_rng(args.seed + 1), model)
        healthy_p = _median_prob(np.random.default_rng(args.seed + 2), model,
                                 HEALTHY, 1.4, 2.2, 0.18, 0.42)
        print(f"  healthy profile   -> median P(faller)         ~ {healthy_p:.2f}")
        print(f"  high-risk profile -> lower-quartile P(faller)  ~ {hr_p:.2f}  "
              f"(used on ~{args.faller_share:.0%} of walking; per-window "
              f"P runs higher)")

    steps_total = 0
    now_ms = int(time.time() * 1000)

    if args.backfill_days:
        print(f"backfilling {args.backfill_days} days into {args.url} ...")
        for day in range(args.backfill_days, 0, -1):
            day_start = now_ms - day * 86_400_000
            # Whole-day profile, so each day's median lands cleanly in one
            # band on the risk chart rather than averaging out.
            day_faller = high_risk is not None and py_rng.random() < args.faller_share
            profile = high_risk if day_faller else HEALTHY
            # A plausible day: a few walking bouts of varying length and pace.
            n_bouts = py_rng.randint(2, 5)
            sent = 0
            for _ in range(n_bouts):
                # Offset the bout somewhere in waking hours.
                bout_start = day_start + py_rng.randint(8, 20) * 3_600_000
                n_windows = py_rng.randint(12, 60)      # 1-5 minutes of walking
                if day_faller:
                    step_hz = py_rng.uniform(*FALLER_STEP_HZ)
                    vigour = py_rng.uniform(*FALLER_VIGOUR)
                else:
                    step_hz = py_rng.uniform(1.4, 2.2)
                    vigour = py_rng.uniform(0.18, 0.42)

                for w in range(n_windows):
                    v, ml, apx = make_window(rng, walking=True, step_hz=step_hz,
                                             vigour=vigour, profile=profile)
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
            tag = "  high-risk" if day_faller else ""
            print(f"  day -{day:>2}: {sent} windows, cumulative steps {steps_total:,}{tag}")

    if not args.live:
        print("done (use --live to keep streaming)")
        return

    print("streaming live windows every 5 s -- Ctrl+C to stop")
    step_hz = 1.8
    walking = True
    bout_faller = False
    remaining = py_rng.randint(10, 40)

    while True:
        if remaining <= 0:
            # Alternate between walking bouts and rest, so the dashboard shows
            # the not-scoreable path as well as the scored one.
            walking = not walking
            remaining = py_rng.randint(10, 40) if walking else py_rng.randint(4, 12)
            if walking:
                bout_faller = high_risk is not None and py_rng.random() < args.faller_share
                step_hz = (py_rng.uniform(*FALLER_STEP_HZ) if bout_faller
                           else py_rng.uniform(1.4, 2.2))
        remaining -= 1

        profile = high_risk if (walking and bout_faller) else HEALTHY
        vigour = (py_rng.uniform(*FALLER_VIGOUR) if (walking and bout_faller)
                  else py_rng.uniform(0.2, 0.4))
        v, ml, apx = make_window(rng, walking=walking, step_hz=step_hz,
                                 vigour=vigour, profile=profile)
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
        tag = "R" if (walking and bout_faller) else "·"
        print(f"  [{tag}] walking={a['walking']!s:<5} steps={a['steps_window']:>3} "
              f"cadence={a['cadence_spm'] or 0:>5.0f} P={prob:<6} "
              f"total={steps_total:,} {'ok' if ok else 'FAILED'}")
        time.sleep(5)


if __name__ == "__main__":
    main()
