from threading import RLock

from src.apps.comic_gen.models import ExtraRosterEntry, GlobalAssetLibrary, Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline


def make_pipeline(tmp_path, script, series):
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.series_data_file = str(tmp_path / "series.json")
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {series.id: series}
    pipeline.library_store = GlobalAssetLibrary()
    return pipeline


def test_asset_reference_index_projects_series_crowd_metadata(tmp_path):
    series = Series(
        id="series", title="青溪镇", created_at=1, updated_at=1,
        extra_roster=[
            ExtraRosterEntry(
                extra_id="townspeople", label="青溪镇市井百姓",
                kind="extra_template", role_tags=["近景", "避让"],
                reference_media_ids={"anchor": "media-crowd-1"},
            ),
        ],
    )
    script = Script(id="episode", title="第一幕", original_text="", series_id=series.id,
                    created_at=1, updated_at=1)
    pipeline = make_pipeline(tmp_path, script, series)

    index = pipeline.get_asset_reference_index(script.id)
    crowd = next(item for item in index.assets if item.asset_type == "crowd")

    assert crowd.asset_id == "townspeople"
    assert crowd.source_scope == "series"
    assert crowd.crowd_kind == "extra_template"
    assert crowd.role_tags == ["近景", "避让"]
    assert crowd.reference_media_ids == {"anchor": "media-crowd-1"}
    assert crowd.variants == []


def test_asset_library_index_includes_series_crowd_without_converting_it(tmp_path):
    series = Series(
        id="series", title="青溪镇", created_at=1, updated_at=1,
        extra_roster=[ExtraRosterEntry(extra_id="bandits", label="流民匪寇")],
    )
    pipeline = make_pipeline(
        tmp_path,
        Script(id="episode", title="第一幕", original_text="", series_id=series.id,
               created_at=1, updated_at=1),
        series,
    )

    index = pipeline.get_asset_library_reference_index()
    crowd = next(item for item in index.assets if item.asset_type == "crowd")
    assert crowd.asset_id == "bandits"
    assert crowd.name == "流民匪寇"
    assert crowd.crowd_kind == "fixed_extra"
