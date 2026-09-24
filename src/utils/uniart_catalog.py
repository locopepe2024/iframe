"""Normalize UniArt's authoritative media capability catalog for iFrame."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Mapping
from urllib.request import Request, urlopen


MODE_MAP = {
    "text_to_video": "t2v",
    "image_to_video": "i2v",
    "image_reference": "i2v",
    "omni_reference": "r2v",
    "first_last_frame": "f2v",
}


def _unique(values: Iterable[str]) -> List[str]:
    return list(dict.fromkeys(value for value in values if value))


def _display_name(model_id: str) -> str:
    tokens = model_id.replace("_", "-").split("-")
    acronyms = {"gpt": "GPT", "h3": "H3", "vip": "VIP", "ir": "IR"}
    return " ".join(acronyms.get(token.lower(), token.capitalize()) for token in tokens)


def _family(model_id: str) -> str:
    low = model_id.lower()
    if "seedance" in low:
        return "seedance"
    if "minimax" in low or "h3" in low:
        return "minimax"
    if low.startswith("wan-"):
        return "wan"
    if low.startswith("gpt-image"):
        return "gpt-image"
    if low.startswith("nano-banana"):
        return "nano-banana"
    return "uniart"


def normalize_uniart_model(item: Dict[str, Any]) -> Dict[str, Any] | None:
    model_id = str(item.get("id") or "").strip()
    if not model_id:
        return None

    video = item.get("video_capability") if isinstance(item.get("video_capability"), dict) else {}
    image = item.get("image_capability") if isinstance(item.get("image_capability"), dict) else {}
    audio = item.get("audio_capability") if isinstance(item.get("audio_capability"), dict) else {}
    mode_ids = [
        str(mode.get("id") or "")
        for mode in video.get("modes", [])
        if isinstance(mode, dict)
    ]
    capabilities = _unique(MODE_MAP.get(mode_id, "") for mode_id in mode_ids)
    if image.get("supports_generation"):
        capabilities.append("t2i")
    if image.get("supports_edit"):
        capabilities.append("i2i")
    # Some UniArt GPT Image route aliases publish generic OpenAI metadata
    # without image_capability. Their stable model prefix still identifies
    # the image API family.
    if model_id.lower().startswith("gpt-image-"):
        capabilities.extend(("t2i", "i2i"))
    if audio.get("supports_generation") or audio.get("supports_tts") or audio.get("supports_speech"):
        capabilities.append("audio")
    # Older UniArt payloads identify these MiniMax audio SKUs only by ID.
    if model_id.lower().startswith("minimax") and any(token in model_id.lower() for token in ("speed-hd", "speed_hd", "-turbo", "_turbo")):
        capabilities.append("audio")
    capabilities = _unique(capabilities)
    # UniArt's /models endpoint also publishes chat SKUs. Keep them in the
    # selectable catalog even though they have no image/video controls.
    if not capabilities:
        capabilities = ["chat"]

    is_image = any(capability in {"t2i", "i2i"} for capability in capabilities)
    resolutions = video.get("resolutions") or image.get("resolutions") or []
    resolutions = [str(value) for value in resolutions if value is not None]
    ratios = [str(value) for value in video.get("ratios", []) if value is not None]
    ratios_by_resolution = {
        str(key): [str(value) for value in values]
        for key, values in (video.get("ratios_by_resolution") or {}).items()
        if isinstance(values, list)
    }
    durations = [int(value) for value in video.get("durations", []) if isinstance(value, (int, float))]

    params: Dict[str, Any] = {}
    if resolutions:
        key = "size" if is_image and not any(capability.endswith("2v") for capability in capabilities) else "resolution"
        default = image.get("default_resolution") if key == "size" else video.get("default_resolution")
        params[key] = {"options": resolutions, "default": str(default or resolutions[0])}
    if ratios:
        params["ratio"] = {
            "options": ratios,
            "default": str(video.get("default_ratio") or ratios[0]),
        }
    if ratios_by_resolution:
        params["ratiosByResolution"] = ratios_by_resolution
    if video.get("supports_generate_audio") is not None:
        # This public field does not gate whether generate_audio may be set.
        # params.audio describes availability of the UI control, not its value.
        params["audio"] = True

    duration = None
    if durations:
        duration = {
            "type": "slider",
            "min": min(durations),
            "max": max(durations),
            "step": 1,
            "default": int(video.get("default_duration") or durations[0]),
        }

    return {
        "id": f"uniart/{model_id}",
        "api_model_id": model_id,
        "display_name": _display_name(model_id),
        "description": f"{_display_name(model_id)} via UniArt",
        "family": _family(model_id),
        "provider": "uniart",
        "capabilities": capabilities,
        "duration": duration,
        "params": params,
        "inputs": {
            "reference_images": {"max": int((image.get("max_input_images") if is_image else video.get("max_reference_images")) or 0)},
            "reference_videos": {"max": int(video.get("max_reference_videos") or 0)},
            "reference_audios": {"max": int(video.get("max_reference_audios") or 0)},
        },
    }


def normalize_uniart_catalog(payload: Any) -> List[Dict[str, Any]]:
    items = payload.get("data", []) if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []
    return [model for item in items if isinstance(item, dict) if (model := normalize_uniart_model(item))]


def fetch_uniart_catalog(config: Mapping[str, Any], *, timeout: float = 15) -> List[Dict[str, Any]]:
    """Fetch and normalize the owner-scoped UniArt model catalog.

    This helper deliberately returns capability metadata only.  Credentials
    are read from ``config`` to construct the request but are never included
    in the returned payload or in an exception message.
    """
    base_url = str(config.get("base_url") or "").strip().rstrip("/")
    api_key = str(config.get("api_key") or "").strip()
    if not base_url:
        raise ValueError("UniArt base URL is not configured")
    if not api_key:
        raise ValueError("UniArt API key is not configured")
    request = Request(
        f"{base_url}/models",
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return normalize_uniart_catalog(payload)
