# Setup instructions

Three things to set up: the Python model pipeline (already trained, only
needed if you retrain), the website, and the ESP32 firmware. Do the website
first — you can run and click through the whole dashboard with simulated data
before any hardware is involved.

## 0. Prerequisites

- **Python 3.11+** with the project venv. From the repo root:
  ```bash
  uv venv
  uv pip install -r requirements.txt
  ```
  (or `python -m venv .venv` + `pip install -r requirements.txt` if you don't
  use `uv`)
- **Docker Desktop** — only needed if you touch `firmware/main/gait_features.c`
  and want to re-run the C/Python conformance check. Not needed to run the
  website or flash firmware.
- **ESP-IDF v5.2+** — only needed to build and flash the firmware. See §3.

---

## 1. Website

```bash
uv pip install -r web/requirements-web.txt

# must match GAITSENSE_DEVICE_TOKEN you'll set in the firmware later
export GAITSENSE_TOKEN=some-shared-secret        # PowerShell: $env:GAITSENSE_TOKEN="some-shared-secret"

uvicorn web.server.app:app --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>.

- Bind to `0.0.0.0`, not `127.0.0.1` — the ESP32 needs to reach this over the
  LAN. Allow port 8000 through the host firewall if the device can't connect.
- The database is created at `web/gaitsense.db` on first run (override the
  path with `GAITSENSE_DB`). It's gitignored — nothing to clean up.

### Try it without hardware

```bash
python tools/simulate_device.py --backfill-days 21 --live
```

This posts real synthetic readings (real features, real model scores, real
walking-gate logic) so you can see the dashboard fully populated — 21 days of
history, then a new window every 5 seconds. Stop with Ctrl+C; it doesn't
affect anything the firmware would send later.

To start clean again, just delete `web/gaitsense.db*` and restart the server.

---

## 2. Retraining or re-exporting the model (optional)

Skip this section unless you're changing the model. The repo ships a trained
model already (`models/model.json`, `models/model.c`).

```bash
python src/download.py --stage metadata
python src/download.py --stage labwalks
python src/load.py       # -> data/cache/subject_table.parquet
python src/features.py   # -> data/cache/features_labwalks.parquet
python src/train.py      # -> models/model.json, results/*
python src/export.py     # -> models/model.c, model.h, test_harness.c
```

If you change `src/features.py`, regenerate and check the firmware's C port
against it (see §4) before flashing — the two must agree.

---

## 3. ESP32 firmware

### Hardware

- ESP32 or ESP32-S3 board with **4 MB flash or more**
- MPU6050 6-axis IMU
- Wired I²C, default pins (changeable in menuconfig):

  | MPU6050 | ESP32 |
  |---|---|
  | VCC | 3V3 |
  | GND | GND |
  | SDA | GPIO 21 |
  | SCL | GPIO 22 |
  | AD0 | GND |

- Mount the sensor at the lower back (~L5), strapped firmly — a loose sensor
  invalidates every feature.

### Install ESP-IDF (v5.2 or newer — required)

Follow Espressif's official install guide for your OS:
<https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html>

On Windows, the easiest path is the **ESP-IDF Windows Installer**, which sets
up the toolchain and an "ESP-IDF PowerShell" / "ESP-IDF Command Prompt" shell
with everything on `PATH`. Run the rest of this section from that shell.

Confirm it's on PATH:

```bash
idf.py --version
```

### Configure

```bash
cd firmware
idf.py set-target esp32s3        # or esp32, matching your board
idf.py menuconfig
```

Under **GaitSense**, set at minimum:

| Setting | Value |
|---|---|
| Wi-Fi → SSID / password | your network |
| Server → Dashboard base URL | `http://<LAN IP of the machine running the website>:8000` — **not** `localhost` |
| Server → Device token | must equal `GAITSENSE_TOKEN` from §1, or ingest returns 401 |
| Sensor orientation → Vertical / ML / AP axis | leave at defaults first; the firmware logs at-rest axis means at boot so you can check and correct them |

### Build and flash

```bash
idf.py build
idf.py -p <PORT> flash monitor
```

`<PORT>` is the board's serial port (`COM3`, `/dev/ttyUSB0`, etc. — `idf.py`
will usually detect it if you omit `-p`).

Watch the boot log for the orientation check:

```
I (1234) gaitsense: at-rest means: X=+0.021 Y=-0.043 Z=+0.998 g
I (1240) gaitsense: mapped: vertical=+Z (+0.998) ml=+X (+0.021) ap=+Y (-0.043) g
```

The vertical channel should read **about +1 g** at rest. If it doesn't, fix
`GAITSENSE_AXIS_V/ML/AP` in menuconfig and reflash — a wrong mapping means the
model sees out-of-distribution input.

Exit the monitor with `Ctrl+]`.

### Verify it's reporting

With the website running (§1) and the device powered and connected, its card
should appear on the dashboard within ~5 seconds, and the "Devices" section at
the bottom should show it online.

---

## 4. Firmware conformance check (optional, only if you edit `gait_features.c`)

Confirms the C feature port still matches the Python reference in
`src/features.py`. Needs Docker Desktop running (no local C toolchain
required — it builds in a throwaway `gcc:latest` container).

```bash
python tools/gen_conformance_case.py

docker run --rm -v "$(pwd):/w" -w /w gcc:latest bash -c \
  "gcc -O2 -I firmware/main -I models -o /tmp/t \
     firmware/main/gait_features.c firmware/test/test_features.c models/model.c -lm \
   && /tmp/t firmware/test/cases.txt" > /tmp/c_out.json

python tools/check_conformance.py < /tmp/c_out.json
```

Expect `PASS` on all 8 cases, worst relative error ~1e-14 and worst
probability difference ~1e-7. A failure here means the C and Python diverge —
do not flash until it passes.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Device never appears on the dashboard | Wrong `GAITSENSE_SERVER_URL` (must be LAN IP, not `localhost`), firewall blocking port 8000, or Wi-Fi credentials wrong — check the firmware's serial monitor log |
| Ingest returns 401 | `GAITSENSE_DEVICE_TOKEN` (firmware) and `GAITSENSE_TOKEN` (server env) don't match |
| Dashboard shows a "Model mismatch" banner | Firmware was flashed from an older `models/model.c` than the server's current `models/model.json` — rebuild and reflash after any retrain |
| Every window reports "not scored" | Check the boot-time axis mean log — if the vertical channel isn't ~+1 g, the walking gate and features are being computed on the wrong axis |
| `idf.py` not found | ESP-IDF environment not sourced — use the ESP-IDF shell/installer, or run `. $IDF_PATH/export.sh` (Linux/macOS) first |
