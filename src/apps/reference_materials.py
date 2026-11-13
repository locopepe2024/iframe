"""Owner-checked image materialization shared by Studio workbenches."""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from PIL import Image

from .media_registry import get_media, register_media
from .studio_access import studio_media_dir, studio_owner_key
from ..utils.managed_media_root import ManagedMediaRoot


def resolve_owned_image(owner: str, media_id: str, *, output_root: str) -> str:
    record = get_media(owner, media_id, output_root=output_root)
    if not record:
        raise ValueError("Reference image is not available to this owner")
    source = ManagedMediaRoot(output_root).resolve(record["storage_key"])
    # Registry entries are owner-scoped; verify their bytes as well as their ID.
    with Image.open(source) as image:
        image.verify()
    if record.get("sha256") and hashlib.sha256(source.read_bytes()).hexdigest() != record["sha256"]:
        raise ValueError("Reference image changed; please select it again")
    return str(source)


def materialize_image(owner: str, source: str, *, label: str = "", output_root: str) -> dict:
    source_path = Path(source)
    with Image.open(source_path) as image:
        image.verify()
        suffix = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}.get(image.format)
    if not suffix:
        raise ValueError("Unsupported reference image format")
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    directory = Path(studio_media_dir(owner, "uploads", output_root=output_root)) / "references"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (digest + suffix)
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        # Copy to a unique temporary file before an atomic replace.
        from uuid import uuid4
        temporary = directory / (uuid4().hex + ".tmp")
        try:
            shutil.copyfile(source_path, temporary)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    key = ManagedMediaRoot(output_root).key(str(target.resolve()))
    media_id = register_media(owner, key, kind="reference_input", display_name=label,
                              sha256=digest, output_root=output_root)
    return {"media_id": media_id, "storage_key": key,
            "path": f"/studio/owned-media/{studio_owner_key(owner)}/uploads/references/{target.name}",
            "label": label,
            "reference": {"asset_type": "media", "asset_id": media_id,
                          "variant_id": media_id, "source_scope": "private"}}
