"""Gait-bout detection and chunked feature extraction for the 3-day
free-living recordings (phase 2).

The lab walks (features.py) are ~40s of continuous, supervised walking --
every window is a walking window. A 3-day recording is the opposite: the
overwhelming majority of it is sitting, standing, lying, or transit, not
walking. Running the full 66-feature extractor (which includes an O(n^2)
sample-entropy call) on every 10s window of 3 days x 71 subjects is
computationally infeasible (~3.7M windows). So this module adds a cheap
first-pass gate -- vertical-acceleration peak detection only -- and only
runs the full feature extractor on windows that pass it.

Records are read in fixed-size chunks (`CHUNK_SEC`) via wfdb's
sampfrom/sampto rather than loaded whole, both to bound memory (a full
3-day x 6-channel record is ~800 MB as float64) and to let progress be
logged per subject. Chunks are processed independently with no overlap
stitching: a handful of windows exactly at a chunk boundary are dropped
rather than double-counted or stitched, which loses a negligible fraction
of windows (chunk boundaries are ~35 per subject vs. ~50,000 candidate
windows) in exchange for much simpler, easily-verified code.

We deliberately do NOT use ReportHome75h.xlsx (the self-reported
wear/removal diary) to filter windows. It's a free-text, inconsistently
filled clinician diary (values like "slept with it", "sometime in the
evening", "9:00?") -- not a machine-parseable schedule. Building an
automated parser on top of it would produce confident-looking but
unreliable exclusions. The signal-based gate already does the job we'd
want the diary for: a removed/off-body sensor reads as flat, low-variance
acceleration, which fails the walking gate on its own.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import wfdb

import features as F

log = logging.getLogger("bouts")

CHUNK_SEC = 3600 * 2  # 2h chunks -> ~8.6MB/channel in memory, trivial
ACCEL_CHANNELS = ("v-acceleration", "ml-acceleration", "ap-acceleration")


def gate_is_walking(v_window: np.ndarray, fs: float) -> tuple[bool, np.ndarray]:
    """Cheap first-pass filter: bandpass + peak-pick the vertical axis only.
    Returns (passes_gate, detected_peaks) so callers can reuse the peaks
    instead of re-detecting them inside the full feature extractor."""
    peaks = F.detect_steps(v_window, fs)
    return len(peaks) >= F.MIN_STEPS_FOR_TEMPORAL, peaks


def iter_chunks(n_samples: int, fs: float, chunk_sec: float = CHUNK_SEC):
    chunk_len = int(round(chunk_sec * fs))
    start = 0
    while start < n_samples:
        end = min(start + chunk_len, n_samples)
        yield start, end
        start = end


def extract_record_bouts(record_path: str, fs_expected: float = F.FS_EXPECTED,
                          window_sec: float = F.WINDOW_SEC, overlap: float = F.OVERLAP,
                          chunk_sec: float = CHUNK_SEC):
    """Generator of feature dicts for windows that pass the walking gate,
    covering an entire (potentially multi-day) record without loading it
    all into memory at once."""
    hdr = wfdb.rdheader(record_path)
    if abs(hdr.fs - fs_expected) > 1e-6:
        log.warning("record %s fs=%.2f differs from expected %.2f", record_path, hdr.fs, fs_expected)
    idx = {name: i for i, name in enumerate(hdr.sig_name)}
    missing = set(ACCEL_CHANNELS) - set(idx)
    if missing:
        log.warning("record %s missing acceleration channels %s, skipping", record_path, missing)
        return
    channel_idx = [idx[c] for c in ACCEL_CHANNELS]  # v, ml, ap order

    n_samples = hdr.sig_len
    n_windows_total = 0
    n_windows_kept = 0

    for chunk_start, chunk_end in iter_chunks(n_samples, hdr.fs, chunk_sec):
        rec = wfdb.rdrecord(record_path, sampfrom=chunk_start, sampto=chunk_end, channels=channel_idx)
        v = rec.p_signal[:, 0]
        ml = rec.p_signal[:, 1]
        ap = rec.p_signal[:, 2]

        for w_s, w_e in F.make_windows(len(v), rec.fs, window_sec, overlap):
            n_windows_total += 1
            passes, peaks = gate_is_walking(v[w_s:w_e], rec.fs)
            if not passes:
                continue
            n_windows_kept += 1
            feats = F.extract_window_features(v[w_s:w_e], ml[w_s:w_e], ap[w_s:w_e], rec.fs, window_sec)
            feats["window_start_sec"] = (chunk_start + w_s) / rec.fs
            yield feats

    log.info("%s: %d/%d windows passed the walking gate (%.1f%%)",
              record_path, n_windows_kept, n_windows_total,
              100 * n_windows_kept / max(n_windows_total, 1))


def build_freeliving_feature_matrix(subject_table: pd.DataFrame, raw_dir: Path,
                                     window_sec: float = F.WINDOW_SEC, overlap: float = F.OVERLAP) -> pd.DataFrame:
    from tqdm import tqdm

    rows = []
    subjects = subject_table[subject_table["has_3day"]]
    for _, srow in tqdm(list(subjects.iterrows()), desc="extracting free-living features"):
        record_path = str(raw_dir / srow["record_3day"])
        try:
            for feats in extract_record_bouts(record_path, F.FS_EXPECTED, window_sec, overlap):
                feats["subject_id"] = srow["subject_id"]
                feats["cohort_sheet"] = srow["cohort_sheet"]
                feats["age"] = srow["Age"]
                feats["sex"] = srow["sex"]
                feats["falls_year"] = srow["falls_year"]
                feats["is_faller"] = srow["is_faller"]
                feats["faller_label_known"] = srow["faller_label_known"]
                rows.append(feats)
        except Exception as e:
            log.error("failed to extract free-living features for %s (%s): %s", srow["subject_id"], record_path, e)

    df = pd.DataFrame(rows)
    log.info("free-living feature matrix: %d windows x %d columns from %d subjects",
              len(df), len(df.columns), df["subject_id"].nunique() if len(df) else 0)
    return df


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import load as _load

    subject_table = _load.build_subject_table()
    matrix = build_freeliving_feature_matrix(subject_table, _load.DATA_DIR)

    out = Path(__file__).resolve().parent.parent / "data" / "cache" / "features_freeliving.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    matrix.to_parquet(out)
    log.info("wrote %s", out)
