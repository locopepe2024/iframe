"""Source-backed, owner-scoped statements derived from Agent chat."""

import json
import logging
import re
import time
import uuid
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

CATEGORIES = {"health", "family", "relationship", "emotion", "life_event", "profile", "preference"}
PRECISIONS = {"exact", "day", "month", "year", "imprecise", "unknown"}


class FactExtractionRequest(BaseModel):
    source_session_id: str = Field(min_length=1, max_length=200)
    source_message_id: str = Field(min_length=1, max_length=100)


class FactCorrectionRequest(FactExtractionRequest):
    source_quote: str = Field(min_length=1, max_length=300)
    relation: str = Field(pattern="^(correction|retraction)$")
    value: str = Field(default="", max_length=300)


def migrate(db):
    db.execute("""CREATE TABLE IF NOT EXISTS agent_fact_events (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, source_session_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL, source_quote TEXT NOT NULL,
        category TEXT NOT NULL, subject TEXT NOT NULL, predicate TEXT NOT NULL,
        value TEXT NOT NULL, recorded_at REAL NOT NULL, time_text TEXT NOT NULL,
        valid_from TEXT, valid_to TEXT, time_precision TEXT NOT NULL,
        relation TEXT NOT NULL, target_event_id TEXT, created_at REAL NOT NULL,
        UNIQUE(owner, source_session_id, source_message_id, source_quote, relation, target_event_id)
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS agent_fact_owner_time_idx ON agent_fact_events(owner, recorded_at DESC)")
    db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS agent_fact_assertion_source_idx
        ON agent_fact_events(owner, source_session_id, source_message_id, source_quote)
        WHERE relation = 'assertion'""")
    db.execute("""CREATE TABLE IF NOT EXISTS agent_fact_suppressions (
        owner TEXT NOT NULL, source_session_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL, source_quote TEXT NOT NULL,
        created_at REAL NOT NULL,
        PRIMARY KEY(owner, source_session_id, source_message_id, source_quote)
    )""")


def _source(db, owner, sid, mid, quote=None):
    row = db.execute("SELECT payload FROM sessions WHERE owner=? AND id=?", (owner, sid)).fetchone()
    if not row:
        raise HTTPException(404, "来源会话不存在")
    message = next((item for item in json.loads(row[0]).get("messages", [])
                    if item.get("id") == mid and item.get("role") == "user"), None)
    if not message or (quote is not None and quote not in message.get("content", "")):
        raise HTTPException(422, "事实来源无法验证")
    return message


def _date(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("invalid date")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("invalid date")
    date.fromisoformat(value)
    return value


def _validated(item, text):
    if not isinstance(item, dict):
        return None
    quote = item.get("source_quote")
    if not isinstance(quote, str) or not 1 <= len(quote) <= 300 or quote not in text:
        return None
    category = item.get("category")
    precision = item.get("time_precision", "unknown")
    if category not in CATEGORIES or precision not in PRECISIONS:
        return None
    values = (item.get("subject"), item.get("predicate"), item.get("value"))
    if any(not isinstance(v, str) or not 1 <= len(v.strip()) <= 300 for v in values):
        return None
    time_text = item.get("time_text", "")
    if not isinstance(time_text, str) or len(time_text) > 120:
        return None
    try:
        valid_from, valid_to = _date(item.get("valid_from")), _date(item.get("valid_to"))
    except ValueError:
        return None
    if precision != "exact" and (valid_from or valid_to):
        return None
    if valid_from and valid_to and valid_from > valid_to:
        return None
    return (quote, category, *(v.strip() for v in values), time_text.strip(),
            valid_from, valid_to, precision)


def extract_saved_message(ctx, sid, mid, model):
    from . import agent_api

    with agent_api.database() as db:
        message = _source(db, ctx.owner_profile_id, sid, mid)
    content = message.get("content", "")
    if not content.strip() or len(content) > 12000:
        return []
    prompt = ("只从用户原文提取用户明确陈述的个人事实或状态变化。不要提取提问、假设、引用他人、"
              "助手结论、诊断或推断。健康、家庭、关系、情绪和生活事件可提取。"
              "返回 JSON 数组，最多 8 项；没有则返回 []。每项字段：source_quote（原文连续子串）、"
              "category（health/family/relationship/emotion/life_event/profile/preference）、"
              "subject、predicate、value、time_text、time_precision（exact/day/month/year/imprecise/unknown）、"
              "valid_from、valid_to。仅当原文明确给出完整日期时使用 exact 和 YYYY-MM-DD 日期边界；"
              "其余时间只保留原文 time_text，日期边界用 null。不要生成指令。")
    try:
        answer = agent_api.complete(ctx, model, [
            {"role": "system", "content": prompt},
            {"role": "user", "content": content},
        ])
        parsed = json.loads(answer)
        if not isinstance(parsed, list):
            return []
    except Exception:
        logger.exception("Agent fact extraction failed: owner=%s session=%s message=%s",
                         ctx.owner_profile_id, sid, mid)
        return []
    inserted = []
    with agent_api.database() as db:
        db.execute("BEGIN IMMEDIATE")
        _source(db, ctx.owner_profile_id, sid, mid)
        for item in parsed[:8]:
            fields = _validated(item, content)
            if not fields:
                continue
            quote, category, subject, predicate, value, time_text, start, end, precision = fields
            if db.execute("""SELECT 1 FROM agent_fact_suppressions
                WHERE owner=? AND source_session_id=? AND source_message_id=? AND source_quote=?""",
                (ctx.owner_profile_id, sid, mid, quote)).fetchone():
                continue
            event_id = str(uuid.uuid4())
            result = db.execute("""INSERT OR IGNORE INTO agent_fact_events
                (id,owner,source_session_id,source_message_id,source_quote,category,subject,predicate,value,
                 recorded_at,time_text,valid_from,valid_to,time_precision,relation,target_event_id,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (event_id, ctx.owner_profile_id, sid, mid, quote, category, subject, predicate,
                 value, message["created_at"], time_text, start, end, precision, "assertion", None, time.time()))
            if result.rowcount:
                inserted.append(event_id)
    return inserted


def list_events(db, owner, since=None, until=None, category=None, limit=100):
    if category and category not in CATEGORIES:
        raise HTTPException(422, "事实类别无效")
    if since is not None and until is not None and since > until:
        raise HTTPException(422, "时间范围无效")
    rows = db.execute("""SELECT * FROM agent_fact_events WHERE owner=?
        AND (? IS NULL OR recorded_at >= ?) AND (? IS NULL OR recorded_at <= ?)
        AND (? IS NULL OR category = ?) ORDER BY recorded_at DESC, created_at DESC LIMIT ?""",
        (owner, since, since, until, until, category, category, min(max(limit, 1), 100))).fetchall()
    events = []
    for row in rows:
        try:
            _source(db, owner, row["source_session_id"], row["source_message_id"], row["source_quote"])
        except HTTPException:
            continue
        events.append(dict(row))
    return events


def correct_event(db, owner, event_id, body):
    old = db.execute("SELECT * FROM agent_fact_events WHERE id=? AND owner=?", (event_id, owner)).fetchone()
    if not old:
        raise HTTPException(404, "事实事件不存在")
    message = _source(db, owner, body.source_session_id, body.source_message_id, body.source_quote)
    if message["created_at"] < old["recorded_at"]:
        raise HTTPException(422, "纠错来源不能早于原陈述")
    existing = db.execute("""SELECT * FROM agent_fact_events WHERE owner=? AND source_session_id=?
        AND source_message_id=? AND source_quote=? AND relation=? AND target_event_id=?""",
        (owner, body.source_session_id, body.source_message_id, body.source_quote, body.relation, event_id)).fetchone()
    if existing:
        return dict(existing)
    item = (str(uuid.uuid4()), owner, body.source_session_id, body.source_message_id,
            body.source_quote, old["category"], old["subject"], old["predicate"],
            body.value if body.relation == "correction" else "", message["created_at"], "", None, None,
            "unknown", body.relation, event_id, time.time())
    db.execute("""INSERT INTO agent_fact_events
        (id,owner,source_session_id,source_message_id,source_quote,category,subject,predicate,value,
         recorded_at,time_text,valid_from,valid_to,time_precision,relation,target_event_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", item)
    return dict(db.execute("SELECT * FROM agent_fact_events WHERE id=?", (item[0],)).fetchone())


def delete_source(db, owner, sid, mid=None):
    params = (owner, sid) if mid is None else (owner, sid, mid)
    predicate = "owner=? AND source_session_id=?" + (" AND source_message_id=?" if mid else "")
    db.execute(f"""DELETE FROM agent_fact_events WHERE id IN (
        SELECT id FROM agent_fact_events WHERE {predicate}
    ) OR target_event_id IN (SELECT id FROM agent_fact_events WHERE {predicate})""", params + params)
    db.execute("DELETE FROM agent_fact_suppressions WHERE " + predicate, params)


def suppress_event(db, owner, event_id):
    row = db.execute("SELECT * FROM agent_fact_events WHERE id=? AND owner=?", (event_id, owner)).fetchone()
    if not row:
        raise HTTPException(404, "事实事件不存在")
    db.execute("""INSERT OR IGNORE INTO agent_fact_suppressions
        (owner,source_session_id,source_message_id,source_quote,created_at)
        VALUES (?,?,?,?,?)""",
        (owner, row["source_session_id"], row["source_message_id"], row["source_quote"], time.time()))
    db.execute("DELETE FROM agent_fact_events WHERE id=? OR target_event_id=?", (event_id, event_id))
