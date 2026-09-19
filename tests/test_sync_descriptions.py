from types import SimpleNamespace

from src.apps.comic_gen.models import Character, Scene, Prop, Script, Series


def test_sync_descriptions_returns_the_merged_project_asset_view(monkeypatch):
    from src.apps.comic_gen import api

    script = Script(
        id="episode",
        title="Episode",
        original_text="source",
        created_at=1,
        updated_at=1,
        series_id="series",
        characters=[],
        scenes=[],
        props=[],
    )
    series = Series(
        id="series",
        title="Series",
        created_at=1,
        updated_at=1,
        characters=[Character(id="char-1", name="周涵", description="大学时期")],
        scenes=[Scene(id="scene-1", name="大学电影院", description="安静的放映厅")],
        props=[Prop(id="prop-1", name="大学教材", description="翻开的教材")],
    )
    pipeline = SimpleNamespace(
        get_script=lambda project_id: script if project_id == "episode" else None,
        sync_descriptions_from_script_entities=lambda project_id: script,
        get_series=lambda series_id: series if series_id == "series" else None,
        library_store=SimpleNamespace(characters=[], scenes=[], props=[]),
        _library_list_for_type=lambda *args: [],
    )
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "signed_response", lambda data: data)

    result = api.sync_descriptions("episode")

    assert [item["id"] for item in result["characters"]] == ["char-1"]
    assert [item["id"] for item in result["scenes"]] == ["scene-1"]
    assert [item["id"] for item in result["props"]] == ["prop-1"]
    assert all(item["source"] == "series" for item in result["characters"])
