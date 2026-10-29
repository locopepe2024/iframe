"""Small, deterministic intent boundary for Companion requests."""
import re
from dataclasses import dataclass


_DIARY = re.compile(r'^\s*(?:请\s*)?把\s+(\d{4}-\d{2}-\d{2})\s+我们聊的内容整理成一篇回忆日记', re.S)
_ALBUM_SEARCH = re.compile(r'(?:搜索|查找|找找|筛选)(?:一下)?(?:相册|照片|相片)?(?:里|中的)?(?P<query>.+?)(?:的)?(?:照片|相片)?(?:吧|好吗)?$', re.I)
_UPLOAD = re.compile(r'(?:怎么|如何|怎样)?(?:发|传|上传|添加)(?:照片|图片|相片|视频|素材)?|从相册', re.I)


@dataclass(frozen=True)
class Intent:
    name: str
    day: str | None = None
    query: str | None = None


def classify(text: str) -> Intent:
    match = _DIARY.search(text or '')
    if match:
        return Intent('diary.compose', match.group(1))
    compact = re.sub(r'[\s，。！？、,.!?：:]', '', text or '')
    if re.fullmatch(r'(?:请|请你|麻烦)?(?:帮我|给我|我想|我要)?(?:梳理|整理)(?:一下)?(?:我的)?(?:相册|照片|相片)(?:一下|吧|好吗)?', compact):
        return Intent('album.scope')
    search = _ALBUM_SEARCH.search(text or '')
    if search:
        query = re.sub(r'^(?:的|里|中的)', '', search.group('query').strip())
        query = re.sub(r'的$', '', query)
        if query in {'照片', '相片', '相册'}: query = ''
        return Intent('album.search', query=query or None)
    if re.fullmatch(r'(?:请|请你|麻烦)?(?:帮我|给我|我想|我要)?(?:打开(?:我的)?相册|把(?:我的)?相册打开|进入相册|看看相册)(?:一下|吧|好吗)?', compact):
        return Intent('album.browse')
    if _UPLOAD.search(text or ''):
        return Intent('media.upload_help', None)
    return Intent('chat', None)


def diary_day(text: str) -> str | None:
    intent = classify(text)
    return intent.day if intent.name == 'diary.compose' else None
