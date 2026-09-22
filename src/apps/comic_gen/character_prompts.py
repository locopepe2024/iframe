"""Language-consistent defaults for character asset generation.

User-authored prompts are deliberately not normalized here. These helpers only
own copy that iFrame creates itself, so provider-specific style wording can be
preserved when it comes from the project or workbench.
"""

import re


DEFAULT_CHARACTER_STYLE_SUFFIX = "电影感光线，电影剧照，8K，细节丰富，写实"


def _clean_fragment(value: object) -> str:
    text = str(value or "").strip()
    return re.sub(r"[。！？.!?]+$", "", text)


def _sentence(*fragments: object) -> str:
    parts = [_clean_fragment(fragment) for fragment in fragments]
    parts = [part for part in parts if part]
    return f"。".join(parts) + "。" if parts else ""


def build_character_image_prompt(
    generation_type: str,
    name: str,
    description: str,
    preserve_reference: bool = False,
) -> str:
    """Build a Chinese default prompt for a character image slot."""

    character_name = _clean_fragment(name) or "角色"
    character_description = _clean_fragment(description)

    if generation_type == "full_body":
        return _sentence(
            "严格保持参考图中的角色外观、脸型、发型、肤色和服装" if preserve_reference else "",
            f"全身角色设计：{character_name}",
            "概念设计",
            character_description,
            "站立姿势，中性表情，正面看向镜头",
            "纯白背景，主体独立，无其他物体和场景，背景简洁，高质量，杰作级细节",
        )

    if generation_type == "three_view":
        return _sentence(
            "严格保持参考图中的角色外观、脸型、发型和服装" if preserve_reference else "",
            f"角色设定参考图：{character_name}",
            character_description,
            "三视图角色设计：正面、侧面和背面",
            "全身站立，中性表情，所有视图保持服装与细节一致",
            "简洁白色背景，线条清晰，摄影棚光线，高质量",
        )

    if generation_type == "headshot":
        return _sentence(
            "严格保持参考图中的角色面孔、发型、肤色和五官" if preserve_reference else "",
            f"角色{character_name}的近景肖像",
            character_description,
            "聚焦面部和肩部，刻画清晰的面部细节，中性表情，正面看向镜头",
            "高质量，杰作级细节",
        )

    raise ValueError(f"Unsupported character generation type: {generation_type}")


def build_reference_sheet_prompt(name: str, description: str) -> str:
    """Build the R2V canonical reference-sheet fallback prompt."""

    return _sentence(
        f"角色设定参考图：{_clean_fragment(name) or '角色'}",
        _clean_fragment(description),
        "多视角展示：正面、侧面和背面",
        "背景简洁，摄影棚光线",
    )


def chinese_reverse_reference_instruction() -> str:
    """Instruction prepended only when iFrame supplies a reference image."""

    return "严格保持参考图中的角色外观、脸型、发型、肤色和服装。"


def append_style_suffix(prompt: str, style_suffix: str) -> str:
    """Append style input without introducing a second punctuation language."""

    base = str(prompt or "").rstrip()
    style = str(style_suffix or "").strip()
    if not style or style in base:
        return base
    separator = "" if re.match(r"[\u3400-\u9fff]", style) else " "
    return f"{base}{separator}{style}" if base else style
