from types import SimpleNamespace

from src.apps.studio_access import StudioOwnerMixin


class _Pipeline(StudioOwnerMixin):
    def __init__(self, script, series):
        self.scripts = {script.id: script}
        self.series_store = {series.id: series}
        self.saved = []

    def _save_data(self):
        self.saved.append("projects")

    def _save_series_data(self):
        self.saved.append("series")


def test_migrate_owner_profile_updates_projects_series_and_children():
    child = SimpleNamespace(owner_user_id="old-user", owner_profile_id="browser-old")
    script = SimpleNamespace(
        id="project-1",
        owner_user_id="old-user",
        owner_profile_id="browser-old",
        characters=[child],
        scenes=[],
        props=[],
        frames=[],
        video_tasks=[],
    )
    series = SimpleNamespace(
        id="series-1",
        owner_user_id="old-user",
        owner_profile_id="browser-old",
        characters=[],
        scenes=[],
        props=[],
        frames=[],
        video_tasks=[],
    )
    pipeline = _Pipeline(script, series)

    assert pipeline.migrate_legacy_browser_owners("apikey-user", "apikey-profile") is True
    assert script.owner_user_id == "apikey-user"
    assert script.owner_profile_id == "apikey-profile"
    assert child.owner_user_id == "apikey-user"
    assert child.owner_profile_id == "apikey-profile"
    assert series.owner_profile_id == "apikey-profile"
    assert pipeline.saved == ["projects", "series"]


def test_migrate_owner_profile_does_not_merge_unrelated_owner():
    script = SimpleNamespace(
        id="project-1",
        owner_user_id="other-user",
        owner_profile_id="other-profile",
        characters=[],
        scenes=[],
        props=[],
        frames=[],
        video_tasks=[],
    )
    series = SimpleNamespace(
        id="series-1",
        owner_user_id="other-user",
        owner_profile_id="other-profile",
        characters=[],
        scenes=[],
        props=[],
        frames=[],
        video_tasks=[],
    )
    pipeline = _Pipeline(script, series)

    assert pipeline.migrate_legacy_browser_owners("apikey-user", "apikey-profile") is False
    assert pipeline.saved == []
