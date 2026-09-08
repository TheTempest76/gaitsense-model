"""Diff the firmware's C feature extractor against the Python reference.

Reads firmware/test/expected.json (produced from src/features.py by
tools/gen_conformance_case.py) and the JSON the C harness prints on stdout,
and fails loudly on any mismatch -- including NaN-vs-number disagreements,
which matter more than small numeric drift: a feature that is NaN in Python
but finite in C would be silently scored on-device against a model that never
saw that value.

Run:  <C harness> firmware/test/cases.txt | .venv/Scripts/python.exe tools/check_conformance.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = ROOT / "firmware" / "test" / "expected.json"

# Relative tolerance. The C uses a direct partial DFT where SciPy uses pocketfft
# and sums in a different order, so exact bit equality is not achievable; 1e-9
# relative is far tighter than any difference that could move a tree split.
RTOL = 1e-9
ATOL = 1e-12

# The C model is m2cgen-generated from the same booster, so it should agree far
# more tightly than this; 1e-6 is the tolerance the repo already asserts for the
# C export in models/test_harness.c.
PROB_ATOL = 1e-6

FEATURES = json.loads((ROOT / "models" / "feature_list.json").read_text())


def close(a: float, b: float) -> bool:
    return abs(a - b) <= max(ATOL, RTOL * max(abs(a), abs(b)))


def load_model() -> xgb.XGBClassifier:
    model = xgb.XGBClassifier()
    model.load_model(str(ROOT / "models" / "model.json"))
    # XGBoost >= 2.0 round-trips base_score as the string "5E-1"; the same
    # coercion src/export.py applies before handing the booster to m2cgen.
    model.set_params(base_score=float(model.get_params()["base_score"]))
    return model


def main() -> int:
    expected = json.loads(EXPECTED.read_text())
    actual = json.loads(sys.stdin.read())

    if len(expected) != len(actual):
        print(f"FAIL: {len(expected)} expected cases, {len(actual)} from C")
        return 1

    model = load_model()

    failures = 0
    for exp, act in zip(expected, actual):
        if exp["name"] != act["name"]:
            print(f"FAIL: case order mismatch {exp['name']} != {act['name']}")
            failures += 1
            continue

        worst = 0.0
        problems = []

        for i, name in enumerate(FEATURES):
            e = exp["features"][name]
            a = act["features"][i]

            if e is None and a is None:
                continue
            if (e is None) != (a is None):
                problems.append(f"{name}: python={e!r} c={a!r} (NaN disagreement)")
                continue
            if not close(float(e), float(a)):
                problems.append(f"{name}: python={e!r} c={a!r}")
            else:
                denom = max(abs(e), abs(a), 1e-300)
                worst = max(worst, abs(e - a) / denom)

        if exp["n_steps_window"] != act["n_steps_window"]:
            problems.append(f"n_steps_window: python={exp['n_steps_window']} c={act['n_steps_window']}")
        if exp["n_steps_fresh"] != act["n_steps_fresh"]:
            problems.append(f"n_steps_fresh: python={exp['n_steps_fresh']} c={act['n_steps_fresh']}")
        if exp["all_finite"] != act["features_valid"]:
            problems.append(f"features_valid: python={exp['all_finite']} c={act['features_valid']}")

        # End-to-end: the on-device probability must match what the Python
        # booster produces for the same window.
        prob_note = "not scoreable"
        if act["features_valid"]:
            x = np.array([[exp["features"][k] for k in FEATURES]], dtype=float)
            py_prob = float(model.predict_proba(x)[0, 1])
            c_prob = act["prob_faller"]
            if c_prob is None:
                problems.append(f"prob_faller: python={py_prob!r} c=null")
            elif abs(py_prob - c_prob) > PROB_ATOL:
                problems.append(f"prob_faller: python={py_prob!r} c={c_prob!r}")
            else:
                prob_note = f"P(faller)={c_prob:.6f} (dP={abs(py_prob - c_prob):.2e})"
        elif act["prob_faller"] is not None:
            problems.append("prob_faller: C scored a window with NaN features")

        status = "PASS" if not problems else "FAIL"
        print(f"{status}  {exp['name']:<18} steps={act['n_steps_window']:>3} "
              f"max_rel_err={worst:.2e}  {prob_note}")
        for p in problems:
            print(f"        {p}")
        failures += bool(problems)

    print()
    if failures:
        print(f"FAIL: {failures}/{len(expected)} cases mismatched")
        return 1
    print(f"PASS: all {len(expected)} cases match the Python reference "
          f"(rtol={RTOL:g})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
