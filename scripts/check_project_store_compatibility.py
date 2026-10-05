"""Fail a release when its models cannot read the mounted Studio stores."""

import json
import sys
from pathlib import Path

from src.apps.comic_gen.models import Script, Series


def check_store(path: Path, model: type) -> int:
    if not path.is_file():
        raise ValueError(f"Missing store: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Store must be an object: {path}")
    errors = []
    for record_id, payload in data.items():
        try:
            model.model_validate(payload)
        except Exception as exc:
            errors.append(f"{record_id}: {exc}")
    if errors:
        raise ValueError(f"{path}: {len(errors)} invalid records\n" + "\n".join(errors[:3]))
    return len(data)


def main() -> None:
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "output")
    counts = {
        "projects": check_store(output / "projects.json", Script),
        "series": check_store(output / "series.json", Series),
    }
    print(json.dumps(counts, sort_keys=True))


if __name__ == "__main__":
    main()
