"""
schemas/requests.py — Pydantic v2 models for all API request/response bodies

Using Pydantic v2 field validators for early rejection of bad data
before we ever touch the expensive ML code paths.
"""
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
import base64
import re


# ── Face recognition ──────────────────────────────────────────────────────────

class RecognizeRequest(BaseModel):
    """Sent by the Node.js backend when a student tries face-based attendance."""
    student_id: str = Field(..., min_length=24, max_length=24, description="MongoDB ObjectId")
    image_base64: str = Field(..., min_length=100, description="Base64-encoded JPEG/PNG")
    session_id: str = Field(..., min_length=24, max_length=24)

    @field_validator("image_base64")
    @classmethod
    def validate_base64(cls, v: str) -> str:
        # Strip data URI prefix if present (data:image/jpeg;base64,...)
        if "," in v:
            v = v.split(",", 1)[1]
        try:
            decoded = base64.b64decode(v)
            if len(decoded) < 1000:
                raise ValueError("Image too small — likely corrupt or empty")
            # Check JPEG/PNG magic bytes
            if not (decoded[:2] == b'\xff\xd8' or decoded[:4] == b'\x89PNG'):
                raise ValueError("Image must be JPEG or PNG")
        except Exception as e:
            raise ValueError(f"Invalid base64 image: {e}")
        return v


class EnrollRequest(BaseModel):
    """Register a student's face. Accepts 1–5 photos; we average encodings."""
    student_id: str = Field(..., min_length=24, max_length=24)
    images_base64: list[str] = Field(
        ..., min_length=1, max_length=5,
        description="1–5 face photos for robust encoding"
    )
    overwrite: bool = Field(False, description="Replace existing encoding if True")

    @field_validator("images_base64")
    @classmethod
    def validate_images(cls, images: list[str]) -> list[str]:
        clean = []
        for img in images:
            if "," in img:
                img = img.split(",", 1)[1]
            try:
                base64.b64decode(img)
            except Exception:
                raise ValueError("One or more images have invalid base64 encoding")
            clean.append(img)
        return clean


class DeleteEncodingRequest(BaseModel):
    student_id: str = Field(..., min_length=24, max_length=24)


# ── Risk prediction ───────────────────────────────────────────────────────────

class AttendanceRecord(BaseModel):
    """Per-class attendance summary for one student."""
    class_id: str
    subject_code: str
    total_classes: int = Field(..., ge=0)
    attended: int = Field(..., ge=0)
    percentage: float = Field(..., ge=0.0, le=100.0)

    # Weekly breakdown: list of (week_number, percentage) — last 8 weeks
    weekly_trend: list[dict] = Field(default_factory=list)

    @model_validator(mode="after")
    def attended_lte_total(self) -> "AttendanceRecord":
        if self.attended > self.total_classes:
            raise ValueError("attended cannot exceed total_classes")
        return self


class PredictRiskRequest(BaseModel):
    """Full attendance context for one student — used by nightly batch job."""
    student_id: str = Field(..., min_length=24, max_length=24)
    overall_percentage: float = Field(..., ge=0.0, le=100.0)
    consecutive_absences: int = Field(..., ge=0)
    days_since_last_attendance: int = Field(..., ge=0)
    subject_records: list[AttendanceRecord] = Field(..., min_length=1)
    # Optional: pre-computed 4-week trend delta (positive = improving)
    trend_delta_4w: Optional[float] = None


class BatchPredictRequest(BaseModel):
    """Batch prediction for all students — called by the nightly cron job."""
    students: list[PredictRiskRequest] = Field(..., min_length=1, max_length=5000)


# ── Response schemas ──────────────────────────────────────────────────────────

class RecognizeResponse(BaseModel):
    matched: bool
    confidence: float = Field(..., ge=0.0, le=1.0)
    student_id: str
    face_detected: bool
    processing_time_ms: float
    message: str


class EnrollResponse(BaseModel):
    success: bool
    student_id: str
    encodings_stored: int
    storage_key: str
    message: str


class RiskPrediction(BaseModel):
    student_id: str
    risk_score: float = Field(..., ge=0.0, le=100.0, description="0=safe, 100=dropout risk")
    risk_level: str = Field(..., pattern="^(good|moderate|warning|critical)$")
    risk_probability: float = Field(..., ge=0.0, le=1.0)
    top_risk_factors: list[str]
    recommendation: str
    model_version: str


class BatchPredictResponse(BaseModel):
    predictions: list[RiskPrediction]
    processed: int
    failed: int
    model_version: str
