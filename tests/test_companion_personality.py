from src.apps.companion_runtime.personality import get_profile, system_prompt


def test_profiles_are_explicit_and_safe_fallback_is_stable():
    assert get_profile("quiet_listener").name == "温和倾听"
    assert get_profile("unknown").key == "warm_curious"


def test_prompt_carries_behavior_rules_without_claiming_real_feelings():
    prompt = system_prompt(get_profile("steady_care"))
    assert "沉稳照料" in prompt
    assert "每轮最多一个问题" in prompt
    assert "不代表你有真实感受" in prompt
