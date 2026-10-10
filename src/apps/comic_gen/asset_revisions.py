"""Persisted semantic asset snapshots, independent of delivery URLs and task state."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from .models import AssetRevision, Character, Prop, Scene


SemanticAsset = Character | Scene | Prop
ConfirmationStatus = Literal["legacy_attached", "user_confirmed"]

_TRANSIENT_FIELDS = {
    "asset_revision", "asset_revisions", "owner_user_id", "owner_profile_id",
    "status", "generation_error", "generation_lineage", "director_review_required",
    "director_profile_revision", "director_profile_hash", "locked", "starred",
    "video_assets",
}


def asset_snapshot(asset: SemanticAsset) -> dict:
    return asset.model_dump(mode="json", exclude=_TRANSIENT_FIELDS)


def commit_asset_revision(
    asset: SemanticAsset, confirmation_status: ConfirmationStatus = "legacy_attached",
    *, force_new: bool = False,
) -> AssetRevision:
    snapshot = asset_snapshot(asset)
    content_hash = hashlib.sha256(json.dumps(
        snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    if (not force_new and asset.asset_revisions and asset.asset_revisions[-1].content_hash == content_hash
            and (confirmation_status == "legacy_attached"
                 or asset.asset_revisions[-1].confirmation_status == "user_confirmed")):
        return asset.asset_revisions[-1]
    revision = max([asset.asset_revision, *(item.revision for item in asset.asset_revisions)]) + 1
    item = AssetRevision(revision=revision, content_hash=content_hash,
                         snapshot=snapshot, confirmation_status=confirmation_status)
    asset.asset_revisions.append(item)
    asset.asset_revision = revision
    return item


def current_asset_revision(asset: SemanticAsset) -> AssetRevision:
    return commit_asset_revision(asset)
