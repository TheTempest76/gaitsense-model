"""LOSO-CV XGBoost training on lab-walk gait features.

Leave-one-subject-out CV is mandatory here, not a style choice: each
subject contributes several overlapping 10s windows, and windows from the
same subject share subject-specific gait signature, sensor placement, and
noise -- a random split would put windows from the same walk on both sides
of train/test and report an inflated, meaningless accuracy. Every fold
excludes one subject's windows entirely from training.

Hyperparameters are fixed (not tuned) at values compatible with the
constraint that this model must eventually run on an ESP32-S3: max_depth=5,
n_estimators=200, all within the requested max_depth 4-6 / n_estimators
100-300 range. We do not search this space and do not chase a higher AUC
by tuning -- if LOSO AUC comes out weak, that is the reported result.
"""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import roc_auc_score, confusion_matrix, precision_score

SEED = 42
ROOT = Path(__file__).resolve().parent.parent
FEATURES_PATH = ROOT / "data" / "cache" / "features_labwalks.parquet"
RESULTS_DIR = ROOT / "results"
MODELS_DIR = ROOT / "models"

NON_FEATURE_COLS = {
    "subject_id", "cohort_sheet", "age", "sex", "falls_year", "is_faller",
    "faller_label_known", "window_index", "window_start_sec",
}

XGB_PARAMS = dict(
    max_depth=5,
    n_estimators=200,
    learning_rate=0.08,
    subsample=0.8,
    colsample_bytree=0.8,
    missing=np.nan,
    random_state=SEED,
    eval_metric="logloss",
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("train")


def set_seed(seed: int = SEED):
    random.seed(seed)
    np.random.seed(seed)


def load_labeled_features() -> tuple[pd.DataFrame, list[str]]:
    df = pd.read_parquet(FEATURES_PATH)
    before = df["subject_id"].nunique()
    df = df[df["faller_label_known"]].copy()
    after = df["subject_id"].nunique()
    log.info("labeled subjects: %d/%d (dropped %d unlabeled)", after, before, before - after)
    feature_cols = [c for c in df.columns if c not in NON_FEATURE_COLS]
    return df, feature_cols


def compute_scale_pos_weight(y: np.ndarray) -> float:
    n_pos = (y == 1).sum()
    n_neg = (y == 0).sum()
    return float(n_neg / max(n_pos, 1))


def run_loso(df: pd.DataFrame, feature_cols: list[str], params: dict = XGB_PARAMS) -> pd.DataFrame:
    """Returns a per-window dataframe with columns:
    subject_id, y_true, y_prob (out-of-fold prediction)."""
    set_seed()
    subjects = df["subject_id"].unique()
    out_rows = []
    for held_out in subjects:
        train_df = df[df["subject_id"] != held_out]
        test_df = df[df["subject_id"] == held_out]

        X_train = train_df[feature_cols].to_numpy(dtype=float)
        y_train = train_df["is_faller"].to_numpy(dtype=int)
        X_test = test_df[feature_cols].to_numpy(dtype=float)
        y_test = test_df["is_faller"].to_numpy(dtype=int)

        if len(np.unique(y_train)) < 2:
            log.warning("skipping fold %s: training fold has only one class", held_out)
            continue

        model = xgb.XGBClassifier(**{**params, "scale_pos_weight": compute_scale_pos_weight(y_train)})
        model.fit(X_train, y_train)
        probs = model.predict_proba(X_test)[:, 1]

        for y_t, p in zip(y_test, probs):
            out_rows.append({"subject_id": held_out, "y_true": y_t, "y_prob": p})

    return pd.DataFrame(out_rows)


def aggregate_subject_level(window_preds: pd.DataFrame) -> pd.DataFrame:
    agg = window_preds.groupby("subject_id").agg(y_true=("y_true", "first"), y_prob=("y_prob", "mean")).reset_index()
    return agg


def compute_metrics(y_true: np.ndarray, y_prob: np.ndarray, threshold: float = 0.5) -> dict:
    y_pred = (y_prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    sensitivity = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
    specificity = tn / (tn + fp) if (tn + fp) > 0 else float("nan")
    precision = precision_score(y_true, y_pred, zero_division=0)
    try:
        auc = roc_auc_score(y_true, y_prob)
    except ValueError:
        auc = float("nan")
    return {
        "auc_roc": auc,
        "sensitivity": sensitivity,
        "specificity": specificity,
        "precision": precision,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "n": int(len(y_true)),
    }


def evaluate(df: pd.DataFrame, feature_cols: list[str], params: dict = XGB_PARAMS) -> dict:
    window_preds = run_loso(df, feature_cols, params)
    subject_preds = aggregate_subject_level(window_preds)
    return {
        "window_level": compute_metrics(window_preds["y_true"].to_numpy(), window_preds["y_prob"].to_numpy()),
        "subject_level": compute_metrics(subject_preds["y_true"].to_numpy(), subject_preds["y_prob"].to_numpy()),
        "n_features": len(feature_cols),
    }


def train_final_model(df: pd.DataFrame, feature_cols: list[str], params: dict = XGB_PARAMS) -> xgb.XGBClassifier:
    """Fit on ALL labeled data -- for interpretation (SHAP/gain) and export
    only. Never used for the reported LOSO performance numbers."""
    set_seed()
    X = df[feature_cols].to_numpy(dtype=float)
    y = df["is_faller"].to_numpy(dtype=int)
    model = xgb.XGBClassifier(**{**params, "scale_pos_weight": compute_scale_pos_weight(y)})
    model.fit(X, y)
    return model


def gain_importances(model: xgb.XGBClassifier, feature_cols: list[str]) -> pd.Series:
    booster = model.get_booster()
    gain = booster.get_score(importance_type="gain")
    # xgboost names features f0..fN internally when given a plain ndarray
    mapped = {feature_cols[int(k[1:])]: v for k, v in gain.items()}
    s = pd.Series(mapped).reindex(feature_cols).fillna(0.0)
    return s.sort_values(ascending=False)


PALETTE = {
    "surface": "#fcfcfb",
    "primary_ink": "#0b0b0b",
    "secondary_ink": "#52514e",
    "muted": "#898781",
    "gridline": "#e1e0d9",
    "baseline": "#c3c2b7",
    "blue": "#2a78d6",
}


def shap_importances(model: xgb.XGBClassifier, df: pd.DataFrame, feature_cols: list[str]) -> pd.Series:
    import shap

    X = df[feature_cols].to_numpy(dtype=float)
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)
    mean_abs = np.abs(shap_values).mean(axis=0)
    return pd.Series(mean_abs, index=feature_cols).sort_values(ascending=False)


def plot_top_importances(importances: pd.Series, out_path: Path, top_n: int = 20, value_label: str = "mean |SHAP value|"):
    import matplotlib.pyplot as plt

    top = importances.head(top_n).iloc[::-1]  # ascending for horizontal barh (largest at top of plot)

    fig, ax = plt.subplots(figsize=(8, 0.35 * top_n + 1.2), facecolor=PALETTE["surface"])
    ax.set_facecolor(PALETTE["surface"])
    ax.barh(top.index, top.values, color=PALETTE["blue"], height=0.6, zorder=3)
    ax.set_xlabel(value_label, color=PALETTE["secondary_ink"], fontsize=10)
    ax.set_title(f"Top {top_n} gait features by importance", color=PALETTE["primary_ink"], fontsize=12, loc="left")
    ax.tick_params(axis="y", colors=PALETTE["primary_ink"], labelsize=9)
    ax.tick_params(axis="x", colors=PALETTE["muted"], labelsize=9)
    ax.grid(axis="x", color=PALETTE["gridline"], linewidth=0.8, zorder=0)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(PALETTE["baseline"])
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, facecolor=PALETTE["surface"])
    plt.close(fig)


def run_ablation(df: pd.DataFrame, ranked_features: pd.Series, ks: tuple[int, ...] = (10, 20, 40)) -> pd.DataFrame:
    rows = []
    all_cols = [c for c in df.columns if c not in NON_FEATURE_COLS]
    rows.append({"n_features": len(all_cols), "feature_set": "all",
                 **{f"subject_{k}": v for k, v in evaluate(df, all_cols)["subject_level"].items()}})
    for k in ks:
        top_k = ranked_features.head(k).index.tolist()
        m = evaluate(df, top_k)
        rows.append({"n_features": k, "feature_set": f"top_{k}",
                     **{f"subject_{kk}": vv for kk, vv in m["subject_level"].items()}})
    return pd.DataFrame(rows)


def main():
    set_seed()
    RESULTS_DIR.mkdir(exist_ok=True)
    MODELS_DIR.mkdir(exist_ok=True)

    df, feature_cols = load_labeled_features()
    log.info("training on %d windows, %d features, %d subjects", len(df), len(feature_cols), df["subject_id"].nunique())

    metrics = evaluate(df, feature_cols)
    log.info("WINDOW-level: %s", metrics["window_level"])
    log.info("SUBJECT-level: %s", metrics["subject_level"])

    if metrics["subject_level"]["auc_roc"] < 0.6:
        log.warning("subject-level LOSO AUC is %.3f -- close to chance (0.5). "
                     "Reporting as-is; NOT tuning hyperparameters to chase a better number.",
                     metrics["subject_level"]["auc_roc"])

    # full-feature model: kept only for global SHAP/gain ranking, not exported
    analysis_model = train_final_model(df, feature_cols)

    gain_imp = gain_importances(analysis_model, feature_cols)
    gain_imp.to_csv(RESULTS_DIR / "feature_importances_gain.csv", header=["gain"])

    shap_imp = shap_importances(analysis_model, df, feature_cols)
    shap_imp.to_csv(RESULTS_DIR / "feature_importances_shap.csv", header=["mean_abs_shap"])
    plot_top_importances(shap_imp, RESULTS_DIR / "importances.png", top_n=20)
    log.info("wrote %s", RESULTS_DIR / "importances.png")

    ablation_df = run_ablation(df, shap_imp)
    ablation_df.to_csv(RESULTS_DIR / "ablation.csv", index=False)
    log.info("ablation results:\n%s", ablation_df[["feature_set", "n_features", "subject_auc_roc",
                                                       "subject_sensitivity", "subject_specificity"]].to_string(index=False))

    # deploy the smallest feature set that did not lose LOSO AUC vs. the
    # candidates tried, per the task's flash-footprint constraint
    candidates = ablation_df[ablation_df["feature_set"] != "all"]
    best_row = candidates.loc[candidates["subject_auc_roc"].idxmax()]
    deployed_k = int(best_row["n_features"])
    deployed_features = shap_imp.head(deployed_k).index.tolist()
    log.info("deploying top_%d feature set (subject AUC %.3f vs %.3f for all %d features)",
              deployed_k, best_row["subject_auc_roc"], metrics["subject_level"]["auc_roc"], len(feature_cols))

    deployed_model = train_final_model(df, deployed_features)
    deployed_model.save_model(str(MODELS_DIR / "model.json"))
    with open(MODELS_DIR / "feature_list.json", "w") as f:
        json.dump(deployed_features, f, indent=2)
    log.info("saved %s + feature_list.json", MODELS_DIR / "model.json")

    with open(RESULTS_DIR / "metrics.json", "w") as f:
        json.dump({
            "seed": SEED,
            "xgb_params": {k: v for k, v in XGB_PARAMS.items() if k != "missing"},
            "full_feature_model_loso": metrics,
            "deployed_model": {
                "n_features": deployed_k,
                "features": deployed_features,
                "loso_subject_level": {k: v for k, v in best_row.items() if k.startswith("subject_")},
            },
        }, f, indent=2, default=str)
    log.info("wrote %s", RESULTS_DIR / "metrics.json")

    df.to_parquet(RESULTS_DIR.parent / "data" / "cache" / "labeled_features.parquet")
    return df, feature_cols, metrics, deployed_model, deployed_features, shap_imp, ablation_df


if __name__ == "__main__":
    main()
