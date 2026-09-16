"""UniArt OpenAI-compatible image/video adapter.

Image generation/edit may return final data or an accepted image task.
Image tasks use /v1/images/{task_id}; video tasks use /v1/videos/{task_id}.
"""
from __future__ import annotations
import base64, os, time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlsplit
import requests
from .base import VideoGenModel
from .image import ImageGenModel
from ..utils import get_logger

logger = get_logger(__name__)

# AtlasCloud/Cangyuan routes consume URL arrays. NewToken Discount edits use
# image_url objects instead; do not generalize that provider format to all SKUs.
_URL_ARRAY_IMAGE_MODELS = frozenset({
    "gpt-image-2", "gpt-image-2-special", "nano-banana-2-special",
    "gpt-image-2.5-flare-special", "gpt-image-2.5-sunburst-special",
})


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
    return _image_reference_url(value)


def _image_reference_url(value: str) -> str:
    """Publish image references through managed storage; never inline bytes."""
    if value.startswith(("https://", "http://")):
        return value
    if value.startswith(("data:", "blob:")):
        raise ValueError("UniArt image references require HTTP(S) material URLs")
    from ..utils.oss_utils import OSSImageUploader
    uploader = OSSImageUploader()
    if not uploader.is_configured:
        raise RuntimeError("Image reference material storage is not configured")
    path = value if os.path.isfile(value) else os.path.join("output", value)
    if not os.path.isfile(path):
        raise ValueError("Image edit material is not a resolved local file or HTTP(S) URL")
    key = uploader.upload_file(path, sub_path="image-edit-inputs")
    if not key:
        raise RuntimeError("Could not upload image edit material")
    url = uploader.sign_url_for_api(key)
    if not url or not url.startswith(("https://", "http://")):
        raise RuntimeError("Could not create image edit material URL")
    return url


def _post(config: Dict[str, Any], path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    resp = requests.post(f"{_base_url(config)}{path}", headers=_headers(config), json=body, timeout=90)
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        # Preserve the provider's actionable error without logging the request
        # body (which may contain prompts or media references) or credentials.
        detail = _provider_error_detail(resp)
        raise RuntimeError(detail) from exc
    data = resp.json()
    task_id = data.get("task_id") or data.get("id")
    if not task_id and not _image_bytes(data) and not _result_urls(data, "image"):
        raise RuntimeError("UniArt response has neither a task id nor image data")
    return data


def _image_bytes(data: Dict[str, Any]) -> bytes | None:
    items = data.get("data")
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and item.get("b64_json"):
            try:
                return base64.b64decode(item["b64_json"], validate=True)
            except (ValueError, TypeError):
                return None
    return None


def _provider_error_detail(resp: requests.Response) -> str:
    """Return a compact, secret-free error from a UniArt HTTP response."""
    status = resp.status_code
    code = ""
    message = ""
    request_id = resp.headers.get("X-Oneapi-Request-Id") or resp.headers.get("X-Request-Id") or ""
    try:
        payload = resp.json()
        error = payload.get("error", payload) if isinstance(payload, dict) else {}
        if isinstance(error, dict):
            code = str(error.get("code") or "").strip()
            message = str(error.get("message") or error.get("detail") or "").strip()
        elif error:
            message = str(error).strip()
    except (ValueError, requests.exceptions.JSONDecodeError):
        message = resp.text.strip()
    message = message[:1000] or "empty provider error response"
    suffix = f" (request id: {request_id})" if request_id else ""
    code_part = f" {code}" if code else ""
    return f"UniArt request failed ({status}{code_part}): {message}{suffix}"


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
        size = kwargs.get("size")
        if isinstance(size, str) and size.lower() in {"1k", "2k", "4k"}:
            body.pop("size", None)
            body["resolution"] = size.lower()
        if kwargs.get("aspect_ratio"):
            body["aspect_ratio"] = kwargs["aspect_ratio"]
        refs = list(kwargs.get("ref_image_paths") or [])
        if kwargs.get("ref_image_path"):
            refs.insert(0, kwargs["ref_image_path"])
        if refs:
            urls = [_image_reference_url(ref) for ref in refs]
            body["images"] = urls if model in _URL_ARRAY_IMAGE_MODELS else [{"image_url": url} for url in urls]
        mask = kwargs.get("mask")
        if mask:
            if not refs:
                raise ValueError("Mask editing requires a reference image")
            body["mask"] = _image_reference_url(mask)
            body["async"] = True
        endpoint = "/images/edits" if refs else "/images/generations"
        task = _post(self.config, endpoint, body)
        image = _image_bytes(task)
        if image is not None:
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "wb") as target:
                target.write(image)
        elif _result_urls(task, "image"):
            _download_result(self.config, task, "image", output_path)
        else:
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
        elif kwargs.get("ref_image_urls") or kwargs.get("ref_video_urls"):
            body["content"] = [
                {"type": "image_url", "role": "reference_image", "image_url": {"url": _media(ref)}}
                for ref in kwargs.get("ref_image_urls", [])
            ] + [
                {"type": "video_url", "role": "reference_video", "video_url": {"url": _media(ref)}}
                for ref in kwargs.get("ref_video_urls", [])
            ]
        else:
            image = _media(kwargs.get("img_url") or kwargs.get("img_path"))
            if image:
                body["input_reference"] = image
        task = _post(self.config, "/videos", body)
        result = _poll(self.config, task.get("task_id") or task.get("id"))
        _download_result(self.config, result, "video", output_path)
        return output_path, time.time() - started
