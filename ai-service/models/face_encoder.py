"""
models/face_encoder.py — Face recognition core

Pipeline:
  Enrollment  : image(s) → detect faces → compute 128-d encodings
                → average across samples → upload to S3
  Recognition : new image → detect face → compute encoding
                → load stored encoding from S3 → compare (Euclidean distance)
                → return confidence score

Why average multiple encodings?
  A single photo can be affected by lighting, angle, or expression.
  Averaging 3–5 encodings produces a centroid that is more representative
  of the student's true face and reduces both false-accept and false-reject rates.

Confidence formula:
  raw_distance   = Euclidean distance between two 128-d vectors (0 = identical)
  dlib threshold = 0.6 (faces with distance < 0.6 are "same person")
  We normalise:  confidence = max(0, 1 - (distance / 0.6))
  This maps distance 0.0 → confidence 1.0 (perfect match)
              distance 0.6 → confidence 0.0 (at threshold)
"""
import asyncio
import logging
import time
from typing import Optional

import face_recognition
import numpy as np

from config import get_settings
from utils.image_processor import decode_base64_image, ImageProcessingError
from utils.s3_client import (
    upload_encoding,
    download_encoding,
    delete_encoding,
    encoding_exists,
)
from schemas.requests import (
    EnrollRequest,
    RecognizeRequest,
    EnrollResponse,
    RecognizeResponse,
)

logger   = logging.getLogger(__name__)
settings = get_settings()

# In-memory LRU cache to avoid S3 round-trips on repeat scans
# Key: student_id, Value: (encoding_array, cached_at_ts)
_ENCODING_CACHE: dict[str, tuple[np.ndarray, float]] = {}
_CACHE_TTL_SECS = 300  # 5 minutes


# ─── Public API ───────────────────────────────────────────────────────────────

async def enroll_student(request: EnrollRequest) -> EnrollResponse:
    """
    Encode and store a student's face from 1–5 reference photos.
    Returns error if no face is detected in any photo.
    """
    if not request.overwrite and await encoding_exists(request.student_id):
        return EnrollResponse(
            success=False,
            student_id=request.student_id,
            encodings_stored=0,
            storage_key="",
            message="Encoding already exists. Set overwrite=true to replace.",
        )

    encodings_collected: list[np.ndarray] = []

    for idx, b64_img in enumerate(request.images_base64):
        try:
            rgb_array = decode_base64_image(b64_img)
        except ImageProcessingError as e:
            logger.warning(f"Enrollment image {idx} decode failed for {request.student_id}: {e}")
            continue

        face_locations = face_recognition.face_locations(rgb_array, model="hog")
        if not face_locations:
            logger.warning(f"No face detected in enrollment image {idx} for {request.student_id}")
            continue

        # Use the largest detected face (most prominent in frame)
        largest_loc = _largest_face(face_locations)
        enc = face_recognition.face_encodings(rgb_array, [largest_loc])
        if enc:
            encodings_collected.append(enc[0])
            logger.debug(f"Enrollment image {idx}: face encoded (student={request.student_id})")

    if not encodings_collected:
        return EnrollResponse(
            success=False,
            student_id=request.student_id,
            encodings_stored=0,
            storage_key="",
            message="No face detected in any of the provided images. "
                    "Ensure photos are well-lit and the face is clearly visible.",
        )

    # Average across all valid samples → robust centroid
    averaged = np.mean(encodings_collected, axis=0)

    # Upload to S3 and bust cache
    key = await upload_encoding(request.student_id, averaged, len(encodings_collected))
    _ENCODING_CACHE.pop(request.student_id, None)

    logger.info(
        f"Enrolled student {request.student_id}: "
        f"{len(encodings_collected)}/{len(request.images_base64)} images used"
    )

    return EnrollResponse(
        success=True,
        student_id=request.student_id,
        encodings_stored=len(encodings_collected),
        storage_key=key,
        message=f"Face enrolled successfully using {len(encodings_collected)} sample(s).",
    )


async def recognize_face(request: RecognizeRequest) -> RecognizeResponse:
    """
    Match a submitted image against the student's stored face encoding.
    Returns confidence score and match decision.
    """
    t_start = time.perf_counter()

    # ── Step 1: decode image ──────────────────────────────────────────────────
    try:
        rgb_array = decode_base64_image(request.image_base64)
    except ImageProcessingError as e:
        return RecognizeResponse(
            matched=False, confidence=0.0,
            student_id=request.student_id,
            face_detected=False,
            processing_time_ms=_elapsed_ms(t_start),
            message=f"Image decode error: {e}",
        )

    # ── Step 2: detect face in submitted image ────────────────────────────────
    face_locations = face_recognition.face_locations(rgb_array, model="hog")
    if not face_locations:
        return RecognizeResponse(
            matched=False, confidence=0.0,
            student_id=request.student_id,
            face_detected=False,
            processing_time_ms=_elapsed_ms(t_start),
            message="No face detected in submitted image. "
                    "Ensure good lighting and face the camera directly.",
        )

    # ── Step 3: compute encoding for submitted face ───────────────────────────
    largest_loc  = _largest_face(face_locations)
    live_encodings = face_recognition.face_encodings(rgb_array, [largest_loc])
    if not live_encodings:
        return RecognizeResponse(
            matched=False, confidence=0.0,
            student_id=request.student_id,
            face_detected=True,
            processing_time_ms=_elapsed_ms(t_start),
            message="Face detected but could not be encoded. Try again.",
        )
    live_enc = live_encodings[0]

    # ── Step 4: load stored encoding (cache → S3) ─────────────────────────────
    stored_enc = await _get_cached_encoding(request.student_id)
    if stored_enc is None:
        return RecognizeResponse(
            matched=False, confidence=0.0,
            student_id=request.student_id,
            face_detected=True,
            processing_time_ms=_elapsed_ms(t_start),
            message="No face enrolled for this student. "
                    "Ask admin to complete face enrollment first.",
        )

    # ── Step 5: compare encodings ─────────────────────────────────────────────
    distance   = float(face_recognition.face_distance([stored_enc], live_enc)[0])
    confidence = _distance_to_confidence(distance)
    matched    = confidence >= settings.FACE_MIN_CONFIDENCE

    elapsed = _elapsed_ms(t_start)
    logger.info(
        f"Recognition: student={request.student_id} "
        f"distance={distance:.4f} confidence={confidence:.3f} "
        f"matched={matched} time={elapsed:.1f}ms"
    )

    return RecognizeResponse(
        matched=matched,
        confidence=round(confidence, 4),
        student_id=request.student_id,
        face_detected=True,
        processing_time_ms=elapsed,
        message=(
            "Identity verified." if matched
            else f"Face confidence too low ({confidence*100:.0f}%). "
                 "Improve lighting or use QR fallback."
        ),
    )


async def remove_student_encoding(student_id: str) -> bool:
    """GDPR-compliant deletion of a student's face data."""
    _ENCODING_CACHE.pop(student_id, None)
    return await delete_encoding(student_id)


# ─── Internals ────────────────────────────────────────────────────────────────

async def _get_cached_encoding(student_id: str) -> Optional[np.ndarray]:
    """
    Cache-aside pattern:
      1. Check in-memory cache (TTL=5min)
      2. If miss/expired → fetch from S3 and repopulate
    """
    now = time.time()
    cached = _ENCODING_CACHE.get(student_id)

    if cached:
        enc, cached_at = cached
        if now - cached_at < _CACHE_TTL_SECS:
            logger.debug(f"Encoding cache HIT for student {student_id}")
            return enc
        else:
            logger.debug(f"Encoding cache EXPIRED for student {student_id}")

    # Cache miss or expired — fetch from S3
    enc = await download_encoding(student_id)
    if enc is not None:
        _ENCODING_CACHE[student_id] = (enc, now)
        # Evict oldest entries if cache grows too large
        if len(_ENCODING_CACHE) > 500:
            oldest = min(_ENCODING_CACHE, key=lambda k: _ENCODING_CACHE[k][1])
            del _ENCODING_CACHE[oldest]

    return enc


def _largest_face(
    face_locations: list[tuple[int, int, int, int]],
) -> tuple[int, int, int, int]:
    """
    Return the face location with the largest bounding-box area.
    (top, right, bottom, left) — dlib convention.
    """
    def area(loc):
        top, right, bottom, left = loc
        return (bottom - top) * (right - left)

    return max(face_locations, key=area)


def _distance_to_confidence(distance: float) -> float:
    """
    Normalise Euclidean distance [0, threshold] → confidence [1.0, 0.0].

    The dlib model was trained with a distance threshold of 0.6.
    We clamp confidence to [0, 1] so values beyond the threshold give 0.
    """
    threshold = settings.FACE_DISTANCE_THRESHOLD
    if distance >= threshold:
        return 0.0
    return round(max(0.0, 1.0 - (distance / threshold)), 4)


def _elapsed_ms(t_start: float) -> float:
    return round((time.perf_counter() - t_start) * 1000, 2)
