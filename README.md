# gaitsense-model

A baseline gait-classification pipeline built on the PhysioNet [LTMM (Long
Term Movement Monitoring) database](https://physionet.org/content/ltmm/1.0.0/),
aimed at eventual deployment on an ESP32-S3 wearable.

## What this model actually is (read this first)

**LTMM's fall labels are self-reported falls in the year *preceding* the
recording.** A model trained on them learns to classify people who *have*
already fallen, using their gait at one point in time. It is a
**retrospective classifier of fall history, not a predictive model of
future falls.** Nothing in this repo should be described, documented, or
marketed as "fall prediction" -- that would claim a causal/forward-looking
capability this data cannot support. If you build a forward-looking
predictor later, it needs prospective follow-up data (falls recorded
*after* the gait measurement), which LTMM does not provide.

## Headline result: it doesn't really work, and that's the finding

Leave-one-subject-out cross-validated AUC-ROC on the lab-walk data, at the
subject level:

| feature set | n features | AUC-ROC | sensitivity | specificity |
|---|---|---|---|---|
| all extracted features | 66 | **0.425** | 0.33 | 0.50 |
| top 10 by SHAP | 10 | **0.592** | 0.53 | 0.61 |
| top 20 by SHAP | 20 | 0.579 | 0.50 | 0.58 |
| top 40 by SHAP | 40 | 0.454 | 0.37 | 0.55 |

0.5 AUC is chance. The full-feature model is *at* chance. The best
ablation (top-10 features) reaches 0.59, which is weak-to-mediocre, not a
clinically usable discriminator (typical usable thresholds in this
literature start around 0.70-0.75). No hyperparameter tuning was applied
to chase a better number, per instruction -- these are the numbers a fixed,
MCU-sized model gets on a single 30-50s lab walk with LOSO CV.

**Read this as: a one-minute lab walk, on its own, does not carry enough
signal to separate self-reported past fallers from non-fallers in this
cohort.** That is a real, useful, and unsurprising finding -- lab gait
speed/rhythm during a short supervised walk is a weak proxy for whatever
combination of balance, cognition, health status, and bad luck produced a
fall a year ago. Two candidate explanations, not mutually exclusive:

1. **The label is noisy.** "Falls in the past year" is self-reported,
   collected once, and mixes genuinely fall-prone gait with unlucky
   one-off falls, medication changes, environmental hazards, etc. -- none
   of which show up in 40 seconds of walking.
2. **The lab walk is the wrong window.** It is short, supervised, and
   artificially "clean" -- elderly fallers may walk close to normal when
   told to walk down a hallway for a clinician, and their real risk shows
   up in unsupervised, fatigued, or distracted walking captured over the
   3-day free-living recording (phase 2, not yet run -- see below).

### A confound worth flagging

The strongest individual features by SHAP are static **axis-mean**
quantities (`vertical_mean`, `ml_mean`, `ap_mean`, `magnitude_mean`) --
essentially the average sensor orientation/gravity component during the
walk, not gait *dynamics*. That is more consistent with a subtle sensor
mounting/orientation or cohort-recruitment artifact (e.g. systematic
differences between how the two subject groups were fitted with the
device) than with a genuine gait-based fall signal, especially combined
with the near-chance overall performance. Take the SHAP ranking as a
diagnostic of what the model *could* grab onto, not as clinically
validated gait biomarkers.

## Data and labels

- Source: PhysioNet LTMM 1.0.0, 71 community-living older adults (40
  labeled "Controls", 31 labeled "Fallers" in the recording metadata),
  lower-back sensor at ~L5, 100 Hz.
- **The sensor is a 6-channel IMU, not accelerometer-only**: 3-axis
  acceleration (`v`, `ml`, `ap`, units `g`) *and* 3-axis angular velocity
  (`yaw`, `pitch`, `roll`, units `deg/s`), confirmed by reading the WFDB
  `.hea` headers directly (never assumed). Per the task scope, only the
  three acceleration channels were used -- everything here is achievable
  from a plain triaxial accelerometer, which is what the ESP32-S3 target
  is expected to carry.
- **Faller label**: derived from `ClinicalDemogData_COFL.xlsx`, *not* from
  the Controls/Fallers sheet split. That workbook has two sheets
  (`Controls`, `Fallers`) plus a `Legend` sheet; the `Year Fall ` column
  ("# falls in past year") is legended as a count but entered as a mix of
  numbers and free text (`"at least 2"`, `"na"`, ...). We parse the
  numeric value where possible and label `is_faller = falls_year >= 2`.
  This is **not** the same as sheet membership: subject `FL-008` sits in
  the "Fallers" sheet but self-reports 0 falls in the past year (labeled
  non-faller here); several "Controls" self-report 1 fall (still
  non-faller under the >=2 rule, correctly). `CO-024`, `FL-003`,
  `FL-037`, `FL-038`, `FL-039` have no usable fall count and are dropped
  from the labeled analysis entirely (not imputed, not assumed).
- Resulting labeled cohort (subjects with a usable lab-walk record *and* a
  parseable fall count): **68 subjects, 32 non-faller / 36 faller** (see
  `src/load.py` for the exact join logic and `data/cache/subject_table.parquet`
  for the full audit trail, including subjects present in one source but
  missing from another).

## Pipeline

```
src/download.py   staged, resumable PhysioNet mirror (metadata -> LabWalks -> full 3-day, gated behind --confirm-full)
src/load.py       WFDB header parsing + subject table (demographics join, label derivation, source-mismatch reporting)
src/features.py   windowed gait feature extraction (10s windows, 50% overlap) + driver that builds the labeled feature matrix
src/train.py      leave-one-subject-out CV, XGBoost (missing=np.nan, scale_pos_weight), SHAP/gain importances, ablation
src/export.py     m2cgen C export of the deployed (top-10-feature) model + C test harness
```

Run in order:

```
python src/download.py --stage metadata
python src/download.py --stage labwalks
python src/load.py       # -> data/cache/subject_table.parquet
python src/features.py   # -> data/cache/features_labwalks.parquet
python src/train.py      # -> models/model.json, results/*
python src/export.py     # -> models/model.c, model.h, test_harness.c
```

Everything under `data/` and `.venv/` is gitignored; re-running the
pipeline reuses the cached Parquet files in `data/cache/` instead of
re-parsing WFDB from scratch.

### Not yet run: the 3-day free-living data (phase 2)

The 3-day recordings are ~20.8 GB and were deliberately **not**
downloaded in this pass -- `src/download.py --stage full` is gated behind
an explicit `--confirm-full` flag for exactly that reason. The lab-walk
result above is weak enough that the free-living data is the natural next
step (see confound discussion above), but that is a much bigger feature-
extraction job (multi-day windowing, activity/gait-bout detection to
find walking segments inside 3 days of mixed activity, wear-time
filtering via `ReportHome75h.xlsx`) and a real 20.8 GB download, so it
was intentionally left for a deliberate go/no-go rather than pulled
automatically.

## Features

All features are computed per 10s window (50% overlap) from the three
acceleration axes (vertical, mediolateral, anterior-posterior) and their
Euclidean magnitude. `NaN` is emitted (never 0, never a dropped row)
whenever a feature can't be computed for a window -- e.g. fewer than 4
detected steps makes every timing-derived feature NaN for that window --
so XGBoost's native missing-value split-direction learning sees genuine
"unavailable," not a fabricated value. 66 features total; see
`src/features.py` for the full list and formulas.

Two features carry real methodological caveats, kept because they are
standard practice in the field, not because they're exact:

- **Step/stride timing** comes from peak-picking a bandpass-filtered
  (0.5-3.5 Hz) vertical acceleration signal -- noisy for slow, shuffling,
  or irregular gait, which is disproportionately the gait of interest here.
- **Stride-time asymmetry** and **harmonic ratio** both need a left/right
  step split. A single trunk-mounted sensor cannot know true foot side,
  so (like the rest of the field) we use the *alternating-step
  assumption* -- odd- vs. even-indexed detected steps stand in for the
  two "sides." A missed or spurious step detection silently flips which
  side is which.

## Model

- XGBoost, fixed hyperparameters (not tuned): `max_depth=5`,
  `n_estimators=200`, `learning_rate=0.08`, `subsample=0.8`,
  `colsample_bytree=0.8`, `missing=np.nan` set explicitly,
  `scale_pos_weight` computed per LOSO training fold from that fold's
  class balance. Seed 42 everywhere.
- **Deployed model uses only the top-10 SHAP-ranked features**
  (`models/feature_list.json`), chosen because it had the best LOSO
  subject-level AUC among the {10, 20, 40, all} feature-count ablation
  *and* is the smallest -- both the accuracy and the flash-footprint
  argument point the same way here. See `results/ablation.csv`.
- `results/importances.png` / `results/feature_importances_shap.csv` /
  `feature_importances_gain.csv` give the full ranking (66 features) from
  a separate model fit for interpretation only -- that model is not the
  one exported to C.

## C export (`models/`)

`model.c` / `model.h` are generated from the deployed (10-feature) model
via [m2cgen](https://github.com/BayesWitnesses/m2cgen). One compatibility
fix was needed: XGBoost >=2.0 serializes `base_score` as the string
`"5E-1"` in its JSON model dump, and m2cgen 0.10.0 expects a float --
`src/export.py` coerces it back before export (see that file's docstring).

- `model.c`: 252,405 bytes of generated source (200 trees x depth 5 x 10
  features, one big if/else chain per tree, summed).
- `results/export_footprint.json` has a **rough** flash-footprint
  estimate (1-2x source size) -- explicitly a heuristic, not a compiled
  measurement. Verify with the real ESP32-S3 toolchain (`idf.py size`)
  before trusting it. 252 KB of source is plausible to fit an ESP32-S3's
  flash on its own, but budget against whatever else the firmware needs.
- `test_harness.c` feeds one saved feature vector
  (`models/test_vector.json`, taken from subject CO-001's first window)
  through `score()` and asserts `output[1]` (P(faller)) matches the
  Python-side `predict_proba` to within 1e-4. No C compiler was available
  on the host machine, so this was compiled and run in a throwaway
  `gcc:latest` Docker container instead (nothing installed on the host):
  ```
  docker run --rm -v "$(pwd)/models:/work" -w /work gcc:latest \
    bash -c "gcc -O2 -o test_model model.c test_harness.c -lm && ./test_model"
  ```
  Result: `P(faller) C=0.01252196 python=0.01252199 diff=0.00000002` --
  **PASS**, 4,000x tighter than the 1e-4 requirement.

## Deployment: the wearable and the website

Two folders take the exported model off the bench and into something you can
wear and look at.

```
firmware/   ESP-IDF firmware: MPU6050 -> features -> score() -> POST
web/        Next.js site: ingest API, SQLite, dashboard (steps, history, exercises)
tools/      fixture generator, C/Python conformance checker, device simulator
```

### `firmware/` -- the ESP32 node

Samples an MPU6050 at 100 Hz, computes the same ten features on-device, scores
them with `models/model.c` compiled straight out of this repo, and POSTs the
result every 5 seconds. See `firmware/README.md` for wiring, `menuconfig`
settings and the axis-mapping check.

`main/gait_features.c` is a hand-written C port of the SciPy pipeline in
`src/features.py` -- Butterworth `filtfilt`, `find_peaks` with prominence,
Welch PSD, harmonic ratio. It is verified against the real training-time
extractor rather than eyeballed:

```bash
python tools/gen_conformance_case.py
docker run --rm -v "$(pwd):/w" -w /w gcc:latest bash -c   "gcc -O2 -I firmware/main -I models -o /tmp/t      firmware/main/gait_features.c firmware/test/test_features.c models/model.c -lm    && /tmp/t firmware/test/cases.txt" > /tmp/c_out.json
python tools/check_conformance.py < /tmp/c_out.json
```

Eight windows -- normal, brisk, slow-shuffling, asymmetric and noisy gait plus
three degenerate cases -- match to a worst-case **2.1e-14 relative error**, with
step counts, NaN placement and the end-to-end `P(faller)` all agreeing
(worst probability difference 1.2e-07).

Two findings from building it are worth carrying forward:

- **A walking gate is mandatory.** The conformance fixture's `standing_still`
  case -- gravity plus 0.002 g of noise -- yields 22 detected "steps" and the
  model scores it **P(faller) = 0.89**. Step detection cannot distinguish
  walking from stillness on its own, because the peak detector's prominence
  threshold is relative to the signal's own standard deviation and so scales
  down with the noise floor. The firmware gates on absolute movement energy.
- **NaN windows must not be scored.** `src/features.py` emits NaN when a
  feature cannot be computed, and the Python model handles that via
  `missing=np.nan`. m2cgen does not reproduce this: `model.c` emits a bare
  `if (input[i] < threshold)`, and a NaN comparison is always false, so a NaN
  silently takes the right branch of every split regardless of the learned
  direction. The firmware refuses to score incomplete windows instead.

### `web/` -- the dashboard

A Next.js App Router app -- ingest API and UI in one process, no separate
backend. React dashboard, hand-built SVG charts (light/dark, a validated
data-viz palette), SQLite via `better-sqlite3`.

```bash
cd web
npm install
cp .env.example .env.local   # set GAITSENSE_TOKEN to match the firmware
npm run dev                  # http://localhost:3000

# no hardware? this posts real features and real scores, not mock data
python tools/simulate_device.py --backfill-days 21 --live
```

Steps, walking time, cadence, 30 days of history, the gait-pattern indicator
and an exercise plan, all polled every 5 seconds. Inference happens on the
device only -- the earlier FastAPI version of this site re-scored every
reading server-side as a drift check against `models/model.json`; this app
has no Python/XGBoost runtime, so that check does not currently exist here
(see `web/README.md` for what dropped and the cheapest way to bring it back).

The presentation rules live in `web/lib/risk.ts` and are enforced
server-side: every response carrying a probability also carries the model
card, no band is shown under ~2 minutes of walking, 0.35-0.65 is reported as
"inconclusive" and shaded neutral gray rather than amber, and the exercise
recommendations key on measured steps and cadence rather than on the model.
Given a 0.592 AUC on a retrospective label, that framing is the honest one --
see `web/README.md` if you change it. Note also that `web/lib/model-metrics.json`
is a static copy of the trained model's numbers, not read live from
`results/metrics.json` -- re-copy it by hand after a retrain.

## Reproducibility

- Python 3.11.9, dependencies pinned in `requirements.txt`, installed via
  `uv venv && uv pip install -r requirements.txt`.
- Random seed 42 set in `src/train.py` (`numpy`, `random`, and XGBoost's
  `random_state`) before every fit.
- `data/cache/*.parquet` cache the subject table and feature matrix so
  reruns don't re-parse WFDB or re-extract features from scratch.
