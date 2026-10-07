"""Owner-scoped media reference normalization.

Delivery routes are intentionally different by producer, but every managed
route is normalized before a provider or local resolver sees it.  This module
does not fetch arbitrary remote URLs.
"""

from urllib.parse import urlsplit


MANAGED_MEDIA_PATHS = (
    "/playground/media/",
    "/playground/input-media/",
    "/studio/media/",
)


def normalize_managed_media_reference(value: str) -> str | None:
    """Return a canonical path for a managed media URL/path.

    Query parameters are retained because signed Studio/Playground delivery
    references need them for owner and expiry validation. Absolute URLs are
    reduced to their path only when they point at a managed route. Arbitrary
    remote URLs return ``None`` and remain outside the server fetch boundary.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    parsed = urlsplit(value.strip())
    path = parsed.path
    if not path.startswith(MANAGED_MEDIA_PATHS):
        return None
    return path + (f"?{parsed.query}" if parsed.query else "")
