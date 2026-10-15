from urllib.error import HTTPError

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api


def test_catalog_rejected_owner_key_has_actionable_error(monkeypatch):
    monkeypatch.setattr(api, "studio_uniart_config", lambda: {
        "api_key": "owner-key", "base_url": "https://uniart.fun/v1"
    })

    def rejected(_config):
        raise HTTPError("https://uniart.fun/v1/models", 401, "Unauthorized", None, None)

    monkeypatch.setattr(api, "fetch_uniart_catalog", rejected)
    with pytest.raises(HTTPException) as exc_info:
        api.get_uniart_models()

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "uniart_catalog_credential_rejected"
