"""
training/train_risk_model.py
─────────────────────────────
Full training pipeline for the attendance risk prediction model.

Pipeline:
  CSV data → feature matrix → StandardScaler → LogisticRegression
  → CalibratedClassifierCV (isotonic) → persist as .joblib

Evaluation:
  Stratified 5-fold CV + held-out test set
  Reports: accuracy, precision, recall, F1, AUC-ROC, confusion matrix

Why CalibratedClassifierCV?
  Raw logistic regression probabilities are already reasonably calibrated,
  but isotonic calibration on a held-out fold produces sharper,
  better-calibrated probabilities — important for the risk score display.
  Students and admins will see "Risk: 73%" — that number must be meaningful.

Run:
  python training/train_risk_model.py \
      --data data/training.csv \
      --model-out /app/models/risk_model.joblib \
      --eval

Re-train monthly as real data accumulates in MongoDB.
"""
import argparse
import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore", category=ConvergenceWarning)

FEATURE_COLS = [
    "overall_pct",
    "trend_delta_4w",
    "consecutive_absences",
    "days_since_last",
    "subjects_at_risk",
    "worst_subject_pct",
    "week_variance",
]
LABEL_COL = "label"


def load_data(path: str) -> tuple[np.ndarray, np.ndarray]:
    df = pd.read_csv(path)
    print(f"Loaded {len(df)} records from {path}")
    print(f"  At-risk: {df[LABEL_COL].sum()} ({df[LABEL_COL].mean()*100:.1f}%)")

    X = df[FEATURE_COLS].values.astype(float)
    y = df[LABEL_COL].values.astype(int)
    return X, y


def build_pipeline() -> Pipeline:
    """
    sklearn Pipeline:
      1. StandardScaler — zero-mean, unit-variance (LR is scale-sensitive)
      2. CalibratedClassifierCV — wraps LR with isotonic calibration
         using cross-val to prevent data leakage
    """
    lr = LogisticRegression(
        max_iter     = 1000,
        class_weight = "balanced",   # compensate for ~22% minority class
        C            = 1.0,
        solver       = "lbfgs",
        random_state = 42,
    )

    # Isotonic calibration: better than Platt (sigmoid) for our feature distribution
    calibrated = CalibratedClassifierCV(lr, method="isotonic", cv=3)

    return Pipeline([
        ("scaler",     StandardScaler()),
        ("classifier", calibrated),
    ])


def evaluate(pipeline: Pipeline, X_test: np.ndarray, y_test: np.ndarray) -> dict:
    y_pred  = pipeline.predict(X_test)
    y_proba = pipeline.predict_proba(X_test)[:, 1]

    metrics = {
        "accuracy":          round(accuracy_score(y_test, y_pred), 4),
        "auc_roc":           round(roc_auc_score(y_test, y_proba), 4),
        "confusion_matrix":  confusion_matrix(y_test, y_pred).tolist(),
        "classification_report": classification_report(
            y_test, y_pred,
            target_names=["safe", "at_risk"],
            output_dict=True,
        ),
    }

    return metrics


def cross_validate(pipeline: Pipeline, X: np.ndarray, y: np.ndarray, folds: int = 5) -> dict:
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
    scores = cross_val_score(pipeline, X, y, cv=cv, scoring="roc_auc", n_jobs=-1)
    return {
        "cv_auc_mean":  round(float(scores.mean()), 4),
        "cv_auc_std":   round(float(scores.std()), 4),
        "cv_folds":     folds,
    }


def print_results(metrics: dict, cv_metrics: dict) -> None:
    print("\n" + "═" * 55)
    print("  RISK MODEL EVALUATION")
    print("═" * 55)
    print(f"  Accuracy :  {metrics['accuracy']*100:.2f}%")
    print(f"  AUC-ROC  :  {metrics['auc_roc']:.4f}")
    print(f"  CV AUC   :  {cv_metrics['cv_auc_mean']:.4f} ± {cv_metrics['cv_auc_std']:.4f}")
    print()

    cr = metrics["classification_report"]
    for cls in ["safe", "at_risk"]:
        r = cr[cls]
        print(f"  [{cls:8s}]  P={r['precision']:.3f}  R={r['recall']:.3f}  F1={r['f1-score']:.3f}  N={int(r['support'])}")

    print()
    cm = np.array(metrics["confusion_matrix"])
    print(f"  Confusion matrix:")
    print(f"    TN={cm[0,0]:4d}  FP={cm[0,1]:4d}")
    print(f"    FN={cm[1,0]:4d}  TP={cm[1,1]:4d}")
    print("═" * 55)


def train(args: argparse.Namespace) -> None:
    print(f"\n🚀 Training risk model from {args.data}")

    X, y = load_data(args.data)

    # Hold out 20% for final evaluation
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=42
    )
    print(f"  Train: {len(X_train)}  Test: {len(X_test)}")

    pipeline = build_pipeline()

    print("  Fitting pipeline (StandardScaler + CalibratedLR)…")
    pipeline.fit(X_train, y_train)

    if args.eval:
        print("  Running 5-fold cross-validation…")
        cv_metrics = cross_validate(pipeline, X_train, y_train)
        metrics    = evaluate(pipeline, X_test, y_test)
        print_results(metrics, cv_metrics)

        # Persist metrics alongside the model
        all_metrics = {**metrics, **cv_metrics, "feature_names": FEATURE_COLS}
        metrics_path = Path(args.model_out).with_suffix(".metrics.joblib")
        joblib.dump(all_metrics, metrics_path)
        print(f"  Metrics saved → {metrics_path}")

    # Persist the pipeline
    out = Path(args.model_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, out)
    print(f"\n✅ Model saved → {out}  ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train the attendance risk prediction model")
    parser.add_argument("--data",      default="data/training.csv",          help="Training CSV path")
    parser.add_argument("--model-out", default="/app/models/risk_model.joblib", help="Output model path")
    parser.add_argument("--eval",      action="store_true",                   help="Run full evaluation")
    args = parser.parse_args()
    train(args)
