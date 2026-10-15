"""Bounded, read-only projection for the rich-frame refinement LLM boundary."""

import json


MAX_CONTEXT_CHARS = 6000
PROVENANCE = (
    "source_revision", "source_revision_id", "director_profile_revision",
    "shooting_plan_revision", "shooting_plan_hash",
)
IDENTITIES = {
    "shot_id", "scene_id", "beat_id", "scene_asset_id", "plan_scene_asset_id",
    "place_continuity_id", "time_continuity_id",
}
IDENTITY_LISTS = {
    "source_chunk_refs", "character_ids", "person_ids", "prop_ids",
}
SCENE_FIELDS = (
    "scene_id", "scene_asset_id", "plan_scene_asset_id", "source_chunk_refs",
    "scene_ref", "location", "time_anchor", "continuity_in", "continuity_out",
    "place_continuity_id", "time_continuity_id", "interior_exterior",
    "time_of_day", "season", "weather", "atmosphere", "prop_ids",
)
SHOT_FIELDS = (
    "shot_id", "scene_id", "beat_id", "source_chunk_refs", "scene_asset_id",
    "plan_scene_asset_id", "character_ids", "person_ids", "prop_ids",
    "visual_intent", "director_effect", "performance_action", "action_physics",
    "shot_size", "camera_angle", "composition", "camera_movement",
    "duration_seconds", "dialogue", "ambient_sound", "lighting",
    "place_continuity_id", "time_continuity_id", "lighting_override_reason",
)
LIGHT_FIELDS = ("key_source", "color_tone", "contrast", "practical_sources")
BASELINE_FIELDS = (
    "place_continuity_id", "time_continuity_id", "story_time", "daylight_phase",
    "weather", "shadow_direction", "lighting",
)


def _identity(value):
    if not isinstance(value, str) or len(value) > 240:
        raise ValueError("Invalid context identity")
    return value


def _dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def project_shot_context(raw, frame_shot_id, origin):
    """Return serialized JSON, or suppress unsafe identity data without plan fallback.

    Saved snapshots are historical truth; absent provenance stays unknown. Prose is
    cropped before encoding so escaped strings can never break the JSON envelope.
    """
    if not isinstance(raw, dict):
        return ""
    shot = raw.get("shot")
    scene = raw.get("scene", {})
    if not isinstance(shot, dict) or not shot or not isinstance(scene, dict):
        return ""
    try:
        if frame_shot_id:
            _identity(frame_shot_id)
        saved_id = shot.get("shot_id")
        if saved_id is not None:
            _identity(saved_id)
        if saved_id and frame_shot_id and saved_id != frame_shot_id:
            return ""
        if shot.get("scene_id") and scene.get("scene_id"):
            if shot["scene_id"] != scene["scene_id"]:
                return ""
        provenance = {}
        for key in PROVENANCE:
            value = raw.get(key)
            if value is not None:
                if key.endswith("revision"):
                    if type(value) is not int or not 0 <= value <= 10**12:
                        return ""
                else:
                    _identity(value)
            provenance[key] = value

        for limit in (480, 240, 120, 60, 0):
            shortened = False

            def text(value):
                nonlocal shortened
                if not isinstance(value, str):
                    return None
                shortened |= len(value) > limit
                return value[:limit]

            def bounded_list(value, convert):
                nonlocal shortened
                if not isinstance(value, list):
                    return []
                shortened |= len(value) > 8
                return [convert(item) for item in value[:8]]

            def fields(value, names):
                if not isinstance(value, dict):
                    return {}
                result = {}
                for key in names:
                    item = value.get(key)
                    if item is None:
                        continue
                    if key in IDENTITIES:
                        result[key] = _identity(item)
                    elif key in IDENTITY_LISTS:
                        result[key] = bounded_list(item, _identity)
                    elif key == "lighting":
                        result[key] = fields(item, LIGHT_FIELDS)
                    elif key == "dialogue":
                        result[key] = bounded_list(
                            item, lambda line: fields(line, ("speaker", "line"))
                        )
                    elif key == "practical_sources":
                        result[key] = bounded_list(item, text)
                    elif key == "duration_seconds":
                        if type(item) is int and 0 <= item <= 86400:
                            result[key] = item
                    elif isinstance(item, str):
                        result[key] = text(item)
                return result

            result = {"scene": fields(scene, SCENE_FIELDS),
                      "shot": fields(shot, SHOT_FIELDS), **provenance}
            baseline = raw.get("lighting_baseline")
            if isinstance(baseline, dict):
                pair = tuple(shot.get(key) or scene.get(key) for key in
                             ("place_continuity_id", "time_continuity_id"))
                if all(pair) and pair == (baseline.get("place_continuity_id"),
                                         baseline.get("time_continuity_id")):
                    result["lighting_baseline"] = fields(baseline, BASELINE_FIELDS)
            result["projection"] = {
                "version": 1, "origin": origin, "frame_shot_id": frame_shot_id or None,
                "binding_status": "matched" if saved_id and frame_shot_id else "legacy_unverified",
                "text_limit": limit, "shortened": shortened,
            }
            encoded = _dump(result)
            if len(encoded) <= MAX_CONTEXT_CHARS:
                return encoded
    except (ValueError, TypeError):
        # Never crop an identity or silently switch a saved snapshot to today's plan.
        return ""
    return ""
