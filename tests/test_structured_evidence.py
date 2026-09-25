import pytest
from fastapi import HTTPException

from src.apps.comic_gen.models import Character, Prop, Scene, Script
from src.apps.comic_gen.structured_evidence import query_asset_mentions, source_version


def make_script(text):
    return Script(
        id="episode", title="第一集", original_text=text,
        created_at=1, updated_at=1,
        characters=[
            Character(id="zhou", name="周涵", description=""),
            Character(id="zhou-college", name="周涵（大学时期）", description="", base_character_id="zhou"),
        ],
        scenes=[Scene(id="cinema", name="电影院", description="")],
        props=[Prop(id="ticket", name="电影票", description="")],
    )


def test_repeated_mentions_keep_exact_source_ranges():
    text = "周涵牵着沈夏走向电影院。\n周涵牵着沈夏走向电影院。"
    script = make_script(text)

    result = query_asset_mentions(script, "character", "zhou", source_version(text))

    assert result["source_version"] == source_version(text)
    assert len(result["mentions"]) == 2
    assert [text[item["start"]:item["end"]] for item in result["mentions"]] == ["周涵", "周涵"]
    assert result["mentions"][0]["start"] != result["mentions"][1]["start"]
    assert all(item["evidence_type"] == "literal_mention" for item in result["mentions"])


def test_variant_fallback_is_explicitly_ambiguous():
    script = make_script("周涵走向电影院。")

    result = query_asset_mentions(script, "character", "zhou-college", source_version(script.original_text))

    assert result["matched_name"] == "周涵"
    assert result["variant_ambiguous"] is True
    assert len(result["mentions"]) == 1


def test_exact_variant_mention_takes_precedence():
    script = make_script("周涵走近。周涵（大学时期）在电影院门口等沈夏。")

    result = query_asset_mentions(script, "character", "zhou-college", source_version(script.original_text))

    assert result["matched_name"] == "周涵（大学时期）"
    assert result["variant_ambiguous"] is False
    assert len(result["mentions"]) == 1


def test_source_change_rejects_stale_query():
    script = make_script("周涵走向电影院。")
    old_version = source_version(script.original_text)
    script.original_text = "周涵走向电影院入口。"

    with pytest.raises(HTTPException) as error:
        query_asset_mentions(script, "scene", "cinema", old_version)

    assert error.value.status_code == 409


def test_missing_asset_is_not_replaced_with_name_guess():
    script = make_script("周涵拿着电影票。")

    with pytest.raises(HTTPException) as error:
        query_asset_mentions(script, "prop", "unknown", source_version(script.original_text))

    assert error.value.status_code == 404


def test_source_revision_list_omits_text_and_legacy_current_source_is_readable(monkeypatch):
    from src.apps.comic_gen import api

    script = make_script("周涵走向电影院。")
    monkeypatch.setattr(api.pipeline, "get_script", lambda script_id: script)

    revisions = api.list_source_revisions(script.id, user=None)
    assert len(revisions) == 1
    assert "text" not in revisions[0]
    assert revisions[0]["content_hash"] == source_version(script.original_text)
    assert api.get_source_revision(script.id, 1, user=None).text == script.original_text
