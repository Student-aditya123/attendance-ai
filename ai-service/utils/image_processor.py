"""
utils/image_processor.py — Image decoding and preprocessing pipeline

All images entering the face recognition pipeline go through this module.
Steps:
  1. Decode base64 → raw bytes
  2. Validate magic bytes (JPEG / PNG only)
  3. Decode with Pillow → RGB array
  4. Auto-orient (EXIF rotation on phone cameras)
  5. Resize: cap at 1024px on the longest side (dlib doesn't need more)
  6. Convert to numpy uint8 RGB — what face_recognition expects

Why cap at 1024px? face_recognition's HOG detector runs on the full image.
A 4K selfie gives no accuracy benefit over 1024px and costs 16× the compute.
"""
import base64
import io
import logging
import numpy as np
from PIL import Image, ImageOps, ExifTags

logger = logging.getLogger(__name__)

MAX_DIM = 1024
ALLOWED_MODES = {"RGB", "RGBA", "L"}


class ImageProcessingError(Exception):
    """Raised when an image cannot be processed."""
    pass


def decode_base64_image(b64_string: str) -> np.ndarray:
    """
    Full pipeline: base64 string → numpy uint8 RGB array.
    Raises ImageProcessingError on any failure.
    """
    # 1. Strip data-URI prefix if present
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]

    # 2. Decode base64
    try:
        raw_bytes = base64.b64decode(b64_string)
    except Exception as e:
        raise ImageProcessingError(f"Base64 decode failed: {e}")

    # 3. Validate magic bytes
    _validate_magic_bytes(raw_bytes)

    # 4. Open with Pillow
    try:
        img = Image.open(io.BytesIO(raw_bytes))
    except Exception as e:
        raise ImageProcessingError(f"Pillow cannot open image: {e}")

    # 5. Auto-orient using EXIF data (phone cameras rotate JPEGs)
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass  # Non-fatal — some images have no EXIF

    # 6. Convert to RGB (handles grayscale, RGBA, palette modes)
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 7. Resize if larger than MAX_DIM
    w, h = img.size
    if max(w, h) > MAX_DIM:
        scale = MAX_DIM / max(w, h)
        new_size = (int(w * scale), int(h * scale))
        img = img.resize(new_size, Image.LANCZOS)
        logger.debug(f"Resized image from {w}×{h} → {new_size[0]}×{new_size[1]}")

    # 8. Convert to numpy uint8 RGB
    arr = np.array(img, dtype=np.uint8)

    if arr.ndim != 3 or arr.shape[2] != 3:
        raise ImageProcessingError(f"Unexpected array shape after conversion: {arr.shape}")

    return arr


def _validate_magic_bytes(raw: bytes) -> None:
    """Quick magic-byte check — reject non-image bytes before Pillow opens them."""
    if len(raw) < 4:
        raise ImageProcessingError("Image data too short")

    is_jpeg = raw[:2] == b"\xff\xd8"
    is_png  = raw[:4] == b"\x89PNG"
    is_webp = raw[8:12] == b"WEBP"

    if not (is_jpeg or is_png or is_webp):
        raise ImageProcessingError(
            "Unsupported image format. Only JPEG, PNG, and WebP are accepted."
        )


def array_to_pil(arr: np.ndarray) -> Image.Image:
    """Utility: numpy RGB array → Pillow image (for saving debug frames)."""
    return Image.fromarray(arr.astype(np.uint8), "RGB")
