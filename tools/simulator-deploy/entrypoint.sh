#!/bin/sh
# Container entrypoint for the GaitSense device simulator.
#
# Env vars:
#   GAITSENSE_URL        (required) base URL of the deployed website,
#                        e.g. https://gait.example.com  -- no trailing slash
#   GAITSENSE_TOKEN      must equal the site's GAITSENSE_TOKEN env var
#   GAITSENSE_DEVICE_ID  device id shown on the dashboard (default gaitsense-sim01)
#   BACKFILL_DAYS        days of history to seed on first run (default 21, 0 = none)
#   FALLER_SHARE         0..1 fraction of days/bouts using the calibrated
#                        high-P(faller) gait profile (default 0.35)
#   SEED                 RNG seed (default 7)
#   STATE_DIR            dir for the "already backfilled" marker. Point it at a
#                        mounted volume (/data) so a restart doesn't replay
#                        history; on ephemeral disk every restart re-seeds.
#   EXTRA_ARGS           anything else appended verbatim, e.g. "--no-faller"
set -eu

if [ -z "${GAITSENSE_URL:-}" ]; then
    echo "FATAL: GAITSENSE_URL is not set (e.g. https://your-site.example.com)" >&2
    exit 1
fi

URL="${GAITSENSE_URL%/}"
COMMON="--url ${URL} --token ${GAITSENSE_TOKEN:-change-me} --device-id ${GAITSENSE_DEVICE_ID:-gaitsense-sim01} --faller-share ${FALLER_SHARE:-0.35} --seed ${SEED:-7}"
MARKER="${STATE_DIR:-/tmp}/.gaitsense-backfilled"

if [ "${BACKFILL_DAYS:-21}" -gt 0 ] 2>/dev/null && [ ! -f "${MARKER}" ]; then
    echo "seeding ${BACKFILL_DAYS} days of history -> ${URL}"
    # shellcheck disable=SC2086
    python tools/simulate_device.py ${COMMON} --backfill-days "${BACKFILL_DAYS}"
    mkdir -p "$(dirname "${MARKER}")" && touch "${MARKER}" || \
        echo "note: could not write ${MARKER}; a restart will re-seed history"
else
    echo "skipping backfill (BACKFILL_DAYS=${BACKFILL_DAYS:-21}, marker present: $([ -f "${MARKER}" ] && echo yes || echo no))"
fi

echo "streaming live -> ${URL}"
# shellcheck disable=SC2086
exec python tools/simulate_device.py ${COMMON} --live ${EXTRA_ARGS:-}
