"""Tests for Series functionality (Phase 3).

Covers: Models, Pipeline CRUD, Episode association, asset resolution,
PromptConfig three-level fallback, text splitting, and cross-series import.
"""

import time
import uuid
import pytest
from unittest.mock import patch, MagicMock

from src.apps.comic_gen.models import (
    Series, Script, Character, Scene, Prop, PromptConfig, ModelSettings,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def pipeline(tmp_path):
    """Create a pipeline with temp data files, bypassing real IO."""
    with patch("src.apps.comic_gen.pipeline.ScriptProcessor"), \
         patch("src.apps.comic_gen.pipeline.AssetGenerator"), \
         patch("src.apps.comic_gen.pipeline.StoryboardGenerator"), \
         patch("src.apps.comic_gen.pipeline.VideoGenerator"), \
         patch("src.apps.comic_gen.pipeline.AudioGenerator"), \
         patch("src.apps.comic_gen.pipeline.ExportManager"):
        p = ComicGenPipeline()
    p.data_file = str(tmp_path / "projects.json")
    p.series_data_file = str(tmp_path / "series.json")
    p.scripts = {}
    p.series_store = {}
    return p


def _make_script(title="Episode 1", text="Some text", **overrides) -> Script:
    """Helper to create a Script with sensible defaults."""
    now = time.time()
    defaults = dict(
        id=str(uuid.uuid4()),
        title=title,
        original_text=text,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return Script(**defaults)


def _make_character(name="Hero", **kw) -> Character:
    return Character(id=kw.pop("id", str(uuid.uuid4())), name=name,
                     description=kw.pop("description", "A brave hero"), **kw)


def _make_scene(name="Forest", **kw) -> Scene:
    return Scene(id=kw.pop("id", str(uuid.uuid4())), name=name,
                 description=kw.pop("description", "A dark forest"), **kw)


def test_series_source_context_is_exposed_to_episode_analysis(pipeline):
    series = pipeline.create_series("S")
    series.source_context = {"kind": "series_submission_context", "synopsis": "全剧摘要"}
    episode = _make_script(series_id=series.id)
    pipeline.scripts[episode.id] = episode
    pipeline.series_store[series.id] = series
    pipeline.storyboard_analysis_context = lambda _id: (episode, {"characters": []}, None)
    script, entities, _ = pipeline.director_analysis_context(episode.id)
    assert script.id == episode.id
    assert entities["series_context"]["synopsis"] == "全剧摘要"


def test_director_analysis_excludes_unbound_shared_assets(pipeline):
    series = pipeline.create_series("S")
    series.characters.append(_make_character("Series extra"))
    episode = _make_script(series_id=series.id, characters=[_make_character("Episode lead")])
    pipeline.scripts[episode.id] = episode
    pipeline.series_store[series.id] = series
    pipeline.resolve_episode_assets = lambda _episode: {
        "characters": [*episode.characters, *series.characters, _make_character("Global extra")],
        "scenes": [], "props": [],
    }

    _, entities, _ = pipeline.director_analysis_context(episode.id)

    assert [character["name"] for character in entities["characters"]] == ["Episode lead"]


def test_series_director_analysis_excludes_shared_visual_assets(pipeline):
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    series.characters.append(_make_character("Shared reference"))
    episode = _make_script(series_id=series.id, characters=[_make_character("Script lead")])
    pipeline.scripts[episode.id] = episode
    series.episode_ids = [episode.id]
    pipeline.series_store[series.id] = series
    pipeline.script_processor.analyze_director_profile_with_audit.return_value = {
        "profile": profile_payload(),
        "source_audit": {},
    }

    pipeline.preview_series_director_profile(series.id)

    entities = pipeline.script_processor.analyze_director_profile_with_audit.call_args.args[1]
    assert [character["name"] for character in entities["characters"]] == ["Script lead"]


def test_updating_series_style_preserves_confirmed_director_profile(pipeline):
    from src.apps.comic_gen.models import ArtDirection, DirectorProfile
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    profile = DirectorProfile(**profile_payload(), revision=1, content_hash="profile-1")
    series.art_direction = ArtDirection(
        selected_style_id="old", style_config={"name": "Old"}, director_profile=profile,
    )

    updated = pipeline.update_series(series.id, {
        "art_direction": {"selected_style_id": "new", "style_config": {"name": "New"}},
    })

    assert updated.art_direction.style_config["name"] == "New"
    assert updated.art_direction.director_profile == profile

    cleared = pipeline.update_series(series.id, {"art_direction": None})
    assert cleared.art_direction.style_config == {}
    assert cleared.art_direction.director_profile == profile


def test_episode_director_confirmation_keeps_series_style_live(pipeline):
    from src.apps.comic_gen.models import ArtDirection
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    series.art_direction = ArtDirection(selected_style_id="old", style_config={"name": "Old"})
    episode = _make_script(series_id=series.id)
    pipeline.scripts[episode.id] = episode
    pipeline._save_data = MagicMock()

    pipeline.apply_director_profile(episode.id, profile_payload())
    assert episode.art_direction.director_profile is not None
    assert episode.art_direction.style_config == {}
    assert pipeline.effective_art_direction(episode).style_config["name"] == "Old"

    series.art_direction.style_config = {"name": "New"}
    assert pipeline.effective_art_direction(episode).style_config["name"] == "New"
    assert pipeline.effective_director_profile(episode).revision == 1


def test_reset_episode_style_retains_its_director_profile(pipeline, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ArtDirection, DirectorProfile
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    series.art_direction = ArtDirection(selected_style_id="series", style_config={"name": "Series"})
    profile = DirectorProfile(**profile_payload(), revision=2, content_hash="profile-2")
    episode = _make_script(series_id=series.id, art_direction=ArtDirection(
        selected_style_id="episode", style_config={"name": "Episode"}, director_profile=profile,
    ))
    pipeline.scripts[episode.id] = episode
    pipeline._save_data = MagicMock()
    monkeypatch.setattr(api, "pipeline", pipeline)

    api.clear_project_art_direction(episode.id)

    assert episode.art_direction.style_config == {}
    assert episode.art_direction.director_profile == profile
    assert pipeline.effective_art_direction(episode).style_config["name"] == "Series"


def test_episode_director_draft_and_history_do_not_impersonate_series_profile(pipeline, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ArtDirection, DirectorProfile
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    series.art_direction = ArtDirection(
        selected_style_id="series", style_config={"name": "Series"},
        director_profile=DirectorProfile(**profile_payload(), revision=3, content_hash="series-3"),
    )
    episode = _make_script(series_id=series.id)
    pipeline.scripts[episode.id] = episode
    monkeypatch.setattr(api, "pipeline", pipeline)

    assert pipeline.effective_director_profile(episode).revision == 3
    assert api.list_director_profile_revisions(episode.id) == []
    assert api.get_director_profile_draft(episode.id)["draft"] is None


def test_episode_director_review_status_tracks_series_style_and_director_revision(pipeline, monkeypatch):
    import json
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ArtDirection, DirectorProfile
    from src.apps.comic_gen.pipeline import _director_style_hash
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    series.art_direction = ArtDirection(selected_style_id="series", style_config={"name": "Old"})
    series.director_profile_revisions = []
    episode = _make_script(series_id=series.id, art_direction=ArtDirection(
        selected_style_id="director-profile", style_config={},
        director_profile=DirectorProfile(**profile_payload(), revision=1, content_hash="episode-1"),
    ))
    episode.director_style_hash = _director_style_hash({"name": "Old"})
    episode.director_series_revision = 1
    pipeline.scripts[episode.id] = episode
    monkeypatch.setattr(api, "pipeline", pipeline)

    series.art_direction.style_config = {"name": "New"}
    response = api.get_project(episode.id)
    payload = json.loads(response.body)
    assert payload["director_style_review_required"] is True
    assert payload["series_director_review_required"] is True


def test_series_director_review_status_tracks_style_baseline(pipeline, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import ArtDirection, DirectorProfile
    from tests.test_director_profile import profile_payload

    series = pipeline.create_series("S")
    series.art_direction = ArtDirection(selected_style_id="old", style_config={"name": "Old"})
    series.director_profile_draft = DirectorProfile(**profile_payload())
    pipeline.confirm_series_director_profile(series.id)
    monkeypatch.setattr(api, "pipeline", pipeline)
    assert api.get_series_director_profile(series.id)["style_review_required"] is False

    pipeline.update_series(series.id, {
        "art_direction": {"selected_style_id": "new", "style_config": {"name": "New"}},
    })
    assert api.get_series_director_profile(series.id)["style_review_required"] is True
    assert len(series.director_profile_revisions) == 1


def _make_prop(name="Sword", **kw) -> Prop:
    return Prop(id=kw.pop("id", str(uuid.uuid4())), name=name,
                description=kw.pop("description", "A magic sword"), **kw)


# ===================================================================
# 1. Models tests
# ===================================================================

class TestModels:
    def test_series_defaults(self):
        now = time.time()
        s = Series(id="s1", title="My Series", created_at=now, updated_at=now)
        assert s.id == "s1"
        assert s.title == "My Series"
        assert s.description == ""
        assert s.characters == []
        assert s.scenes == []
        assert s.props == []
        assert s.art_direction is None
        assert isinstance(s.prompt_config, PromptConfig)
        assert isinstance(s.model_settings, ModelSettings)
        assert s.episode_ids == []
        assert s.created_at > 0
        assert s.updated_at > 0

    def test_script_series_fields_default_none(self):
        sc = _make_script()
        assert sc.series_id is None
        assert sc.episode_number is None


# ===================================================================
# 2. Pipeline CRUD tests
# ===================================================================

class TestSeriesCRUD:
    def test_create_series(self, pipeline):
        s = pipeline.create_series("Title A", "desc A")
        assert s.id in pipeline.series_store
        assert s.title == "Title A"
        assert s.description == "desc A"
        assert s.created_at > 0
        assert s.updated_at > 0

    def test_get_series_exists(self, pipeline):
        s = pipeline.create_series("X")
        assert pipeline.get_series(s.id) is s

    def test_get_series_not_found(self, pipeline):
        assert pipeline.get_series("nonexistent") is None

    def test_list_series_empty(self, pipeline):
        assert pipeline.list_series() == []

    def test_list_series_multiple(self, pipeline):
        pipeline.create_series("A")
        pipeline.create_series("B")
        assert len(pipeline.list_series()) == 2

    def test_update_series_title_and_description(self, pipeline):
        s = pipeline.create_series("Old")
        old_updated = s.updated_at
        updated = pipeline.update_series(s.id, {"title": "New", "description": "new desc"})
        assert updated.title == "New"
        assert updated.description == "new desc"
        assert updated.updated_at >= old_updated

    def test_update_series_episode_ids_not_overwritten(self, pipeline):
        s = pipeline.create_series("X")
        s.episode_ids = ["ep1"]
        pipeline.update_series(s.id, {"episode_ids": ["should_not_change"]})
        assert s.episode_ids == ["ep1"]

    def test_update_series_not_found(self, pipeline):
        with pytest.raises(ValueError, match="Series not found"):
            pipeline.update_series("missing", {"title": "X"})

    def test_delete_series_clears_episodes(self, pipeline):
        s = pipeline.create_series("ToDelete")
        ep = _make_script(title="Ep1")
        pipeline.scripts[ep.id] = ep
        pipeline.add_episode_to_series(s.id, ep.id)
        assert ep.series_id == s.id

        pipeline.delete_series(s.id)
        assert s.id not in pipeline.series_store
        assert ep.series_id is None
        assert ep.episode_number is None

    def test_delete_series_not_found(self, pipeline):
        with pytest.raises(ValueError, match="Series not found"):
            pipeline.delete_series("missing")


# ===================================================================
# 3. Episode association tests
# ===================================================================

class TestEpisodeAssociation:
    def test_add_episode_to_series(self, pipeline):
        s = pipeline.create_series("S")
        ep = _make_script()
        pipeline.scripts[ep.id] = ep

        result = pipeline.add_episode_to_series(s.id, ep.id)
        assert ep.id in result.episode_ids
        assert ep.series_id == s.id
        assert ep.episode_number == 1

    def test_add_episode_reassign_from_old_series(self, pipeline):
        s1 = pipeline.create_series("S1")
        s2 = pipeline.create_series("S2")
        ep = _make_script()
        pipeline.scripts[ep.id] = ep

        pipeline.add_episode_to_series(s1.id, ep.id)
        assert ep.id in s1.episode_ids

        pipeline.add_episode_to_series(s2.id, ep.id)
        assert ep.id not in s1.episode_ids
        assert ep.id in s2.episode_ids
        assert ep.series_id == s2.id

    def test_remove_episode_from_series(self, pipeline):
        s = pipeline.create_series("S")
        ep = _make_script()
        pipeline.scripts[ep.id] = ep
        pipeline.add_episode_to_series(s.id, ep.id)

        pipeline.remove_episode_from_series(s.id, ep.id)
        assert ep.id not in s.episode_ids
        assert ep.series_id is None
        assert ep.episode_number is None

    def test_get_series_episodes_order(self, pipeline):
        s = pipeline.create_series("S")
        ep1 = _make_script(title="Ep1")
        ep2 = _make_script(title="Ep2")
        pipeline.scripts[ep1.id] = ep1
        pipeline.scripts[ep2.id] = ep2

        pipeline.add_episode_to_series(s.id, ep1.id, episode_number=1)
        pipeline.add_episode_to_series(s.id, ep2.id, episode_number=2)

        episodes = pipeline.get_series_episodes(s.id)
        assert len(episodes) == 2
        assert episodes[0].title == "Ep1"
        assert episodes[1].title == "Ep2"


# ===================================================================
# 4. Asset resolution tests
# ===================================================================

class TestResolveEpisodeAssets:
    def test_no_series_returns_local(self, pipeline):
        ep = _make_script()
        char = _make_character()
        ep.characters = [char]
        result = pipeline.resolve_episode_assets(ep)
        assert result["characters"] == [char]
        assert result["scenes"] == []
        assert result["props"] == []

    def test_merge_series_and_episode_local_priority(self, pipeline):
        shared_id = "shared-char"
        series_char = _make_character(name="Series Hero", id=shared_id)
        series_scene = _make_scene(name="Series Forest", id="series-scene")
        now = time.time()
        series = Series(id="s1", title="S", characters=[series_char], scenes=[series_scene],
                        created_at=now, updated_at=now)

        ep_char = _make_character(name="Episode Hero", id=shared_id)  # same ID → local wins
        ep = _make_script(characters=[ep_char])

        result = pipeline.resolve_episode_assets(ep, series=series)
        # Episode char with same ID should take priority
        assert len(result["characters"]) == 1
        assert result["characters"][0].name == "Episode Hero"
        # Series scene should be included
        assert len(result["scenes"]) == 1
        assert result["scenes"][0].name == "Series Forest"

    def test_auto_lookup_series_via_episode_series_id(self, pipeline):
        s = pipeline.create_series("S")
        series_prop = _make_prop(name="Series Sword")
        s.props = [series_prop]

        ep = _make_script(series_id=s.id)
        pipeline.scripts[ep.id] = ep

        result = pipeline.resolve_episode_assets(ep)
        assert len(result["props"]) == 1
        assert result["props"][0].name == "Series Sword"


# ===================================================================
# 5. PromptConfig three-level fallback tests
# ===================================================================

class TestGetEffectivePrompt:
    def test_episode_custom_takes_priority(self, pipeline):
        ep = _make_script()
        ep.prompt_config = PromptConfig(storyboard_polish="EP custom prompt")
        now = time.time()
        series = Series(id="s1", title="S",
                        prompt_config=PromptConfig(storyboard_polish="Series prompt"),
                        created_at=now, updated_at=now)

        result = pipeline.get_effective_prompt("storyboard_polish", ep, series)
        assert result == "EP custom prompt"

    def test_fallback_to_series(self, pipeline):
        ep = _make_script()
        ep.prompt_config = PromptConfig(storyboard_polish="")
        now = time.time()
        series = Series(id="s1", title="S",
                        prompt_config=PromptConfig(storyboard_polish="Series prompt"),
                        created_at=now, updated_at=now)

        result = pipeline.get_effective_prompt("storyboard_polish", ep, series)
        assert result == "Series prompt"

    def test_fallback_to_system_default(self, pipeline):
        ep = _make_script()
        ep.prompt_config = PromptConfig()
        now = time.time()
        series = Series(id="s1", title="S", prompt_config=PromptConfig(),
                        created_at=now, updated_at=now)

        result = pipeline.get_effective_prompt("storyboard_polish", ep, series)
        # Should return the DEFAULT_STORYBOARD_POLISH_PROMPT (non-empty string)
        assert len(result.strip()) > 0

    def test_invalid_prompt_type_raises_error(self, pipeline):
        """Invalid prompt_type raises ValueError."""
        ep = _make_script()
        with pytest.raises(ValueError, match="Invalid prompt_type"):
            pipeline.get_effective_prompt("nonexistent_type", ep)


# ===================================================================
# 6. Text splitting tests
# ===================================================================

class TestSplitTextByMarkers:
    def test_import_separates_submission_preamble_from_screenplay(self, pipeline):
        text = (
            "剧本名字：《示例》\n剧本梗概：全剧从校园走向异地。\n人物小传：甲乙。\n"
            "1、校园教室 日 内\n" + "人物发生冲突。" * 80
        )
        context, screenplay = pipeline._split_import_series_context(text)
        assert context["kind"] == "series_submission_context"
        assert "剧本梗概" in context["preamble"]
        assert screenplay.startswith("1、校园教室 日 内")
        assert "剧本梗概" not in screenplay

    def test_import_without_scene_heading_preserves_full_source(self, pipeline):
        text = "这是一段没有明确场景标记的剧本。" * 30
        context, screenplay = pipeline._split_import_series_context(text)
        assert context == {}
        assert screenplay == text

    def test_submission_form_without_scene_heading_becomes_series_context(self, pipeline):
        text = "一、剧本类型：电影\n剧本名字：《隔岸不观火》\n剧本梗概：异地恋故事。\n人物小传：甲乙。"
        context, screenplay = pipeline._split_import_series_context(text)
        assert context["kind"] == "series_submission_context"
        assert context["preamble"] == text
        assert context["synopsis"] == "异地恋故事。"
        assert screenplay == ""

    def test_save_series_source_context_preserves_plain_text(self, pipeline):
        series = pipeline.create_series("S")
        value = "剧本类型：电影\n全剧发生在西安。"
        saved = pipeline.save_series_source_context(series.id, value)
        assert saved.source_context["text"] == value
        assert saved.source_context["preamble"] == value

    def test_create_series_from_import_keeps_preamble_at_series_scope(self, pipeline):
        text = (
            "剧本名字：《示例》\n剧本梗概：全剧摘要。\n人物小传：甲乙。\n"
            "1、校园教室 日 内\n" + "人物发生冲突。" * 80
        )
        pipeline.script_processor.create_draft_script.side_effect = (
            lambda title, source: _make_script(title=title, text=source)
        )
        result = pipeline.create_series_from_import(
            "示例", text,
            [{"episode_number": 1, "title": "第一集", "start_marker": "1、校园教室 日 内", "end_marker": ""}],
        )
        series = pipeline.get_series(result["series"]["id"])
        episode = pipeline.get_script(result["episodes"][0]["id"])
        assert series.source_context["kind"] == "series_submission_context"
        assert "人物发生冲突" in episode.original_text
        assert "剧本梗概" not in episode.original_text

    def test_normal_marker_split(self, pipeline):
        text = "AAAA第一章开始BBBB内容CCCC第二章开始DDDD内容EEEE"
        episodes_data = [
            {"start_marker": "第一章开始", "end_marker": "CCCC"},
            {"start_marker": "第二章开始", "end_marker": "EEEE"},
        ]
        chunks = pipeline._split_text_by_markers(text, episodes_data)
        assert len(chunks) == 2
        assert "第一章开始" in chunks[0]
        assert "第二章开始" in chunks[1]

    def test_markers_not_found_fallback_equal_split(self, pipeline):
        text = "ABCDEFGHIJ"
        episodes_data = [
            {"start_marker": "XXX", "end_marker": "YYY"},
            {"start_marker": "ZZZ", "end_marker": "WWW"},
        ]
        chunks = pipeline._split_text_by_markers(text, episodes_data)
        assert len(chunks) == 2
        # Equal split: each chunk ~5 chars
        combined = "".join(chunks)
        assert combined == text

    def test_sequential_search_no_overlap(self, pipeline):
        text = "AAABBBCCC"
        episodes_data = [
            {"start_marker": "AAA", "end_marker": "BBB"},
            {"start_marker": "CCC", "end_marker": ""},
        ]
        chunks = pipeline._split_text_by_markers(text, episodes_data)
        assert len(chunks) == 2
        # First chunk should contain AAA through BBB
        assert "AAA" in chunks[0]
        assert "BBB" in chunks[0]
        # Second chunk should start from CCC onwards
        assert "CCC" in chunks[1]


# ===================================================================
# 7. Cross-series import tests
# ===================================================================

class TestImportAssetsFromSeries:
    def test_deep_copy_with_new_id(self, pipeline):
        source = pipeline.create_series("Source")
        char = _make_character(name="Hero")
        source.characters = [char]
        original_id = char.id

        target = pipeline.create_series("Target")

        result, imported_ids, skipped_ids = pipeline.import_assets_from_series(target.id, source.id, [original_id])
        assert len(result.characters) == 1
        imported = result.characters[0]
        # New ID, same name
        assert imported.id != original_id
        assert imported.name == "Hero"
        assert original_id in imported_ids
        assert len(skipped_ids) == 0

    def test_skip_nonexistent_asset_id(self, pipeline):
        source = pipeline.create_series("Source")
        source.characters = [_make_character(name="Hero")]
        target = pipeline.create_series("Target")

        result, imported_ids, skipped_ids = pipeline.import_assets_from_series(target.id, source.id, ["nonexistent-id"])
        assert len(result.characters) == 0
        assert len(result.scenes) == 0
        assert len(result.props) == 0
        assert "nonexistent-id" in skipped_ids

    def test_import_mixed_asset_types(self, pipeline):
        source = pipeline.create_series("Source")
        char = _make_character(name="C")
        scene = _make_scene(name="S")
        prop = _make_prop(name="P")
        source.characters = [char]
        source.scenes = [scene]
        source.props = [prop]

        target = pipeline.create_series("Target")
        result, imported_ids, skipped_ids = pipeline.import_assets_from_series(
            target.id, source.id, [char.id, scene.id, prop.id]
        )
        assert len(result.characters) == 1
        assert len(result.scenes) == 1
        assert len(result.props) == 1
        assert len(imported_ids) == 3
