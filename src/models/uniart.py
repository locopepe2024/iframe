"""UniArt OpenAI-compatible image/video adapter.

The UniArt gateway exposes async image generation at /v1/images/generations and
async video generation at /v1/videos. Task status and authenticated result
content are read from /v1/videos/{task_id}.
"""
from __future__ import annotations
import base64, mimetypes, os, time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlsplit
import requests
from .base import VideoGenModel
from .image import ImageGenModel
from ..utils import get_logger

logger = get_logger(__name__)


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


def _poll(config: Dict[str, Any], task_id: str, max_wait: int = 900, endpoint: str = "videos") -> Dict[str, Any]:
    started = time.time()
    while time.time() - started < max_wait:
        resp = requests.get(
            f"{_base_url(config)}/{endpoint}/{task_id}",
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


def _download(config: Dict[str, Any], url: str, output_path: str, attempts: int = 6) -> str:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    # UniArt's signed COS URLs authenticate through their query string. Sending
    # the UniArt Bearer token to the storage host is unnecessary and can make
    # the CDN/COS request fail even though the signed URL is valid. Keep the
    # Bearer header only for UniArt-owned content endpoints.
    headers = {"Accept": "video/*,image/*,application/octet-stream,*/*"}
    target_host = urlsplit(url).netloc.lower()
    uniart_host = urlsplit(_base_url(config)).netloc.lower()
    if target_host and target_host == uniart_host:
        headers["Authorization"] = _headers(config)["Authorization"]
    partial_path = f"{output_path}.part"
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = requests.get(url, headers=headers, timeout=180, stream=True)
            if resp.status_code in {408, 425, 429} or resp.status_code >= 500:
                logger.warning(
                    "[UniArt] media download transient failure host=%s path=%s status=%s attempt=%s/%s",
                    urlsplit(url).netloc,
                    urlsplit(url).path,
                    resp.status_code,
                    attempt + 1,
                    attempts,
                )
                resp.close()
                raise requests.HTTPError(f"media download returned HTTP {resp.status_code}", response=resp)
            resp.raise_for_status()
            with open(partial_path, "wb") as f:
                for chunk in resp.iter_content(65536):
                    if chunk:
                        f.write(chunk)
            os.replace(partial_path, output_path)
            return output_path
        except requests.RequestException as exc:
            last_error = exc
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", None)
            retryable = status in {408, 425, 429} or (isinstance(status, int) and status >= 500)
            if not retryable or attempt == attempts - 1:
                raise
            time.sleep(min(5 * (2**attempt), 30))
    raise last_error or RuntimeError("media download failed")


def _result_urls(data: Dict[str, Any], kind: str) -> list[str]:
    candidates: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            candidates.append(value)

    add(data.get("result_url"))
    add(data.get("url"))
    add(data.get(f"{kind}_url"))
    add(data.get("content_url"))
    output = data.get("output") or data.get("data") or {}
    if isinstance(output, dict):
        add(output.get(f"{kind}_url"))
        add(output.get("url"))
        add(output.get("content_url"))
    content = data.get("content")
    add(content)
    if isinstance(content, dict):
        add(content.get(f"{kind}_url"))
        add(content.get("url"))
        add(content.get("content_url"))
    if isinstance(content, list):
        for item in content:
            add(item)
            if isinstance(item, dict):
                add(item.get(f"{kind}_url"))
                add(item.get("url"))
                add(item.get("content_url"))

    # Image task responses use the OpenAI-style data array:
    # {"object":"image.task", "data":[{"url":"https://..."}]}
    # Keep this separate from the video content shape but include it in the
    # common candidate ordering so signed COS URLs are still preferred.
    data_items = data.get("data")
    if isinstance(data_items, list):
        for item in data_items:
            add(item)
            if isinstance(item, dict):
                add(item.get("url"))
                add(item.get("image_url"))
                add(item.get("content_url"))

    # A signed object-storage URL is the durable media artifact. Try those
    # first, then gateway/content URLs. Do not collapse the result to a single
    # field: a transient 502 from one returned URL must not discard another
    # valid artifact URL from the same task response.
    signed = [candidate for candidate in candidates if "sign" in parse_qs(urlsplit(candidate).query)]
    return signed + [candidate for candidate in candidates if candidate not in signed]


def _result_url(data: Dict[str, Any], kind: str) -> str:
    urls = _result_urls(data, kind)
    if urls:
        return urls[0]
    raise RuntimeError(f"UniArt task has no {kind} result URL: {data}")


def _download_result(config: Dict[str, Any], data: Dict[str, Any], kind: str, output_path: str) -> str:
    urls = _result_urls(data, kind)
    if not urls:
        raise RuntimeError(f"UniArt task has no {kind} result URL: {data}")
    errors: list[str] = []
    for url in urls:
        try:
            return _download(config, url, output_path)
        except requests.RequestException as exc:
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", "request-error")
            errors.append(f"{urlsplit(url).netloc}{urlsplit(url).path}: HTTP {status}")
            logger.warning("[UniArt] result URL failed; trying next candidate: %s", errors[-1])
    raise RuntimeError(f"UniArt {kind} result download failed: {'; '.join(errors)}")


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
        result = _poll(self.config, task.get("task_id") or task.get("id"), endpoint="images")
        _download_result(self.config, result, "image", output_path)
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
        _download_result(self.config, result, "video", output_path)
        return output_path, time.time() - started
