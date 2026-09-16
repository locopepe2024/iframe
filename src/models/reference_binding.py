"""Bind display names to ordered attachments without exposing signed URLs in text."""
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
from ..utils.reference_files import TEXT_EXTENSIONS, AUDIO_EXTENSIONS, read_reference_text


def media_kind(reference: str) -> str:
    extension = Path(unquote(urlsplit(reference).path)).suffix.lower()
    if extension in TEXT_EXTENSIONS:
        return 'text'
    if extension in AUDIO_EXTENSIONS:
        return 'audio'
    mime = mimetypes.guess_type(unquote(urlsplit(reference).path))[0] or ""
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("image/"):
        return "image"
    raise ValueError("Cannot determine reference media type; reselect an image, video or audio file")


def video_reference_prompt(prompt: str, originals: list[str], ordered_media: list[str], names: dict[str, str]) -> str:
    """Text is prompt context, not a media slot; remap UI indices before submission."""
    bound = bind_reference_names(prompt, [names.get(ref, '') for ref in originals])
    mapped = {}
    documents = []
    for index, reference in enumerate(originals, 1):
        if media_kind(reference) == 'text':
            if urlsplit(reference).scheme:
                raise ValueError('请上传文本文件，不支持远程文本地址')
            label = f'[Text {len(documents) + 1}]'
            mapped[index] = label
            documents.append(f'{label} {names.get(reference) or Path(reference).name}\n{read_reference_text(reference)}')
        else:
            mapped[index] = '@' + str(ordered_media.index(reference) + 1)
    bound = re.sub(r'@(\d+)(?![0-9A-Za-z_.])', lambda m: mapped.get(int(m[1]), m[0]), bound)
    return bound + ('\n\n参考文本材料（按用户要求使用）：\n' + '\n\n'.join(documents) if documents else '')


def bind_reference_names(prompt: str, labels: list[str]) -> str:
    positions: dict[str, list[int]] = {}
    for index, label in enumerate(labels, 1):
        if label:
            positions.setdefault(label, []).append(index)
    if not positions:
        return prompt
    pattern = r"@(" + "|".join(re.escape(name) for name in sorted(positions, key=len, reverse=True)) + r")(?=$|[\s，。！？、,.!?;；:：\u3400-\u9fff])"
    def replace(match):
        indices = positions[match[1]]
        if len(indices) != 1:
            raise ValueError("Referenced materials have duplicate names; use explicit @1, @2 indices")
        return "@" + str(indices[0])
    return re.sub(pattern, replace, prompt)
