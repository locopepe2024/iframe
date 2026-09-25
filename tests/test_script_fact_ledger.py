import threading
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen.models import (
    Script,
    ScriptFactLedgerEntry,
    SourceRange,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.structured_evidence import query_script_fact_ledger


def make_pipeline():
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = threading.RLock()
    pipeline._save_data = Mock()
    script = Script(
        id="episode",
        title="第一集",
        original_text="周涵牵着沈夏走向电影院入口。",
        created_at=1,
        updated_at=1,
    )
    pipeline.scripts = {script.id: script}
    return pipeline, script


def test_confirmed_fact_requires_exact_source_range_and_archives_snapshot():
    pipeline, script = make_pipeline()
    invalid = ScriptFactLedgerEntry(
        fact_id="fact-1",
        kind="action",
        subject_ids=["zhou", "shen"],
        source_revision=1,
        value={"action": "牵手前往电影院入口"},
        evidence_status="confirmed",
    )
    with pytest.raises(ValueError, match="requires a source range"):
        pipeline.apply_fact_ledger(script.id, 1, 0, [invalid])
    assert script.fact_ledger_revision == 0

    fact = invalid.model_copy(update={"source_ranges": [SourceRange(start=0, end=10)]})
    applied = pipeline.apply_fact_ledger(script.id, 1, 0, [fact])
    assert applied.fact_ledger_revision == 1
    assert applied.fact_ledger_revisions[0].source_revision == 1
    assert applied.fact_ledger_revisions[0].source_revision_id == applied.fact_ledger[0].source_revision_id
    assert applied.fact_ledger[0].source_revision_id.startswith("source-r1:")
    assert applied.fact_ledger_revisions[0].facts[0].fact_id == "fact-1"

    result = query_script_fact_ledger(applied, 1)
    assert result["facts"][0]["evidence"] == [{
        "start": 0,
        "end": 10,
        "text": "周涵牵着沈夏走向电影",
    }]


def test_fact_ledger_rejects_stale_revisions_and_out_of_bounds_ranges():
    pipeline, script = make_pipeline()
    with pytest.raises(ValueError, match="source revision changed"):
        pipeline.apply_fact_ledger(script.id, 2, 0, [])
    with pytest.raises(ValueError, match="invalid source range"):
        pipeline.apply_fact_ledger(
            script.id,
            1,
            0,
            [ScriptFactLedgerEntry(
                fact_id="fact-1",
                kind="event",
                source_revision=1,
                source_ranges=[SourceRange(start=0, end=100)],
                value={"event": "unknown"},
            )],
        )
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.apply_fact_ledger(script.id, 1, 1, [])


def test_fact_ledger_old_revision_remains_queryable_after_script_edit():
    pipeline, script = make_pipeline()
    fact = ScriptFactLedgerEntry(
        fact_id="fact-1",
        kind="action",
        source_revision=1,
        source_ranges=[SourceRange(start=0, end=2)],
        value={"action": "周涵"},
        evidence_status="confirmed",
    )
    pipeline.apply_fact_ledger(script.id, 1, 0, [fact])
    pipeline.update_script_text(script.id, "沈夏留在原地。")

    assert script.source_revision == 2
    assert script.fact_ledger_revision == 1
    old = query_script_fact_ledger(script, 1, ledger_revision=1)
    assert old["facts"][0]["evidence"][0]["text"] == "周涵"
    with pytest.raises(HTTPException) as error:
        query_script_fact_ledger(script, 2, ledger_revision=1)
    assert error.value.status_code == 409


def test_draft_save_is_separate_from_confirmation_and_uses_optimistic_revisions():
    pipeline, script = make_pipeline()
    fact = ScriptFactLedgerEntry(
        fact_id="fact-1",
        kind="character_action",
        source_revision=1,
        source_ranges=[SourceRange(start=0, end=2)],
        value={"action": "Zhou Han holds Shen Xia's hand"},
        evidence_status="confirmed",
    )
    saved = pipeline.save_fact_ledger_draft(script.id, 1, 0, [fact])
    assert saved.fact_ledger_draft_revision == 1
    assert saved.fact_ledger_revision == 0
    assert saved.fact_ledger_draft[0].source_revision_id
    with pytest.raises(ValueError, match="draft revision changed"):
        pipeline.save_fact_ledger_draft(script.id, 1, 0, [fact])

    confirmed = pipeline.confirm_fact_ledger(script.id, expected_revision=0, expected_draft_revision=1)
    assert confirmed.fact_ledger_revision == 1
    assert confirmed.fact_ledger_revisions[0].facts[0].fact_id == "fact-1"


def test_fact_ledger_evidence_reads_are_paginated():
    pipeline, script = make_pipeline()
    facts = [
        ScriptFactLedgerEntry(
            fact_id="fact-1", kind="character", source_revision=1,
            source_ranges=[SourceRange(start=0, end=2)], value={"name": "周涵"},
        ),
        ScriptFactLedgerEntry(
            fact_id="fact-2", kind="character", source_revision=1,
            source_ranges=[SourceRange(start=2, end=4)], value={"action": "牵着"},
        ),
    ]
    pipeline.apply_fact_ledger(script.id, 1, 0, facts)

    first_page = query_script_fact_ledger(script, 1, offset=0, limit=1)
    second_page = query_script_fact_ledger(script, 1, offset=1, limit=1)
    assert first_page["total_facts"] == 2
    assert first_page["truncated"] is True
    assert second_page["facts"][0]["fact_id"] == "fact-2"
    assert second_page["truncated"] is False
