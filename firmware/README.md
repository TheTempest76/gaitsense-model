# GaitSense ESP32 node

ESP-IDF firmware for a lower-back wearable that samples a triaxial
accelerometer at 100 Hz, computes the ten features the deployed model uses,
scores them **on-device** with the exported `models/model.c`, and POSTs the
result to the website in `../web`.

```
MPU6050 @100 Hz ──▶ ring buffer ──▶ 10 s window (50% overlap, one every 5 s)
                                      │
                                      ├─▶ gait_extract()   10 features
                                      ├─▶ walking gate     (not optional, see below)
                                      ├─▶ score()          models/model.c
                                      └─▶ POST /api/ingest
```

## Read this before you trust a number

The model this firmware runs has a **leave-one-subject-out AUC of 0.592**.
Chance is 0.5. It classifies whether someone *had already reported two or more
falls in the year before they were recorded* — it is a retrospective
classifier of fall history and **cannot predict a future fall**. The root
`README.md` explains why in detail, including the likely sensor-orientation
confound in its strongest features.

The step count, cadence and walking-time figures are direct measurements and
are the trustworthy output of this device. Treat the probability as a research
readout.

## Hardware

| | |
|---|---|
| MCU | ESP32 or ESP32-S3 with **4 MB flash or more** (see partition note below) |
| IMU | MPU6050 (6-axis, I²C) |
| Mounting | Lower back, at approximately L5, firmly strapped — a loose sensor invalidates every feature |

Default wiring (changeable in `menuconfig`):

| MPU6050 | ESP32 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |
| AD0 | GND (I²C address 0x68) |

## Build and flash

Requires **ESP-IDF v5.2 or newer** — `mpu6050.c` uses the `i2c_master` driver
that replaced the deprecated `driver/i2c.h` API in 5.2.

```bash
cd firmware
idf.py set-target esp32s3        # or esp32
idf.py menuconfig                # → GaitSense: Wi-Fi, server URL, token, wiring, orientation
idf.py build flash monitor
```

At minimum set, under **GaitSense**:

- `Wi-Fi → SSID` / `password`
- `Server → Dashboard base URL` — the LAN IP of the machine running the
  website, e.g. `http://192.168.1.100:8000`. Not `localhost`: on the ESP32,
  localhost is the ESP32.
- `Server → Device token` — must equal the `GAITSENSE_TOKEN` environment
  variable the server runs with, or ingest returns 401.

`models/model.c` is compiled **directly out of the repo's `models/`
directory** (see `main/CMakeLists.txt`), not copied here. Re-running
`python src/export.py` after a retrain updates the firmware with no file
shuffling — just rebuild.

### Partition table

`model.c` is ~250 KB of generated source, which pushes the app past the
default 1 MB factory partition. `partitions.csv` gives the app 2 MB and is
selected by `sdkconfig.defaults`. This needs a 4 MB flash part or larger.

Check the real cost on your target with `idf.py size` — the estimate in
`results/export_footprint.json` is a heuristic from source size, not a
compiled measurement.

## Setting the axis mapping — do not skip this

The training data has named anatomical axes (vertical / mediolateral /
anterior-posterior); the MPU6050 only knows X, Y and Z. Which is which depends
entirely on how you mount the board, so it is a configuration item:
`GAITSENSE_AXIS_V` / `_ML` / `_AP`, each `0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z`.

On boot the firmware averages a second of samples and logs what it sees:

```
I (1234) gaitsense: at-rest means: X=+0.021 Y=-0.043 Z=+0.998 g
I (1240) gaitsense: mapped: vertical=+Z (+0.998) ml=+X (+0.021) ap=+Y (-0.043) g
```

The vertical channel must read about **+1 g at rest** (the saved training
vector has `vertical_mean = 0.929`). If it does not, the firmware warns and
you should fix the mapping — features computed on a mis-mapped sensor are out
of distribution, and the model will produce confident nonsense from them.

## Why there is a walking gate

`is_walking()` in `main.c` requires movement energy (`magnitude_std >= 0.06 g`),
at least 8 steps in the window, and a cadence between 40 and 200 steps/min
before a window is scored at all.

This is not defensive padding. Step detection alone cannot distinguish walking
from stillness, because the peak detector's prominence threshold is
*relative* to the signal's own standard deviation (`0.15 * std`), so it scales
down with the noise floor and keeps finding "steps" in a motionless sensor.
The repo's own conformance fixture demonstrates the consequence: its
`standing_still` case — gravity plus 0.002 g of noise — yields **22 detected
steps** and the model scores it **P(faller) = 0.89**.

The model was trained only on supervised lab walks. Anything else is
out-of-distribution input and the output is meaningless.

## Why NaN windows are not scored

A window is scored only when **all ten features are finite**. This is a
correctness requirement, not caution.

`src/features.py` deliberately emits `NaN` (never 0, never a dropped row) when
a feature cannot be computed — fewer than 4 detected steps makes
`step_time_mean` NaN, fewer than 5 makes `harmonic_ratio_ml` NaN — and the
Python model handles those correctly via XGBoost's `missing=np.nan`, which
learns a split direction for missing values.

**m2cgen does not reproduce that.** The generated `model.c` emits a bare
`if (input[i] < threshold) { ... } else { ... }`, and in C a comparison against
NaN is always false — so a NaN silently takes the right-hand branch of every
split it touches, regardless of which way the model was trained to send it.
Rather than emit a number that quietly disagrees with the trained model, the
firmware declines to score and reports `scored: false`.

## Verifying the C feature port against Python

`main/gait_features.c` is a hand-written C port of the SciPy pipeline in
`src/features.py` — Butterworth `filtfilt`, `find_peaks` with prominence,
Welch PSD, and the harmonic ratio. Small differences there would produce
features that look plausible but sit in a different distribution from the
training data, so the port is checked against the reference rather than
eyeballed.

`gait_features.c` has no ESP-IDF dependency for exactly this reason: it
compiles for the host.

```bash
# 1. generate the fixture from the real training-time extractor
python tools/gen_conformance_case.py

# 2. build and run the C side (gcc via Docker; no host toolchain needed)
docker run --rm -v "$(pwd):/w" -w /w gcc:latest bash -c \
  "gcc -O2 -I firmware/main -I models -o /tmp/t \
     firmware/main/gait_features.c firmware/test/test_features.c models/model.c -lm \
   && /tmp/t firmware/test/cases.txt" > /tmp/c_out.json

# 3. diff it
python tools/check_conformance.py < /tmp/c_out.json
```

Current result — eight windows covering normal, brisk, slow-shuffling,
asymmetric and noisy gait plus three degenerate cases, checking features, step
counts, NaN agreement **and** the end-to-end probability:

```
PASS  normal_gait        steps= 18 max_rel_err=1.28e-15  P(faller)=0.010725 (dP=5.73e-09)
PASS  brisk_gait         steps= 23 max_rel_err=1.81e-15  P(faller)=0.102946 (dP=1.52e-08)
PASS  slow_shuffle       steps= 11 max_rel_err=2.60e-15  P(faller)=0.020394 (dP=7.32e-09)
PASS  asymmetric_gait    steps= 17 max_rel_err=2.19e-15  P(faller)=0.011295 (dP=8.70e-09)
PASS  noisy_gait         steps= 20 max_rel_err=2.28e-15  P(faller)=0.004295 (dP=4.96e-09)
PASS  standing_still     steps= 22 max_rel_err=8.91e-15  P(faller)=0.889671 (dP=1.19e-07)
PASS  pure_noise         steps= 24 max_rel_err=4.21e-15  P(faller)=0.398540 (dP=6.16e-09)
PASS  flat_dc            steps=  2 max_rel_err=2.07e-14  not scoreable

PASS: all 8 cases match the Python reference (rtol=1e-09)
```

The fixture quantises its reference input to float32 before running the Python
side, because the firmware buffers samples as `float`. Without that the
comparison is dominated by input rounding (~1e-9 relative) instead of testing
the algorithm.

## Files

| File | What it is |
|---|---|
| `main/main.c` | Tasks, windowing, walking gate, on-device scoring, upload queue |
| `main/gait_features.c/.h` | The C port of the feature pipeline (host-testable, no IDF deps) |
| `main/mpu6050.c/.h` | Accelerometer driver, fixed at 100 Hz / ±4 g / DLPF 44 Hz |
| `main/net.c/.h` | Wi-Fi, SNTP, and the `/api/ingest` POST |
| `main/Kconfig.projbuild` | Everything exposed in `idf.py menuconfig` |
| `test/test_features.c` | Host conformance harness |
| `test/cases.txt`, `test/expected.json` | Generated fixture (regenerate, don't hand-edit) |

## Notes on the implementation

- **Sample clock.** An `esp_timer` ISR ticks a semaphore at exactly 100 Hz
  rather than the sampling task using `vTaskDelay`. Step timing is a model
  input, so a sample clock that drifted with I²C latency would bias
  `step_time_mean` directly.
- **No FFT library.** Both spectral features need only a handful of bins out
  of a 400- or 1000-point transform, so a direct partial DFT is used. 1000 is
  not a power of two, and the worst case is ~5×10⁵ multiply-adds — a few tens
  of milliseconds once every 5 s.
- **Doubles.** The feature code uses `double` throughout to match the Python.
  The ESP32 FPU is single-precision, so this is software-emulated; the
  analysis task gets an 8 KB stack and its own core. Window processing is
  logged with its duration — watch for it approaching the 5 s hop.
- **Reboots.** `steps_total` restarts at zero. The server detects the
  counter going backwards and treats the new value as fresh steps rather than
  a negative delta.
- **Offline.** Readings queue in RAM (64 windows, ~5 minutes) and are retried;
  when the queue fills, the oldest is dropped so the dashboard keeps showing
  the most recent minutes.
