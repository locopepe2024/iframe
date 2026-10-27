import json
from types import SimpleNamespace

import pytest

from src.apps.comic_gen.models import ExtraRosterEntry, Script, Series


@pytest.fixture
def reconcile_setup(monkeypatch, tmp_path):
    from src.apps.comic_gen import api

    series = Series(id="series", title="青溪镇", created_at=1, updated_at=1,
                    extra_roster=[ExtraRosterEntry(extra_id="existing-bandits", label="流民匪寇", kind="extra_template")])
    script = Script(id="episode", title="第一幕", original_text="", series_id=series.id,
                    created_at=1, updated_at=1, crowd_group_candidates=[
                        ExtraRosterEntry(extra_id="local-bandits", label="流民匪寇", kind="extra_template"),
                        ExtraRosterEntry(extra_id="local-townspeople", label="青溪镇市井百姓", kind="extra_template"),
                    ])

    class Pipeline:
        scripts = {script.id: script}
        series_store = {series.id: series}

        def get_script(self, script_id):
            return self.scripts.get(script_id)

        def get_series(self, series_id):
            return self.series_store.get(series_id)

        def _save_data(self):
            pass

        def _save_series_data(self):
            pass

    monkeypatch.setattr(api, "pipeline", Pipeline())
    monkeypatch.setattr(api, "signed_response", lambda value: SimpleNamespace(body=json.dumps(value.model_dump()).encode()))
    return api, script, series


def test_reconcile_suggests_extracted_crowd_groups(reconcile_setup):
    api, _, _ = reconcile_setup

    suggestions = api.reconcile_suggestions("episode")["crowd_groups"]

    assert [(item["local_name"], item["suggested_series_id"], item["confidence"])
            for item in suggestions] == [
                ("流民匪寇", "existing-bandits", 100),
                ("青溪镇市井百姓", None, 0),
            ]


def test_reconcile_merges_and_promotes_crowd_groups(reconcile_setup):
    api, script, series = reconcile_setup

    response = api.reconcile_apply("episode", api.ApplyReconcileRequest(crowd_groups=[
        api.ReconcileAction(local_id="local-bandits", action="merge_into_series", target_series_id="existing-bandits"),
        api.ReconcileAction(local_id="local-townspeople", action="create_new_in_series"),
    ]))

    assert script.crowd_group_candidates == []
    assert [entry.extra_id for entry in series.extra_roster] == ["existing-bandits", "local-townspeople"]
    assert json.loads(response.body)["crowd_group_candidates"] == []


def test_reconcile_rejects_crowd_merge_target_with_different_kind(reconcile_setup):
    from fastapi import HTTPException

    api, script, series = reconcile_setup
    series.extra_roster[0].kind = "fixed_extra"

    with pytest.raises(HTTPException) as error:
        api.reconcile_apply("episode", api.ApplyReconcileRequest(crowd_groups=[
            api.ReconcileAction(local_id="local-bandits", action="merge_into_series", target_series_id="existing-bandits"),
        ]))

    assert error.value.status_code == 400
    assert len(script.crowd_group_candidates) == 2
