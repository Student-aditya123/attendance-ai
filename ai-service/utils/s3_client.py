"""
utils/s3_client.py — AWS S3 operations for face encoding storage

Why S3 instead of MongoDB for encodings?
  A face encoding is a numpy array of 128 float64 values = 1 KB.
  Storing binary blobs in Mongo works but creates unnecessary document bloat,
  makes querying awkward, and misses S3's built-in versioning / lifecycle rules.
  S3 gives us cheap object storage, CDN delivery if needed, and clean separation.

Encoding key format:  encodings/{student_id}.npy
Metadata key format:  encodings/{student_id}.json  (sample count, created_at)
"""
import boto3
import numpy as np
import io
import json
import logging
from datetime import datetime, timezone
from botocore.exceptions import ClientError
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_client():
    """Return a boto3 S3 client. Uses env credentials or IAM role in production."""
    kwargs = {"region_name": settings.AWS_REGION}
    if settings.AWS_ACCESS_KEY_ID:
        kwargs["aws_access_key_id"]     = settings.AWS_ACCESS_KEY_ID
        kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
    return boto3.client("s3", **kwargs)


BUCKET = settings.AWS_BUCKET_NAME


def _encoding_key(student_id: str) -> str:
    return f"encodings/{student_id}.npy"


def _meta_key(student_id: str) -> str:
    return f"encodings/{student_id}.json"


async def upload_encoding(student_id: str, encoding: np.ndarray, sample_count: int) -> str:
    """
    Persist a face encoding (128-d float64 array) to S3.
    Returns the S3 key on success.
    """
    key = _encoding_key(student_id)

    # Serialise numpy array to bytes
    buf = io.BytesIO()
    np.save(buf, encoding)
    buf.seek(0)

    client = _get_client()

    # Upload encoding
    client.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=buf.getvalue(),
        ContentType="application/octet-stream",
        Metadata={
            "student_id":   student_id,
            "sample_count": str(sample_count),
            "created_at":   datetime.now(timezone.utc).isoformat(),
        },
    )

    # Upload metadata JSON alongside for easy inspection without downloading the .npy
    meta = {
        "student_id":   student_id,
        "sample_count": sample_count,
        "encoding_dim": len(encoding),
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "model":        "dlib_face_recognition_resnet_model_v1",
    }
    client.put_object(
        Bucket=BUCKET,
        Key=_meta_key(student_id),
        Body=json.dumps(meta).encode(),
        ContentType="application/json",
    )

    logger.info(f"Uploaded encoding for student {student_id} → s3://{BUCKET}/{key}")
    return key


async def download_encoding(student_id: str) -> np.ndarray | None:
    """
    Retrieve a face encoding from S3.
    Returns None if no encoding exists for this student.
    """
    key = _encoding_key(student_id)
    client = _get_client()

    try:
        response = client.get_object(Bucket=BUCKET, Key=key)
        buf = io.BytesIO(response["Body"].read())
        encoding = np.load(buf)
        logger.debug(f"Downloaded encoding for student {student_id} (dim={encoding.shape})")
        return encoding

    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            logger.warning(f"No encoding found for student {student_id}")
            return None
        raise


async def delete_encoding(student_id: str) -> bool:
    """Remove a student's face encoding (e.g. on GDPR deletion request)."""
    client = _get_client()
    try:
        client.delete_objects(
            Bucket=BUCKET,
            Delete={"Objects": [
                {"Key": _encoding_key(student_id)},
                {"Key": _meta_key(student_id)},
            ]},
        )
        logger.info(f"Deleted encoding for student {student_id}")
        return True
    except ClientError as e:
        logger.error(f"Failed to delete encoding for {student_id}: {e}")
        return False


async def encoding_exists(student_id: str) -> bool:
    """Quick existence check without downloading the full encoding."""
    client = _get_client()
    try:
        client.head_object(Bucket=BUCKET, Key=_encoding_key(student_id))
        return True
    except ClientError:
        return False
