"""Bounded local image decoding; originals remain byte-for-byte unchanged."""

from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .dates import ExifCaptureTime, PhotoTimeEvidence

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 20_000_000
_MIME = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class ImageLimitExceeded(ValueError):
    pass


@dataclass(frozen=True)
class PreparedPhoto:
    original: bytes
    thumbnail: bytes
    media_type: str
    evidence: PhotoTimeEvidence


def _text(value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def prepare_photo(raw: bytes) -> PreparedPhoto:
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ImageLimitExceeded("Image exceeds byte limit")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as image:
                media_type = _MIME.get(image.format)
                if not media_type or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Only static JPEG, PNG and WebP are supported")
                if image.width * image.height > MAX_PIXELS:
                    raise ImageLimitExceeded("Image exceeds pixel limit")
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image.load()
                exif = image.getexif()
                capture = exif.get_ifd(34665) if 34665 in exif else {}
                # Keep malformed values for date-rule review, not permissive parsing.
                evidence = PhotoTimeEvidence(
                    original_capture_times=(ExifCaptureTime(
                        source_ref="original/exif/DateTimeOriginal",
                        raw_value=_text(capture.get(36867)),
                        raw_offset=_text(capture.get(36881)),
                    ),),
                    uploaded_at=datetime.now(timezone.utc),
                )
                thumbnail = ImageOps.exif_transpose(image).convert("RGB")
                thumbnail.thumbnail((1024, 1024))
                thumbnail.info.clear()
                output = BytesIO()
                thumbnail.save(output, "WEBP", quality=82)
                return PreparedPhoto(raw, output.getvalue(), media_type, evidence)
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ImageLimitExceeded("Image exceeds decoder limits") from exc
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError("Invalid or incomplete image") from exc
