import json

from scripts.repair_series_style_inheritance import repair


def test_repair_removes_only_episode_style_and_keeps_director_history(tmp_path):
    series = {"s": {"episode_ids": ["e"], "art_direction": {"style_config": {"name": "New"}}}}
    episode = {
        "series_id": "s",
        "art_direction": {"selected_style_id": "old", "style_config": {"name": "Old"},
                          "director_profile": {"revision": 2, "story_map": {"phases": [1]}}},
        "director_profile_revisions": [{"revision": 1}, {"revision": 2}],
        "director_profile_draft": {"pacing": "unchanged"},
        "director_profile_draft_revision": 3,
    }
    (tmp_path / "series.json").write_text(json.dumps(series))
    (tmp_path / "projects.json").write_text(json.dumps({"e": episode}))

    assert repair(tmp_path, "s", "e", 2, False)["applied"] is False
    assert json.loads((tmp_path / "projects.json").read_text())["e"] == episode

    result = repair(tmp_path, "s", "e", 2, True)
    changed = json.loads((tmp_path / "projects.json").read_text())["e"]
    assert result["applied"] is True
    assert changed["art_direction"]["style_config"] == {}
    assert changed["art_direction"]["director_profile"] == episode["art_direction"]["director_profile"]
    assert changed["director_profile_revisions"] == episode["director_profile_revisions"]
    assert changed["director_profile_draft"] == episode["director_profile_draft"]
    assert json.loads((tmp_path / "series.json").read_text()) == series
    assert json.loads(__import__("pathlib").Path(result["backup"]).read_text())["e"] == episode
