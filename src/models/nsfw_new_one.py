"""Image and video adapters for the nsfw host's New One gateway."""

from __future__ import annotations

import os
import time
from math import gcd
from urllib.parse import urlsplit

import requests

from .image import ImageGenModel
from .base import VideoGenModel
from ..apps.studio_access import signed_provider_media_url


SEEDREAM_MODEL = "seedream_5.0Pro_nsfw"
SEEDREAM_IDS = frozenset({f"nsfw/{SEEDREAM_MODEL}", f"uniart/{SEEDREAM_MODEL}"})
WAN_MODELS = frozenset({"wan3.0", "wan3.0-Prime"})
WAN_IDS = frozenset(f"{prefix}/{model}" for prefix in ("nsfw", "uniart") for model in WAN_MODELS)
RATIOS = frozenset({"1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"})


def gateway_config(owner_config: dict) -> dict:
    base = os.getenv("NSFW_NEW_ONE_BASE_URL", "").strip().rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not parsed.path.endswith("/v1"):
        raise RuntimeError("NSFW_NEW_ONE_BASE_URL must be a New One /v1 URL")
    key = owner_config.get("api_key") or owner_config.get("UNIART_API_KEY")
    if not key:
        raise RuntimeError("nsfw New One API key is not configured")
    return {"base_url": base, "api_key": key}


def _reference_url(value: str) -> str:
    if value.startswith(("http://", "https://")):
        return value
    path = value if os.path.isfile(value) else os.path.join("output", value)
    return signed_provider_media_url(path)


def _size(value: str | None) -> tuple[str, str | None]:
    if not value:
        return "1K", None
    if value.upper() in {"1K", "2K"}:
        return value.upper(), None
    separator = "*" if "*" in value else "x" if "x" in value.lower() else None
    if separator:
        width, height = (int(part) for part in value.lower().split(separator))
        if min(width, height) <= 0 or max(width, height) > 2048:
            raise ValueError("Seedream dimensions must be within 2K")
        factor = gcd(width, height)
        ratio = f"{width // factor}:{height // factor}"
        if ratio not in RATIOS:
            raise ValueError("Unsupported Seedream aspect ratio")
        return ("1K" if max(width, height) <= 1024 else "2K"), ratio
    raise ValueError("Seedream resolution must be 1K or 2K")


class NSFWNewOneImageModel(ImageGenModel):
    def __init__(self, owner_config: dict):
        self.config = gateway_config(owner_config)

    def generate(self, prompt: str, output_path: str, **kwargs) -> tuple[str, float]:
        started = time.time()
        model = kwargs.get("model_name") or f"nsfw/{SEEDREAM_MODEL}"
        if model not in SEEDREAM_IDS:
            raise ValueError("Unsupported nsfw image model")
        resolution, inferred_ratio = _size(kwargs.get("size"))
        ratio = kwargs.get("aspect_ratio") or inferred_ratio or "1:1"
        if ratio not in RATIOS:
            raise ValueError("Unsupported Seedream aspect ratio")
        refs = list(kwargs.get("ref_image_paths") or [])
        if kwargs.get("ref_image_path"):
            refs.insert(0, kwargs["ref_image_path"])
        if len(refs) > 10:
            raise ValueError("Seedream accepts at most 10 reference images")
        body = {"model": SEEDREAM_MODEL, "prompt": prompt, "resolution": resolution, "aspect_ratio": ratio}
        if refs:
            body["images"] = [_reference_url(ref) for ref in refs]
        headers = {"Authorization": f"Bearer {self.config['api_key']}"}
        base = self.config["base_url"]
        path = "/images/edits" if refs else "/images/generations"
        response = requests.post(base + path, headers=headers, json=body, timeout=300)
        response.raise_for_status()
        result = response.json()
        if result.get("status") in {"failed", "FAILURE"}:
            raise RuntimeError(str(result.get("error") or "Seedream task failed"))
        task_id = result.get("id") or result.get("task_id")
        url = _result_url(result)
        while not url and task_id:
            if time.time() - started > 900:
                raise TimeoutError("Seedream task did not complete within 15 minutes")
            time.sleep(5)
            status_response = requests.get(f"{base}/images/{task_id}", headers=headers, timeout=30)
            status_response.raise_for_status()
            result = status_response.json()
            if result.get("status") in {"failed", "FAILURE"}:
                raise RuntimeError(str(result.get("error") or "Seedream task failed"))
            url = _result_url(result)
        if not url:
            raise RuntimeError("Seedream response has no image URL")
        image = requests.get(url, timeout=120)
        image.raise_for_status()
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "wb") as target:
            target.write(image.content)
        return output_path, time.time() - started


def _result_url(result: dict) -> str | None:
    data = result.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0].get("url")
    return result.get("image_url") or result.get("result_url")


class NSFWNewOneVideoModel(VideoGenModel):
    def __init__(self, owner_config: dict):
        self.config = gateway_config(owner_config)

    def generate(self, prompt: str, output_path: str, **kwargs) -> tuple[str, float]:
        started = time.time()
        model_id = kwargs.get("model") or kwargs.get("model_name") or "nsfw/wan3.0"
        if model_id not in WAN_IDS:
            raise ValueError("Unsupported nsfw video model")
        base = self.config["base_url"]
        headers = {"Authorization": f"Bearer {self.config['api_key']}"}
        task_id = kwargs.get("resume_task_id")
        if not task_id:
            duration = int(kwargs.get("duration") or 4)
            resolution = kwargs.get("resolution") or "720p"
            ratio = kwargs.get("aspect_ratio") or "16:9"
            if not 2 <= duration <= 30 or resolution not in {"480p", "720p", "1080p"}:
                raise ValueError("Unsupported Wan 3.0 duration or resolution")
            if ratio not in {"16:9", "9:16", "1:1", "4:3", "3:4"}:
                raise ValueError("Unsupported Wan 3.0 aspect ratio")
            body = {
                "model": model_id.split("/", 1)[1],
                "prompt": prompt,
                "duration": duration,
                "resolution": resolution,
                "aspect_ratio": ratio,
            }
            references = list(kwargs.get("ref_image_urls") or [])
            image = kwargs.get("img_url") or kwargs.get("img_path")
            if image and image not in references:
                references.insert(0, image)
            if len(references) > 10:
                raise ValueError("Wan 3.0 accepts at most 10 reference images")
            if references:
                body["reference_images"] = [_reference_url(value) for value in references]
            if kwargs.get("ref_video_urls") or kwargs.get("ref_audio_urls"):
                raise ValueError("Wan 3.0 accepts image references only")
            response = requests.post(base + "/videos", headers=headers, json=body, timeout=120)
            response.raise_for_status()
            result = response.json()
            task_id = result.get("id") or result.get("task_id")
            if not task_id:
                raise RuntimeError("New One video response has no task ID")
            if kwargs.get("on_task_submitted"):
                kwargs["on_task_submitted"](task_id)
        while True:
            if time.time() - started > 1800:
                raise TimeoutError("Wan 3.0 task did not complete within 30 minutes")
            response = requests.get(f"{base}/videos/{task_id}", headers=headers, timeout=30)
            response.raise_for_status()
            result = response.json()
            status = str(result.get("status") or "").lower()
            if status in {"failed", "failure", "error"}:
                error = result.get("error")
                raise RuntimeError(str(error.get("message") if isinstance(error, dict) else error or "Wan task failed"))
            if status in {"completed", "success", "succeeded"}:
                url = result.get("video_url") or result.get("result_url")
                if not url:
                    raise RuntimeError("Completed Wan task has no video URL")
                break
            time.sleep(5)
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with requests.get(url, timeout=180, stream=True) as media:
            media.raise_for_status()
            with open(output_path + ".part", "wb") as target:
                for chunk in media.iter_content(65536):
                    if chunk:
                        target.write(chunk)
        os.replace(output_path + ".part", output_path)
        return output_path, time.time() - started
