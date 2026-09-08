#!/usr/bin/env bash
# Keeps tools/simulate_device.py running continuously (Linux/macOS/WSL/Git
# Bash equivalent of run_simulator_loop.ps1 -- see that file's header for
# what this is and isn't for).
#
# Usage:
#   ./tools/run_simulator_loop.sh
#   URL=http://192.168.1.50:3000 TOKEN=my-secret ./tools/run_simulator_loop.sh
#
# To actually survive a terminal closing, run this under nohup/screen/tmux,
# e.g.:  nohup ./tools/run_simulator_loop.sh > /dev/null 2>&1 &

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="${URL:-http://127.0.0.1:3000}"
TOKEN="${TOKEN:-change-me}"
DEVICE_ID="${DEVICE_ID:-gaitsense-sim01}"
RESTART_DELAY="${RESTART_DELAY:-5}"
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/simulator.log}"

PYTHON="$SCRIPT_DIR/../.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
    # Windows venv layout (Git Bash), then a PATH fallback.
    PYTHON="$SCRIPT_DIR/../.venv/Scripts/python.exe"
fi
if [ ! -x "$PYTHON" ]; then
    echo "venv python not found under .venv/ -- falling back to 'python' on PATH"
    PYTHON="python"
fi

echo "Starting simulator loop -> $URL (device $DEVICE_ID). Logging to $LOG_FILE. Ctrl+C to stop."

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting simulate_device.py --live" >> "$LOG_FILE"

    "$PYTHON" "$SCRIPT_DIR/simulate_device.py" \
        --url "$URL" --token "$TOKEN" --device-id "$DEVICE_ID" --live >> "$LOG_FILE" 2>&1

    code=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] simulate_device.py exited (code $code) -- restarting in ${RESTART_DELAY}s" \
        | tee -a "$LOG_FILE"
    sleep "$RESTART_DELAY"
done
