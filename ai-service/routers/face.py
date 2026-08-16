"""
routers/face.py — Face recognition API endpoints

POST /face/enroll      — register a student's face (admin/faculty only)
POST /face/recognize   — match live image against stored encoding
DELETE /face/enroll/{student_id} — GDPR deletion of face data
GET  /face/status/{student_id}  — check if a student has an enrolled face
"""
import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from models.face_encoder import enroll_student, recognize_face, remove_student_encoding
from utils.s3_client import encoding_exists
from schemas.requests import EnrollRequest, RecognizeRequest, DeleteEncodingRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/face", tags=["Face Recognition"])


# ── POST /face/enroll ─────────────────────────────────────────────────────────
@router.post("/enroll", summary="Enroll a student's face encoding")
async def enroll(request: EnrollRequest):
    """
    Register a student's face by encoding 1–5 reference photos.

    - **student_id**: 24-char MongoDB ObjectId
    - **images_base64**: list of 1–5 base64-encoded JPEG/PNG images
    - **overwrite**: if True, replaces an existing encoding

    The service computes a 128-d dlib face encoding for each image,
    averages them, and uploads the result to S3.
    """
    try:
        result = await enroll_student(request)
    except Exception as e:
        logger.exception(f"Enrollment error for student {request.student_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Enrollment failed: {str(e)}")

    status_code = 201 if result.success else 409
    return JSONResponse(status_code=status_code, content=result.model_dump())


# ── POST /face/recognize ──────────────────────────────────────────────────────
@router.post("/recognize", summary="Match a live face against stored encoding")
async def recognize(request: RecognizeRequest):
    """
    Perform face recognition for attendance marking.

    Returns a **confidence score** (0–1) and a **matched** boolean.
    The Node.js backend enforces the threshold check and records the result.

    Processing steps:
    1. Decode and validate the submitted image
    2. Detect face location using HOG descriptor
    3. Compute 128-d face encoding
    4. Load stored encoding from S3 (or memory cache, TTL=5m)
    5. Euclidean distance → confidence score
    """
    try:
        result = await recognize_face(request)
    except Exception as e:
        logger.exception(f"Recognition error for student {request.student_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Recognition failed: {str(e)}")

    return JSONResponse(
        status_code=200 if result.face_detected else 422,
        content=result.model_dump(),
    )


# ── GET /face/status/{student_id} ─────────────────────────────────────────────
@router.get("/status/{student_id}", summary="Check if a student has a face enrolled")
async def enrollment_status(student_id: str):
    """
    Quick check — used by the frontend to show whether face attendance
    is available for this student.
    """
    if len(student_id) != 24:
        raise HTTPException(status_code=422, detail="student_id must be a 24-char ObjectId")

    try:
        enrolled = await encoding_exists(student_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "student_id": student_id,
        "enrolled": enrolled,
        "message": "Face enrolled" if enrolled else "No face data on file",
    }


# ── DELETE /face/enroll/{student_id} ─────────────────────────────────────────
@router.delete(
    "/enroll/{student_id}",
    summary="Delete a student's face encoding (GDPR)",
)
async def delete_face(student_id: str):
    """
    Permanently delete a student's face encoding from S3.
    This is irreversible — the student will need to re-enroll.

    Designed for GDPR right-to-erasure requests.
    """
    if len(student_id) != 24:
        raise HTTPException(status_code=422, detail="student_id must be a 24-char ObjectId")

    try:
        deleted = await remove_student_encoding(student_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not deleted:
        raise HTTPException(status_code=404, detail="No face encoding found for this student")

    return {
        "success": True,
        "student_id": student_id,
        "message": "Face encoding permanently deleted",
    }
