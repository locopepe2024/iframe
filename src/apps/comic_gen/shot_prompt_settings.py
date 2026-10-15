"""Deterministic, visible edits to adopted prompt text; no semantic rewriting."""

import re

SETTINGS = re.compile(r"【当前镜头设定】[^\n]*【/当前镜头设定】")
VISUAL_FIELD = re.compile(r"(?i)((?:integrated_multimodal_description|detailed_description|综合多模态描述|详细描述)[ \t]*(?:\*\*)?[:：][ \t]*(?:\*\*)?)[ \t]*")
NEXT_FIELD = re.compile(r"(?i)(?:subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music|主体定义|详细描述|综合多模态描述|整体声景|非叙事音乐)[ \t]*(?:\*\*)?[:：]")
DIALOGUE = re.compile(r'(<d>[\s\S]*?</d>|"[^"\n]*"|“[^”]*”|「[^」]*」)', re.I)


def sync_prompt_settings(prompt, old_style, old_light, style, light):
    if (old_style or "").strip() == (style or "").strip() and (old_light or "").strip() == (light or "").strip():
        return prompt
    visual = VISUAL_FIELD.search(prompt)
    start = visual.end() if visual else 0
    following = NEXT_FIELD.search(prompt, start) if visual else None
    end = following.start() if following else len(prompt)
    body = SETTINGS.sub("", prompt[start:end])
    for previous, current in ((old_style, style), (old_light, light)):
        if previous and previous.strip() != (current or "").strip():
            chunks = DIALOGUE.split(body)
            body = "".join(chunk if index % 2 else chunk.replace(previous.strip(), "")
                           for index, chunk in enumerate(chunks))
    parts = [f"{label}：{' '.join(value.split())}" for label, value in (("风格", style), ("光线", light)) if value and value.strip()]
    note = "【当前镜头设定】" + "；".join(parts) + "【/当前镜头设定】" if parts else ""
    prefix = prompt[:start]
    return (prefix + (note + " " if note else "") + body + prompt[end:]).strip()
