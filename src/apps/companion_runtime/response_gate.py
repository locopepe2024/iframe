"""Program-owned response gate for low-risk conversational turns."""
import re


_REQUEST_MARKERS = (
    '怎么', '如何', '请', '帮我', '打开', '保存', '修改', '删除', '上传',
    '查找', '搜索', '重试', '继续', '选择', '生成', '整理', '写日记',
)


def _has_request(text: str) -> bool:
    compact = re.sub(r'\s+', '', text or '')
    return any(marker in compact for marker in _REQUEST_MARKERS) or '?' in compact or '？' in compact


def emotional_reply(text: str, signal: dict | None):
    """Return a short acknowledgement only for emotion without an action.

    The gate is deliberately narrow. Any possible task request delegates to
    the normal planner/model path, even when the utterance also sounds urgent.
    """
    if not isinstance(signal, dict) or signal.get('confidence', 0) < 0.68 or _has_request(text):
        return None
    need = signal.get('need')
    if need == 'comfort':
        return dict(kind='text', text='听起来这让您有些难过，我在听。', reason='emotion')
    if need == 'solve':
        return dict(kind='text', text='听起来这让您有些着急，我们一步一步来。', reason='emotion')
    if need == 'celebrate':
        return dict(kind='text', text='听起来今天有件开心的事。', reason='emotion')
    return None


def emotion_already_acknowledged(messages: list[dict], signal: dict | None) -> bool:
    """Avoid repeating the same emotional acknowledgement in one short turn."""
    if not isinstance(signal, dict) or signal.get('confidence', 0) < 0.68:
        return False
    need = signal.get('need')
    phrases = {
        'comfort': '难过',
        'solve': '着急',
        'celebrate': '开心',
    }
    marker = phrases.get(need)
    if not marker:
        return False
    for message in reversed(messages[-4:]):
        reply = message.get('assistant_reply') or {}
        if reply.get('reason') == 'emotion' and marker in reply.get('text', ''):
            return True
    return False
