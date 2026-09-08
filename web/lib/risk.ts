/**
 * How the model's output is allowed to be presented.
 *
 * Ported from the Python site's web/server/risk.py — read that file's
 * docstring for the full reasoning. Short version: three facts from the
 * repo's own evaluation drive everything here.
 *
 *   1. The LTMM labels are falls self-reported in the year BEFORE the
 *      recording. The model classifies fall *history*, not future falls.
 *   2. Leave-one-subject-out AUC is 0.592 at subject level. Chance is 0.5,
 *      and this field generally treats ~0.70-0.75 as the floor for a usable
 *      discriminator. This model is below that floor.
 *   3. The strongest features by SHAP are static axis means, essentially the
 *      sensor's average orientation, pointing at a mounting/cohort artefact
 *      rather than a gait signal.
 *
 * So every function here that touches a probability also produces the
 * disclosure that must travel with it — the dashboard is not allowed to show
 * a bare number.
 */

import type { Assessment, AssessmentBand, ModelCard } from "./types";
import metrics from "./model-metrics.json";

// A single 10 s window is far too noisy to show. Require a few minutes of
// actual walking before the indicator reports anything at all.
export const MIN_SCORED_WINDOWS = 24; // 24 windows x 5 s hop = ~2 minutes of walking

// Band edges on P(faller). The model's own confusion matrix was computed at
// 0.5, so that is the midpoint; the dead band either side of it exists
// because a model at AUC 0.59 genuinely cannot separate the middle of its own
// range.
export const BAND_LOW = 0.35;
export const BAND_HIGH = 0.65;

export function modelCard(): ModelCard {
  const auc = metrics.subject_auc_roc;
  const sens = metrics.subject_sensitivity;
  const spec = metrics.subject_specificity;
  const n = metrics.subject_n;

  return {
    what_it_measures:
      "How closely this walking pattern resembles those of people who " +
      "reported two or more falls in the year before they were recorded.",
    what_it_does_not_measure:
      "It does not predict future falls. The training labels describe " +
      "falls that had already happened, so there is no forward-looking " +
      "claim available from this data at all.",
    accuracy: {
      auc_roc: auc,
      sensitivity: sens,
      specificity: spec,
      n_subjects: n,
      chance_auc: 0.5,
      clinically_useful_auc: 0.7,
    },
    accuracy_plain:
      `Leave-one-subject-out AUC ${auc.toFixed(2)} on ${n} people. ` +
      `A coin flip scores 0.50 and this field generally treats 0.70 as ` +
      `the minimum for a useful test, so this indicator is only slightly ` +
      `better than guessing.`,
    known_confound:
      "The features doing most of the work are static axis means, which " +
      "mostly describe how the sensor was oriented rather than how the " +
      "person walked. That is more consistent with a mounting artefact " +
      "than a real gait signal.",
    not_medical_advice:
      "This is a research prototype, not a medical device, and nothing " +
      "here should inform a clinical decision. Talk to a clinician or " +
      "physiotherapist about falls risk.",
    trustworthy_instead:
      "The step count, cadence and walking-time figures on this page are " +
      "direct measurements and do not depend on the model.",
    // True, and worth stating, but a narrower claim than "the model gets
    // better with use": the model itself is a fixed booster baked into
    // models/model.c at export time -- it does not retrain, learn, or
    // personalise from anything this device sends. What genuinely improves
    // is the *indicator's* stability: it is a median over the scored
    // windows in the selected period (see MIN_SCORED_WINDOWS below), so a
    // handful of odd strides move it less once there are hundreds of
    // windows behind it than when there are just enough to clear the gate.
    // Don't strengthen this into an accuracy claim.
    gets_more_reliable_with_use:
      "The indicator itself becomes steadier with more recorded walking -- " +
      "it's a median across every scored window in the period, so a few " +
      "unusual strides move it far less once weeks of data sit behind it " +
      "than they did on day one. That's a statement about noise, though, " +
      "not accuracy: the model doing the scoring is fixed and does not " +
      "learn from your data.",
  };
}

interface Band {
  band: AssessmentBand;
  label: string;
  detail: string;
}

function band(prob: number | null, nScored: number): Band {
  if (prob === null || nScored < MIN_SCORED_WINDOWS) {
    const needed = MIN_SCORED_WINDOWS - Math.max(0, nScored);
    return {
      band: "insufficient_data",
      label: "Not enough walking yet",
      detail:
        `Needs about ${Math.floor((MIN_SCORED_WINDOWS * 5) / 60)} minutes of walking ` +
        `before the indicator means anything; ${Math.max(0, needed)} more windows to go.`,
    };
  }

  if (prob < BAND_LOW) {
    return {
      band: "resembles_non_fallers",
      label: "Closer to the non-faller pattern",
      detail:
        "This walking pattern sits nearer the group who did not report " +
        "repeated falls.",
    };
  }

  if (prob > BAND_HIGH) {
    return {
      band: "resembles_fallers",
      label: "Closer to the past-faller pattern",
      detail:
        "This walking pattern sits nearer the group who reported two or " +
        "more past falls. It is not a warning about a future fall, and " +
        "the model is wrong roughly as often as it is right.",
    };
  }

  return {
    band: "inconclusive",
    label: "Inconclusive",
    detail:
      "The pattern sits in the middle of the model's range, where it " +
      "cannot separate the two groups at all.",
  };
}

/** A score plus the disclosure that must travel with it. */
export function assessment(prob: number | null, nScored: number): Assessment {
  return {
    ...band(prob, nScored),
    probability: prob,
    n_scored_windows: nScored,
    model_card: modelCard(),
  };
}
