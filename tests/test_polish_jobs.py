"""Slow prompt polish remains available after the submit connection closes."""
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.apps.comic_gen.extraction_jobs import ExtractionJobs
from src.apps.identity import UserContext


def test_polish_job_is_durable_owner_scoped_and_preserves_model_error(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    user = UserContext("user", "owner", "", "")
    other = UserContext("other", "other", "", "")
    script = SimpleNamespace(frames=[SimpleNamespace(id="shot")])
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(
        get_script=lambda script_id, owner: script if script_id == "project" and owner == "owner" else None,
    ))

    def failed_polish(request):
        raise HTTPException(502, {"reason": "json_parse_error", "message_zh": "返回格式错误", "message_en": "Invalid format"})

    monkeypatch.setattr(api, "polish_video_prompt", failed_polish)
    monkeypatch.setattr(api, "_require_video_polish_review", lambda *_args: {"system": "", "user": "test"})
    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "jobs.sqlite3", executor=executor)
        monkeypatch.setattr(api, "extraction_jobs", jobs)
        started = api.start_video_polish_job("project", api.PolishVideoPromptRequest(
            script_id="project", frame_id="shot", draft_prompt="test",
        ), user)
        deadline = time.monotonic() + 3
        while True:
            current = api.get_polish_job("project", started["id"], user)
            if current["status"] == "completed":
                break
            assert time.monotonic() < deadline
            time.sleep(.01)
        assert current["result"]["detail"]["reason"] == "json_parse_error"
        with pytest.raises(HTTPException) as denied:
            api.get_polish_job("project", started["id"], other)
        assert denied.value.status_code == 404


def test_polish_job_rejects_mismatched_project(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    user = UserContext("user", "owner", "", "")
    with pytest.raises(HTTPException) as rejected:
        api.start_video_polish_job("project", api.PolishVideoPromptRequest(
            script_id="another", draft_prompt="test",
        ), user)
    assert rejected.value.status_code == 422


def test_r2v_polish_job_returns_bilingual_result(tmp_path, monkeypatch):
    from src.apps.comic_gen import api

    user = UserContext("user", "owner", "", "")
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(
        get_script=lambda script_id, owner: SimpleNamespace(frames=[]),
    ))
    monkeypatch.setattr(api, "polish_r2v_prompt", lambda request: {
        "prompt_cn": "中文镜头", "prompt_en": "English shot",
    })
    monkeypatch.setattr(api, "_require_video_polish_review", lambda *_args: {"system": "", "user": "test"})
    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / "jobs.sqlite3", executor=executor)
        monkeypatch.setattr(api, "extraction_jobs", jobs)
        started = api.start_r2v_polish_job("project", api.PolishR2VPromptRequest(
            script_id="project", draft_prompt="test", slots=[],
        ), user)
        deadline = time.monotonic() + 3
        while True:
            current = api.get_polish_job("project", started["id"], user)
            if current["status"] == "completed":
                break
            assert time.monotonic() < deadline
            time.sleep(.01)
        assert current["result"] == {"prompt_cn": "中文镜头", "prompt_en": "English shot"}
