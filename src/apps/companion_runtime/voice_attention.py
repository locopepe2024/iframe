"""A name-only attention call is a conversational acknowledgement, not a task."""
import re


def attention_reply(text):
    # Deliberately match complete utterances only. Never consume a command or
    # infer a task from an ASR approximation (e.g. 小安小韩).
    compact = re.sub(r'[\s，。！？、,.!?～~]', '', text)
    if compact in {'小安', '小安小安'}:
        return dict(kind='text', text='我在，您说。')
    return None
