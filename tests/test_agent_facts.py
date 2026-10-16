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
    listed = agent.facts(ctx=setup)["events"]
    assert {item["id"] for item in listed} == {event["id"], corrected["id"]}
    assert next(item for item in listed if item["id"] == event["id"])["value"] == "正在服药"


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
