"""Explicit provider-scoped catalog projection; legacy catalogs are unchanged."""

import json
import os
from typing import Mapping
from urllib.request import Request, urlopen

from .uniart_catalog import normalize_uniart_catalog


def fetch_provider_catalog(provider: str, config: Mapping[str, str], *, timeout: float = 15) -> list[dict]:
    public_id = "greena" if provider in ("greena", "nsfw") else provider
    compatible_ids = {"greena", "nsfw"} if public_id == "greena" else {"uniart"}
    if provider not in ("uniart", "greena", "nsfw") or config.get("provider") not in compatible_ids:
        raise ValueError("Catalog provider does not match credential profile")
    base = config["base_url"].rstrip("/")
    request = Request(f"{base}/models", headers={"Authorization": f"Bearer {config['api_key']}"}, method="GET")
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    models = normalize_uniart_catalog(payload)
    env_name = "UNIART_MODEL_ALLOWLIST"
    if public_id == "greena":
        env_name = "GREENA_MODEL_ALLOWLIST" if "GREENA_MODEL_ALLOWLIST" in os.environ else "NSFW_MODEL_ALLOWLIST"
    allowed = {item.strip() for item in os.getenv(env_name, "").split(",") if item.strip()}
    result = []
    for model in models:
        raw_id = model["api_model_id"]
        if allowed and raw_id not in allowed:
            continue
        namespace = "nsfw" if public_id == "greena" else "uniart"
        result.append({**model, "id": f"{namespace}/{raw_id}", "provider": public_id,
                       "description": f"{model['display_name']} via {'GreenA' if public_id == 'greena' else 'UniArt'}"})
    return result
