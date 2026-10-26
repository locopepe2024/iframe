"""Validate evaluation data only. Never calls models or scores product behavior."""
import argparse
from collections import Counter
import json
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import date


DEFAULT = Path(__file__).resolve().parents[2] / "tests/fixtures/companion_character/cases.v1.jsonl"
EXPECTED = {"emotion": 6, "persona": 4, "diary": 5, "memory": 3, "voice": 6}


def validate(path: Path) -> tuple[list[dict], list[str]]:
    cases, errors, seen = [], [], set()
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        label = f"line {line_number}"
        try:
            case = json.loads(line)
            if not isinstance(case, dict):
                raise ValueError("case must be an object")
            if case.get("schema_version") != 1:
                raise ValueError("unsupported schema version")
            case_id = case.get("id")
            if not isinstance(case_id, str) or not case_id or case_id in seen:
                raise ValueError("missing or duplicate ID")
            seen.add(case_id)
            if case.get("group") not in EXPECTED:
                raise ValueError("unknown group")
            if not isinstance(case.get("user_text"), str) or not case["user_text"].strip():
                raise ValueError("missing user text")
            if not isinstance(case.get("initial_state"), dict):
                raise ValueError("missing initial state")
            for field in ("context", "expected_observations", "forbidden_outcomes", "human_review"):
                values = case.get(field)
                if not isinstance(values, list) or (field != "context" and not values):
                    raise ValueError(f"invalid {field}")
                if any(not isinstance(value, str) or not value.strip() for value in values):
                    raise ValueError(f"invalid text in {field}")
            clock = case["clock"]
            date.fromisoformat(clock["local_date"])
            ZoneInfo(clock["timezone"])
            if not isinstance(case.get("requires_audio"), bool):
                raise ValueError("requires_audio must be boolean")
            # Seed definitions cannot double as claims of successful execution.
            if case.get("execution_status") != "not_run":
                raise ValueError("execution results belong in separate run records")
            if "audio_fixture" not in case:
                raise ValueError("audio_fixture must explicitly identify missing evidence")
            fixture = case["audio_fixture"]
            if fixture is not None:
                if not isinstance(fixture, str) or not fixture:
                    raise ValueError("invalid audio fixture")
                if not (path.parent / fixture).is_file():
                    raise ValueError("audio fixture does not exist")
            cases.append(case)
        except (ValueError, KeyError, TypeError) as exc:
            errors.append(f"{label}: {exc}")
    counts = Counter(case["group"] for case in cases)
    if dict(counts) != EXPECTED:
        errors.append(f"coverage mismatch: expected {EXPECTED}, received {dict(counts)}")
    return cases, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT)
    args = parser.parse_args()
    try:
        cases, errors = validate(args.path)
    except (OSError, UnicodeError) as exc:
        print(f"Cannot read seed cases: {exc}")
        return 1
    if errors:
        print("\n".join(errors))
        return 1
    missing = sum(case["requires_audio"] and case["audio_fixture"] is None for case in cases)
    print(f"Seed data valid: {len(cases)} scenarios; {missing} require audio not yet supplied.")
    print("Product/model/browser/audio evaluations: NOT RUN. This is data validation only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
