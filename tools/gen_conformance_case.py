"""Generate the C/Python conformance fixture for the firmware feature port.

Synthesises a spread of 10 s triaxial acceleration windows (normal gait, slow
shuffling gait, fast gait, standing still, pure noise), runs each one through
the *real* training-time extractor in src/features.py, and writes:

    firmware/test/cases.txt     the raw windows, for the C test to read
    firmware/test/expected.json the 10 deployed features per case

The point is that the reference values come from the same code that produced
the training set -- not from a second hand-written implementation that could be
wrong in the same way the C is.

Run:  .venv/Scripts/python.exe tools/gen_conformance_case.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import features as ref  # noqa: E402  (needs the sys.path tweak above)

FS = 100.0
N = 1000  # 10 s window
OUT_DIR = ROOT / "firmware" / "test"

DEPLOYED = json.loads((ROOT / "models" / "feature_list.json").read_text())


def gait_window(rng, *, step_hz, v_amp, ml_amp, ap_amp, noise, asym=0.0):
    """A crude but structurally realistic lower-back acceleration window.

    Vertical carries the step-rate fundamental plus a second harmonic;
    mediolateral carries the *stride* rate (half the step rate), which is what
    makes the ML harmonic ratio meaningful. `asym` detunes alternate steps to
    imitate an uneven gait.
    """
    t = np.arange(N) / FS
    stride_hz = step_hz / 2.0

    phase_jitter = asym * np.sin(2 * np.pi * stride_hz * t)

    v = (
        1.0
        + v_amp * np.sin(2 * np.pi * step_hz * t + phase_jitter)
        + 0.35 * v_amp * np.sin(2 * np.pi * 2 * step_hz * t)
        + 0.10 * v_amp * np.sin(2 * np.pi * 3 * step_hz * t + 0.7)
    )
    ml = (
        -0.16
        + ml_amp * np.sin(2 * np.pi * stride_hz * t + 0.4)
        + 0.25 * ml_amp * np.sin(2 * np.pi * 2 * stride_hz * t)
    )
    ap = (
        -0.36
        + ap_amp * np.sin(2 * np.pi * step_hz * t + 1.1)
        + 0.30 * ap_amp * np.sin(2 * np.pi * 2 * step_hz * t + 0.2)
    )

    v += rng.normal(0, noise, N)
    ml += rng.normal(0, noise, N)
    ap += rng.normal(0, noise, N)
    return v, ml, ap


def build_cases():
    rng = np.random.default_rng(42)
    cases = []

    cases.append(("normal_gait", *gait_window(
        rng, step_hz=1.8, v_amp=0.30, ml_amp=0.18, ap_amp=0.22, noise=0.02)))
    cases.append(("brisk_gait", *gait_window(
        rng, step_hz=2.3, v_amp=0.45, ml_amp=0.24, ap_amp=0.30, noise=0.03)))
    cases.append(("slow_shuffle", *gait_window(
        rng, step_hz=1.1, v_amp=0.09, ml_amp=0.06, ap_amp=0.07, noise=0.02)))
    cases.append(("asymmetric_gait", *gait_window(
        rng, step_hz=1.7, v_amp=0.28, ml_amp=0.20, ap_amp=0.21, noise=0.025, asym=0.55)))
    cases.append(("noisy_gait", *gait_window(
        rng, step_hz=2.0, v_amp=0.33, ml_amp=0.19, ap_amp=0.25, noise=0.09)))

    # Edge cases: these should drive the temporal features to NaN, which is
    # exactly the situation the firmware must refuse to score.
    still_v = 0.98 + rng.normal(0, 0.002, N)
    still_ml = -0.05 + rng.normal(0, 0.002, N)
    still_ap = -0.12 + rng.normal(0, 0.002, N)
    cases.append(("standing_still", still_v, still_ml, still_ap))

    cases.append(("pure_noise",
                  rng.normal(0, 0.5, N),
                  rng.normal(0, 0.5, N),
                  rng.normal(0, 0.5, N)))

    flat = np.full(N, 1.0)
    cases.append(("flat_dc", flat.copy(), np.full(N, -0.1), np.full(N, -0.3)))

    return cases


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cases = build_cases()

    lines = [f"{len(cases)}"]
    expected = []

    for name, v, ml, ap in cases:
        # The firmware buffers samples as float32 (12 KB per window instead of
        # 24 KB; the MPU6050 only gives 16 bits anyway). Quantise the reference
        # input to float32 too, so both sides see bit-identical samples and any
        # residual difference is genuinely algorithmic rather than a rounding
        # artefact of the fixture.
        v, ml, ap = (a.astype(np.float32).astype(np.float64) for a in (v, ml, ap))

        feats = ref.extract_window_features(v, ml, ap, FS, ref.WINDOW_SEC)
        vec = [float(feats[k]) for k in DEPLOYED]

        peaks = ref.detect_steps(v, FS)
        expected.append({
            "name": name,
            "features": {k: (None if not np.isfinite(x) else x)
                         for k, x in zip(DEPLOYED, vec)},
            "n_steps_window": int(len(peaks)),
            "n_steps_fresh": int(np.sum(peaks >= 500)),
            "all_finite": bool(np.all(np.isfinite(vec))),
        })

        lines.append(name)
        # 17 significant digits round-trips an IEEE-754 double exactly, so the
        # C side sees the identical bits the Python reference saw.
        for arr in (v, ml, ap):
            lines.append(" ".join(f"{x:.17g}" for x in arr))

    (OUT_DIR / "cases.txt").write_text("\n".join(lines) + "\n")
    (OUT_DIR / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")

    print(f"wrote {OUT_DIR / 'cases.txt'} ({len(cases)} cases)")
    print(f"wrote {OUT_DIR / 'expected.json'}")
    for e in expected:
        finite = "all finite" if e["all_finite"] else "has NaN -> not scoreable"
        print(f"  {e['name']:<18} steps={e['n_steps_window']:>3}  {finite}")


if __name__ == "__main__":
    main()
