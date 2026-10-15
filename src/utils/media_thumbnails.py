"""On-demand WebP previews for owner-scoped local media."""

import hashlib
import os
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from src.utils.system_check import get_ffmpeg_path


PREVIEW_MAX_EDGES = frozenset({160, 320, 512, 960})
MAX_PREVIEW_SOURCE_BYTES = 64 * 1024 * 1024
MAX_PREVIEW_SOURCE_PIXELS = 40_000_000
MAX_VIDEO_PREVIEW_SOURCE_BYTES = 512 * 1024 * 1024
VIDEO_DEMUXERS = {".mp4": "mov", ".mov": "mov", ".webm": "matroska", ".mkv": "matroska"}


def _video_still(source: Path, max_edge: int) -> Image.Image:
    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        raise ValueError("Video preview requires FFmpeg on the backend")
    try:
        result = subprocess.run(
            [ffmpeg, "-nostdin", "-v", "error", "-threads", "1",
             "-protocol_whitelist", "file", "-f", VIDEO_DEMUXERS[source.suffix.lower()],
             "-i", str(source), "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-dn",
             "-vf", f"scale={max_edge}:{max_edge}:force_original_aspect_ratio=decrease",
             "-threads", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
            check=True, capture_output=True, timeout=20,
        )
        with Image.open(BytesIO(result.stdout)) as still:
            return still.convert("RGB")
    except (subprocess.SubprocessError, OSError) as exc:
        raise ValueError("Video preview generation failed") from exc


def create_media_thumbnail(source_path: str, owner_root: str, max_edge: int) -> str:
    """Create or reuse a bounded WebP preview inside the media owner's tree.

    The caller must first verify the signed URL or authenticated owner. Repeat
    the owner-root containment check before reading the source or writing the
    cache, and keys cached output by source path and filesystem version.
    """
    if max_edge not in PREVIEW_MAX_EDGES:
        raise ValueError("Unsupported media preview size")

    owner = Path(owner_root).resolve(strict=True)
    source = Path(source_path).resolve(strict=True)
    if not source.is_relative_to(owner) or not source.is_file():
        raise ValueError("Media is outside its owner directory")
    source_stat = source.stat()
    is_video = source.suffix.lower() in VIDEO_DEMUXERS
    byte_limit = MAX_VIDEO_PREVIEW_SOURCE_BYTES if is_video else MAX_PREVIEW_SOURCE_BYTES
    if source_stat.st_size <= 0 or source_stat.st_size > byte_limit:
        raise ValueError("Media is outside preview size limits")

    cache_key = hashlib.sha256(
        f"{source}:{source_stat.st_size}:{source_stat.st_mtime_ns}:{max_edge}".encode("utf-8")
    ).hexdigest()
    cache_dir = owner / ".media-previews"
    cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = cache_dir / f"{cache_key}.webp"
    if destination.is_file():
        return str(destination)

    temporary_path = None
    try:
        try:
            if is_video:
                image = _video_still(source, max_edge)
            else:
                with Image.open(source) as opened:
                    width, height = opened.size
                    if width <= 0 or height <= 0 or width * height > MAX_PREVIEW_SOURCE_PIXELS:
                        raise ValueError("Media is outside preview pixel limits")
                    if getattr(opened, "n_frames", 1) > 1:
                        opened.seek(0)
                    image = ImageOps.exif_transpose(opened.copy())
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ValueError("Media is outside preview pixel limits") from exc
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")

        source_after = source.stat()
        if (source_after.st_size, source_after.st_mtime_ns) != (source_stat.st_size, source_stat.st_mtime_ns):
            raise ValueError("Media changed during preview generation")

        file_descriptor, temporary_path = tempfile.mkstemp(
            prefix=".preview-", suffix=".webp", dir=cache_dir
        )
        os.close(file_descriptor)
        image.save(temporary_path, "WEBP", quality=78, method=4)
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, destination)
        temporary_path = None
        return str(destination)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
