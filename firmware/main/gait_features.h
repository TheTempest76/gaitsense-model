/* gait_features.h -- window-level gait feature extraction for the deployed
 * 10-feature GaitSense model.
 *
 * This is a C port of the subset of src/features.py needed to feed
 * models/model.c. It is deliberately free of any ESP-IDF dependency so the
 * exact same translation unit can be compiled and diffed against the Python
 * reference on a host machine (see firmware/test/).
 *
 * Feature order matches models/model.h:
 *   [0] vertical_mean       [5] magnitude_mean
 *   [1] vertical_power_3_8  [6] harmonic_ratio_ml
 *   [2] ml_mean             [7] magnitude_rms
 *   [3] ml_rms              [8] vertical_skew
 *   [4] ap_mean             [9] step_time_mean
 *
 * Units: acceleration in g, matching the LTMM training data (a lower-back
 * sensor at rest reads ~+1 g on the vertical axis -- the saved test vector
 * has vertical_mean = 0.929, magnitude_mean = 1.028).
 */
#ifndef GAIT_FEATURES_H
#define GAIT_FEATURES_H

#include <stdbool.h>
#include <stddef.h>

#define GAIT_FS              100.0   /* Hz, matches FS_EXPECTED in features.py */
#define GAIT_WINDOW_SEC      10.0
#define GAIT_WINDOW_SAMPLES  1000    /* GAIT_WINDOW_SEC * GAIT_FS */
#define GAIT_HOP_SAMPLES     500     /* 50% overlap, matches OVERLAP = 0.5 */
#define GAIT_N_FEATURES      10

/* Below this many detected steps, features.py emits NaN for every
 * timing-derived feature rather than a fabricated value. */
#define GAIT_MIN_STEPS_FOR_TEMPORAL 4

typedef struct {
    /* Model input vector, in models/model.h order. NaN where the Python
     * reference would also emit NaN. */
    double features[GAIT_N_FEATURES];

    /* True only when all 10 features are finite. The exported model.c does
     * NOT reproduce XGBoost's learned missing-value split directions (m2cgen
     * emits a bare `if (input[i] < t)`, and a NaN comparison is always false,
     * so NaN silently takes the right branch regardless of what the model
     * learned). Callers must not score a window unless this is true.
     * See firmware/README.md, "Why NaN windows are not scored". */
    bool features_valid;

    /* Step events detected across the whole 10 s window. */
    int n_steps_window;
    /* Step events in the fresh (non-overlapping) second half of the window,
     * i.e. samples [GAIT_HOP_SAMPLES, GAIT_WINDOW_SAMPLES). Summing this
     * across windows counts each sample's steps exactly once. */
    int n_steps_fresh;

    double cadence_spm;       /* 60 * n_steps_window / GAIT_WINDOW_SEC, NaN if <4 steps */
    double stride_time_mean;  /* seconds, NaN if <5 steps */

    /* Standard deviation of the acceleration magnitude over the window, in g.
     * This is the movement-energy signal the walking gate keys on, and it is
     * NOT one of the model's inputs.
     *
     * It is needed because step detection alone cannot tell walking from
     * stillness: the peak-picking prominence threshold is relative
     * (0.15 * std of the filtered signal), so a motionless sensor's noise
     * floor still yields "steps". The conformance fixture demonstrates this --
     * its standing_still case detects 22 steps and the model scores it
     * P(faller) = 0.89, purely from sensor noise. */
    double magnitude_std;
} gait_window_result_t;

/* Extract features from one 10 s window of triaxial acceleration in g.
 * v/ml/ap must each hold GAIT_WINDOW_SAMPLES samples. */
void gait_extract(const float *v, const float *ml, const float *ap,
                  gait_window_result_t *out);

/* --- Pieces exposed for the host-side conformance test only. ------------- */

/* 4th-order Butterworth bandpass (0.5-3.5 Hz) applied via scipy-equivalent
 * filtfilt (odd padding, padlen 27, lfilter_zi initial conditions). */
void gait_bandpass_filtfilt(const double *x, int n, double *y);

/* scipy.signal.find_peaks(x, distance=25, prominence=0.15*std(x)) */
int gait_detect_steps(const double *filt, int n, int *peaks_out, int max_peaks);

/* scipy.signal.welch band power, summed over PSD bins with lo <= f < hi. */
double gait_welch_band_power(const double *x, int n, double lo, double hi);

double gait_harmonic_ratio_ml(const double *ml, int n, double stride_time);

#endif /* GAIT_FEATURES_H */
