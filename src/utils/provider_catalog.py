"""Explicit provider-scoped catalog projection; legacy catalogs are unchanged."""

import json
import os
from typing import Mapping
from urllib.request import Request, urlopen

from .uniart_catalog import normalize_uniart_catalog


def fetch_provider_catalog(provider: str, config: Mapping[str, str], *, timeout: float = 15) -> list[dict]:
    if provider not in ("uniart", "nsfw") or config.get("provider") != provider:
        raise ValueError("Catalog provider does not match credential profile")
    base = config["base_url"].rstrip("/")
    request = Request(f"{base}/models", headers={"Authorization": f"Bearer {config['api_key']}"}, method="GET")
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    models = normalize_uniart_catalog(payload)
    allowed = {item.strip() for item in os.getenv(f"{provider.upper()}_MODEL_ALLOWLIST", "").split(",") if item.strip()}
    result = []
    for model in models:
        raw_id = model["api_model_id"]
        if allowed and raw_id not in allowed:
            continue
        result.append({**model, "id": f"{provider}/{raw_id}", "provider": provider,
                       "description": f"{model['display_name']} via {provider}"})
    return result
