"""Build a pinned metadata-only platform pack from open-pose-costume catalog.json."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


SOURCE_REVISION = "321eae5ba196e2b6ddc250294ff34de2d167a6e3"
CUSTOM_BASE = f"https://raw.githubusercontent.com/locopepe2024/open-pose-costume/{SOURCE_REVISION}/public/"
ALLOWED_HOSTS = {
    "ai-pose-gallery.pages.dev", "ai-pose-depth-gallery.pages.dev",
    "ai-costume-gallery.pages.dev", "ai-costume-anime-gallery.pages.dev",
    "ai-portrait-gallery.pages.dev", "raw.githubusercontent.com",
}
KINDS = {"pose", "costume", "character"}


def image_url(value: str) -> str:
    if not isinstance(value, str) or not value or value.startswith(("/", "\\")):
        raise ValueError("invalid source image path")
    url = value if value.startswith("https://") else CUSTOM_BASE + value
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or not re.search(r"\.(png|jpe?g|webp)$", parsed.path, re.I)
            or ".." in parsed.path.split("/")):
        raise ValueError("source image URL is not allowed")
    return url


def build(source: Path) -> dict:
    source_bytes = source.read_bytes()
    catalog = json.loads(source_bytes)
    resources = []
    seen = set()
    for item in catalog["items"]:
        kind = item["kind"]
        if kind not in KINDS:
            raise ValueError("unknown reference kind")
        for variant in item["variants"]:
            for representation, media in [("image", variant)] + ([("depth_reference", variant["depth"])] if variant.get("depth") else []):
                identity = f"{kind}:{item['id']}:{variant['id']}:{representation}"
                resource_id = "iframe.opc." + hashlib.sha256(identity.encode()).hexdigest()[:32]
                if resource_id in seen:
                    raise ValueError("duplicate source reference")
                seen.add(resource_id)
                original = image_url(media["original"])
                thumbnail = image_url(media["thumbnail"])
                tags = [tag["zh"] for tag in item.get("tags", [])]
                if representation == "depth_reference":
                    tags.append("深度视觉参考")
                source_hash = media.get("provenance", {}).get("originalSha256")
                resources.append({
                    "platform_resource_id": resource_id, "revision": 1, "kind": "image",
                    "category_path": f"reference/{kind}", "status": "active",
                    "title": f"{item['title']['zh']} · {variant['label']['zh']}" + (" · 深度参考" if representation == "depth_reference" else ""),
                    "summary": item["keywords"]["zh"], "tags": tags,
                    "payload": {"remote_url": original, "thumbnail_url": thumbnail,
                                "media_sha256": source_hash, "source_variant_id": variant["id"],
                                "angle": variant["angle"], "representation": representation},
                    "provenance": {"source": "open-pose-costume", "source_url": item["source"] if item["source"] != "custom" else CUSTOM_BASE,
                                   "source_item_id": item["id"], "source_revision": SOURCE_REVISION,
                                   "collection": item.get("collection", "upstream"),
                                   "license": "source_terms_apply", "content_sha256": hashlib.sha256(
                                       json.dumps([identity, original, source_hash], ensure_ascii=False).encode()).hexdigest()},
                })
    if len(catalog["items"]) != catalog["stats"]["references"] or len(resources) < catalog["stats"]["images"]:
        raise ValueError("source catalog count mismatch")
    return {"source_revision": SOURCE_REVISION, "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "source_counts": catalog["stats"], "resources": resources}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    payload = build(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as stream:
        with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
            compressed.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    print(f"{len(payload['resources'])} platform reference images from {payload['source_revision']}")


if __name__ == "__main__":
    main()
