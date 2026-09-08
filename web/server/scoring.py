"""Server-side recomputation of P(faller), used only as a drift check.

Inference runs on the device: the firmware compiles models/model.c and posts the
probability it computed. This module re-scores the posted feature vector with
the Python booster so that a mismatch between the flashed model and
models/model.json shows up in the dashboard instead of silently changing what
the numbers mean after a retrain.

If xgboost is unavailable the check simply switches off -- it is diagnostic,
not load-bearing.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger("scoring")

ROOT = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = ROOT / "models"


class ServerScorer:
    def __init__(self) -> None:
        self.available = False
        self._model = None
        self._n_features = 0
        try:
            import numpy as np  # noqa: F401
            import xgboost as xgb

            model = xgb.XGBClassifier()
            model.load_model(str(MODELS_DIR / "model.json"))
            # XGBoost >= 2.0 round-trips base_score as the string "5E-1"; the
            # same coercion src/export.py applies before the m2cgen export.
            model.set_params(base_score=float(model.get_params()["base_score"]))

            self._model = model
            self._n_features = len(json.loads((MODELS_DIR / "feature_list.json").read_text()))
            self.available = True
        except Exception as e:
            log.warning("server-side scoring disabled (%s); device scores are "
                        "still stored and displayed", e)

    def score(self, features: list[float | None]) -> float | None:
        """P(faller) for one feature vector, or None if it cannot be scored."""
        if not self.available or self._model is None:
            return None
        if len(features) != self._n_features:
            log.warning("expected %d features, got %d", self._n_features, len(features))
            return None
        # A None here is a NaN the firmware refused to score on; the device
        # would not have sent scored=true, so this should not happen.
        if any(f is None for f in features):
            return None

        import numpy as np

        x = np.asarray([features], dtype=float)
        return float(self._model.predict_proba(x)[0, 1])
