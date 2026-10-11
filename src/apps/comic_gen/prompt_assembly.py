"""
Storyboard Schema v2 — Prompt Assembly & Dialogue-TTS Sync.

Pure functions with no side effects (no I/O, no pipeline/api imports).
"""
import re
from typing import Any, Dict, List, Optional

from .models import (
    CameraMovementData,
    Character,
    Scene,
    StoryboardFrame,
)


MOVEMENT_MAP = {
    "static": "固定机位",
    "push_in": "推镜头(Dolly In)",
    "pull_out": "拉镜头(Dolly Out)",
    "pan_left": "左摇(Pan Left)",
    "pan_right": "右摇(Pan Right)",
    "tilt_up": "上摇(Tilt Up)",
    "tilt_down": "下摇(Tilt Down)",
    "orbit": "环绕(Orbit)",
    "follow": "跟随(Follow)",
    "crane_up": "升镜(Crane Up)",
    "crane_down": "降镜(Crane Down)",
    "handheld": "手持(Handheld)",
    "zoom_in": "变焦推(Zoom In)",
    "zoom_out": "变焦拉(Zoom Out)",
}

SPEED_MAP = {"slow": "缓慢", "normal": "", "fast": "快速"}


def _movement_type_to_text(
    primary: str,
    secondary: Optional[str],
    speed: str,
) -> str:
    speed_prefix = SPEED_MAP.get(speed, "")
    primary_text = f"{speed_prefix}{MOVEMENT_MAP.get(primary, primary)}"
    if secondary:
        secondary_text = MOVEMENT_MAP.get(secondary, secondary)
        return f"{primary_text}，同时{secondary_text}"
    return primary_text


def _get_character_appearance_keywords(
    character_ids: List[str],
    characters: List[Character],
) -> str:
    parts = []
    for cid in character_ids:
        char = next((c for c in characters if c.id == cid), None)
        if not char:
            continue
        desc_parts = [char.name]
        if char.age:
            desc_parts.append(char.age)
        if char.gender:
            desc_parts.append(char.gender)
        if char.clothing:
            desc_parts.append(char.clothing)
        elif char.description:
            snippet = char.description[:60]
            desc_parts.append(snippet)
        parts.append("，".join(desc_parts))
    return "；".join(parts)


def _director_shot_context_parts(context: Optional[Dict[str, Any]]) -> List[str]:
    """Convert the server-projected plan context into concise prompt clauses.

    The plan context is read-only runtime data. Keep IDs out of the natural
    language prompt: asset IDs are resolved through reference inputs, while
    only visual direction belongs here.
    """
    if not isinstance(context, dict):
        return []
    parts: List[str] = []
    scene = context.get("scene")
    shot = context.get("shot")
    if isinstance(scene, dict):
        place_time = "，".join(
            str(scene.get(key) or "").strip()
            for key in ("location", "time_anchor")
            if str(scene.get(key) or "").strip()
        )
        if place_time:
            parts.append("场景连续性：" + place_time)
        for key, label in (
            ("continuity_in", "入场连续性"),
            ("continuity_out", "出场连续性"),
        ):
            value = scene.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(f"{label}：{value.strip()}")
        atmosphere = scene.get("atmosphere")
        if isinstance(atmosphere, str) and atmosphere.strip():
            parts.append("环境氛围：" + atmosphere.strip())
    if not isinstance(shot, dict):
        shot = context
    labels = (
        ("visual_intent", "镜头意图"),
        ("director_effect", "导演效果"),
        ("performance_action", "角色表演"),
        ("action_physics", "动作物理"),
        ("camera_movement", "运镜"),
        ("composition", "构图"),
        ("ambient_sound", "环境音"),
    )
    for key, label in labels:
        value = shot.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(f"{label}：{value.strip()}")
    lighting = shot.get("lighting")
    if isinstance(lighting, dict):
        lighting_parts: List[str] = []
        for key, label in (
            ("key_source", "主光"),
            ("color_tone", "色调"),
            ("contrast", "明暗"),
        ):
            value = lighting.get(key)
            if isinstance(value, str) and value.strip():
                lighting_parts.append(f"{label}{value.strip()}")
        practical_sources = lighting.get("practical_sources")
        if isinstance(practical_sources, list):
            sources = [str(item).strip() for item in practical_sources if str(item).strip()]
            if sources:
                lighting_parts.append("画内光源" + "、".join(sources))
        if lighting_parts:
            parts.append("光影：" + "；".join(lighting_parts))
    return parts


def inject_reference_tags(
    text: str,
    frame: "StoryboardFrame",
    characters: List[Character],
    scenes: Optional[List[Scene]] = None,
) -> str:
    """Inject [characterN:name] tags into visual description.

    HappyHorse R2V uses `characterN` as a generic reference-image slot
    identifier — it does NOT distinguish characters from scenes/props.
    character1 = first ref image, character2 = second, etc.

    Numbering order: characters first (by frame.character_ids order),
    then scene (if present). All use [characterN:name] format.
    """
    import re

    if not text:
        return text

    # Skip if text already contains asset tags
    if re.search(r"\[character\d+:", text):
        return text

    # Global slot counter — characters first, then scene
    slot = 1

    # Inject character tags — numbered by frame.character_ids order
    for cid in frame.character_ids:
        char = next((c for c in characters if c.id == cid), None)
        if not char or not char.name:
            continue
        tag = f"{char.name}[character{slot}:{char.name}]"
        pos = text.find(char.name)
        if pos >= 0:
            text = text[:pos] + tag + text[pos + len(char.name):]
            slot += 1

    # Inject scene tag — continues the global numbering
    if scenes and frame.scene_id:
        scene = next((s for s in scenes if s.id == frame.scene_id), None)
        if scene and scene.name:
            pos = text.find(scene.name)
            if pos >= 0:
                tag = f"{scene.name}[character{slot}:{scene.name}]"
                text = text[:pos] + tag + text[pos + len(scene.name):]

    return text


def assemble_prompt(
    frame: StoryboardFrame,
    characters: List[Character],
) -> str:
    """Assemble the final generation prompt from structured fields + visual description.

    Priority: subject/action first → scene/lighting → camera → style/constraints.
    """
    parts: List[str] = []

    # 1. Visual description (core narrative)
    if frame.visual_description:
        parts.append(frame.visual_description)

    # 2. Lighting supplement
    if frame.lighting and frame.lighting.description:
        if not frame.visual_description or frame.lighting.description not in frame.visual_description:
            parts.append(frame.lighting.description)

    # 3. Camera movement
    if frame.camera_movement_structured:
        cm: CameraMovementData = frame.camera_movement_structured
        movement_text = cm.description or _movement_type_to_text(
            cm.primary, cm.secondary, cm.speed
        )
        parts.append(movement_text)

    # A confirmed shooting-plan shot is a server-projected constraint. Include
    # its visual clauses in the final prompt even when the refinement model did
    # not repeat them in the visual description. Compare clause values without
    # punctuation so the plan does not restate text already present in a frame.
    normalized_existing = re.sub(r"[\s，。；：、,.!?！？:;]+", "", " ".join(parts)).casefold()
    for clause in _director_shot_context_parts(frame.director_shot_context):
        value = clause.split("：", 1)[-1]
        normalized_value = re.sub(r"[\s，。；：、,.!?！？:;]+", "", value).casefold()
        if not normalized_value or normalized_value in normalized_existing:
            continue
        parts.append(clause)
        normalized_existing += normalized_value

    # 4. Shot size + angle (only if not already covered)
    joined = " ".join(parts)
    angle_shot = []
    if frame.shot_size and frame.shot_size not in joined:
        angle_shot.append(frame.shot_size)
    if frame.camera_angle and frame.camera_angle not in joined:
        angle_shot.append(frame.camera_angle)
    if angle_shot:
        parts.append("，".join(angle_shot))

    # 5. Character appearance keywords
    char_desc = _get_character_appearance_keywords(frame.character_ids, characters)
    if char_desc:
        parts.append(f"角色：{char_desc}")

    if not parts:
        return frame.action_description or ""

    assembled = "。".join(p.rstrip("。，.") for p in parts if p) + "。"
    return assembled


def enrich_prompt_with_dialogue(
    prompt: str,
    frame: "StoryboardFrame",
) -> str:
    """Append a natural-language speaking cue to the video prompt.

    Video models (e.g. HappyHorse) need explicit lip/mouth action in the
    visual description to generate mouth movement.  We derive a short
    Chinese sentence from the frame's dialogue and weave it into the tail
    of the prompt so it reads as part of the visual narrative — NOT as a
    separate labelled metadata section.

    Returns the original prompt unmodified when there is no dialogue.
    """
    line = None
    speaker = None
    emotion = None

    if frame.dialogue_structured and frame.dialogue_structured.line:
        line = frame.dialogue_structured.line.strip()
        speaker = frame.dialogue_structured.speaker
        emotion = frame.dialogue_structured.emotion
    elif frame.dialogue:
        line = frame.dialogue.strip()
        speaker = frame.speaker

    if not line:
        return prompt

    subject = speaker or "角色"
    emotion_hint = f"，表情{emotion}" if emotion else ""

    # The Storyboard R2V client already adds the structured dialogue once
    # (for example ``<d>[Mandarin] ...</d>`` for H3).  Keep this helper
    # idempotent at the provider boundary: appending the full line again
    # makes a video model hear/act on the same dialogue twice.  If an older
    # caller only included the line as plain narrative text, retain the
    # mouth-movement cue while omitting a second copy of the dialogue body.
    normalized_prompt = re.sub(r"\s+", "", prompt or "")
    normalized_line = re.sub(r"\s+", "", line)
    if normalized_line and normalized_line in normalized_prompt:
        lower_prompt = (prompt or "").lower()
        has_speaking_cue = (
            "张嘴说话" in prompt
            or "台词" in prompt
            or "<d>" in lower_prompt
            or re.search(r"\b(?:says|speaks|speaking|dialogue)\b", lower_prompt)
        )
        if has_speaking_cue:
            return prompt
        clean = prompt.rstrip("。，. ")
        cue = f"{subject}张嘴说话{emotion_hint}，按已给台词自然演绎"
        return f"{clean}。{cue}"

    # Build a visual speaking cue
    cue = f"{subject}张嘴说话{emotion_hint}，台词：「{line}」"

    # Append to prompt with separator
    clean = prompt.rstrip("。，. ")
    return f"{clean}。{cue}"


def sync_dialogue_to_tts(frame: StoryboardFrame) -> None:
    """Sync dialogue_structured emotion/delivery into dialogue_instructions,
    and keep legacy dialogue/speaker fields in sync."""
    if not frame.dialogue_structured:
        return

    ds = frame.dialogue_structured
    # Sync legacy fields
    frame.dialogue = ds.line
    frame.speaker = ds.speaker

    # Build TTS instructions from emotion + delivery
    instr_parts = []
    if ds.emotion:
        instr_parts.append(f"情绪：{ds.emotion}")
    if ds.delivery:
        instr_parts.append(f"演绎：{ds.delivery}")

    if instr_parts:
        frame.dialogue_instructions = "；".join(instr_parts)
