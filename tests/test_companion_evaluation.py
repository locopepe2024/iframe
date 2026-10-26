"""Evaluator regression: exercise real API/storage, never a paid provider."""
import json
from unittest.mock import Mock

import pytest

from scripts.companion_eval import replay


def read_records(output):
    return {row["case_id"]: row for row in map(json.loads, (output / "records.jsonl").read_text().splitlines())}


def test_offline_run_exposes_route_boundary_and_keeps_missing_evidence_unscored(tmp_path, monkeypatch):
    network = Mock(side_effect=AssertionError("Unexpected external call"))
    monkeypatch.setattr(replay.requests, "post", network)
    output = tmp_path / "run"
    summary = replay.run(output, api_key="test-secret-never-in-artifacts")
    network.assert_not_called()
    assert summary["total"] == 24
    assert summary["counts"] == {"checks_failed": 1, "not_run_audio": 13, "synthetic_checks_ok": 4, "unsupported_state": 6}
    assert summary["full_scenario_pass_rate"] is None
    assert summary["human_quality"] == "NOT_EVALUATED"
    rows = read_records(output)
    diary = rows["D04"]
    checks = {item["name"]: item["passed"] for item in diary["checks"]}
    assert checks["context_delivered"]
    # Natural wording is currently routed to ordinary backend chat with memory tools.
    assert not checks["diary_lane_has_no_memory_tools"]
    assert diary["before"] == diary["after"]
    save = rows["M02"]
    assert save["api_response"]["result"]["status"] == "pending_confirmation"
    assert save["before"] == save["after"]
    assert all(check["passed"] for check in save["checks"])
    assert rows["V01"]["status"] == "not_run_audio"
    assert rows["D01"]["status"] == "unsupported_state"
    assert all(r["transport"] == "synthetic" for r in rows.values())
    assert all(set(r["human_review"].values()) == {"pending"} for r in rows.values())
    assert "test-secret-never-in-artifacts" not in (output / "records.jsonl").read_text()
    assert "test-secret-never-in-artifacts" not in (output / "summary.json").read_text()


def test_wrong_save_source_is_rejected_by_real_runtime_and_recorded(tmp_path):
    fixture = json.loads(replay.RESPONSES.read_text())
    message = fixture["messages"]["M02"]["tool_calls"][0]["function"]
    message["arguments"] = message["arguments"].replace("{{current_message_id}}", "wrong-source")
    path = tmp_path / "responses.json"
    path.write_text(json.dumps(fixture))
    replay.run(tmp_path / "run", responses_path=path)
    record = read_records(tmp_path / "run")["M02"]
    assert record["status"] == "checks_failed"
    assert record["http_status"] == 422
    assert record["before"] == record["after"]
    assert any(c["name"] == "save_waits_for_confirmation" and not c["passed"] for c in record["checks"])


def test_unexpected_persistent_mutation_cannot_pass_checks(tmp_path, monkeypatch):
    # Inject a state mutation at the request boundary to prove the evaluator detects it.
    original = replay.ChatStore.finish_turn

    def mutate(self, owner, actor, claim, proposal):
        result = original(self, owner, actor, claim, proposal)
        with self.connection(write=True) as db:
            db.execute("INSERT INTO companion_diaries VALUES (?,?,?,?,?,?,?)",
                       (owner, actor, "2026-10-26", "unexpected write", "", 1, self.clock()))
        return result

    monkeypatch.setattr(replay.ChatStore, "finish_turn", mutate)
    replay.run(tmp_path / "run")
    row = read_records(tmp_path / "run")["P03"]
    assert row["status"] == "checks_failed"
    assert any(c["name"] == "no_unconfirmed_persistent_write" and not c["passed"] for c in row["checks"])


def test_existing_artifacts_are_never_overwritten(tmp_path):
    output = tmp_path / "run"
    output.mkdir()
    marker = output / "summary.json"
    marker.write_text("existing result")
    with pytest.raises(FileExistsError):
        replay.run(output)
    assert marker.read_text() == "existing result"


@pytest.mark.parametrize("options", [{"mode": "typo"}, {"mode": "live"},
    {"mode": "live", "base_url": "http://example.test/v1", "api_key": "key"}])
def test_invalid_transport_fails_before_creating_artifacts(tmp_path, options):
    with pytest.raises(ValueError):
        replay.run(tmp_path / "run", **options)
    assert not (tmp_path / "run").exists()
