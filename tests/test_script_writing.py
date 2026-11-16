from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.apps.comic_gen.script_writing import build_episode_writing_messages, generate_episode_text


def test_expand_and_continue_use_distinct_writing_contracts():
    expand = build_episode_writing_messages(
        mode="expand_outline",
        title="筹码不能流血",
        source_text="纲手挥拳前手指发抖；你露出流血的掌心。",
        target_word_count=2000,
        series_context="第一视角，不出现男主面部。",
        skill_instructions="保留原纲事件、人物动机与结尾。",
    )
    continuation = build_episode_writing_messages(
        mode="continue",
        title="筹码不能流血",
        source_text="纲手摘下项链，第一道查克拉线缠上你的手指。",
        target_word_count=2000,
    )

    assert "扩写成约 2000 字" in expand[1]["content"]
    assert "不出现男主面部" in expand[1]["content"]
    assert "保留原纲事件" in expand[0]["content"]
    assert "只输出新增内容" in continuation[1]["content"]
    assert "不重复已有段落" in continuation[1]["content"]
    assert "本集正文目标字数：约 2000 字" in expand[1]["content"]
    assert "本次新增目标字数：约 2000 字" in continuation[1]["content"]
    assert "目标时长" not in expand[1]["content"]
    assert "分钟" not in continuation[1]["content"]


def test_writing_target_character_count_validation():
    import pytest
    from pydantic import ValidationError
    from src.apps.comic_gen.api import ScriptWritingRequest

    base = {"mode": "expand_outline", "source_text": "女孩出发。"}
    assert ScriptWritingRequest(**base).target_word_count == 2000
    for target in (99, 20001, 1000.5):
        with pytest.raises(ValidationError):
            ScriptWritingRequest(**base, target_word_count=target)


def test_generate_episode_text_uses_shared_llm_and_strips_fences():
    calls = []

    class FakeLLM:
        def chat(self, **kwargs):
            calls.append(kwargs)
            return "```text\nINT. 赌桌 - 夜\n纲手抬起拳头。\n```"

    result = generate_episode_text(
        FakeLLM(), mode="expand_outline", title="筹码不能流血", source_text="她挥拳。",
        target_word_count=2000, skill_instructions="保留人物动机。",
    )

    assert result == {"draft": "INT. 赌桌 - 夜\n纲手抬起拳头。", "mode": "expand_outline", "title": "筹码不能流血"}
    assert calls[0]["timeout_seconds"] == 900
    assert calls[0]["max_retries"] == 1
    assert calls[0]["stream"] is True


@pytest.mark.parametrize("mode", ["expand_outline", "continue"])
def test_script_writing_endpoint_is_owner_scoped_and_returns_preview_draft(monkeypatch, mode):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    owner = UserContext("writer", "writer-profile", "Writer", "")
    monkeypatch.setattr(api.pipeline, "get_script", lambda _id, profile: (
        SimpleNamespace(id="episode-1", title="筹码不能流血", owner_profile_id=profile, series_id=None)
        if profile == owner.owner_profile_id else None
    ))
    calls = []
    monkeypatch.setattr(api.pipeline.script_processor.llm, "chat", lambda **kwargs: (
        calls.append(kwargs) or "正文草稿"
    ))
    monkeypatch.setattr(api.extraction_jobs, "start", lambda _owner, _project, _fingerprint, work, **_kwargs: {
        "id": "job-1", "status": "completed", "result": work(), "error": None,
    })
    api.app.dependency_overrides[api.require_studio_user] = lambda: owner
    try:
        response = TestClient(api.app).post("/script-writing/generate", json={
            "project_id": "episode-1",
            "mode": mode,
            "title": "筹码不能流血",
            "source_text": "纲手摘下项链。",
            "target_word_count": 2000,
        })
    finally:
        api.app.dependency_overrides.pop(api.require_studio_user, None)

    assert response.status_code == 202
    assert response.json()["result"]["draft"] == "正文草稿"
    assert response.json()["result"]["mode"] == mode
    system = calls[0]["messages"][0]["content"]
    for dimension in ("01 场景与情境", "03 天气与身体状态", "04 服装与连续性",
                      "06 动作与空间关系", "07 表情、眼神与情绪变化"):
        assert dimension in system
    assert "只按剧情需要选用" in system
    assert ("单集大纲扩写技能" in system) == (mode == "expand_outline")
    user_prompt = calls[0]["messages"][1]["content"]
    assert "纲手摘下项链。" in user_prompt
    if mode == "continue":
        assert "只输出新增内容，不重复已有段落" in user_prompt


@pytest.mark.parametrize("failure", ["missing", "empty"])
def test_scene_detail_resources_fail_explicitly_before_model_call(tmp_path, monkeypatch, failure):
    from src.apps.comic_gen import script_writing

    for path in script_writing._SCENE_DETAIL_DIR.iterdir():
        (tmp_path / path.name).write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    resource = tmp_path / "06-action.md"
    if failure == "missing":
        resource.unlink()
    else:
        resource.write_text(" \n", encoding="utf-8")
    monkeypatch.setattr(script_writing, "_SCENE_DETAIL_DIR", tmp_path)
    calls = []
    with pytest.raises(RuntimeError, match="06-action.md"):
        generate_episode_text(
            SimpleNamespace(chat=lambda **kw: calls.append(kw)),
            mode="continue", title="返程", source_text="她走到门前。", target_word_count=100,
        )
    assert not calls


def test_scene_detail_loader_does_not_import_unreviewed_neighboring_markdown(tmp_path, monkeypatch):
    from src.apps.comic_gen import script_writing

    for path in script_writing._SCENE_DETAIL_DIR.iterdir():
        (tmp_path / path.name).write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "unreviewed.md").write_text("UNREVIEWED_NEIGHBOR", encoding="utf-8")
    monkeypatch.setattr(script_writing, "_SCENE_DETAIL_DIR", tmp_path)
    messages = build_episode_writing_messages(
        mode="continue", title="返程", source_text="她走到门前。", target_word_count=100,
        instruction="保留结尾，不新增道具。",
    )
    assert "06 动作与空间关系" in messages[0]["content"]
    assert "UNREVIEWED_NEIGHBOR" not in messages[0]["content"]
    assert "保留结尾，不新增道具。" in messages[1]["content"]


def test_script_writing_endpoint_rejects_foreign_project(monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    owner = UserContext("writer", "writer-profile", "Writer", "")
    monkeypatch.setattr(api.pipeline, "get_script", lambda *_args: None)
    api.app.dependency_overrides[api.require_studio_user] = lambda: owner
    try:
        response = TestClient(api.app).post("/script-writing/generate", json={
            "project_id": "foreign-episode",
            "mode": "continue",
            "source_text": "当前正文。",
        })
    finally:
        api.app.dependency_overrides.pop(api.require_studio_user, None)

    assert response.status_code == 404


def test_writing_http_routes_receive_authenticated_owner_context(tmp_path, monkeypatch):
    from pathlib import Path
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    owner = UserContext("writer", "writer-profile", "Writer", "")
    other = UserContext("other", "other-profile", "Other", "")
    monkeypatch.setattr(api, "_TRON_SCRIPT_DOCUMENTS_DIR", Path(tmp_path) / "documents")
    monkeypatch.setattr(api, "_resolve_request_context", lambda auth, *_: (
        other if auth == "Bearer other" else owner, False,
    ))
    seen = []

    def start(profile, resource, _fingerprint, _work, **_kwargs):
        seen.append((profile, resource))
        return {"id": "job-http", "status": "running"}

    monkeypatch.setattr(api.extraction_jobs, "start", start)
    monkeypatch.setattr(api.extraction_jobs, "get", lambda profile, resource, job: {
        "id": job, "status": "completed", "result": {"draft": profile + resource},
    })
    client = TestClient(api.app)
    document = client.post("/script-documents", json={"title": "大纲"}).json()
    ws = client.get(f"/script-documents/{document['id']}/writing-plan").json()
    confirmed = client.put(f"/script-documents/{document['id']}/writing-plan", json={
        "draft": {"episodes": [{"number": 1, "title": "第一集", "outline": "女孩出发。"}]},
        "source_hash": ws["source_hash"],
    }).json()
    child = confirmed["plan"]["episodes"][0]["document_id"]
    payload = {"script_document_id": child, "mode": "expand_outline", "source_text": "女孩出发。"}
    assert client.post("/script-writing/generate", json=payload).status_code == 202
    assert seen == [(owner.owner_profile_id, "script-writing:document:" + child)]
    assert client.post("/script-writing/generate", json=payload, headers={"Authorization": "Bearer other"}).status_code == 404
    job = client.get("/script-writing/jobs/job-http", params={"script_document_id": child})
    assert job.status_code == 200
    assert job.json()["result"]["draft"].startswith(owner.owner_profile_id)
