"""
config.py — Centralised configuration via pydantic-settings

All values come from environment variables (or .env file).
Crash at startup if required values are missing — same philosophy as the Node backend.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Server ────────────────────────────────────────────────────────────────
    APP_ENV: str = "development"
    PORT: int = 8000
    LOG_LEVEL: str = "info"

    # ── MongoDB ───────────────────────────────────────────────────────────────
    MONGO_URI: str = "mongodb://localhost:27017/attendance_db"

    # ── AWS S3 (face encoding storage) ────────────────────────────────────────
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_BUCKET_NAME: str = "attendance-face-data"

    # ── Face recognition ──────────────────────────────────────────────────────
    # Distance threshold: lower = stricter. dlib default is 0.6.
    # We use 0.50 for higher security (fewer false positives).
    FACE_DISTANCE_THRESHOLD: float = 0.50
    # Minimum confidence to mark attendance (1 - distance)
    FACE_MIN_CONFIDENCE: float = 0.80
    # Max encodings stored per student (averaged for robustness)
    FACE_MAX_SAMPLES: int = 5

    # ── Risk model ────────────────────────────────────────────────────────────
    # Path to persisted sklearn model inside the container
    RISK_MODEL_PATH: str = "/app/models/risk_model.joblib"
    RISK_MODEL_VERSION: str = "2.1"

    # ── Attendance thresholds ─────────────────────────────────────────────────
    MIN_ATTENDANCE_PCT: float = 75.0


@lru_cache()
def get_settings() -> Settings:
    return Settings()
