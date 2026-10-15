"""Supplier-neutral configuration for upstream access to local media."""

import os
from urllib.parse import urlsplit


def provider_media_origin() -> str | None:
    """Return a validated origin, or None when local publication is disabled.

    A present but invalid new setting must never activate the legacy origin.
    """
    name = ("PROVIDER_MEDIA_PUBLIC_BASE_URL" if "PROVIDER_MEDIA_PUBLIC_BASE_URL" in os.environ
            else "UNIART_MEDIA_BASE_URL")
    raw = os.getenv(name)
    if raw is None or (name == "UNIART_MEDIA_BASE_URL" and not raw.strip()):
        return None
    base = raw.strip().rstrip("/")
    try:
        parsed = urlsplit(base)
        _ = parsed.port  # Validate malformed/out-of-range ports as well.
        valid = (
            parsed.scheme in ("http", "https") and parsed.hostname
            and parsed.username is None and parsed.password is None
            and not parsed.path and not parsed.query and not parsed.fragment
            and not any(c.isspace() or ord(c) < 32 for c in base)
            and "\\" not in base and "?" not in base and "#" not in base
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError(f"{name} must be an HTTP(S) origin without credentials, path, query or fragment")
    return base


def provider_media_ttl_seconds() -> int:
    name = "PROVIDER_MEDIA_URL_TTL_SECONDS"
    raw = os.getenv(name, "1800")
    if not raw.isascii() or not raw.isdecimal() or int(raw) <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return int(raw)
