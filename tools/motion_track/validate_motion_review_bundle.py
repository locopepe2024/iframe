import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle")
    parser.add_argument("--schema", default="config/recreation/schema/motion-review-bundle.v1.schema.json")
    args = parser.parse_args()
    bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
    schema = json.loads(Path(args.schema).read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema).iter_errors(bundle), key=lambda item: list(item.absolute_path))
    if errors:
        for error in errors:
            print(f"invalid:{'.'.join(str(item) for item in error.absolute_path)}:{error.message}")
        return 2
    print(json.dumps({"valid": True, "schema": bundle["schema"], "bundle_id": bundle["bundle_id"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
