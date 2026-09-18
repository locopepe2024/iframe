import asyncio
import io
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, UploadFile

from src.apps.comic_gen.extraction_jobs import ExtractionJobs
from src.apps.identity import UserContext


def wait_done(store, owner, job):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        current = store.get(owner, "series-import", job["id"])
        if current["status"] != "running":
            return current
        time.sleep(0.01)
    raise AssertionError("import preview did not finish")


def upload(text: str) -> UploadFile:
    return UploadFile(filename="script.md", file=io.BytesIO(text.encode("utf-8")))


def test_import_preview_is_durable_deduplicated_and_owner_scoped(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    calls = Mock(return_value=[{
        "episode_number": 1,
        "title": "Episode 1",
        "summary": "Summary",
        "start_marker": "start",
        "end_marker": "end",
    }])
    pipeline = SimpleNamespace(
        script_processor=SimpleNamespace(
            llm=SimpleNamespace(provider="openai", _get_default_model=lambda: "test")
        ),
        import_file_and_split=calls,
        _import_cache={},
    )
    owner = UserContext("user", "owner", "", "")
    other = UserContext("other", "other", "", "")
    text = "# Script\n" + ("Scene content.\n" * 2500)

    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "jobs.db", executor=executor)
        monkeypatch.setattr(api, "pipeline", pipeline)
        monkeypatch.setattr(api, "extraction_jobs", jobs)
        monkeypatch.setattr(api, "get_user_data_dir", lambda: str(tmp_path / "iframe"))

        first = asyncio.run(api.import_file_preview(upload(text), 3, owner))
        done = wait_done(jobs, "owner", first)
        repeated = asyncio.run(api.import_file_preview(upload(text), 3, owner))

        assert repeated["id"] == first["id"]
        assert calls.call_count == 1
        assert done["result"]["text_length"] == len(text)
        import_id = done["result"]["import_id"]
        assert api._load_import_text("owner", import_id) == text
        assert api._load_import_text("other", import_id) is None
        with pytest.raises(HTTPException) as denied:
            api.import_file_preview_status(first["id"], other)
        assert denied.value.status_code == 404
        jobs.forget_result("owner", "series-import", "import_id", import_id)
        with pytest.raises(HTTPException):
            jobs.get("owner", "series-import", first["id"])


def test_confirm_uses_persistent_import_text_and_deletes_only_after_success(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    owner = UserContext("user", "owner", "", "")
    create = Mock(return_value={"series": {"id": "series"}, "episodes": [{"id": "episode"}]})
    pipeline = SimpleNamespace(create_series_from_import=create, _import_cache={})
    jobs = Mock()
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "extraction_jobs", jobs)
    monkeypatch.setattr(api, "get_user_data_dir", lambda: str(tmp_path / "iframe"))
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    import_id = "a" * 32
    api._store_import_text("owner", import_id, "full script")
    request = api.ConfirmImportRequest(
        title="Series", import_id=import_id,
        episodes=[{"episode_number": 1, "title": "Episode"}],
    )

    result = asyncio.run(api.import_file_confirm(request, owner))

    assert result["series"]["id"] == "series"
    assert create.call_args.args[1] == "full script"
    assert api._load_import_text("owner", import_id) is None
    jobs.forget_result.assert_called_once_with(
        "owner", "series-import", "import_id", import_id
    )
