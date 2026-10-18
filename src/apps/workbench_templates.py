"""Read-only, media-free task templates imported from reviewed source text."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).resolve().parents[2] / "config" / "workbench_templates" / "catalog.json"
STATIONS = {"character", "scene", "prop", "shot"}
KINDS = {"image", "video"}


def list_workbench_templates(
    *, station: str | None = None, kind: str | None = None, query: str = "",
    path: Path = CATALOG_PATH,
) -> dict[str, Any]:
    if station is not None and station not in STATIONS:
        raise ValueError("invalid template station")
    if kind is not None and kind not in KINDS:
        raise ValueError("invalid template kind")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or not isinstance(payload.get("templates"), list):
        raise ValueError("invalid workbench template catalog")
    seen: set[str] = set()
    for item in payload["templates"]:
        if not isinstance(item, dict) or not all(item.get(key) for key in (
            "template_id", "revision", "kind", "station", "title", "focus", "source"
        )):
            raise ValueError("invalid workbench template")
        if item["template_id"] in seen or item["station"] not in STATIONS or item["kind"] not in KINDS:
            raise ValueError("invalid workbench template identity or type")
        seen.add(item["template_id"])
        if item.get("media") != [] or not isinstance(item.get("input_slots"), list):
            raise ValueError("workbench templates must be media-free with input slots")
        if not all(isinstance(slot, dict) and slot.get("id") and slot.get("label") for slot in item["input_slots"]):
            raise ValueError("invalid workbench template input slot")
    needle = query.strip().casefold()
    selected = [item for item in payload["templates"] if
                (station is None or item["station"] == station)
                and (kind is None or item["kind"] == kind)
                and (not needle or needle in " ".join((item["title"], item["focus"], item["template_id"])).casefold())]
    return {"schema_version": 1, "catalog_revision": payload["catalog_revision"], "templates": selected}
