from unittest.mock import Mock

import pytest
from fastapi import BackgroundTasks, HTTPException

from src.apps import agent_api as agent
from src.apps import agent_facts
from src.apps.identity import UserContext


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMENX_AGENT_DB", str(tmp_path / "agent.sqlite3"))
    monkeypatch.setattr(agent, "catalog", lambda ctx: [{"api_model_id": "qwen", "capabilities": ["chat"]}])
    return UserContext("user", "profile", "name", "token")


def test_fact_extraction_preserves_imprecise_time_and_is_idempotent(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我最近已经不服药了", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我最近已经不服药了","category":"health","subject":"我","predicate":"服药状态","value":"已不服药","time_text":"最近","time_precision":"imprecise","valid_from":null,"valid_to":null}]'))
    first = agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)
    second = agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)
    assert len(first["events"]) == 1
    assert second["events"] == []
    assert first["events"][0]["time_text"] == "最近"
    assert first["events"][0]["time_precision"] == "imprecise"


def test_fact_correction_keeps_original_event(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    messages = [
        {"id": "m1", "role": "user", "content": "我正在服药", "created_at": 100.0},
        {"id": "m2", "role": "user", "content": "我上次说错了，我没有服药", "created_at": 200.0},
    ]
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 200.0, "messages": messages}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我正在服药","category":"health","subject":"我","predicate":"服药状态","value":"正在服药","time_text":"","time_precision":"unknown","valid_from":null,"valid_to":null}]'))
    event = agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)["events"][0]
    corrected = agent.correct_fact(event["id"], agent_facts.FactCorrectionRequest(
        source_session_id=sid, source_message_id="m2", source_quote="我上次说错了，我没有服药", relation="correction", value="没有服药"), setup)["event"]
    assert corrected["relation"] == "correction"
    assert corrected["target_event_id"] == event["id"]
    current = agent.query_facts(agent_facts.FactTimelineQuery(view="current", category="health"), setup)
    assert [item["id"] for item in current["events"]] == [corrected["id"]]
    listed = agent.facts(ctx=setup)["events"]
    assert {item["id"] for item in listed} == {event["id"], corrected["id"]}
    assert next(item for item in listed if item["id"] == event["id"])["value"] == "正在服药"
    with pytest.raises(HTTPException, match="必须来自用户原文"):
        agent.correct_fact(event["id"], agent_facts.FactCorrectionRequest(
            source_session_id=sid, source_message_id="m2", source_quote="我上次说错了，我没有服药",
            relation="correction", value="患有某种疾病"), setup)


def test_timeline_query_uses_recorded_time_and_does_not_invent_current_state(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    messages = [
        {"id": "m1", "role": "user", "content": "我正在服药", "created_at": 100.0},
        {"id": "m2", "role": "user", "content": "我最近已经不服药了", "created_at": 200.0},
    ]
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 200.0, "messages": messages}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    outputs = [
        '[{"source_quote":"我正在服药","category":"health","subject":"我","predicate":"服药状态","value":"正在服药","time_text":"","time_precision":"unknown"}]',
        '[{"source_quote":"我最近已经不服药了","category":"health","subject":"我","predicate":"服药状态","value":"已不服药","time_text":"最近","time_precision":"imprecise"}]',
    ]
    monkeypatch.setattr(agent, "complete", Mock(side_effect=outputs))
    for mid in ("m1", "m2"):
        agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id=mid), setup)
    current = agent.query_facts(agent_facts.FactTimelineQuery(view="current", category="health"), setup)
    assert len(current["events"]) == 1
    assert current["events"][0]["value"] == "已不服药"
    assert current["events"][0]["time_text"] == "最近"
    assert current["interpretation"] == "latest_user_report"
    history = agent.query_facts(agent_facts.FactTimelineQuery(view="history", category="health"), setup)
    assert [item["value"] for item in history["events"]] == ["已不服药", "正在服药"]
    recent = agent.query_facts(agent_facts.FactTimelineQuery(view="recent", since=150, until=250), setup)
    assert [item["value"] for item in recent["events"]] == ["已不服药"]


def test_exact_date_must_appear_in_source_quote(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我在2026-10-01搬家了", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?",
                   (__import__("json").dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我在2026-10-01搬家了",'
                        '"category":"life_event","subject":"我","predicate":"搬家","value":"搬家",'
                        '"time_precision":"exact","valid_from":"2026-10-02"}]'))
    request = agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1")
    assert agent.extract_facts(request, setup)["events"] == []
    agent.complete.return_value = agent.complete.return_value.replace("2026-10-02", "2026-10-01")
    events = agent.extract_facts(request, setup)["events"]
    assert len(events) == 1
    assert events[0]["valid_from"] == "2026-10-01"


def test_current_query_hides_retracted_report_and_filters_before_limit(setup):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    with agent.database() as db:
        messages = [{"id": f"m{i}", "role": "user", "content": f"陈述{i}", "created_at": float(i)}
                    for i in range(1, 104)]
        messages.append({"id": "retract", "role": "user", "content": "撤回陈述1", "created_at": 104.0})
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 104.0, "messages": messages}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?",
                   (__import__("json").dumps(session), setup.owner_profile_id, sid))
        for i in range(1, 104):
            db.execute("""INSERT INTO agent_fact_events
                (id,owner,source_session_id,source_message_id,source_quote,category,subject,predicate,value,
                 recorded_at,time_text,valid_from,valid_to,time_precision,relation,target_event_id,created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (f"e{i}", setup.owner_profile_id, sid, f"m{i}", f"陈述{i}", "health", "我",
                 "服药状态" if i == 1 else f"其他{i}", f"值{i}", float(i), "", None, None,
                 "unknown", "assertion", None, float(i)))
        db.execute("""INSERT INTO agent_fact_events
            (id,owner,source_session_id,source_message_id,source_quote,category,subject,predicate,value,
             recorded_at,time_text,valid_from,valid_to,time_precision,relation,target_event_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("withdraw", setup.owner_profile_id, sid, "retract", "撤回陈述1", "health", "我",
             "服药状态", "", 104.0, "", None, None, "unknown", "retraction", "e1", 104.0))
    current = agent.query_facts(agent_facts.FactTimelineQuery(
        view="current", predicate="服药状态"), setup)
    assert current["events"] == []
    history = agent.query_facts(agent_facts.FactTimelineQuery(
        view="history", predicate="服药状态"), setup)
    assert [item["id"] for item in history["events"]] == ["withdraw", "e1"]
    with agent.database() as db:
        session["messages"].append({"id": "later", "role": "user", "content": "后来又开始服药", "created_at": 105.0})
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?",
                   (__import__("json").dumps(session), setup.owner_profile_id, sid))
        db.execute("""INSERT INTO agent_fact_events
            (id,owner,source_session_id,source_message_id,source_quote,category,subject,predicate,value,
             recorded_at,time_text,valid_from,valid_to,time_precision,relation,target_event_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("later-report", setup.owner_profile_id, sid, "later", "后来又开始服药", "health", "我",
             "服药状态", "重新服药", 105.0, "", None, None, "unknown", "assertion", None, 105.0))
    current = agent.query_facts(agent_facts.FactTimelineQuery(view="current", predicate="服药状态"), setup)
    assert [item["id"] for item in current["events"]] == ["later-report"]


def test_fact_source_deletion_removes_derived_event(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我喜欢象棋", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我喜欢象棋","category":"preference","subject":"我","predicate":"喜欢","value":"象棋","time_text":"","time_precision":"unknown","valid_from":null,"valid_to":null}]'))
    agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)
    agent.delete_message(sid, "m1", setup)
    assert agent.facts(ctx=setup)["events"] == []


def test_deleted_fact_is_suppressed_on_extraction_retry(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我喜欢象棋", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    response = '[{"source_quote":"我喜欢象棋","category":"preference","subject":"我","predicate":"喜欢","value":"象棋","time_text":"","time_precision":"unknown"}]'
    monkeypatch.setattr(agent, "complete", Mock(return_value=response))
    event = agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)["events"][0]
    agent.delete_fact(event["id"], setup)
    assert agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)["events"] == []


def test_fact_extraction_rejects_fabricated_quote_and_other_owner(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我最近搬家了", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我住在北京","category":"life_event","subject":"我","predicate":"居住地","value":"北京","time_text":"最近","time_precision":"imprecise"}]'))
    assert agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)["events"] == []
    other = UserContext("other", "other-profile", "name", "token")
    with pytest.raises(HTTPException):
        agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), other)


def test_completed_chat_schedules_extraction_of_saved_user_message(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    monkeypatch.setattr(agent, "complete", Mock(return_value="收到"))
    task = Mock()
    monkeypatch.setattr(agent_facts, "extract_saved_message", task)
    background = BackgroundTasks()
    result = agent.send(sid, agent.MessageCreate(content="我最近搬家了"), setup, background)
    assert len(background.tasks) == 1
    assert background.tasks[0].args[1:3] == (sid, result["user_message"]["id"])


def test_fact_category_registry_controls_auto_capture_and_is_owner_scoped(setup, monkeypatch):
    with agent.database() as db:
        initial = agent.fact_categories(setup)["categories"]
    assert {item["id"] for item in initial} == agent_facts.CATEGORIES
    agent.patch_fact_category("health", agent_facts.FactCategoryPatch(auto_capture_enabled=False), setup)
    other = UserContext("other", "other-profile", "name", "token")
    assert next(item for item in agent.fact_categories(setup)["categories"] if item["id"] == "health")["auto_capture_enabled"] is False
    assert next(item for item in agent.fact_categories(other)["categories"] if item["id"] == "health")["auto_capture_enabled"] is True
    sid = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我最近不服药了", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": sid, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (__import__("json").dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我最近不服药了","category":"health","subject":"我","predicate":"服药状态","value":"不服药","time_text":"最近","time_precision":"imprecise"}]'))
    assert agent.extract_facts(agent_facts.FactExtractionRequest(source_session_id=sid, source_message_id="m1"), setup)["events"] == []


def test_chat_recall_requires_owner_setting_relevance_and_category_setting(setup, monkeypatch):
    prior = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    message = {"id": "m1", "role": "user", "content": "我最近已经不服药了", "created_at": 100.0}
    with agent.database() as db:
        session = {"id": prior, "model": "qwen", "title": "x", "updated_at": 100.0, "messages": [message]}
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?",
                   (__import__("json").dumps(session), setup.owner_profile_id, prior))
    monkeypatch.setattr(agent, "complete", Mock(return_value='[{"source_quote":"我最近已经不服药了",'
                        '"category":"health","subject":"我","predicate":"服药状态","value":"已不服药",'
                        '"time_text":"最近","time_precision":"imprecise"}]'))
    original = agent.extract_facts(agent_facts.FactExtractionRequest(
        source_session_id=prior, source_message_id="m1"), setup)["events"][0]
    current = agent.create(agent.SessionCreate(model="qwen"), setup)["session"]["id"]
    completion = Mock(return_value="收到")
    monkeypatch.setattr(agent, "complete", completion)
    assert agent.memory_settings(setup) == {"enabled": False}
    agent.send(current, agent.MessageCreate(content="我的服药情况怎样？", companion_skills=["memory"]), setup)
    assert all("相关过往陈述" not in item["content"] for item in completion.call_args.args[2][1:])
    agent.patch_memory_settings(agent.MemorySettingsPatch(enabled=True), setup)
    agent.send(current, agent.MessageCreate(content="我的服药情况怎样？"), setup)
    history = completion.call_args.args[2]
    assert "不是已核实的当前状态" in history[0]["content"]
    assert any("我最近已经不服药了" in item["content"] for item in history[1:-1])
    assert "1970-01-01T00:01:40+00:00" in history[1]["content"]
    assert '"time_text": "最近"' in history[1]["content"]
    agent.send(current, agent.MessageCreate(content="今天天气怎么样？"), setup)
    assert all("相关过往陈述" not in item["content"] for item in completion.call_args.args[2][1:])
    agent.patch_memory_settings(agent.MemorySettingsPatch(enabled=False), setup)
    agent.send(current, agent.MessageCreate(content="我的服药情况怎样？"), setup)
    assert all("相关过往陈述" not in item["content"] for item in completion.call_args.args[2][1:])
    agent.patch_memory_settings(agent.MemorySettingsPatch(enabled=True), setup)
    agent.patch_fact_category("health", agent_facts.FactCategoryPatch(auto_recall_enabled=False), setup)
    agent.send(current, agent.MessageCreate(content="我的服药情况怎样？"), setup)
    assert all("相关过往陈述" not in item["content"] for item in completion.call_args.args[2][1:])
    agent.patch_fact_category("health", agent_facts.FactCategoryPatch(auto_recall_enabled=True), setup)
    session["messages"].append({"id": "m2", "role": "user", "content": "我上次说错了，撤回服药说法", "created_at": 200.0})
    with agent.database() as db:
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?",
                   (__import__("json").dumps(session), setup.owner_profile_id, prior))
    agent.correct_fact(original["id"], agent_facts.FactCorrectionRequest(
        source_session_id=prior, source_message_id="m2", source_quote="我上次说错了，撤回服药说法",
        relation="retraction"), setup)
    agent.send(current, agent.MessageCreate(content="我的服药情况怎样？"), setup)
    assert all("相关过往陈述" not in item["content"] for item in completion.call_args.args[2][1:])
    agent.delete_message(prior, "m1", setup)
    agent.send(current, agent.MessageCreate(content="我的服药情况怎样？"), setup)
    assert all("相关过往陈述" not in item["content"] for item in completion.call_args.args[2][1:])
