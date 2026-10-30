"""Conservative, explainable emotion signals for companion turn routing.

This is a routing hint, not a diagnosis. Unknown or ambiguous language stays
unknown and must never trigger a tool or long-term memory write.
"""
import re


_RULES = (
    ("negative", "high", "solve", ("着急", "很急", "赶紧", "怎么办", "卡住", "失败", "没反应")),
    ("negative", "medium", "comfort", ("难过", "伤心", "失望", "孤单", "寂寞", "不开心")),
    ("positive", "medium", "celebrate", ("开心", "高兴", "幸福", "太好了", "喜欢", "谢谢")),
    ("neutral", "medium", "clarify", ("不明白", "不知道", "怎么", "什么意思", "看不懂")),
)


def analyze(text: str) -> dict:
    compact = re.sub(r"\s+", "", text or "")
    if not compact:
        return dict(valence="unknown", arousal="unknown", need="none", confidence=0.0, evidence=[])
    for valence, arousal, need, terms in _RULES:
        for term in terms:
            if term in compact:
                return dict(valence=valence, arousal=arousal, need=need,
                            confidence=0.82 if len(term) >= 2 else 0.68,
                            evidence=[term])
    return dict(valence="neutral", arousal="unknown", need="none", confidence=0.25, evidence=[])
