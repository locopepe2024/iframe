"""Read-only storyboard continuity rows and bounded diagnostics."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable, Optional

from .models import Script, StoryboardFrame
from .visual_continuity import _as_dict, _confirmed_design, _nonempty, projected_design_for_target


WORLD_FIELDS = ("story_time", "daylight_phase", "weather", "shadow_direction")
LOCAL_FIELDS = ("key_source", "color_tone", "contrast", "practical_sources", "direction", "quality", "color_temp", "ambient_lighting")
SPACE_FIELDS = ("location", "reference_viewpoint", "reference_framing")
CAMERA_FIELDS = ("shot_size", "camera_angle", "composition", "camera_movement")


def _record(value: Any, kind: str, source_id: Optional[str], revision: Optional[int] = None,
            status: str = "confirmed") -> Dict[str, Any]:
    return {"value": value, "source_kind": kind, "source_id": source_id,
            "source_revision": revision, "status": status}


def _set_fields(fields: Dict[str, Dict[str, Any]], source: Dict[str, Any], keys: Iterable[str],
                kind: str, source_id: Optional[str], revision: Optional[int] = None,
                status: str = "confirmed", *, replace: bool = True) -> None:
    for key in keys:
        value = source.get(key)
        if _nonempty(value) and (replace or key not in fields):
            fields[key] = _record(value, kind, source_id, revision, status)


def _context(frame: StoryboardFrame) -> tuple[dict, dict, dict]:
    raw = _as_dict(frame.director_shot_context)
    return _as_dict(raw.get("scene")), _as_dict(raw.get("shot")), raw


def build_continuity_sheet(script: Script, scenes: Iterable[Any], *, model_name: str) -> Dict[str, Any]:
    scene_by_id = {item.id: item for item in scenes}
    style_id = script.art_direction.selected_style_id if script.art_direction else script.style_preset
    style_payload = script.art_direction.style_config if script.art_direction else script.style_prompt
    style_hash = hashlib.sha256(json.dumps(style_payload, sort_keys=True, ensure_ascii=False,
                                           default=str).encode("utf-8")).hexdigest()[:16]
    rows = []
    for frame in script.frames:
        scene = scene_by_id.get(frame.scene_id)
        scene_context, shot_context, raw = _context(frame)
        place_id = shot_context.get("place_continuity_id") or scene_context.get("place_continuity_id")
        time_id = shot_context.get("time_continuity_id") or scene_context.get("time_continuity_id")
        design_revision, design = _confirmed_design(scene)
        fields: Dict[str, Dict[str, Any]] = {}
        scene_id = getattr(scene, "id", None)
        if scene is not None:
            _set_fields(fields, {"location": scene.name}, SPACE_FIELDS, "scene_asset", scene_id)
        _set_fields(fields, design, WORLD_FIELDS + LOCAL_FIELDS + SPACE_FIELDS,
                    "scene_design", scene_id, design_revision)
        _set_fields(fields, _as_dict(design.get("lighting")), WORLD_FIELDS + LOCAL_FIELDS,
                    "scene_design", scene_id, design_revision)
        _set_fields(fields, scene_context, WORLD_FIELDS + SPACE_FIELDS, "plan_scene", frame.scene_id,
                    raw.get("shooting_plan_revision"))
        if _nonempty(scene_context.get("time_anchor")):
            fields["story_time"] = _record(scene_context["time_anchor"], "plan_scene", frame.scene_id,
                                           raw.get("shooting_plan_revision"))
        baseline = _as_dict(raw.get("lighting_baseline"))
        _set_fields(fields, baseline, WORLD_FIELDS + LOCAL_FIELDS, "plan_baseline",
                    f"{place_id}:{time_id}" if place_id and time_id else None,
                    raw.get("shooting_plan_revision"))
        _set_fields(fields, _as_dict(baseline.get("lighting")), LOCAL_FIELDS, "plan_baseline",
                    f"{place_id}:{time_id}" if place_id and time_id else None,
                    raw.get("shooting_plan_revision"))
        _set_fields(fields, shot_context, CAMERA_FIELDS, "plan_shot", frame.shot_id,
                    raw.get("shooting_plan_revision"))
        _set_fields(fields, _as_dict(shot_context.get("lighting")), WORLD_FIELDS + LOCAL_FIELDS,
                    "plan_shot", frame.shot_id, raw.get("shooting_plan_revision"), "explicit_override")
        _set_fields(fields, {"shot_size": frame.shot_size,
                             "camera_angle": frame.camera_angle if frame.camera_angle != "Medium Shot" else None,
                             "composition": frame.composition, "camera_movement": frame.camera_movement},
                    CAMERA_FIELDS, "frame", frame.id, status="explicit_override")
        _set_fields(fields, _as_dict(frame.lighting), LOCAL_FIELDS, "frame", frame.id,
                    status="explicit_override")
        if frame.lighting_override and frame.lighting_override.strip():
            fields["lighting_override"] = _record(frame.lighting_override.strip(), "frame", frame.id,
                                                  status="explicit_override")
        snapshot = frame.reference_visual_projection
        if snapshot and snapshot.selected_fields:
            projected = projected_design_for_target(snapshot, frame, scene)
            for group in ("lighting", "space", "camera"):
                _set_fields(fields, _as_dict(projected.get(group)),
                            WORLD_FIELDS + LOCAL_FIELDS + SPACE_FIELDS + CAMERA_FIELDS,
                            "selected_reference", snapshot.source_variant_id or snapshot.source_frame_id,
                            snapshot.source_scene_design_revision, replace=False)
        fields["style"] = _record(style_id, "art_direction" if script.art_direction else "project",
                                  script.id, status="confirmed")
        if frame.style_prompt_override and frame.style_prompt_override.strip():
            fields["style"] = _record(frame.style_prompt_override.strip(), "frame", frame.id,
                                      status="explicit_override")
        fields["aspect_ratio"] = _record(script.model_settings.storyboard_aspect_ratio,
                                          "model_settings", script.id)
        rows.append({
            "frame_id": frame.id, "shot_id": frame.shot_id, "scene_id": frame.scene_id,
            "scene_name": getattr(scene, "name", None),
            "place_continuity_id": place_id, "time_continuity_id": time_id,
            "continuity_status": "confirmed" if place_id and time_id else "unresolved",
            "plan_revision": raw.get("shooting_plan_revision"), "plan_hash": raw.get("shooting_plan_hash"),
            "scene_design_revision": design_revision, "style_hash": style_hash,
            "model": model_name, "fields": fields,
            "reference": ({"source_asset_id": snapshot.source_asset_id,
                           "source_frame_id": snapshot.source_frame_id,
                           "source_variant_id": snapshot.source_variant_id,
                           "source_media_id": snapshot.source_media_id,
                           "source_design_revision": snapshot.source_scene_design_revision,
                           "selected_fields": snapshot.selected_fields} if snapshot else None),
        })
    return {"rows": rows, "issues": _diagnose(rows)}


def _diagnose(rows: list[dict]) -> list[dict]:
    issues = []
    anchors: Dict[tuple, tuple[dict, dict]] = {}
    for row in rows:
        candidates = [("project_style", "project", ("style",))]
        if row["continuity_status"] == "confirmed":
            time_id = row["time_continuity_id"]
            place_id = row["place_continuity_id"]
            candidates.extend([
                ("same_time_world_light", time_id, WORLD_FIELDS),
                ("same_place_time", (place_id, time_id), LOCAL_FIELDS + SPACE_FIELDS),
            ])
        for scope, group_id, fields in candidates:
            for field in fields:
                current = row["fields"].get(field)
                if current is None:
                    continue
                key = (scope, group_id, field)
                first = anchors.setdefault(key, (row, current))
                prior_row, prior_value = first
                if prior_row["frame_id"] == row["frame_id"] or prior_value["value"] == current["value"]:
                    continue
                issue_scope = scope
                if scope == "same_time_world_light":
                    issue_scope = ("same_place_time" if prior_row["place_continuity_id"] == row["place_continuity_id"]
                                   else "same_time_different_place")
                issues.append({"scope": issue_scope, "field": field,
                               "frame_ids": [prior_row["frame_id"], row["frame_id"]],
                               "values": [prior_value, current],
                               "status": "explicit_override" if "explicit_override" in (prior_value["status"], current["status"])
                               else "conflict"})
    return issues
