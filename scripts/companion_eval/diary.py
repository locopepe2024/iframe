"""Collect separate diary component and backend evidence; never claim full E2E."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.companion_eval.check_cases import DEFAULT, validate

UI_FILES = ["DiaryEvaluation.test.tsx", "DiaryEditor.test.tsx", "DiaryCalendar.test.tsx", "diaryIntent.test.tsx"]


def execute(command, cwd, env, log):
    started = datetime.now(timezone.utc).isoformat()
    with log.open("x") as stream:
        try:
            result = subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=120)
            return {"command": command, "started_at_utc": started, "exit_code": result.returncode}
        except subprocess.TimeoutExpired:
            return {"command": command, "started_at_utc": started, "exit_code": None, "error": "timeout"}
        except OSError as exc:
            return {"command": command, "started_at_utc": started, "exit_code": None, "error": type(exc).__name__}


def collect(output):
    cases, errors = validate(DEFAULT)
    if errors:
        raise ValueError("Invalid seed cases")
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    started = datetime.now(timezone.utc).isoformat()
    env = dict(os.environ, TZ="Asia/Hong_Kong", COMPANION_DIARY_EVIDENCE=str(output / "component-observations.jsonl"))
    # Components mock provider/API calls, backend tests override identity/storage and model calls.
    frontend = execute(["node", "scripts/run-vitest.mjs", "--config", "vitest.ui.config.mts",
                        *["src/components/companion/agent/" + name for name in UI_FILES],
                        "--reporter=json", "--outputFile=" + str(output / "frontend.json")],
                       ROOT / "frontend", env, output / "frontend.log")
    backend = execute([sys.executable, "-m", "pytest", "-q", "--disable-warnings", "tests/test_companion_diary.py",
                       "--junitxml=" + str(output / "backend.xml")], ROOT, env, output / "backend.log")
    report_error = None
    observations = {}
    try:
        report = json.loads((output / "frontend.json").read_text())
        frontend["tests"] = report["numTotalTests"]
        frontend["passed"] = report["numPassedTests"]
        frontend["report_ok"] = report["success"] is True and frontend["tests"] > 0 and frontend["passed"] == frontend["tests"]
        tree = ET.parse(output / "backend.xml")
        backend["tests"] = len(tree.findall(".//testcase"))
        backend["report_ok"] = backend["tests"] > 0 and not tree.findall(".//failure") and not tree.findall(".//error") and not tree.findall(".//skipped")
        for line in (output / "component-observations.jsonl").read_text().splitlines():
            row = json.loads(line)
            if row["case_id"] in observations:
                raise ValueError("Duplicate observation")
            observations[row["case_id"]] = row
        if set(observations) != {"D01", "D02", "D03"}:
            raise ValueError("Missing case observations")
        for observation in observations.values():
            if not observation.get("checks") or any(not isinstance(check.get("passed"), bool) for check in observation["checks"]):
                raise ValueError("Missing or invalid observation checks")
    except (OSError, ValueError, KeyError, ET.ParseError) as exc:
        report_error = type(exc).__name__
    suites_ok = report_error is None and all(suite.get("exit_code") == 0 and suite.get("report_ok") for suite in (frontend, backend))
    records = []
    for case in cases:
        row = {"case_id": case["id"], "status": "not_run_in_this_slice", "full_scenario_pass": None}
        if case["id"] in {"D01", "D02", "D03"}:
            if suites_ok:
                row.update(observations[case["id"]])
                row["status"] = "component_checks_ok" if all(c["passed"] for c in row["checks"]) else "component_expectation_mismatch"
                row["actual_audio"] = "NOT_TESTED"
                row["backend_connection"] = "MOCKED"
            else:
                row["status"] = "evidence_incomplete"
        elif case["id"] == "D04":
            row.update(status="frontend_date_conversion_regression_ok" if suites_ok else "evidence_incomplete",
                       scope="existing_diaryIntent_tests; no actual Qwen or integrated API request")
        records.append(row)
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "unknown"
    paths = [Path(__file__), DEFAULT, ROOT / "tests/test_companion_diary.py"]
    paths += [ROOT / "frontend/src/components/companion/agent" / name for name in UI_FILES]
    paths += [ROOT / "frontend/src/components/companion/agent" / name for name in
              ("DiaryCard.tsx", "DiaryEditor.tsx", "useDiaryDictation.ts", "DiaryCalendar.tsx")]
    summary = {"started_at_utc": started, "finished_at_utc": datetime.now(timezone.utc).isoformat(),
               "code_revision": revision, "sources_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
               "scope": "React components with mocked ASR/API, plus separate SQLite backend tests; NOT full E2E",
               "frontend": frontend, "backend": backend, "suites_ok": suites_ok, "report_error": report_error,
               "full_scenario_pass_rate": None, "model_quality": "NOT_EVALUATED", "actual_audio": "NOT_TESTED",
               "total_cases": len(records), "cases": records}
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New output directory")
    args = parser.parse_args()
    try:
        summary = collect(args.output)
    except (OSError, ValueError) as exc:
        parser.error(type(exc).__name__ + ": cannot create or validate run")
    print(json.dumps({key: summary[key] for key in ("suites_ok", "report_error", "scope", "cases")}, ensure_ascii=False, indent=2))
    return 2 if not summary["suites_ok"] or any(row["status"] == "component_expectation_mismatch" for row in summary["cases"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
