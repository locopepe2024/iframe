"""Evidence collector must distinguish passing regressions from unmet scenarios."""
import json

import pytest

from scripts.companion_eval import diary


def fake_reports(monkeypatch, *, omit=None, process_failure=False):
    def execute(command, cwd, env, log):
        output = log.parent
        if log.name == "frontend.log":
            (output / "frontend.json").write_text(json.dumps({"numTotalTests": 3, "numPassedTests": 3, "success": True}))
            rows = [{"case_id": case_id, "scope": "mocked", "checks": [{"name": "seed_contract", "passed": case_id == "D01"}]}
                    for case_id in ("D01", "D02", "D03") if case_id != omit]
            (output / "component-observations.jsonl").write_text("\n".join(json.dumps(row) for row in rows))
        else:
            (output / "backend.xml").write_text('<testsuites><testsuite><testcase name="save"/></testsuite></testsuites>')
        return {"exit_code": 1 if process_failure else 0}
    monkeypatch.setattr(diary, "execute", execute)


def test_passing_suites_do_not_hide_case_expectation_mismatches(tmp_path, monkeypatch):
    fake_reports(monkeypatch)
    result = diary.collect(tmp_path / "run")
    rows = {row["case_id"]: row for row in result["cases"]}
    assert result["suites_ok"]
    assert rows["D01"]["status"] == "component_checks_ok"
    assert rows["D02"]["status"] == rows["D03"]["status"] == "component_expectation_mismatch"
    assert result["full_scenario_pass_rate"] is None
    assert rows["D02"]["actual_audio"] == "NOT_TESTED"
    assert rows["V01"]["status"] == "not_run_in_this_slice"
    assert len(rows) == 24


@pytest.mark.parametrize("options", [{"omit": "D02"}, {"process_failure": True}])
def test_missing_observations_or_failed_process_prevent_success(tmp_path, monkeypatch, options):
    fake_reports(monkeypatch, **options)
    result = diary.collect(tmp_path / "run")
    assert not result["suites_ok"]
    assert all(row["status"] == "evidence_incomplete" for row in result["cases"] if row["case_id"].startswith("D0") and row["case_id"] != "D05")


def test_existing_run_cannot_be_overwritten(tmp_path):
    output = tmp_path / "run"
    output.mkdir()
    marker = output / "summary.json"
    marker.write_text("previous evidence")
    with pytest.raises(FileExistsError):
        diary.collect(output)
    assert marker.read_text() == "previous evidence"
