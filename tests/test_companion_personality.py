from src.apps.companion_runtime.personality import get_profile, system_prompt


def test_profiles_are_explicit_and_safe_fallback_is_stable():
    assert get_profile("quiet_listener").name == "温和倾听"
    assert get_profile("unknown").key == "warm_curious"


def test_prompt_carries_behavior_rules_without_claiming_real_feelings():
    prompt = system_prompt(get_profile("steady_care"))
    assert "沉稳照料" in prompt
    assert "每轮最多一个问题" in prompt
    assert "不代表你有真实感受" in prompt


def test_prompt_distinguishes_product_voice_from_model_text_and_playback_evidence():
    prompt = system_prompt()
    assert "通过 OpenTalking 语音渠道播报回复" in prompt
    assert "无法观测扬声器或实际播放结果" in prompt
    assert "不要因为自己输出文本就声称产品只能输出文字" in prompt


def test_prompt_contains_internal_expression_contract_without_control_tags():
    prompt = system_prompt(get_profile("warm_curious"))
    assert "内部表达流程" in prompt
    assert "无法确定时按平静处理" in prompt
    assert "不输出情绪控制标记" in prompt
    assert "用户说结束、休息或不想聊" in prompt


def test_prompt_limits_chat_length_and_repetition_without_blocking_writing():
    prompt = system_prompt()
    assert "1—3 句、约 30—80 个汉字" in prompt
    assert "不回顾整段历史" in prompt
    assert "用更简单的新说法回答" in prompt
    assert "明确要求的写作任务可以超过普通长度" in prompt


def test_voice_check_in_does_not_imply_playback_failure_or_require_settings():
    prompt = system_prompt()
    assert '不要把这类呼叫推断为声音故障' in prompt
    assert '不主动让用户改设置、切换文字或排查设备' in prompt
    assert '不再建议重新开启或调整同一设置' in prompt
    assert '不要从旧对话继承仍未验证的声音故障' in prompt
