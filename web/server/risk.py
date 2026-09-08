"""How the model's output is allowed to be presented.

The numbers here are read from results/metrics.json rather than hardcoded, and
every API response that carries a probability also carries this module's
caveat text. That coupling is deliberate: the framing is not decoration the
front-end can choose to drop, because the underlying model does not support a
stronger claim than the one written here.

Three facts drive everything in this file, all from the repo's own evaluation:

  1. The LTMM labels are falls self-reported in the year BEFORE the recording.
     The model classifies fall *history*. It does not predict future falls,
     and no arrangement of this data could make it do so.
  2. Leave-one-subject-out AUC is 0.592 at subject level. Chance is 0.5, and
     the clinical literature treats ~0.70-0.75 as the floor for a usable
     discriminator. This model is below that floor.
  3. The strongest features by SHAP are static axis means -- essentially the
     sensor's average orientation -- which points at a mounting or cohort
     artefact rather than a gait signal.

So the website reports the score as a research readout, not a health finding.
The reliable content on the dashboard is the step count, cadence and walking
volume; those are direct measurements and stand on their own.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
METRICS_PATH = ROOT / "results" / "metrics.json"

# A single 10 s window is far too noisy to show. Require a few minutes of
# actual walking before the indicator reports anything at all.
MIN_SCORED_WINDOWS = 24   # 24 windows x 5 s hop = ~2 minutes of walking

# Band edges on P(faller). The model's own confusion matrix was computed at
# 0.5, so that is the midpoint; the dead band either side of it exists because
# a model at AUC 0.59 genuinely cannot separate the middle of its own range.
BAND_LOW = 0.35
BAND_HIGH = 0.65


@lru_cache(maxsize=1)
def model_metrics() -> dict:
    if not METRICS_PATH.exists():
        return {}
    data = json.loads(METRICS_PATH.read_text())
    return data.get("deployed_model", {}).get("loso_subject_level", {})


@lru_cache(maxsize=1)
def model_card() -> dict:
    """The disclosure block attached to every response containing a score."""
    m = model_metrics()
    auc = m.get("subject_auc_roc")
    sens = m.get("subject_sensitivity")
    spec = m.get("subject_specificity")
    n = m.get("subject_n")

    return {
        "what_it_measures": (
            "How closely this walking pattern resembles those of people who "
            "reported two or more falls in the year before they were recorded."
        ),
        "what_it_does_not_measure": (
            "It does not predict future falls. The training labels describe "
            "falls that had already happened, so there is no forward-looking "
            "claim available from this data at all."
        ),
        "accuracy": {
            "auc_roc": auc,
            "sensitivity": sens,
            "specificity": spec,
            "n_subjects": int(n) if n is not None else None,
            "chance_auc": 0.5,
            "clinically_useful_auc": 0.70,
        },
        "accuracy_plain": (
            f"Leave-one-subject-out AUC {auc:.2f} on {n} people. "
            f"A coin flip scores 0.50 and this field generally treats 0.70 as "
            f"the minimum for a useful test, so this indicator is only slightly "
            f"better than guessing."
            if auc is not None else "Model metrics unavailable."
        ),
        "known_confound": (
            "The features doing most of the work are static axis means, which "
            "mostly describe how the sensor was oriented rather than how the "
            "person walked. That is more consistent with a mounting artefact "
            "than a real gait signal."
        ),
        "not_medical_advice": (
            "This is a research prototype, not a medical device, and nothing "
            "here should inform a clinical decision. Talk to a clinician or "
            "physiotherapist about falls risk."
        ),
        "trustworthy_instead": (
            "The step count, cadence and walking-time figures on this page are "
            "direct measurements and do not depend on the model."
        ),
    }


def band(prob: float | None, n_scored: int) -> dict:
    """Classify a probability into a display band, or refuse to."""
    if prob is None or n_scored < MIN_SCORED_WINDOWS:
        needed = MIN_SCORED_WINDOWS - max(0, n_scored)
        return {
            "band": "insufficient_data",
            "label": "Not enough walking yet",
            "detail": (
                f"Needs about {MIN_SCORED_WINDOWS * 5 // 60} minutes of walking "
                f"before the indicator means anything; "
                f"{max(0, needed)} more windows to go."
            ),
            "probability": prob,
            "n_scored_windows": n_scored,
        }

    if prob < BAND_LOW:
        b, label, detail = ("resembles_non_fallers", "Closer to the non-faller pattern",
                            "This walking pattern sits nearer the group who did not "
                            "report repeated falls. Given the model's accuracy, treat "
                            "this as weak evidence at best.")
    elif prob > BAND_HIGH:
        b, label, detail = ("resembles_fallers", "Closer to the past-faller pattern",
                            "This walking pattern sits nearer the group who reported "
                            "two or more past falls. It is not a warning about a "
                            "future fall, and the model is wrong roughly as often as "
                            "it is right.")
    else:
        b, label, detail = ("inconclusive", "Inconclusive",
                            "The pattern sits in the middle of the model's range, "
                            "where it cannot separate the two groups at all.")

    return {
        "band": b,
        "label": label,
        "detail": detail,
        "probability": prob,
        "n_scored_windows": n_scored,
    }


def assessment(prob: float | None, n_scored: int) -> dict:
    """A score plus the disclosure that must travel with it."""
    return {**band(prob, n_scored), "model_card": model_card()}
