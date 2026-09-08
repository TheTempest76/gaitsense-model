"""Window-level gait feature extraction from lower-back triaxial acceleration.

Every feature is accelerometer-derivable from a single lower-back sensor;
none of it assumes a second sensor or ground-truth foot-side labels. Two
methodological caveats worth knowing before trusting individual features:

  * Step/stride timing comes from peak-picking the vertical acceleration
    (bandpass 0.5-3.5 Hz) -- standard, but noisy for short, slow, or
    shuffling gait. Windows with <4 detected steps get NaN for every
    temporal feature rather than a fabricated value.
  * "Stride-time asymmetry" and "harmonic ratio" both need a left/right
    step split. A single trunk sensor cannot know true foot side, so like
    the rest of the field we use the *alternating-step assumption*
    (odd-indexed vs even-indexed steps = the two "sides"). This is a real
    limitation: it silently mislabels sides after any missed/extra step
    detection. Documented here and in the README, not hidden.

NaN is emitted (never 0, never a dropped row) whenever a feature can't be
computed for a window, so XGBoost's native missing-value handling sees the
true "unavailable" signal.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy import signal as sig
from scipy import stats

log = logging.getLogger("features")

try:
    import antropy
except ImportError:  # pragma: no cover
    antropy = None

FS_EXPECTED = 100.0  # Hz, confirmed from WFDB headers -- see load.py
WINDOW_SEC = 10.0
OVERLAP = 0.5

STEP_BAND = (0.5, 3.5)      # Hz, plausible walking cadence band for bandpass
BAND_LOW = (0.5, 3.0)        # Hz, "power_0.5_3"
BAND_HIGH = (3.0, 8.0)       # Hz, "power_3_8"
MIN_STEPS_FOR_TEMPORAL = 4   # below this, timing stats are unreliable -> NaN
N_HARMONICS = 10


# ---------------------------------------------------------------------------
# Windowing
# ---------------------------------------------------------------------------

def make_windows(n_samples: int, fs: float, window_sec: float = WINDOW_SEC, overlap: float = OVERLAP):
    win = int(round(window_sec * fs))
    hop = int(round(win * (1 - overlap)))
    if win <= 0 or hop <= 0:
        return
    start = 0
    while start + win <= n_samples:
        yield start, start + win
        start += hop


# ---------------------------------------------------------------------------
# Step/stride detection (vertical axis only)
# ---------------------------------------------------------------------------

def _bandpass(x: np.ndarray, fs: float, band: tuple[float, float], order: int = 4) -> np.ndarray:
    nyq = fs / 2
    lo, hi = band[0] / nyq, min(band[1], nyq * 0.99) / nyq
    b, a = sig.butter(order, [lo, hi], btype="band")
    return sig.filtfilt(b, a, x)


def detect_steps(v_accel: np.ndarray, fs: float) -> np.ndarray:
    """Peak-pick bandpass-filtered vertical acceleration. Returns sample
    indices of detected step events (empty array if none found)."""
    if len(v_accel) < fs:  # need at least ~1s
        return np.array([], dtype=int)
    try:
        filt = _bandpass(v_accel, fs, STEP_BAND)
    except ValueError:
        return np.array([], dtype=int)
    min_distance = max(int(0.25 * fs), 1)  # cap cadence at 240 steps/min
    prominence = 0.15 * np.std(filt) if np.std(filt) > 0 else None
    peaks, _ = sig.find_peaks(filt, distance=min_distance, prominence=prominence)
    return peaks


@dataclass
class TemporalFeatures:
    step_time_mean: float = np.nan
    step_time_std: float = np.nan
    step_time_cv: float = np.nan
    stride_time_mean: float = np.nan
    stride_time_std: float = np.nan
    stride_time_cv: float = np.nan
    cadence: float = np.nan
    stride_time_asymmetry_index: float = np.nan
    step_regularity: float = np.nan
    stride_regularity: float = np.nan


def temporal_features(v_accel: np.ndarray, fs: float, window_sec: float) -> TemporalFeatures:
    out = TemporalFeatures()
    peaks = detect_steps(v_accel, fs)
    if len(peaks) >= MIN_STEPS_FOR_TEMPORAL:
        step_times = np.diff(peaks) / fs
        out.step_time_mean = float(np.mean(step_times))
        out.step_time_std = float(np.std(step_times, ddof=1)) if len(step_times) > 1 else np.nan
        out.step_time_cv = out.step_time_std / out.step_time_mean if out.step_time_mean else np.nan
        out.cadence = 60.0 * len(peaks) / window_sec

        if len(peaks) >= 5:
            stride_times = (peaks[2:] - peaks[:-2]) / fs
            out.stride_time_mean = float(np.mean(stride_times))
            out.stride_time_std = float(np.std(stride_times, ddof=1)) if len(stride_times) > 1 else np.nan
            out.stride_time_cv = out.stride_time_std / out.stride_time_mean if out.stride_time_mean else np.nan

            side_a = step_times[0::2]
            side_b = step_times[1::2]
            if len(side_a) >= 2 and len(side_b) >= 2:
                mean_a, mean_b = np.mean(side_a), np.mean(side_b)
                denom = (mean_a + mean_b) / 2
                if denom > 0:
                    out.stride_time_asymmetry_index = float(100 * abs(mean_a - mean_b) / denom)

    out.step_regularity, out.stride_regularity = regularity(v_accel, fs, out.step_time_mean)
    return out


def regularity(x: np.ndarray, fs: float, step_time: float) -> tuple[float, float]:
    """Moe-Nilssen (1998) unbiased-autocorrelation step/stride regularity.

    ac[0] = 1 by construction; step_regularity = ac at the step-period lag,
    stride_regularity = ac at 2x that lag. NaN if step period is unknown or
    the signal is too short to reach the stride-period lag."""
    if not np.isfinite(step_time) or step_time <= 0 or len(x) < fs:
        return np.nan, np.nan
    x = x - np.mean(x)
    n = len(x)
    ac_full = np.correlate(x, x, mode="full")
    ac = ac_full[n - 1:]
    denom = np.arange(n, 0, -1)  # unbiased normalization
    ac_unbiased = ac / denom
    if ac_unbiased[0] <= 0:
        return np.nan, np.nan
    ac_norm = ac_unbiased / ac_unbiased[0]

    def _peak_near(lag_est: int, search: int) -> float:
        if lag_est - search < 1 or lag_est + search >= len(ac_norm):
            return np.nan
        window = ac_norm[lag_est - search: lag_est + search + 1]
        return float(np.max(window))

    step_lag = int(round(step_time * fs))
    stride_lag = int(round(2 * step_time * fs))
    search = max(int(0.1 * fs), 2)
    return _peak_near(step_lag, search), _peak_near(stride_lag, search)


# ---------------------------------------------------------------------------
# Per-axis signal features
# ---------------------------------------------------------------------------

def spectral_features(x: np.ndarray, fs: float) -> dict[str, float]:
    n = len(x)
    if n < 8:
        return dict.fromkeys(
            ["dominant_frequency", "spectral_entropy", "spectral_centroid", "power_0.5_3", "power_3_8"], np.nan)
    freqs, psd = sig.welch(x, fs=fs, nperseg=min(n, int(fs * 4)))
    if not np.any(psd > 0):
        return dict.fromkeys(
            ["dominant_frequency", "spectral_entropy", "spectral_centroid", "power_0.5_3", "power_3_8"], np.nan)

    dom_freq = float(freqs[np.argmax(psd)])

    p_norm = psd / np.sum(psd)
    p_norm = p_norm[p_norm > 0]
    spec_entropy = float(-np.sum(p_norm * np.log2(p_norm)) / np.log2(len(p_norm))) if len(p_norm) > 1 else np.nan

    spec_centroid = float(np.sum(freqs * psd) / np.sum(psd))

    def band_power(lo, hi):
        mask = (freqs >= lo) & (freqs < hi)
        return float(np.sum(psd[mask])) if mask.any() else np.nan

    return {
        "dominant_frequency": dom_freq,
        "spectral_entropy": spec_entropy,
        "spectral_centroid": spec_centroid,
        "power_0.5_3": band_power(*BAND_LOW),
        "power_3_8": band_power(*BAND_HIGH),
    }


def axis_features(x: np.ndarray, fs: float) -> dict[str, float]:
    out: dict[str, float] = {}
    x = np.asarray(x, dtype=float)
    n = len(x)
    if n == 0 or not np.all(np.isfinite(x)):
        keys = ["mean", "std", "rms", "range", "iqr", "skew", "kurtosis", "jerk_rms"]
        out.update(dict.fromkeys(keys, np.nan))
        out.update(spectral_features(np.array([]), fs))
        return out

    out["mean"] = float(np.mean(x))
    out["std"] = float(np.std(x, ddof=1)) if n > 1 else np.nan
    out["rms"] = float(np.sqrt(np.mean(x ** 2)))
    out["range"] = float(np.ptp(x))
    out["iqr"] = float(np.percentile(x, 75) - np.percentile(x, 25))
    out["skew"] = float(stats.skew(x)) if n > 2 else np.nan
    out["kurtosis"] = float(stats.kurtosis(x)) if n > 3 else np.nan

    jerk = np.diff(x) * fs
    out["jerk_rms"] = float(np.sqrt(np.mean(jerk ** 2))) if len(jerk) > 0 else np.nan

    out.update(spectral_features(x, fs))
    return out


# ---------------------------------------------------------------------------
# Stability: harmonic ratio + sample entropy
# ---------------------------------------------------------------------------

def harmonic_ratio(x: np.ndarray, fs: float, stride_time: float, axis: str) -> float:
    """Menz/Latt-style harmonic ratio from the FFT of an acceleration axis
    over the window, referenced to the dominant stride frequency.

    V and AP axes: HR = sum(even harmonics) / sum(odd harmonics)
    ML axis:       HR = sum(odd harmonics)  / sum(even harmonics)
    (ML acceleration alternates sign step-to-step, so its fundamental sits
    on the odd harmonics of the *stride* frequency instead of the even
    ones -- Kobsar et al. 2020.)

    NaN if stride_time is unknown (no reliable step detection in this
    window) or the window is too short to resolve N_HARMONICS harmonics.
    """
    if not np.isfinite(stride_time) or stride_time <= 0:
        return np.nan
    x = np.asarray(x, dtype=float)
    n = len(x)
    if n < fs:
        return np.nan
    f0 = 1.0 / stride_time
    if f0 * N_HARMONICS >= fs / 2:
        return np.nan

    x = x - np.mean(x)
    spec = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(n, d=1 / fs)
    bin_width = freqs[1] - freqs[0] if len(freqs) > 1 else np.nan
    if not np.isfinite(bin_width) or bin_width <= 0:
        return np.nan
    search = 2  # +/-2 FFT bins tolerance around each expected harmonic

    harmonics = []
    for k in range(1, N_HARMONICS + 1):
        idx = int(round(k * f0 / bin_width))
        if idx - search < 0 or idx + search >= len(spec):
            break
        harmonics.append(float(np.max(spec[max(idx - search, 0): idx + search + 1])))
    if len(harmonics) < 4:  # need at least a couple of each parity to be meaningful
        return np.nan

    odd = sum(harmonics[0::2])   # harmonics[0] = 1st harmonic (odd), harmonics[1] = 2nd (even), ...
    even = sum(harmonics[1::2])
    if axis == "ml":
        num, den = odd, even
    else:
        num, den = even, odd
    if den <= 0:
        return np.nan
    return float(num / den)


def sample_entropy(x: np.ndarray) -> float:
    if antropy is None or len(x) < 20:
        return np.nan
    try:
        x_c = np.ascontiguousarray(x, dtype=float)  # antropy's numba kernel only dispatches on C-contiguous input
        val = antropy.sample_entropy(x_c, order=2)  # default metric=chebyshev; passing it explicitly breaks numba dispatch on antropy 0.1.6
        return float(val) if np.isfinite(val) else np.nan
    except Exception as e:
        log.debug("sample_entropy failed: %s", e)
        return np.nan


# ---------------------------------------------------------------------------
# Top-level: one window -> one feature dict
# ---------------------------------------------------------------------------

AXES = ("vertical", "ml", "ap")


def extract_window_features(v: np.ndarray, ml: np.ndarray, ap: np.ndarray, fs: float, window_sec: float) -> dict[str, float]:
    feats: dict[str, float] = {}

    temp = temporal_features(v, fs, window_sec)
    for k, val in temp.__dict__.items():
        feats[k] = val

    mag = np.sqrt(v ** 2 + ml ** 2 + ap ** 2)
    signals = {"vertical": v, "ml": ml, "ap": ap, "magnitude": mag}
    for axis_name, x in signals.items():
        af = axis_features(x, fs)
        for k, val in af.items():
            feats[f"{axis_name}_{k}"] = val

    stride_time = temp.stride_time_mean
    feats["harmonic_ratio_vertical"] = harmonic_ratio(v, fs, stride_time, "vertical")
    feats["harmonic_ratio_ml"] = harmonic_ratio(ml, fs, stride_time, "ml")
    feats["harmonic_ratio_ap"] = harmonic_ratio(ap, fs, stride_time, "ap")
    feats["sample_entropy_vertical"] = sample_entropy(v)

    return feats


# ---------------------------------------------------------------------------
# Driver: subject table -> windowed, labeled feature matrix (Parquet)
# ---------------------------------------------------------------------------

def extract_record_features(record_path: str, fs: float, window_sec: float = WINDOW_SEC, overlap: float = OVERLAP):
    import wfdb as _wfdb

    rec = _wfdb.rdrecord(record_path)
    if abs(rec.fs - fs) > 1e-6:
        log.warning("record %s fs=%.2f differs from expected %.2f", record_path, rec.fs, fs)
    idx = {name: i for i, name in enumerate(rec.sig_name)}
    required = {"v-acceleration", "ml-acceleration", "ap-acceleration"}
    missing = required - set(idx)
    if missing:
        log.warning("record %s missing acceleration channels %s, skipping", record_path, missing)
        return
    v_full = rec.p_signal[:, idx["v-acceleration"]]
    ml_full = rec.p_signal[:, idx["ml-acceleration"]]
    ap_full = rec.p_signal[:, idx["ap-acceleration"]]

    for w_i, (s, e) in enumerate(make_windows(len(v_full), rec.fs, window_sec, overlap)):
        feats = extract_window_features(v_full[s:e], ml_full[s:e], ap_full[s:e], rec.fs, window_sec)
        feats["window_index"] = w_i
        feats["window_start_sec"] = s / rec.fs
        yield feats


def build_feature_matrix(subject_table, labwalks_dir, window_sec: float = WINDOW_SEC, overlap: float = OVERLAP):
    import pandas as pd
    from tqdm import tqdm

    rows = []
    subjects_with_labwalk = subject_table[subject_table["has_labwalk"]]
    for _, srow in tqdm(list(subjects_with_labwalk.iterrows()), desc="extracting lab-walk features"):
        record_path = str(labwalks_dir / srow["record_labwalk"])
        try:
            for feats in extract_record_features(record_path, FS_EXPECTED, window_sec, overlap):
                feats["subject_id"] = srow["subject_id"]
                feats["cohort_sheet"] = srow["cohort_sheet"]
                feats["age"] = srow["Age"]
                feats["sex"] = srow["sex"]
                feats["falls_year"] = srow["falls_year"]
                feats["is_faller"] = srow["is_faller"]
                feats["faller_label_known"] = srow["faller_label_known"]
                rows.append(feats)
        except Exception as e:
            log.error("failed to extract features for %s (%s): %s", srow["subject_id"], record_path, e)

    df = pd.DataFrame(rows)
    n_nan_total = df.select_dtypes(include="number").isna().sum().sum()
    log.info("feature matrix: %d windows x %d columns, %d total NaN cells", len(df), len(df.columns), n_nan_total)
    return df


if __name__ == "__main__":
    import sys
    from pathlib import Path as _Path

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    sys.path.insert(0, str(_Path(__file__).resolve().parent))
    import load as _load

    subject_table = _load.build_subject_table()
    matrix = build_feature_matrix(subject_table, _load.LABWALKS_DIR)

    out = _Path(__file__).resolve().parent.parent / "data" / "cache" / "features_labwalks.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    matrix.to_parquet(out)
    log.info("wrote %s", out)
