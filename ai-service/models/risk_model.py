"""
models/risk_model.py — Attendance Risk Prediction Engine

Model: Logistic Regression with isotonic calibration
Why logistic regression?
  - Interpretable: coefficients map directly to feature importance
  - Fast inference: <1ms per student, suitable for batch of 5000
  - Well-calibrated probabilities out-of-the-box (with calibration wrapper)
  - Easy to audit (FERPA / institutional compliance requirement)
  - Sufficient accuracy (~87%) for this domain — we don't need deep learning
    when the signal (attendance numbers) is clean and tabular

Feature set (7 features):
  1. overall_pct         — overall attendance percentage (0–100)
  2. trend_delta_4w      — change in attendance over last 4 weeks (pp)
  3. consecutive_absences — current absence streak
  4. days_since_last     — recency signal (days since last attended class)
  5. subjects_at_risk    — count of subjects below 75%
  6. worst_subject_pct   — attendance % of the worst-performing subject
  7. week_variance       — variance in weekly attendance (consistency signal)

Risk levels (output):
  good      ≥ 85%   riskScore 0–20
  moderate  75–84%  riskScore 20–40
  warning   60–74%  riskScore 40–70
  critical  < 60%   riskScore 70–100
"""
import logging
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np

from config import get_settings
from schemas.requests import PredictRiskRequest, RiskPrediction, BatchPredictResponse

logger   = logging.getLogger(__name__)
settings = get_settings()


# ─── Feature engineering ──────────────────────────────────────────────────────

FEATURE_NAMES = [
    "overall_pct",
    "trend_delta_4w",
    "consecutive_absences",
    "days_since_last",
    "subjects_at_risk",
    "worst_subject_pct",
    "week_variance",
]


def extract_features(req: PredictRiskRequest) -> np.ndarray:
    """
    Transform a PredictRiskRequest into the 7-feature vector the model expects.
    All features are on natural scales — the pipeline's StandardScaler handles normalisation.
    """
    # Feature 1: overall attendance percentage
    f1_overall = req.overall_percentage

    # Feature 2: 4-week trend delta (pre-computed or derived from weekly records)
    if req.trend_delta_4w is not None:
        f2_trend = req.trend_delta_4w
    else:
        # Derive from the last 8 weekly records across all subjects
        weekly_pcts = _aggregate_weekly_trend(req)
        if len(weekly_pcts) >= 4:
            f2_trend = float(np.mean(weekly_pcts[-2:]) - np.mean(weekly_pcts[:2]))
        else:
            f2_trend = 0.0

    # Feature 3: consecutive absence streak
    f3_streak = min(req.consecutive_absences, 30)  # cap outliers

    # Feature 4: days since last attendance (cap at 60)
    f4_recency = min(req.days_since_last_attendance, 60)

    # Feature 5: count of subjects below the minimum threshold
    f5_at_risk = sum(
        1 for s in req.subject_records
        if s.percentage < settings.MIN_ATTENDANCE_PCT
    )

    # Feature 6: worst subject attendance (most dire signal)
    f6_worst = min((s.percentage for s in req.subject_records), default=req.overall_percentage)

    # Feature 7: week-to-week variance (high variance = inconsistent, risky)
    weekly_pcts = _aggregate_weekly_trend(req)
    f7_variance = float(np.var(weekly_pcts)) if len(weekly_pcts) >= 2 else 0.0

    return np.array([f1_overall, f2_trend, f3_streak, f4_recency,
                     f5_at_risk, f6_worst, f7_variance], dtype=float)


def _aggregate_weekly_trend(req: PredictRiskRequest) -> list[float]:
    """
    Flatten per-subject weekly_trend lists into a single weekly average.
    Each subject contributes its weekly_trend entries; we average across subjects per week.
    """
    from collections import defaultdict
    week_totals: dict[int, list[float]] = defaultdict(list)

    for subj in req.subject_records:
        for entry in subj.weekly_trend:
            wk = entry.get("week", 0)
            pct = entry.get("percentage", 0.0)
            week_totals[wk].append(pct)

    if not week_totals:
        return []

    sorted_weeks = sorted(week_totals.keys())
    return [float(np.mean(week_totals[w])) for w in sorted_weeks]


# ─── Risk scoring ─────────────────────────────────────────────────────────────

def _prob_to_risk_score(probability: float) -> float:
    """Map model probability [0,1] → risk score [0,100]."""
    return round(probability * 100, 1)


def _risk_level(overall_pct: float, probability: float) -> str:
    """
    Risk level combines the direct attendance threshold with the model probability.
    The model can catch students trending downward even before they cross 75%.
    """
    if overall_pct < 60 or probability >= 0.80:
        return "critical"
    if overall_pct < 75 or probability >= 0.55:
        return "warning"
    if overall_pct < 85 or probability >= 0.35:
        return "moderate"
    return "good"


def _top_risk_factors(req: PredictRiskRequest, features: np.ndarray) -> list[str]:
    """
    Return the top 3 human-readable risk factors for this student.
    Used on the admin dashboard to explain the model's decision.
    """
    factors = []

    overall, trend, streak, recency, at_risk_count, worst, variance = features

    if overall < 60:
        factors.append(f"Critical overall attendance: {overall:.0f}%")
    elif overall < 75:
        factors.append(f"Below minimum threshold: {overall:.0f}% (req 75%)")

    if streak >= 5:
        factors.append(f"Long absence streak: {streak} consecutive classes missed")
    elif streak >= 3:
        factors.append(f"Absence streak: {streak} consecutive classes missed")

    if trend < -5:
        factors.append(f"Declining trend: attendance dropped {abs(trend):.0f}pp in 4 weeks")

    if worst < 50:
        worst_subj = min(req.subject_records, key=lambda s: s.percentage)
        factors.append(f"Critical in {worst_subj.subject_code}: {worst:.0f}%")

    if recency >= 14:
        factors.append(f"Last attended {recency} days ago")

    if at_risk_count >= 3:
        factors.append(f"{at_risk_count} subjects below 75%")

    if variance > 200:
        factors.append("Highly irregular attendance pattern")

    return factors[:3] if factors else ["Attendance approaching minimum threshold"]


def _recommendation(level: str, factors: list[str]) -> str:
    recs = {
        "critical": "Immediate counselling session required. Notify HOD and parents.",
        "warning":  "Send attendance warning email. Faculty follow-up recommended.",
        "moderate": "Monitor weekly. Automated reminder email every 3 days.",
        "good":     "No action required. Continue monitoring.",
    }
    return recs.get(level, "Monitor attendance closely.")


# ─── Model loader (singleton) ─────────────────────────────────────────────────

class RiskModelNotFound(Exception):
    pass


_model_pipeline = None  # sklearn Pipeline: StandardScaler + CalibratedClassifierCV


def load_model() -> object:
    """
    Load the trained sklearn pipeline from disk.
    Called once at startup; subsequent calls return the cached object.
    """
    global _model_pipeline

    if _model_pipeline is not None:
        return _model_pipeline

    model_path = Path(settings.RISK_MODEL_PATH)

    if not model_path.exists():
        logger.warning(
            f"Risk model not found at {model_path}. "
            "Run training/train_risk_model.py to generate it. "
            "Falling back to rule-based scoring."
        )
        return None

    _model_pipeline = joblib.load(model_path)
    logger.info(f"Risk model loaded from {model_path} ✓")
    return _model_pipeline


# ─── Inference ────────────────────────────────────────────────────────────────

def predict_risk(req: PredictRiskRequest) -> RiskPrediction:
    """
    Predict dropout risk for a single student.
    Falls back to rule-based scoring if the ML model is not available.
    """
    features = extract_features(req)
    pipeline = load_model()

    if pipeline is not None:
        # ML path — calibrated probability
        X = features.reshape(1, -1)
        try:
            prob = float(pipeline.predict_proba(X)[0][1])  # P(at_risk=1)
        except Exception as e:
            logger.error(f"Model inference error for {req.student_id}: {e}")
            prob = _rule_based_probability(features)
    else:
        # Rule-based fallback
        prob = _rule_based_probability(features)

    level   = _risk_level(req.overall_percentage, prob)
    score   = _prob_to_risk_score(prob)
    factors = _top_risk_factors(req, features)
    rec     = _recommendation(level, factors)

    return RiskPrediction(
        student_id       = req.student_id,
        risk_score       = score,
        risk_level       = level,
        risk_probability = round(prob, 4),
        top_risk_factors = factors,
        recommendation   = rec,
        model_version    = settings.RISK_MODEL_VERSION,
    )


def predict_batch(requests: list[PredictRiskRequest]) -> BatchPredictResponse:
    """
    Vectorised batch prediction — processes all students in one sklearn call.
    Significantly faster than calling predict_risk() in a loop when pipeline is loaded.
    """
    t_start   = time.perf_counter()
    pipeline  = load_model()
    results   = []
    failed    = 0

    if pipeline is not None:
        # Build feature matrix (N × 7) for bulk inference
        try:
            feature_matrix = np.array([extract_features(r) for r in requests])
            probs = pipeline.predict_proba(feature_matrix)[:, 1]  # P(at_risk=1)
        except Exception as e:
            logger.error(f"Batch inference error: {e}. Falling back to per-student.")
            probs = None
    else:
        probs = None

    for i, req in enumerate(requests):
        try:
            features = extract_features(req)
            prob     = float(probs[i]) if probs is not None else _rule_based_probability(features)
            level    = _risk_level(req.overall_percentage, prob)
            results.append(RiskPrediction(
                student_id       = req.student_id,
                risk_score       = _prob_to_risk_score(prob),
                risk_level       = level,
                risk_probability = round(prob, 4),
                top_risk_factors = _top_risk_factors(req, features),
                recommendation   = _recommendation(level, []),
                model_version    = settings.RISK_MODEL_VERSION,
            ))
        except Exception as e:
            logger.error(f"Failed to predict for student {req.student_id}: {e}")
            failed += 1

    elapsed = (time.perf_counter() - t_start) * 1000
    logger.info(
        f"Batch prediction: {len(results)} success / {failed} failed in {elapsed:.0f}ms"
    )

    return BatchPredictResponse(
        predictions   = results,
        processed     = len(results),
        failed        = failed,
        model_version = settings.RISK_MODEL_VERSION,
    )


def _rule_based_probability(features: np.ndarray) -> float:
    """
    Fallback when ML model is not loaded.
    Deterministic rule-based risk scoring that mirrors the training labels.
    """
    overall, trend, streak, recency, at_risk_count, worst, variance = features

    score = 0.0
    score += max(0, (75 - overall) / 75) * 0.45     # weight: 45%
    score += min(streak / 15, 1.0) * 0.20            # weight: 20%
    score += max(0, -trend / 20) * 0.15              # weight: 15% (downtrend)
    score += min(recency / 30, 1.0) * 0.10           # weight: 10%
    score += min(at_risk_count / 5, 1.0) * 0.10      # weight: 10%

    return round(min(max(score, 0.0), 1.0), 4)
