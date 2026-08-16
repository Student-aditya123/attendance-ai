"""
tests/test_face_and_risk.py — Unit + integration tests for both AI modules

Run:
  pytest tests/ -v --tb=short

Coverage goals:
  - Face: decode → detect → encode → compare pipeline
  - Risk: feature extraction, rule-based fallback, edge cases
  - API: happy path + validation errors via TestClient
"""
import base64
import io
import numpy as np
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

# ── Fixtures ──────────────────────────────────────────────────────────────────

VALID_STUDENT_ID = "6" * 24   # 24-char fake ObjectId

def _fake_jpeg_b64(width: int = 100, height: int = 100) -> str:
    """Generate a minimal valid JPEG as base64 (solid colour, no real face)."""
    from PIL import Image
    img = Image.new("RGB", (width, height), color=(120, 80, 60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


# ═══════════════════════════════════════════════════════════════════════════════
# IMAGE PROCESSOR TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestImageProcessor:
    def test_decode_valid_jpeg(self):
        from utils.image_processor import decode_base64_image
        b64 = _fake_jpeg_b64(200, 200)
        arr = decode_base64_image(b64)
        assert arr.dtype == np.uint8
        assert arr.ndim == 3
        assert arr.shape[2] == 3

    def test_decode_with_data_uri_prefix(self):
        from utils.image_processor import decode_base64_image
        b64 = "data:image/jpeg;base64," + _fake_jpeg_b64()
        arr = decode_base64_image(b64)
        assert arr.shape[2] == 3

    def test_resize_large_image(self):
        from utils.image_processor import decode_base64_image
        b64 = _fake_jpeg_b64(2000, 2000)
        arr = decode_base64_image(b64)
        # Should have been resized to max 1024
        assert max(arr.shape[:2]) <= 1024

    def test_invalid_base64_raises(self):
        from utils.image_processor import decode_base64_image, ImageProcessingError
        with pytest.raises(ImageProcessingError):
            decode_base64_image("not-valid-base64!!!")

    def test_non_image_bytes_raises(self):
        from utils.image_processor import decode_base64_image, ImageProcessingError
        fake = base64.b64encode(b"this is not an image at all").decode()
        with pytest.raises(ImageProcessingError, match="Unsupported image format"):
            decode_base64_image(fake)

    def test_too_small_image_raises(self):
        from utils.image_processor import decode_base64_image, ImageProcessingError
        tiny = base64.b64encode(b"\xff\xd8" + b"\x00" * 10).decode()
        with pytest.raises(ImageProcessingError):
            decode_base64_image(tiny)


# ═══════════════════════════════════════════════════════════════════════════════
# FACE ENCODER TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestFaceEncoder:
    @pytest.mark.asyncio
    async def test_recognize_no_stored_encoding(self):
        """Should return face_detected=True but matched=False with 'no encoding' message."""
        from models.face_encoder import recognize_face
        from schemas.requests import RecognizeRequest

        req = RecognizeRequest(
            student_id=VALID_STUDENT_ID,
            image_base64=_fake_jpeg_b64(300, 300),
            session_id=VALID_STUDENT_ID,
        )

        with patch("models.face_encoder._get_cached_encoding", new_callable=AsyncMock) as mock_cache, \
             patch("models.face_encoder.face_recognition") as mock_fr:

            mock_cache.return_value = None  # no stored encoding
            mock_fr.face_locations.return_value = [(10, 90, 90, 10)]
            mock_fr.face_encodings.return_value = [np.random.rand(128)]

            result = await recognize_face(req)

            assert result.face_detected is True
            assert result.matched is False
            assert "enrolled" in result.message.lower()

    @pytest.mark.asyncio
    async def test_recognize_high_confidence_match(self):
        """Same encoding on both sides → distance≈0 → confidence≈1 → matched=True."""
        from models.face_encoder import recognize_face
        from schemas.requests import RecognizeRequest

        enc = np.random.rand(128)
        enc /= np.linalg.norm(enc)  # normalise

        req = RecognizeRequest(
            student_id=VALID_STUDENT_ID,
            image_base64=_fake_jpeg_b64(),
            session_id=VALID_STUDENT_ID,
        )

        with patch("models.face_encoder._get_cached_encoding", new_callable=AsyncMock) as mock_cache, \
             patch("models.face_encoder.face_recognition") as mock_fr:

            mock_cache.return_value = enc
            mock_fr.face_locations.return_value = [(10, 90, 90, 10)]
            mock_fr.face_encodings.return_value = [enc.copy()]
            # Distance 0.0 → confidence 1.0
            mock_fr.face_distance.return_value = np.array([0.0])

            result = await recognize_face(req)

            assert result.face_detected is True
            assert result.matched is True
            assert result.confidence >= 0.95

    @pytest.mark.asyncio
    async def test_recognize_no_face_detected(self):
        """Image with no face → face_detected=False, matched=False."""
        from models.face_encoder import recognize_face
        from schemas.requests import RecognizeRequest

        req = RecognizeRequest(
            student_id=VALID_STUDENT_ID,
            image_base64=_fake_jpeg_b64(),
            session_id=VALID_STUDENT_ID,
        )

        with patch("models.face_encoder.face_recognition") as mock_fr:
            mock_fr.face_locations.return_value = []  # no face found

            result = await recognize_face(req)

            assert result.face_detected is False
            assert result.matched is False

    def test_distance_to_confidence(self):
        """Verify distance→confidence mapping at key thresholds."""
        from models.face_encoder import _distance_to_confidence
        assert _distance_to_confidence(0.0) == 1.0      # perfect match
        assert _distance_to_confidence(0.25) > 0.5      # good match
        assert _distance_to_confidence(0.50) == 0.0     # at threshold (default=0.5)
        assert _distance_to_confidence(0.99) == 0.0     # well beyond threshold


# ═══════════════════════════════════════════════════════════════════════════════
# RISK MODEL TESTS
# ═══════════════════════════════════════════════════════════════════════════════

def _make_request(overall: float, streak: int = 0, trend: float = 0.0,
                  days: int = 1, subjects_risk: int = 0, worst: float = 80.0) -> "PredictRiskRequest":
    from schemas.requests import PredictRiskRequest, AttendanceRecord
    return PredictRiskRequest(
        student_id=VALID_STUDENT_ID,
        overall_percentage=overall,
        consecutive_absences=streak,
        days_since_last_attendance=days,
        trend_delta_4w=trend,
        subject_records=[
            AttendanceRecord(
                class_id=VALID_STUDENT_ID,
                subject_code="CS301",
                total_classes=24,
                attended=int(24 * overall / 100),
                percentage=overall,
                weekly_trend=[{"week": i, "percentage": overall + (i * trend / 8)} for i in range(1, 5)],
            ),
        ],
    )


class TestRiskModel:
    def test_critical_student(self):
        from models.risk_model import predict_risk
        req    = _make_request(overall=42.0, streak=9, trend=-8.0, days=12, subjects_risk=3, worst=38.0)
        result = predict_risk(req)
        assert result.risk_level == "critical"
        assert result.risk_score >= 60
        assert len(result.top_risk_factors) >= 1

    def test_good_student(self):
        from models.risk_model import predict_risk
        req    = _make_request(overall=92.0, streak=0, trend=2.0, days=1, subjects_risk=0, worst=90.0)
        result = predict_risk(req)
        assert result.risk_level == "good"
        assert result.risk_score <= 25

    def test_warning_student(self):
        from models.risk_model import predict_risk
        req    = _make_request(overall=68.0, streak=4, trend=-3.0, days=5)
        result = predict_risk(req)
        assert result.risk_level in ("warning", "critical")

    def test_rule_based_fallback(self):
        from models.risk_model import _rule_based_probability
        # High risk features
        features_high = np.array([45.0, -8.0, 10.0, 20.0, 4.0, 40.0, 300.0])
        prob_high     = _rule_based_probability(features_high)
        assert prob_high >= 0.5

        # Low risk features
        features_low  = np.array([92.0, 3.0, 0.0, 1.0, 0.0, 90.0, 40.0])
        prob_low      = _rule_based_probability(features_low)
        assert prob_low <= 0.2

        assert prob_high > prob_low

    def test_feature_extraction_shape(self):
        from models.risk_model import extract_features
        req      = _make_request(overall=70.0, streak=3)
        features = extract_features(req)
        assert features.shape == (7,)
        assert not np.any(np.isnan(features))

    def test_batch_prediction(self):
        from models.risk_model import predict_batch
        students = [
            _make_request(overall=45.0, streak=8),
            _make_request(overall=88.0, streak=0),
            _make_request(overall=65.0, streak=4),
        ]
        result = predict_batch(students)
        assert result.processed == 3
        assert result.failed == 0
        assert len(result.predictions) == 3

    def test_risk_score_in_range(self):
        from models.risk_model import predict_risk
        for overall in [30, 55, 75, 90]:
            req    = _make_request(overall=float(overall))
            result = predict_risk(req)
            assert 0 <= result.risk_score <= 100
            assert 0 <= result.risk_probability <= 1


# ═══════════════════════════════════════════════════════════════════════════════
# API INTEGRATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def api_client():
    from main import create_app
    app = create_app()
    with TestClient(app) as client:
        yield client


class TestAPI:
    def test_health_endpoint(self, api_client):
        r = api_client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"

    def test_face_enroll_invalid_student_id(self, api_client):
        r = api_client.post("/face/enroll", json={
            "student_id": "short",
            "images_base64": [_fake_jpeg_b64()],
        })
        assert r.status_code == 422   # Pydantic validation rejects it

    def test_predict_risk_valid_payload(self, api_client):
        r = api_client.post("/predict/risk", json={
            "student_id": VALID_STUDENT_ID,
            "overall_percentage": 65.0,
            "consecutive_absences": 4,
            "days_since_last_attendance": 6,
            "trend_delta_4w": -3.5,
            "subject_records": [{
                "class_id": VALID_STUDENT_ID,
                "subject_code": "CS301",
                "total_classes": 24,
                "attended": 15,
                "percentage": 62.5,
                "weekly_trend": [],
            }],
        })
        assert r.status_code == 200
        data = r.json()
        assert "risk_score" in data
        assert "risk_level" in data
        assert data["risk_level"] in ("good", "moderate", "warning", "critical")

    def test_predict_risk_invalid_attended(self, api_client):
        """attended > total_classes should fail validation."""
        r = api_client.post("/predict/risk", json={
            "student_id": VALID_STUDENT_ID,
            "overall_percentage": 80.0,
            "consecutive_absences": 0,
            "days_since_last_attendance": 1,
            "subject_records": [{
                "class_id": VALID_STUDENT_ID,
                "subject_code": "CS301",
                "total_classes": 10,
                "attended": 15,    # invalid: 15 > 10
                "percentage": 80.0,
            }],
        })
        assert r.status_code == 422

    def test_model_info_endpoint(self, api_client):
        r = api_client.get("/predict/model/info")
        assert r.status_code == 200
        data = r.json()
        assert "status" in data
        assert "features" in data
