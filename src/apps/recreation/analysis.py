"""Bounded, local-only FFmpeg analysis; all authoritative times are source PTS."""
from bisect import bisect_left
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading

from PIL import Image, ImageDraw

MAX_BYTES = 256 * 1024 * 1024
MAX_SECONDS = 60
MAX_FRAMES = 7200
INPUT_OPTIONS = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm"]
_PROCESS_SLOTS = threading.BoundedSemaphore(2)


def fingerprint(path: Path) -> str:
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("Source must be a nonempty file of at most 256 MiB")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], timeout: int = 90) -> tuple[str, str]:
    # File-backed capture avoids accumulating decoder output in process memory.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        try:
            if not _PROCESS_SLOTS.acquire(timeout=5):
                raise ValueError("Media processing is busy; retry later")
            try:
                result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=stdout,
                                        stderr=stderr, timeout=timeout, check=False)
            finally:
                _PROCESS_SLOTS.release()
        except FileNotFoundError as exc:
            raise ValueError("FFmpeg/FFprobe is unavailable") from exc
        except subprocess.TimeoutExpired as exc:
            raise ValueError("Media analysis timed out") from exc
        if result.returncode:
            raise ValueError("Media could not be decoded")
        if stdout.tell() > 8 * 1024 * 1024 or stderr.tell() > 8 * 1024 * 1024:
            raise ValueError("Media analysis output exceeds limit")
        stdout.seek(0)
        stderr.seek(0)
        return stdout.read().decode("utf-8"), stderr.read().decode("utf-8", errors="replace")


def parse_probe(data: dict) -> dict:
    videos = [s for s in data.get("streams", []) if s.get("codec_type") == "video"]
    if len(videos) != 1:
        raise ValueError("Source must contain exactly one video stream")
    stream = videos[0]
    width, height = int(stream["width"]), int(stream["height"])
    if not (0 < width <= 4096 and 0 < height <= 4096):
        raise ValueError("Source dimensions exceed 4096 pixels")
    time_base = Fraction(stream["time_base"])
    if time_base <= 0:
        raise ValueError("Invalid source time base")
    if "duration_ts" in stream and int(stream["duration_ts"]) * time_base > MAX_SECONDS:
        raise ValueError("Source duration exceeds 60 seconds")
    frames = [f for f in data.get("frames", []) if f.get("media_type") == "video"]
    if not 1 <= len(frames) <= MAX_FRAMES:
        raise ValueError("Source frame count exceeds limit or is empty")
    pts = [int(f["best_effort_timestamp"]) for f in frames]
    if any(b <= a for a, b in zip(pts, pts[1:])):
        raise ValueError("Source frame timestamps must be strictly increasing")
    last_duration = int(frames[-1].get("duration") or frames[-1].get("pkt_duration") or 0)
    if last_duration > 0:
        end_pts = pts[-1] + last_duration
    elif "duration_ts" in stream:
        end_pts = int(stream.get("start_pts", pts[0])) + int(stream["duration_ts"])
    else:
        raise ValueError("Source end timestamp is unavailable")
    duration = (end_pts - pts[0]) * time_base
    if end_pts <= pts[-1] or not 0 < duration <= MAX_SECONDS:
        raise ValueError("Source duration exceeds 60 seconds or has an invalid end")
    return {
        "time_base": str(time_base), "start_pts": pts[0], "end_pts": end_pts,
        "frame_pts": pts, "duration_seconds": float(duration), "width": width,
        "height": height, "audio_streams": sum(s.get("codec_type") == "audio" for s in data.get("streams", [])),
    }


def analyze(source: Path, destination: Path, expected_hash: str) -> dict:
    if fingerprint(source) != expected_hash:
        raise ValueError("Source fingerprint changed; register the source again")
    destination.mkdir(parents=True, exist_ok=False)
    raw, _ = run(["ffprobe", "-v", "error", *INPUT_OPTIONS, "-threads", "1",
                  "-read_intervals", "%+61", "-show_frames", "-show_streams",
                  "-show_entries", "stream=codec_type,width,height,time_base,start_pts,duration_ts:frame=media_type,best_effort_timestamp,duration,pkt_duration",
                  "-of", "json", str(source)])
    try:
        probe = parse_probe(json.loads(raw))
    except (KeyError, TypeError, ZeroDivisionError, json.JSONDecodeError) as exc:
        raise ValueError("Incomplete source timing metadata") from exc
    pts = probe["frame_pts"]
    _, log = run(["ffmpeg", "-nostdin", "-hide_banner", "-copyts", *INPUT_OPTIONS,
                  "-threads", "1", "-i", str(source), "-map", "0:v:0", "-an",
                  "-vf", "select=gt(scene\\,0.3),showinfo", "-threads", "1",
                  "-f", "null", "-"])
    candidates = sorted({int(p) for p in re.findall(r"\bn:\s*\d+\s+pts:\s*(-?\d+)", log)} - {pts[0]})
    if len(candidates) > 120 or any(p not in pts for p in candidates):
        raise ValueError("Cut detection exceeds limit or uses a different time base")
    tb = Fraction(probe["time_base"])
    samples = sorted({min(bisect_left(pts, Fraction(i, 2) / tb + pts[0]), len(pts) - 1)
                      for i in range(int(probe["duration_seconds"] * 2) + 1)})
    indices = set(samples)
    for cut in candidates:
        index = bisect_left(pts, cut)
        indices.update((index - 1, index))
    selected = sorted(indices)
    expression = "+".join(f"eq(n\\,{n})" for n in selected)
    run(["ffmpeg", "-nostdin", "-v", "error", *INPUT_OPTIONS, "-threads", "1", "-i", str(source),
         "-map", "0:v:0", "-an", "-vf", f"select={expression},scale=320:320:force_original_aspect_ratio=decrease",
         "-fps_mode", "vfr", "-threads", "1", str(destination / "frame-%04d.jpg")])
    files = sorted(destination.glob("frame-*.jpg"))
    if len(files) != len(selected):
        raise ValueError("Evidence extraction did not match decoded frame count")
    frame_files = dict(zip(selected, files))
    def relative(path):
        return path.relative_to(Path("output").resolve()).as_posix()
    cuts = [{"pts": p, "source": "detected", "before_pts": pts[bisect_left(pts, p) - 1],
             "before_url": relative(frame_files[bisect_left(pts, p) - 1]),
             "after_url": relative(frame_files[bisect_left(pts, p)])} for p in candidates]
    sheet = Image.new("RGB", (4 * 320, ((len(samples) + 3) // 4) * 344), "#18181b")
    draw = ImageDraw.Draw(sheet)
    for n, index in enumerate(samples):
        x, y = n % 4 * 320, n // 4 * 344
        with Image.open(frame_files[index]) as picture:
            sheet.paste(picture, (x, y))
        draw.text((x + 6, y + 323), f"{float((pts[index] - pts[0]) * tb):.6f}s", fill="white")
    sheet.save(destination / "contact.jpg")
    if fingerprint(source) != expected_hash:
        raise ValueError("Source fingerprint changed during analysis")
    return {**probe, "candidates": cuts, "contact_sheet_url": relative(destination / "contact.jpg"),
            "samples": [{"pts": pts[i], "url": relative(frame_files[i])} for i in samples],
            "analyzer": "ffmpeg-scene-v1", "scene_threshold": 0.3,
            "source_fingerprint": expected_hash}


def extract_pair(source: Path, destination: Path, probe: dict, cut: int) -> dict:
    pts = probe["frame_pts"]
    if cut not in pts[1:]:
        raise ValueError("Cut must be a source-frame PTS after the start")
    if fingerprint(source) != probe["source_fingerprint"]:
        raise ValueError("Source fingerprint changed")
    index = pts.index(cut)
    destination.mkdir(parents=True, exist_ok=False)
    run(["ffmpeg", "-nostdin", "-v", "error", *INPUT_OPTIONS, "-threads", "1", "-i", str(source),
         "-map", "0:v:0", "-an", "-vf",
         f"select=eq(n\\,{index - 1})+eq(n\\,{index}),scale=320:320:force_original_aspect_ratio=decrease",
         "-fps_mode", "vfr", "-frames:v", "2", "-threads", "1", str(destination / "frame-%04d.jpg")], timeout=30)
    files = sorted(destination.glob("frame-*.jpg"))
    if len(files) != 2:
        raise ValueError("Cut evidence is incomplete")
    return {"pts": cut, "before_pts": pts[index - 1], "source": "manual",
            "before_url": files[0].relative_to(Path("output").resolve()).as_posix(),
            "after_url": files[1].relative_to(Path("output").resolve()).as_posix()}
