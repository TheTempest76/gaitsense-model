# Runs tools/simulate_device.py as a standalone always-on "device" that POSTs
# synthetic-but-real readings to a deployed GaitSense website.
#
# BUILD FROM THE REPO ROOT (it needs src/, models/, tools/):
#   docker build -f tools/simulator-deploy/Dockerfile -t gaitsense-sim .
#
# RUN:
#   docker run --rm -e GAITSENSE_URL=https://your-site.example.com \
#     -e GAITSENSE_TOKEN=your-secret gaitsense-sim
#
# The render.yaml / fly.toml next to this file wire the same image into a
# hosted always-on worker; see README.md.

FROM python:3.11-slim

# xgboost's wheel needs libgomp at runtime; nothing here needs a compiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY tools/simulator-deploy/requirements-sim.txt .
RUN pip install --no-cache-dir -r requirements-sim.txt

# Only the pieces the simulate -> features -> score path touches.
COPY src/ ./src/
COPY models/model.json models/feature_list.json ./models/
COPY tools/simulate_device.py ./tools/simulate_device.py
COPY tools/simulator-deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# All configuration is via env vars (see entrypoint.sh for the full list).
# GAITSENSE_URL and GAITSENSE_TOKEN are supplied at run time, not baked in.
ENV GAITSENSE_DEVICE_ID="gaitsense-sim01" \
    BACKFILL_DAYS="21" \
    FALLER_SHARE="0.35" \
    SEED="7" \
    STATE_DIR="/tmp" \
    EXTRA_ARGS=""

ENTRYPOINT ["./entrypoint.sh"]
