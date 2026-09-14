"""UniArt OpenAI-compatible image/video adapter.

The UniArt gateway exposes async image generation at /v1/images/generations and
async video generation at /v1/videos. Task status and authenticated result
content are read from /v1/videos/{task_id}.
"""
from __future__ import annotations
import base64, mimetypes, os, time
from typing import Any, Dict, Optional, Tuple
import requests
from .base import VideoGenModel
from .image import ImageGenModel


def _base_url(config: Dict[str, Any]) -> str:
    return str(
        config.get("base_url")
        or config.get("UNIART_BASE_URL")
        or os.getenv("UNIART_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://uniart.fun/v1"
    ).rstrip("/")


def _headers(config: Dict[str, Any]) -> Dict[str, str]:
    key = (
        config.get("api_key")
        or config.get("UNIART_API_KEY")
        or os.getenv("UNIART_API_KEY")
        or os.getenv("OPENAI_API_KEY")
    )
    if not key:
        raise RuntimeError("UNIART_API_KEY or OPENAI_API_KEY is required")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _media(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if value.startswith(("http://", "https://", "data:")):
        return value
    path = value if os.path.exists(value) else os.path.join("output", value)
    if not os.path.exists(path):
        return value
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


def _post(config: Dict[str, Any], path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    resp = requests.post(f"{_base_url(config)}{path}", headers=_headers(config), json=body, timeout=90)
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("task_id") or data.get("id")
    if not task_id:
        raise RuntimeError(f"UniArt response has no task id: {data}")
    return data


def _poll(config: Dict[str, Any], task_id: str, max_wait: int = 900) -> Dict[str, Any]:
    started = time.time()
    while time.time() - started < max_wait:
        resp = requests.get(
            f"{_base_url(config)}/videos/{task_id}",
            headers=_headers(config),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        status = str(data.get("status") or "").lower()
        if status in {"completed", "succeeded", "success"}:
            return data
        if status in {"failed", "error", "cancelled", "canceled"}:
            err = data.get("error") or {}
            raise RuntimeError(f"UniArt task {status}: {err.get('message', err) if isinstance(err, dict) else err}")
        time.sleep(10)
    raise RuntimeError(f"UniArt task timed out after {max_wait}s")


def _download(config: Dict[str, Any], url: str, output_path: str) -> str:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    resp = requests.get(url, headers=_headers(config), timeout=180, stream=True)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(65536):
            f.write(chunk)
    return output_path


def _result_url(data: Dict[str, Any], kind: str) -> str:
    url = data.get("result_url") or data.get("url")
    if url:
        return url
    output = data.get("output") or data.get("data") or {}
    if isinstance(output, dict):
        url = output.get(f"{kind}_url") or output.get("url")
        if url:
            return url
    raise RuntimeError(f"UniArt task has no {kind} result URL: {data}")


class UniArtImageModel(ImageGenModel):
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}

    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        started = time.time()
        model = (kwargs.get("model_name") or "gpt-image-2").removeprefix("uniart/")
        body: Dict[str, Any] = {"model": model, "prompt": prompt}
        for key in ("size", "quality", "n"):
            if kwargs.get(key) is not None:
                body[key] = kwargs[key]
        task = _post(self.config, "/images/generations", body)
        result = _poll(self.config, task.get("task_id") or task.get("id"))
        _download(self.config, _result_url(result, "image"), output_path)
        return output_path, time.time() - started


class UniArtVideoModel(VideoGenModel):
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}

    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        started = time.time()
        model = (kwargs.get("model") or kwargs.get("model_name") or "seedance-2.5-vip").removeprefix("uniart/")
        body: Dict[str, Any] = {"model": model, "prompt": prompt}
        for key in ("duration", "resolution", "size", "ratio", "aspect_ratio", "watermark", "generate_audio"):
            if kwargs.get(key) is not None:
                body[key] = kwargs[key]
        first_frame = _media(kwargs.get("first_frame"))
        last_frame = _media(kwargs.get("last_frame"))
        if first_frame or last_frame:
            if not first_frame or not last_frame:
                raise ValueError("UniArt first/last-frame mode requires both frames")
            body["content"] = [
                {"type": "image_url", "role": "first_frame", "image_url": {"url": first_frame}},
                {"type": "image_url", "role": "last_frame", "image_url": {"url": last_frame}},
            ]
        else:
            image = _media(kwargs.get("img_url") or kwargs.get("img_path"))
            if image:
                body["input_reference"] = image
        task = _post(self.config, "/videos", body)
        result = _poll(self.config, task.get("task_id") or task.get("id"))
        _download(self.config, _result_url(result, "video"), output_path)
        return output_path, time.time() - started
