"""A name-only attention call is a conversational acknowledgement, not a task."""
import re

_QUIET_FILLERS = {
    '嗯', '嗯嗯', '嗯嗯嗯', '哦', '哦哦', '好', '好的', '知道了',
    '行', '可以', '没事', '继续', '我听着', '我在听',
}


def attention_reply(text):
    # Deliberately match complete utterances only. Never consume a command or
    # infer a task from an ASR approximation (e.g. 小安小韩).
    compact = re.sub(r'[\s，。！？、,.!?～~]', '', text)
    if compact in {'小安', '小安小安'}:
        return dict(kind='text', text='我在，您说。')
    return None


def silence_reply(text):
    """Return a non-speaking turn for low-information acknowledgements.

    This is intentionally an exact, conservative boundary. Longer utterances
    still go to the coordinator/model because a filler may be part of a real
    request (for example, “好，打开相册”).
    """
    compact = re.sub(r'[\s，。！？、,.!?～~：:]', '', text or '')
    if compact in _QUIET_FILLERS:
        return dict(kind='silent', reason='low_information')
    return None
