"""WFDB parsing + subject table construction for LTMM.

Joins three sources:
  - RECORDS (which WFDB records actually exist, for the 3-day recordings
    and for LabWalks separately -- these lists do NOT match 1:1, see below)
  - ClinicalDemogData_COFL.xlsx (two sheets: Controls, Fallers -- NOT a
    single flat table; falls-per-year is a free-text/numeric mixed column)
  - ReportHome75h.xlsx (self-reported wear/removal diary for the 3-day
    recordings)

Label definition (per task spec): faller if self-reported falls in the
past year >= 2. This is computed from the 'Year Fall' column across BOTH
demographic sheets -- it is NOT the same as the Controls/Fallers sheet
membership (e.g. subject FL-008 sits in the "Fallers" sheet but
self-reports 0 falls in the past year; several "Controls" self-report 1).
We use the numeric column, not sheet membership, per the task's
instruction not to hardcode a subject list.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import pandas as pd
import wfdb

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
LABWALKS_DIR = DATA_DIR / "LabWalks"
DEMOG_XLSX = DATA_DIR / "ClinicalDemogData_COFL.xlsx"
REPORT_XLSX = DATA_DIR / "ReportHome75h.xlsx"

log = logging.getLogger("load")


# ---------------------------------------------------------------------------
# Record discovery
# ---------------------------------------------------------------------------

def list_records(records_file: Path = DATA_DIR / "RECORDS") -> tuple[list[str], list[str]]:
    """Split the RECORDS file into (3-day record names, lab-walk record names)."""
    three_day, lab = [], []
    for line in records_file.read_text().splitlines():
        # RECORDS is a plain WFDB records list, one name per line; the
        # top-level copy we downloaded has an incidental line-number column
        # from how it was served -- strip it if present.
        name = line.strip().split("\t")[-1].strip()
        if not name:
            continue
        if name.startswith("LabWalks/"):
            lab.append(name.removeprefix("LabWalks/"))
        else:
            three_day.append(name)
    return three_day, lab


def record_subject_id(record_name: str) -> str:
    """'CO001' -> 'CO-001', 'co001_base' -> 'CO-001', 'FL014' -> 'FL-014'."""
    m = re.match(r"^(CO|FL)0*(\d+)", record_name, re.IGNORECASE)
    if not m:
        raise ValueError(f"unrecognised record name: {record_name}")
    cohort, num = m.group(1).upper(), int(m.group(2))
    return f"{cohort}-{num:03d}"


# ---------------------------------------------------------------------------
# Demographics
# ---------------------------------------------------------------------------

def _parse_falls(value) -> float:
    """'Year Fall' is legended as '# falls in past year' but is entered as a
    mix of floats and free text ('at least 2', 'na', ...). We parse what we
    confidently can and emit NaN for anything else -- never silently coerce
    text to 0."""
    if pd.isna(value):
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().lower()
    m = re.search(r"(\d+)", s)
    if "at least" in s and m:
        return float(m.group(1))  # lower bound; >=2 threshold is unaffected
    if m and re.fullmatch(r"\d+(\.\d+)?", s):
        return float(s)
    return float("nan")


def load_demographics() -> pd.DataFrame:
    controls = pd.read_excel(DEMOG_XLSX, sheet_name="Controls")
    fallers = pd.read_excel(DEMOG_XLSX, sheet_name="Fallers")
    controls["cohort_sheet"] = "Controls"
    fallers["cohort_sheet"] = "Fallers"
    df = pd.concat([controls, fallers], ignore_index=True)
    df = df.rename(columns={
        "#": "subject_id",
        "Year Fall ": "falls_year_raw",
        "6 Months Fall": "falls_6mo_raw",
    })
    df["subject_id"] = df["subject_id"].str.strip().str.upper()
    df["falls_year"] = df["falls_year_raw"].apply(_parse_falls)
    df["is_faller"] = df["falls_year"] >= 2  # NaN -> False; handled separately as "unknown"
    df["faller_label_known"] = df["falls_year"].notna()

    gender_col = next(c for c in df.columns if c.lower().startswith("gender"))
    female_first = "1-female" in gender_col.lower().replace(" ", "")
    if female_first:
        df["sex"] = df[gender_col].map({1: "F", 0: "M"})
    else:
        df["sex"] = df[gender_col].map({0: "M", 1: "F"})

    df["falls_year_raw"] = df["falls_year_raw"].astype(str)
    df["falls_6mo_raw"] = df["falls_6mo_raw"].astype(str)
    return df[["subject_id", "cohort_sheet", "Age", "sex", "falls_year_raw", "falls_year",
               "is_faller", "faller_label_known", "falls_6mo_raw"]]


def load_wear_report() -> pd.DataFrame:
    df = pd.read_excel(REPORT_XLSX)
    df.columns = [str(c).strip() for c in df.columns]
    id_col = df.columns[0]
    df = df.rename(columns={id_col: "subject_id"})
    df["subject_id"] = df["subject_id"].astype(str).str.strip().str.upper()
    return df


# ---------------------------------------------------------------------------
# WFDB header inspection (cheap: reads only .hea, not .dat)
# ---------------------------------------------------------------------------

def read_header(record_name: str, pn_dir: str | None = None, directory: Path = DATA_DIR) -> wfdb.Record:
    if pn_dir is not None:
        return wfdb.rdheader(record_name, pn_dir=pn_dir)
    return wfdb.rdheader(str(directory / record_name))


def build_subject_table() -> pd.DataFrame:
    three_day_records, lab_records = list_records()
    demog = load_demographics()

    three_day_subjects = {record_subject_id(r): r for r in three_day_records}
    lab_subjects = {record_subject_id(r): r for r in lab_records}

    all_ids = sorted(set(three_day_subjects) | set(lab_subjects) | set(demog["subject_id"]))
    rows = []
    for sid in all_ids:
        rows.append({
            "subject_id": sid,
            "has_3day": sid in three_day_subjects,
            "record_3day": three_day_subjects.get(sid),
            "has_labwalk": sid in lab_subjects,
            "record_labwalk": lab_subjects.get(sid),
            "has_demographics": sid in set(demog["subject_id"]),
        })
    table = pd.DataFrame(rows).merge(demog, on="subject_id", how="left")
    table["faller_label_known"] = table["faller_label_known"].map(lambda x: bool(x) if pd.notna(x) else False)
    table["is_faller"] = table["is_faller"].map(lambda x: bool(x) if pd.notna(x) else False)

    # per-record channel inspection (headers only, cheap)
    channels_col = []
    fs_col = []
    for _, row in table.iterrows():
        rec = row["record_labwalk"]
        if not rec:
            channels_col.append(None)
            fs_col.append(None)
            continue
        try:
            hdr = read_header(rec, directory=LABWALKS_DIR)
            channels_col.append(",".join(hdr.sig_name))
            fs_col.append(hdr.fs)
        except Exception as e:
            log.warning("failed to read header for %s: %s", rec, e)
            channels_col.append(None)
            fs_col.append(None)
    table["labwalk_channels"] = channels_col
    table["labwalk_fs"] = fs_col

    return table


def summarize(table: pd.DataFrame) -> None:
    n = len(table)
    log.info("subject table: %d unique subject IDs across all sources", n)

    both = table[table["has_3day"] & table["has_labwalk"]]
    only_3day = table[table["has_3day"] & ~table["has_labwalk"]]
    only_lab = table[~table["has_3day"] & table["has_labwalk"]]
    no_demog = table[~table["has_demographics"]]
    labeled = table[table["faller_label_known"] == True]  # noqa: E712

    log.info("has both 3-day + labwalk: %d", len(both))
    log.info("3-day only (no labwalk): %d -> %s", len(only_3day), only_3day["subject_id"].tolist())
    log.info("labwalk only (no 3-day): %d -> %s", len(only_lab), only_lab["subject_id"].tolist())
    log.info("no demographics row at all: %d -> %s", len(no_demog), no_demog["subject_id"].tolist())

    n_faller = int((labeled["is_faller"] == True).sum())  # noqa: E712
    n_nonfaller = int((labeled["is_faller"] == False).sum())  # noqa: E712
    log.info("subjects with a usable fall-count label: %d (faller=%d, non-faller=%d, ratio 1:%.2f)",
              len(labeled), n_faller, n_nonfaller, n_nonfaller / max(n_faller, 1))
    unlabeled = table[~table["faller_label_known"]]
    if len(unlabeled):
        log.info("subjects with NO usable fall count (dropped from labeled analysis): %s",
                  unlabeled["subject_id"].tolist())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    t = build_subject_table()
    out = DATA_DIR.parent / "cache" / "subject_table.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    t.to_parquet(out)
    log.info("wrote %s", out)
    summarize(t)
