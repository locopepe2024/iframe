import json

import pytest

from scripts.check_project_store_compatibility import check_store, main
from src.apps.comic_gen.models import Script, Series


def test_release_preflight_checks_every_project_record(tmp_path):
    path = tmp_path / "projects.json"
    valid = {"id": "one", "title": "Episode", "original_text": "Scene", "created_at": 1, "updated_at": 1}
    path.write_text(json.dumps({"one": valid, "two": {**valid, "id": "two", "source_revision": 0}}))

    with pytest.raises(ValueError, match=r"two: [^\n]*\nsource_revision"):
        check_store(path, Script)


def test_release_preflight_reports_both_store_counts(tmp_path, monkeypatch, capsys):
    (tmp_path / "projects.json").write_text(json.dumps({"one": {
        "id": "one", "title": "Episode", "original_text": "Scene", "created_at": 1, "updated_at": 1,
    }}))
    (tmp_path / "series.json").write_text(json.dumps({"series": {
        "id": "series", "title": "Series", "created_at": 1, "updated_at": 1,
    }}))
    monkeypatch.setattr("sys.argv", ["preflight", str(tmp_path)])

    main()

    assert json.loads(capsys.readouterr().out) == {"projects": 1, "series": 1}
    assert check_store(tmp_path / "series.json", Series) == 1
