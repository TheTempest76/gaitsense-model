"""Staged, resumable mirror of the PhysioNet LTMM database.

PhysioNet's open-access file server (https://physionet.org/files/ltmm/1.0.0/)
serves a plain Apache-style directory listing with no auth required and
Accept-Ranges: bytes on every file, so we implement our own tiny recursive
mirror instead of depending on system `wget`/`aws` being present.

Stages (see README for rationale on why the download is staged):
    metadata  -- top-level xlsx/RECORDS/SHA256SUMS files only (~0.08 MB)
    labwalks  -- the LabWalks/ subdirectory (~4.5 MB)
    full      -- the 3-day CO*/FL* .dat/.hea recordings (~20.8 GB).
                 Requires --confirm-full to run; will not be triggered
                 accidentally by rerunning this script.

Usage:
    python src/download.py --stage metadata
    python src/download.py --stage labwalks
    python src/download.py --stage full --confirm-full
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests

BASE_URL = "https://physionet.org/files/ltmm/1.0.0/"
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
CHUNK = 1024 * 1024  # 1 MiB
MAX_RETRIES = 5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("download")

_LISTING_RE = re.compile(r'<a href="([^"]+)">.*?(\d+)\s*$', re.MULTILINE)


@dataclass
class Entry:
    name: str
    url: str
    size: int
    is_dir: bool


def list_dir(url: str) -> list[Entry]:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    entries = []
    for name, size in _LISTING_RE.findall(resp.text):
        if name in ("../",):
            continue
        is_dir = name.endswith("/")
        entries.append(Entry(name=name.rstrip("/"), url=url + name, size=int(size), is_dir=is_dir))
    return entries


def download_file(url: str, dest: Path, expected_size: int | None = None) -> int:
    """Resumable download. Returns bytes written this call (0 if already complete)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    existing = dest.stat().st_size if dest.exists() else 0

    if expected_size is not None and existing == expected_size:
        return 0  # already complete

    headers = {}
    mode = "wb"
    if existing > 0 and (expected_size is None or existing < expected_size):
        headers["Range"] = f"bytes={existing}-"
        mode = "ab"
    elif existing > 0 and expected_size is not None and existing > expected_size:
        # stale/corrupt partial larger than expected -- restart clean
        log.warning("existing %s (%d) larger than expected (%d), redownloading", dest, existing, expected_size)
        existing = 0
        mode = "wb"

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with requests.get(url, headers=headers, stream=True, timeout=60) as resp:
                if resp.status_code == 416:
                    # server says range not satisfiable -> we already have it all
                    return 0
                resp.raise_for_status()
                written = 0
                with open(dest, mode) as f:
                    for chunk in resp.iter_content(chunk_size=CHUNK):
                        if chunk:
                            f.write(chunk)
                            written += len(chunk)
                return written
        except (requests.exceptions.RequestException, ConnectionError) as e:
            wait = min(2 ** attempt, 30)
            log.warning("attempt %d/%d failed for %s (%s); retrying in %ds", attempt, MAX_RETRIES, url, e, wait)
            time.sleep(wait)
            # recompute resume position in case a partial write happened
            existing = dest.stat().st_size if dest.exists() else 0
            headers["Range"] = f"bytes={existing}-"
            mode = "ab"
    raise RuntimeError(f"failed to download {url} after {MAX_RETRIES} attempts")


def mirror(entries: list[Entry], dest_root: Path, label: str, workers: int = 1) -> None:
    """workers>1 downloads files concurrently. PhysioNet's server appears to
    throttle per-connection throughput (~170 KB/s observed on a single
    stream), so a handful of concurrent connections meaningfully cuts wall
    time for the ~22 GB full stage. Kept modest (default single-file
    mirror() call sites still pass workers=1) so we're not hammering a
    public research data server."""
    files = [e for e in entries if not e.is_dir]
    total_bytes = sum(e.size for e in files)
    log.info("%s: %d files, %.2f MB total, %d worker(s)", label, len(files), total_bytes / 1e6, workers)

    progress_lock = threading.Lock()
    done_bytes = 0

    def _do_one(e: Entry):
        nonlocal done_bytes
        dest = dest_root / e.name
        before = dest.stat().st_size if dest.exists() else 0
        written = download_file(e.url, dest, expected_size=e.size)
        after = dest.stat().st_size if dest.exists() else 0
        with progress_lock:
            done_bytes += e.size
            status = "skip (complete)" if written == 0 and before == e.size else f"+{written/1e6:.2f}MB"
            log.info("[%s] %-40s %s (%d/%d bytes) -- %.1f%% of stage done",
                      label, e.name, status, after, e.size, 100 * done_bytes / max(total_bytes, 1))
        if after != e.size:
            log.error("size mismatch for %s: got %d expected %d", dest, after, e.size)

    if workers <= 1:
        for e in files:
            _do_one(e)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_do_one, e) for e in files]
            for fut in as_completed(futures):
                fut.result()  # re-raise any exception


def sha256sums(dest_root: Path) -> dict[str, str]:
    path = dest_root / "SHA256SUMS.txt"
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            parts = line.split()
            if len(parts) == 2:
                out[parts[1]] = parts[0]
    return out


def verify(dest_root: Path, names: list[str]) -> None:
    sums = sha256sums(dest_root)
    if not sums:
        log.info("no SHA256SUMS.txt available yet, skipping checksum verification")
        return
    for name in names:
        f = dest_root / name
        expected = sums.get(name) or sums.get(f"./{name}")
        if not f.exists() or expected is None:
            continue
        h = hashlib.sha256()
        with open(f, "rb") as fh:
            for chunk in iter(lambda: fh.read(CHUNK), b""):
                h.update(chunk)
        actual = h.hexdigest()
        if actual != expected:
            log.error("CHECKSUM MISMATCH: %s (expected %s, got %s)", name, expected, actual)
        else:
            log.info("checksum OK: %s", name)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stage", choices=["metadata", "labwalks", "full"], required=True)
    ap.add_argument("--confirm-full", action="store_true",
                     help="required to actually pull the ~20.8 GB 3-day recordings")
    ap.add_argument("--dest", default=str(DATA_DIR))
    ap.add_argument("--workers", type=int, default=1, help="concurrent downloads (only used for --stage full)")
    args = ap.parse_args()

    dest_root = Path(args.dest)
    dest_root.mkdir(parents=True, exist_ok=True)

    top = list_dir(BASE_URL)

    if args.stage == "metadata":
        meta_names = {"RECORDS", "ReportHome75h.xlsx", "ClinicalDemogData_COFL.xlsx", "SHA256SUMS.txt"}
        entries = [e for e in top if e.name in meta_names]
        mirror(entries, dest_root, "metadata")
        verify(dest_root, [e.name for e in entries])

    elif args.stage == "labwalks":
        lw_entries = list_dir(BASE_URL + "LabWalks/")
        mirror(lw_entries, dest_root / "LabWalks", "labwalks")

    elif args.stage == "full":
        if not args.confirm_full:
            log.error("Refusing to download the ~20.8 GB 3-day recordings without --confirm-full. "
                       "Run with --stage metadata and --stage labwalks first.")
            sys.exit(1)
        rec_entries = [e for e in top if not e.is_dir and (e.name.endswith(".dat") or e.name.endswith(".hea"))
                       and e.name not in ("RECORDS", "SHA256SUMS.txt")]
        mirror(rec_entries, dest_root, "full-3day", workers=args.workers)
        verify(dest_root, [e.name for e in rec_entries])

    log.info("stage '%s' complete", args.stage)


if __name__ == "__main__":
    main()
