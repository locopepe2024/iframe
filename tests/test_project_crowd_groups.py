from src.apps.comic_gen.models import ExtraRosterEntry, Script, Series


def test_project_response_exposes_series_crowd_groups(monkeypatch):
    from src.apps.comic_gen import api

    series = Series(id="series", title="青溪镇", created_at=1, updated_at=1,
                    extra_roster=[ExtraRosterEntry(extra_id="bandits", label="流民匪寇")])
    script = Script(id="episode", title="第一幕", original_text="", series_id="series",
                    created_at=1, updated_at=1)

    class Pipeline:
        def get_script(self, script_id, owner=None): return script
        def get_series(self, series_id, owner=None): return series
        def effective_art_direction(self, value): return None
        def effective_series_director_profile(self, value): return None
        def migrate_legacy_storyboard_media(self, value): pass

    monkeypatch.setattr(api, "pipeline", Pipeline())
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    response = api.get_project("episode", api.UserContext("u", "owner", "", ""))

    assert [item["label"] for item in response["crowd_groups"]] == ["流民匪寇"]
