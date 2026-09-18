"""Translate Studio editor references using the submitted image order."""
import re


def bind_storyboard_prompt(prompt: str, model: str, image_count: int) -> str:
    pattern = r"\[character(\d+):([^\]]+)\]"
    tags = re.findall(pattern, prompt)
    is_h3 = "minimax-h3" in model.lower() or model.lower().endswith("h3")
    if not is_h3:
        prompt = re.sub(pattern, "", prompt)
        return re.sub(r"\[(?:character|scene|prop):[^\]]+\]", "", prompt)
    slots = sorted({int(slot) for slot, _ in tags})
    if tags:
        if len(slots) != image_count:
            raise ValueError("Storyboard references do not match submitted images; reselect missing materials")
        names = {}
        for slot, name in tags:
            if slot in names and names[slot] != name:
                raise ValueError("Conflicting storyboard reference slot")
            names[slot] = name
        mapping = {slot: index for index, slot in enumerate(slots, 1)}
        prompt = re.sub(pattern, lambda m: f"<Picture {mapping[int(m[1])]}> {m[2]}", prompt)
    # Explicit editor @N references are mapped by the same submitted image
    # order. Mixed unresolved syntax is rejected before a paid request.
    prompt = re.sub(r"@(\d+)(?![\w])", lambda m: f"<Picture {m.group(1)}>", prompt)
    if re.search(r"@\w|\[Picture\s+\d+\]|\[(?:character|scene|prop):[^\]]+\]", prompt):
        raise ValueError("H3 prompt contains unresolved reference syntax")
    for number in re.findall(r"<Picture (\d+)>", prompt):
        if not 1 <= int(number) <= image_count:
            raise ValueError("H3 picture reference is outside the submitted image list")
    return prompt
