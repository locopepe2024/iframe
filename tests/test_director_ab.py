from src.apps.comic_gen.director_ab import compare_profiles, score_profile


def test_score_profile_reports_source_coverage_and_unresolved_refs():
    score = score_profile(
        {
            "story_map": {"events": [{"title": "毕业选择"}]},
            "relationships": [{"description": "周涵与尤雪关系破裂"}],
            "unresolved_character_refs": ["陌生人"],
        },
        {
            "events": ["毕业选择", "婚礼擦肩"],
            "characters": ["周涵", "尤雪"],
            "relationships": ["关系破裂"],
            "scenes": [],
            "threads": [],
        },
    )
    assert score["event_coverage"]["rate"] == 0.5
    assert score["character_coverage"]["rate"] == 1.0
    assert score["unresolved_reference_count"] == 1


def test_compare_profiles_exposes_direct_minus_digest_delta():
    direct = {"story_map": {"events": [{"title": "中段转折"}]}}
    digest = {"story_map": {"events": []}}
    result = compare_profiles(direct, digest, {"events": ["中段转折"]})
    assert result["direct"]["event_coverage"]["rate"] == 1.0
    assert result["digest"]["event_coverage"]["rate"] == 0.0
    assert result["delta_direct_minus_digest"]["event_coverage"] == 1.0
