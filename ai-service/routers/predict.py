"""
routers/predict.py — ML risk prediction endpoints

POST /predict/risk        — single student risk score
POST /predict/batch       — batch prediction (called by nightly cron)
GET  /predict/model/info  — model metadata and feature importances
"""
import logging
from fastapi import APIRouter, HTTPException
from pathlib import Path
import joblib
import numpy as np

from models.risk_model import predict_risk, predict_batch, load_model, FEATURE_NAMES
from schemas.requests import PredictRiskRequest, BatchPredictRequest
from config import get_settings

logger   = logging.getLogger(__name__)
settings = get_settings()
router   = APIRouter(prefix="/predict", tags=["Risk Prediction"])


# ── POST /predict/risk ────────────────────────────────────────────────────────
@router.post("/risk", summary="Predict dropout risk for a single student")
async def single_risk(request: PredictRiskRequest):
    """
    Predict attendance risk for one student.

    **Input**: Full attendance context including per-subject records and weekly trend.

    **Output**:
    - `risk_score` 0–100 (higher = more at risk)
    - `risk_level` good / moderate / warning / critical
    - `risk_probability` raw model probability
    - `top_risk_factors` list of 3 human-readable explanations
    - `recommendation` suggested action for faculty/admin

    **Model**: Logistic Regression with isotonic calibration.
    Falls back to rule-based scoring if model file is missing.
    """
    try:
        result = predict_risk(request)
    except Exception as e:
        logger.exception(f"Risk prediction failed for {request.student_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

    return result


# ── POST /predict/batch ───────────────────────────────────────────────────────
@router.post("/batch", summary="Batch risk prediction for all students (nightly job)")
async def batch_risk(request: BatchPredictRequest):
    """
    Vectorised batch inference — designed to be called by the Node.js nightly cron job.

    Processes up to 5,000 students in a single request. Uses sklearn's vectorised
    `predict_proba` on a stacked feature matrix for maximum throughput.

    Typically runs in < 2 seconds for 1,000 students.
    """
    if not request.students:
        raise HTTPException(status_code=422, detail="At least one student is required")

    try:
        result = predict_batch(request.students)
    except Exception as e:
        logger.exception(f"Batch prediction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Batch prediction error: {str(e)}")

    return result


# ── GET /predict/model/info ───────────────────────────────────────────────────
@router.get("/model/info", summary="Model metadata, accuracy, and feature importances")
async def model_info():
    """
    Returns metadata about the loaded risk prediction model including:
    - Model type and version
    - Training accuracy metrics
    - Feature importances (coefficient magnitudes for LR)
    - When the model was last trained
    """
    pipeline = load_model()

    if pipeline is None:
        return {
            "status":  "fallback",
            "message": "ML model not loaded. Using rule-based fallback.",
            "version": settings.RISK_MODEL_VERSION,
            "features": FEATURE_NAMES,
        }

    # Extract LR coefficients from the calibrated pipeline
    # Pipeline structure: [StandardScaler, CalibratedClassifierCV(LR)]
    info: dict = {
        "status":        "loaded",
        "version":       settings.RISK_MODEL_VERSION,
        "model_type":    "LogisticRegression (CalibratedClassifierCV, isotonic)",
        "features":      FEATURE_NAMES,
    }

    try:
        # Navigate into CalibratedClassifierCV → base estimator
        calibrated  = pipeline.named_steps.get("classifier")
        lr_estimator = getattr(calibrated, "estimator", None) or getattr(calibrated, "base_estimator", None)
        if lr_estimator is not None:
            coefs = lr_estimator.coef_[0]
            importances = {
                name: round(float(abs(coef)), 4)
                for name, coef in zip(FEATURE_NAMES, coefs)
            }
            # Sort by importance descending
            info["feature_importances"] = dict(
                sorted(importances.items(), key=lambda x: x[1], reverse=True)
            )
    except Exception:
        pass  # Non-critical — metadata only

    # Load persisted metrics if available
    model_path   = Path(settings.RISK_MODEL_PATH)
    metrics_path = model_path.with_suffix(".metrics.joblib")
    if metrics_path.exists():
        try:
            metrics = joblib.load(metrics_path)
            info["training_metrics"] = metrics
        except Exception:
            pass

    return info
