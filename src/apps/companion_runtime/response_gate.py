"""Program-owned response gate for low-risk conversational turns."""
import re


# Only standalone first-person disclosures qualify for a canned response.
# Everything outside this small grammar needs contextual interpretation.
_SELF_DISCLOSURE = re.compile(
    r'我(?:现在|今天)?(?:有点|有些|很|好|特别|非常)?'
    r'(?:难过|伤心|失望|孤单|寂寞|不开心|着急|开心|高兴|幸福)[。.!！]*'
)


def emotional_reply(text: str, signal: dict | None):
    """Return a short acknowledgement only for emotion without an action.

    The gate is deliberately narrow. Any possible task request delegates to
    the normal planner/model path, even when the utterance also sounds urgent.
    """
    if not isinstance(signal, dict) or signal.get('confidence', 0) < 0.68 or not _SELF_DISCLOSURE.fullmatch((text or '').strip()):
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
