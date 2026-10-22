"""Explicit, bounded projection from a selected storyboard reference.

The module intentionally has no notion of a previous frame.  A caller must
provide the source frame or asset that the creator selected.  Only structured
visual fields are extracted; source prompts and narrative fields are never a
projection input.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from .models import StoryboardFrame, StoryboardReferenceProjectionSnapshot


REFERENCE_FIELDS = ("lighting", "space", "camera", "continuity_state")
WORLD_LIGHT_KEYS = (
    "story_time", "daylight_phase", "time_of_day", "season", "weather",
    "shadow_direction",
)
LIGHT_KEYS = (
    *WORLD_LIGHT_KEYS,
    "key_source", "color_tone", "contrast", "practical_sources", "direction",
    "quality", "color_temp", "description", "ambient_lighting",
    "key_light_direction", "local_lighting", "source", "fill", "shadow",
    "rim", "mood", "air", "color",
)
SPACE_KEYS = ("location", "reference_viewpoint", "reference_framing")
CAMERA_KEYS = ("shot_size", "camera_angle", "camera_movement", "composition")


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(exclude_none=True)
        return dumped if isinstance(dumped, dict) else {}
    return {}


def _nonempty(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, dict)):
        return bool(value)
    return value is not None


def _first(mapping: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if _nonempty(value):
            return value
    return None


def _put(result: Dict[str, Any], key: str, value: Any) -> None:
    if _nonempty(value):
        result[key] = deepcopy(value)


def _confirmed_design(asset: Any) -> Tuple[Optional[int], Dict[str, Any]]:
    raw = getattr(asset, "asset_design", None)
    if not isinstance(raw, dict):
        return None, {}
    revisions = raw.get("design_revisions") or []
    if not isinstance(revisions, list) or not revisions:
        return None, {}
    latest = revisions[-1]
    if not isinstance(latest, dict) or not isinstance(latest.get("design"), dict):
        return None, {}
    revision = latest.get("revision")
    return revision if type(revision) is int and revision >= 1 else None, latest["design"]


def _context_parts(frame: Optional[StoryboardFrame]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    root = _as_dict(getattr(frame, "director_shot_context", None)) if frame else {}
    return _as_dict(root.get("scene")), _as_dict(root.get("shot"))


def _context_value(frame: Optional[StoryboardFrame], key: str) -> Any:
    scene, shot = _context_parts(frame)
    return _first(shot, key) or _first(scene, key)


def _plan_provenance(frame: Optional[StoryboardFrame]) -> Tuple[Optional[int], Optional[str]]:
    root = _as_dict(getattr(frame, "director_shot_context", None)) if frame else {}
    revision = root.get("shooting_plan_revision")
    content_hash = root.get("shooting_plan_hash")
    return (
        revision if type(revision) is int and revision >= 1 else None,
        content_hash if isinstance(content_hash, str) and content_hash.strip() else None,
    )


def _asset_variant_design(source_variant: Any) -> Dict[str, Any]:
    snapshot = getattr(source_variant, "submission_snapshot", None)
    snapshot = _as_dict(snapshot)
    return _as_dict(snapshot.get("visual_design"))


def _merge_lighting(result: Dict[str, Any], source: Dict[str, Any]) -> None:
    lighting = _as_dict(source.get("lighting"))
    if lighting:
        for key in LIGHT_KEYS:
            _put(result, key, lighting.get(key))
    # Asset scene design stores these values at the top level.  Keep only the
    # structured light fields, never visual_notes or the generated prompt.
    for key in LIGHT_KEYS:
        _put(result, key, source.get(key))
    constraints = _as_dict(source.get("visual_constraints"))
    _put(result, "key_light_direction", constraints.get("key_light_direction"))
    layers = _as_dict(source.get("prompt_layers"))
    layer_lighting = _as_dict(layers.get("lighting"))
    for key in LIGHT_KEYS:
        _put(result, key, layer_lighting.get(key))


def _merge_space(result: Dict[str, Any], source: Dict[str, Any]) -> None:
    for key in SPACE_KEYS:
        _put(result, key, source.get(key))
    direct_space = _as_dict(source.get("space"))
    for key in SPACE_KEYS:
        _put(result, key, direct_space.get(key))
    layers = _as_dict(source.get("prompt_layers"))
    camera = _as_dict(layers.get("camera"))
    _put(result, "reference_viewpoint", camera.get("viewpoint"))
    _put(result, "reference_framing", camera.get("framing"))


def _merge_camera(result: Dict[str, Any], source: Dict[str, Any]) -> None:
    for key in CAMERA_KEYS:
        _put(result, key, source.get(key))
    direct_camera = _as_dict(source.get("camera"))
    for key in CAMERA_KEYS:
        _put(result, key, direct_camera.get(key))
    movement = _as_dict(source.get("camera_movement_structured"))
    _put(result, "camera_movement", movement.get("description") or movement.get("primary"))
    layers = _as_dict(source.get("prompt_layers"))
    camera = _as_dict(layers.get("camera"))
    _put(result, "shot_size", camera.get("framing"))
    _put(result, "camera_angle", camera.get("viewpoint"))
    composition = _as_dict(layers.get("composition"))
    if composition:
        _put(result, "composition", composition)


def _entity_refs(frame: Optional[StoryboardFrame], names: Iterable[str] = ()) -> Set[str]:
    refs: Set[str] = set(names)
    if not frame:
        return refs
    refs.update(item for item in (getattr(frame, "character_ids", None) or []) if isinstance(item, str))
    refs.update(item for item in (getattr(frame, "prop_ids", None) or []) if isinstance(item, str))
    return refs


def _merge_continuity(result: Dict[str, Any], frame: Optional[StoryboardFrame], target_refs: Set[str]) -> None:
    blocking = _as_dict(getattr(frame, "blocking", None)) if frame else {}
    _put(result, "camera_relation", blocking.get("camera_relation"))
    stage = blocking.get("stage")
    if not isinstance(stage, list):
        return
    filtered: List[Dict[str, Any]] = []
    for item in stage:
        value = _as_dict(item)
        ref = value.get("ref")
        # A stage item is an identity-bearing state.  Do not carry it to a
        # target without an exact entity reference supplied by the caller.
        if not isinstance(ref, str) or not ref.strip() or ref not in target_refs:
            continue
        filtered.append({
            key: deepcopy(value[key])
            for key in ("ref", "zone", "depth", "height", "facing", "posture")
            if _nonempty(value.get(key))
        })
    if filtered:
        result["stage"] = filtered


def _source_visual_design(
    source_frame: Optional[StoryboardFrame],
    source_asset: Any,
    source_variant: Any,
    source_scene: Any,
    source_context: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Optional[int]]:
    """Extract four allowlisted categories from a selected source."""
    lighting: Dict[str, Any] = {}
    space: Dict[str, Any] = {}
    camera: Dict[str, Any] = {}
    continuity: Dict[str, Any] = {}
    design_revision, design = _confirmed_design(source_asset)
    variant_has_design = False
    if source_variant is not None:
        variant_design = _asset_variant_design(source_variant)
        submission = _as_dict(getattr(source_variant, "submission_snapshot", None))
        variant_has_design = bool(submission and variant_design)
        if variant_has_design:
            design = variant_design
            design_revision = submission.get("design_revision_at_submission") or None
        _merge_lighting(lighting, variant_design)
        _merge_space(space, variant_design)
        _merge_camera(camera, variant_design)
    if design:
        _merge_lighting(lighting, design)
        _merge_space(space, design)
        _merge_camera(camera, design)

    source_scene_context, source_shot_context = (
        (_as_dict(source_context.get("scene")), _as_dict(source_context.get("shot")))
        if source_context is not None else _context_parts(source_frame)
    )
    if source_scene_context and not variant_has_design:
        _merge_space(space, source_scene_context)
        _put(lighting, "story_time", source_scene_context.get("time_anchor"))
    if source_shot_context and not variant_has_design:
        _merge_lighting(lighting, source_shot_context)
        _merge_camera(camera, source_shot_context)
    if source_context is not None and not variant_has_design:
        baseline = _as_dict(source_context.get("lighting_baseline"))
        _merge_lighting(lighting, baseline)
        _merge_lighting(lighting, {"lighting": _as_dict(baseline.get("lighting"))})
    if source_frame is not None:
        frame_design = _as_dict(getattr(source_frame, "shot_visual_design", None))
        if frame_design and not variant_has_design:
            frame_visual_design = _as_dict(frame_design.get("visual_design"))
            _merge_lighting(lighting, frame_visual_design)
            _merge_space(space, frame_visual_design)
            _merge_camera(camera, frame_visual_design)
        if not variant_has_design:
            frame_lighting = _as_dict(getattr(source_frame, "lighting", None))
            _merge_lighting(lighting, {"lighting": frame_lighting})
            _merge_camera(camera, {
                "shot_size": source_frame.shot_size,
                "camera_angle": source_frame.camera_angle if source_frame.camera_angle != "Medium Shot" else None,
                "camera_movement": source_frame.camera_movement,
                "composition": source_frame.composition,
                "camera_movement_structured": _as_dict(source_frame.camera_movement_structured),
            })
        _merge_continuity(continuity, source_frame, _entity_refs(source_frame))

    if source_scene is not None:
        _put(space, "location", getattr(source_scene, "name", None))
        source_design_revision, _ = _confirmed_design(source_scene)
        if not variant_has_design:
            design_revision = source_design_revision or design_revision

    return lighting, space, camera, continuity, design_revision


def _scope(
    source_frame: Optional[StoryboardFrame], target_frame: StoryboardFrame,
    source_context: Optional[Dict[str, Any]] = None,
) -> str:
    source_scene, source_shot = (
        (_as_dict(source_context.get("scene")), _as_dict(source_context.get("shot")))
        if source_context is not None else _context_parts(source_frame)
    )
    source_place = _first(source_shot, "place_continuity_id") or _first(source_scene, "place_continuity_id")
    source_time = _first(source_shot, "time_continuity_id") or _first(source_scene, "time_continuity_id")
    target_place = _context_value(target_frame, "place_continuity_id")
    target_time = _context_value(target_frame, "time_continuity_id")
    if not all(isinstance(item, str) and item.strip() for item in (source_place, source_time, target_place, target_time)):
        return "unresolved"
    if source_time != target_time:
        return "different_time"
    return "same_place_time" if source_place == target_place else "same_time_world_light"


def _eligible_fields(scope: str, design: Dict[str, Dict[str, Any]]) -> List[str]:
    if scope == "same_place_time":
        return [key for key in REFERENCE_FIELDS if _nonempty(design.get(key))]
    if scope == "same_time_world_light":
        light = {key: value for key, value in design.get("lighting", {}).items() if key in WORLD_LIGHT_KEYS and _nonempty(value)}
        return ["lighting"] if light else []
    if scope == "unresolved":
        # Explicit selection is allowed when the creator accepts the source
        # values, but nothing is suggested automatically without IDs.
        return [key for key in REFERENCE_FIELDS if _nonempty(design.get(key))]
    return []


def build_reference_projection(
    target_frame: StoryboardFrame,
    *,
    source_frame: Optional[StoryboardFrame] = None,
    source_asset: Any = None,
    source_variant: Any = None,
    source_scene: Any = None,
    target_scene: Any = None,
    source_context: Optional[Dict[str, Any]] = None,
    source_asset_id: Optional[str] = None,
    source_variant_id: Optional[str] = None,
    source_media_id: Optional[str] = None,
    source_asset_revision: Optional[int] = None,
    target_entity_refs: Optional[Set[str]] = None,
) -> StoryboardReferenceProjectionSnapshot:
    """Build a candidate projection for one explicit source selection."""
    lighting, space, camera, continuity, design_revision = _source_visual_design(
        source_frame, source_asset, source_variant, source_scene, source_context,
    )
    if target_entity_refs is not None and source_frame is not None:
        continuity = {}
        _merge_continuity(continuity, source_frame, target_entity_refs)
    target_context_scene, _ = _context_parts(target_frame)
    target_scene_id = target_frame.scene_id
    source_scene_id = getattr(source_scene, "id", None) or (
        _first(_as_dict(source_context.get("scene")), "scene_id") if source_context is not None
        else _context_value(source_frame, "scene_id")
    )
    if source_context is not None:
        source_revision = source_context.get("shooting_plan_revision")
        source_hash = source_context.get("shooting_plan_hash")
        source_revision = source_revision if type(source_revision) is int and source_revision >= 1 else None
        source_hash = source_hash if isinstance(source_hash, str) and source_hash.strip() else None
    else:
        source_revision, source_hash = _plan_provenance(source_frame)
    target_revision, target_hash = _plan_provenance(target_frame)
    scope = _scope(source_frame, target_frame, source_context)
    design = {"lighting": lighting, "space": space, "camera": camera, "continuity_state": continuity}
    available = [key for key in REFERENCE_FIELDS if _nonempty(design.get(key))]
    eligible = _eligible_fields(scope, design)
    # The reference picker never silently checks a category.  ``suggested``
    # remains an audit field for future ranking, and is intentionally empty in
    # v1 so image-only is always the default.
    suggested: List[str] = []
    if scope == "same_time_world_light":
        design["lighting"] = {
            key: value for key, value in lighting.items()
            if key in WORLD_LIGHT_KEYS and _nonempty(value)
        }
        available = ["lighting"] if design["lighting"] else []
    resolved_source_asset_id = source_asset_id or (
        getattr(source_asset, "id", None) if source_frame is None else None
    )
    resolved_source_asset_revision = source_asset_revision or (
        getattr(source_asset, "asset_revision", None) if source_frame is None else None
    )
    return StoryboardReferenceProjectionSnapshot(
        source_frame_id=getattr(source_frame, "id", None),
        source_shot_id=getattr(source_frame, "shot_id", None),
        source_scene_id=source_scene_id,
        source_asset_id=resolved_source_asset_id,
        source_variant_id=source_variant_id or getattr(source_variant, "id", None),
        source_media_id=source_media_id or getattr(source_variant, "media_id", None),
        source_asset_revision=resolved_source_asset_revision or None,
        source_scene_design_revision=design_revision,
        source_plan_revision=source_revision,
        source_plan_hash=source_hash,
        target_frame_id=target_frame.id,
        target_shot_id=target_frame.shot_id,
        target_scene_id=target_scene_id,
        target_plan_revision=target_revision,
        target_plan_hash=target_hash,
        selected_fields=[],
        available_fields=available,
        eligible_fields=eligible,
        suggested_fields=suggested,
        scope=scope,
        visual_design=design,
    )


def select_projection_fields(
    candidate: StoryboardReferenceProjectionSnapshot,
    selected_fields: Iterable[str],
) -> StoryboardReferenceProjectionSnapshot:
    selected = list(dict.fromkeys(str(item) for item in selected_fields))
    invalid = [item for item in selected if item not in REFERENCE_FIELDS]
    if invalid:
        raise ValueError("invalid structured reference field")
    unavailable = [item for item in selected if item not in candidate.eligible_fields]
    if unavailable:
        raise ValueError("structured reference field is not eligible for this continuity")
    design = {key: deepcopy(candidate.visual_design.get(key, {})) for key in selected}
    return candidate.model_copy(update={
        "selected_fields": selected,
        "visual_design": design,
        "revision": candidate.revision + 1,
    })


def _current_values(frame: StoryboardFrame, target_scene: Any = None) -> Dict[str, Dict[str, Any]]:
    lighting: Dict[str, Any] = {}
    _merge_lighting(lighting, {"lighting": _as_dict(frame.lighting)})
    if frame.lighting_override and frame.lighting_override.strip():
        lighting["__all__"] = frame.lighting_override.strip()
    camera: Dict[str, Any] = {}
    _merge_camera(camera, {
        "shot_size": frame.shot_size,
        "camera_angle": frame.camera_angle if frame.camera_angle != "Medium Shot" else None,
        "camera_movement": frame.camera_movement,
        "composition": frame.composition,
        "camera_movement_structured": _as_dict(frame.camera_movement_structured),
    })
    continuity: Dict[str, Any] = {}
    _put(continuity, "camera_relation", _as_dict(frame.blocking).get("camera_relation"))
    _put(continuity, "stage", _as_dict(frame.blocking).get("stage"))
    space: Dict[str, Any] = {}
    target_scene_context, _ = _context_parts(frame)
    for key in SPACE_KEYS:
        _put(space, key, target_scene_context.get(key))
    _, scene_design = _confirmed_design(target_scene)
    _merge_space(space, scene_design)
    return {"lighting": lighting, "space": space, "camera": camera, "continuity_state": continuity}


def _without_current(source: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    return {key: deepcopy(value) for key, value in source.items() if not _nonempty(current.get(key))}


def projected_design_for_target(
    snapshot: StoryboardReferenceProjectionSnapshot,
    target_frame: StoryboardFrame,
    target_scene: Any = None,
) -> Dict[str, Any]:
    """Apply target-over-source precedence without mutating either model."""
    current = _current_values(target_frame, target_scene)
    result: Dict[str, Any] = {}
    for field in snapshot.selected_fields:
        inherited = _as_dict(snapshot.visual_design.get(field))
        current_fields = current.get(field, {})
        if field == "lighting" and "__all__" in current_fields:
            continue
        if field == "continuity_state" and isinstance(inherited.get("stage"), list):
            current_by_ref = {
                item.get("ref"): item for item in current_fields.get("stage", [])
                if isinstance(item, dict) and isinstance(item.get("ref"), str)
            }
            stages = []
            for source_stage in inherited["stage"]:
                if not isinstance(source_stage, dict):
                    continue
                ref = source_stage.get("ref")
                if not isinstance(ref, str):
                    continue
                target_stage = current_by_ref.get(ref, {})
                stages.append({
                    key: deepcopy(value) for key, value in source_stage.items()
                    if not _nonempty(target_stage.get(key))
                })
            inherited = {**inherited, "stage": [item for item in stages if item.get("ref")]}
        result[field] = _without_current(inherited, current_fields)
    return {key: value for key, value in result.items() if value}


def _format_value(value: Any) -> str:
    if isinstance(value, list):
        return "、".join(_format_value(item) for item in value if _nonempty(item))
    if isinstance(value, dict):
        return "；".join(f"{key}：{_format_value(item)}" for key, item in value.items() if _nonempty(item))
    return str(value).strip()


def reference_projection_prompt_clauses(
    snapshot: Optional[StoryboardReferenceProjectionSnapshot],
    target_frame: StoryboardFrame,
    target_scene: Any = None,
) -> List[str]:
    if snapshot is None or not snapshot.selected_fields:
        return []
    projected = projected_design_for_target(snapshot, target_frame, target_scene)
    labels = {
        "lighting": "参考结构化光影",
        "space": "参考结构化空间",
        "camera": "参考结构化镜头",
        "continuity_state": "参考连续性状态",
    }
    clauses: List[str] = []
    for field in REFERENCE_FIELDS:
        value = projected.get(field)
        if not isinstance(value, dict) or not value:
            continue
        text = "；".join(f"{key}：{_format_value(item)}" for key, item in value.items() if _nonempty(item))
        if text:
            clauses.append(f"{labels[field]}：{text}")
    return clauses
