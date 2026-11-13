"""Owner-checked image materialization shared by Studio workbenches."""
from __future__ import annotations

import hashlib
import json
import re
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


def materialize_image(owner: str, source: str, *, label: str = "", output_root: str,
                      context: dict | None = None) -> dict:
    source_path = Path(source)
    with Image.open(source_path) as image:
        image.verify()
        suffix = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}.get(image.format)
    if not suffix:
        raise ValueError("Unsupported reference image format")
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    directory = Path(studio_media_dir(owner, "uploads", output_root=output_root)) / "references"
    directory.mkdir(parents=True, exist_ok=True)
    # Identical pixels can describe different resources/views. Keep their evidence separate.
    context_key = ("-" + hashlib.sha256(json.dumps(context, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]) if context else ""
    target = directory / (digest + context_key + suffix)
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
                              sha256=digest, metadata={"platform_reference_context": context} if context else None, output_root=output_root)
    return {"media_id": media_id, "storage_key": key,
            "path": f"/studio/owned-media/{studio_owner_key(owner)}/uploads/references/{target.name}",
            "label": label, "context": context,
            "reference": {"asset_type": "media", "asset_id": media_id,
                          "variant_id": media_id, "source_scope": "private"}}


def reference_context(reference, owner: str, *, output_root: str) -> dict | None:
    """Read canonical platform meaning; browser labels never define semantics."""
    identity = reference.model_dump(exclude_none=True) if hasattr(reference, "model_dump") else reference
    if not identity:
        return None
    if identity.get("asset_type") == "media":
        record = get_media(owner, identity["asset_id"], output_root=output_root)
        if not record:
            raise ValueError("Reference image is not available to this owner")
        return (record.get("metadata") or {}).get("platform_reference_context")
    if identity.get("asset_type") != "platform_reference":
        return None
    from .platform_reference_catalog import platform_resource_by_id
    resource = platform_resource_by_id(identity["asset_id"])
    revision = identity.get("revision", int(identity["variant_id"]))
    if (not resource or resource.get("status") != "active" or resource.get("kind") != "image"
            or resource.get("revision") != revision or str(revision) != identity["variant_id"]):
        raise ValueError("Platform reference is unavailable or its revision changed")
    payload = resource.get("payload") or {}
    semantics = {key: payload[key] for key in (
        "angle", "representation", "pose", "action", "viewpoint", "camera_angle", "reference_role", "usage_notes",
    ) if isinstance(payload.get(key), (str, list, dict))}
    dictionary = resource.get("dictionary") or {}
    semantics.update({key: dictionary[key] for key in ("semantic_domain", "entry_type") if key in dictionary})
    return {"platform_resource_id": resource["platform_resource_id"], "revision": revision,
            "title": resource.get("title", ""), "summary": resource.get("summary", ""),
            "tags": resource.get("tags", []), "category_path": resource.get("category_path", ""),
            "semantics": semantics}


def media_path_context(owner: str, source: str, *, output_root: str) -> dict | None:
    """Recover evidence for the exact owner-owned transport path, including after reload."""
    from .media_registry import get_media_by_storage_key
    managed = ManagedMediaRoot(output_root)
    try:
        path = managed.resolve(source)
        key = managed.key(str(path.resolve()))
    except ValueError:
        return None
    record = get_media_by_storage_key(owner, key, output_root=output_root)
    return (record.get("metadata") or {}).get("platform_reference_context") if record else None


def append_reference_context(prompt: str, contexts: list[dict | None]) -> str:
    """Replace our generated evidence block so deselection/reordering cannot leak old context."""
    opening, closing = "<platform_reference_context>", "</platform_reference_context>"
    original = prompt
    prompt = re.sub(r"\n*<platform_reference_context>.*?</platform_reference_context>", "", prompt, flags=re.DOTALL)
    blocks = []
    for index, context in enumerate(contexts, 1):
        if not context:
            continue
        data = json.dumps(context, ensure_ascii=False, sort_keys=True).replace("<", "\\u003c").replace(">", "\\u003e")
        blocks.append(f'<platform_reference index="{index}">\n{data}\n</platform_reference>')
    if not blocks:
        return prompt if prompt != original else original
    guidance = ("平台参考素材说明：序号对应所选补充参考素材组内顺序，不代表全部输入图片的全局编号。以下为图片的描述性资料。"
                "结合用户要求使用其动作、视角、构图等语义；标签不自动覆盖主体身份、服装或画风。"
                "具体视角以 semantics 中的 angle/viewpoint 为准，摘要可能介绍整个素材系列。"
                "depth_reference 表示深度结构视觉参考，lineart 表示结构线稿，不要求将成片画成灰度深度图或线稿。")
    return "\n\n".join([prompt, opening + "\n" + guidance + "\n" + "\n".join(blocks) + "\n" + closing])
