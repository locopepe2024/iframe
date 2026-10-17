"""Source-backed, owner-scoped statements derived from Agent chat."""

import json
import logging
import re
import time
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

DEFAULT_CATEGORIES = {
    "health": {"display_name": "健康", "sensitivity": "high", "auto_capture": True, "auto_recall": True},
    "family": {"display_name": "家庭", "sensitivity": "high", "auto_capture": True, "auto_recall": True},
    "relationship": {"display_name": "关系", "sensitivity": "high", "auto_capture": True, "auto_recall": True},
    "emotion": {"display_name": "情绪", "sensitivity": "high", "auto_capture": True, "auto_recall": True},
    "life_event": {"display_name": "生活事件", "sensitivity": "normal", "auto_capture": True, "auto_recall": True},
    "profile": {"display_name": "身份", "sensitivity": "normal", "auto_capture": True, "auto_recall": True},
    "preference": {"display_name": "偏好", "sensitivity": "normal", "auto_capture": True, "auto_recall": True},
}
CATEGORIES = set(DEFAULT_CATEGORIES)
PRECISIONS = {"exact", "day", "month", "year", "imprecise", "unknown"}


class FactExtractionRequest(BaseModel):
    source_session_id: str = Field(min_length=1, max_length=200)
    source_message_id: str = Field(min_length=1, max_length=100)


class FactCorrectionRequest(FactExtractionRequest):
    source_quote: str = Field(min_length=1, max_length=300)
    relation: str = Field(pattern="^(correction|retraction)$")
    value: str = Field(default="", max_length=300)


class FactTimelineQuery(BaseModel):
    view: str = Field(pattern="^(current|recent|history)$")
    category: str | None = None
    subject: str | None = Field(default=None, max_length=300)
    predicate: str | None = Field(default=None, max_length=300)
    since: float | None = None
    until: float | None = None
    limit: int = Field(default=50, ge=1, le=100)


class FactCategoryPatch(BaseModel):
    auto_capture_enabled: bool | None = None
    auto_recall_enabled: bool | None = None


def migrate(db):
    db.execute("""CREATE TABLE IF NOT EXISTS agent_fact_categories (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, sensitivity TEXT NOT NULL,
        default_auto_capture INTEGER NOT NULL, default_auto_recall INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS agent_fact_category_settings (
        owner TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES agent_fact_categories(id),
        auto_capture_enabled INTEGER, auto_recall_enabled INTEGER,
        PRIMARY KEY(owner, category_id)
    )""")
    for category, config in DEFAULT_CATEGORIES.items():
        db.execute("""INSERT OR IGNORE INTO agent_fact_categories
            (id,display_name,sensitivity,default_auto_capture,default_auto_recall)
            VALUES (?,?,?,?,?)""", (category, config["display_name"], config["sensitivity"],
                                    config["auto_capture"], config["auto_recall"]))
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


def categories(db, owner):
    rows = db.execute("""SELECT c.*, s.auto_capture_enabled, s.auto_recall_enabled
        FROM agent_fact_categories c LEFT JOIN agent_fact_category_settings s
        ON s.category_id=c.id AND s.owner=? WHERE c.status='active' ORDER BY c.id""", (owner,)).fetchall()
    return [dict(row) | {
        "auto_capture_enabled": bool(row["auto_capture_enabled"] if row["auto_capture_enabled"] is not None else row["default_auto_capture"]),
        "auto_recall_enabled": bool(row["auto_recall_enabled"] if row["auto_recall_enabled"] is not None else row["default_auto_recall"]),
    } for row in rows]


def category_enabled(db, owner, category, field="auto_capture_enabled"):
    row = next((item for item in categories(db, owner) if item["id"] == category), None)
    return bool(row and row[field])


def patch_category(db, owner, category, body):
    if category not in DEFAULT_CATEGORIES:
        raise HTTPException(404, "事实类别不存在")
    if body.auto_capture_enabled is None and body.auto_recall_enabled is None:
        raise HTTPException(422, "至少需要设置一个类别开关")
    db.execute("""INSERT INTO agent_fact_category_settings(owner,category_id,auto_capture_enabled,auto_recall_enabled)
        VALUES (?,?,?,?) ON CONFLICT(owner,category_id) DO UPDATE SET
        auto_capture_enabled=COALESCE(excluded.auto_capture_enabled, agent_fact_category_settings.auto_capture_enabled),
        auto_recall_enabled=COALESCE(excluded.auto_recall_enabled, agent_fact_category_settings.auto_recall_enabled)""",
        (owner, category, body.auto_capture_enabled, body.auto_recall_enabled))
    return next(item for item in categories(db, owner) if item["id"] == category)


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
    if precision == "exact" and (not (valid_from or valid_to) or
                                 any(value not in quote for value in (valid_from, valid_to) if value)):
        return None
    if valid_from and valid_to and valid_from > valid_to:
        return None
    return (quote, category, *(v.strip() for v in values), time_text.strip(),
            valid_from, valid_to, precision)


def extract_saved_message(ctx, sid, mid, model):
    from . import agent_api

    with agent_api.database() as db:
        message = _source(db, ctx.owner_profile_id, sid, mid)
        enabled_categories = [item["id"] for item in categories(db, ctx.owner_profile_id)
                              if item["auto_capture_enabled"]]
    if not enabled_categories:
        return []
    content = message.get("content", "")
    if not content.strip() or len(content) > 12000:
        return []
    prompt = ("只从用户原文提取用户明确陈述的个人事实或状态变化。不要提取提问、假设、引用他人、"
              "助手结论、诊断或推断。健康、家庭、关系、情绪和生活事件可提取。"
              "返回 JSON 数组，最多 8 项；没有则返回 []。每项字段：source_quote（原文连续子串）、"
              "category（" + "/".join(enabled_categories) + "）、"
              "subject、predicate、value、time_text、time_precision（exact/day/month/year/imprecise/unknown）、"
              "valid_from、valid_to。仅当 source_quote 中逐字出现 YYYY-MM-DD 日期时，"
              "才可使用 exact 和相应日期边界；"
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
            if not category_enabled(db, ctx.owner_profile_id, category):
                continue
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


def query_timeline(db, owner, query: FactTimelineQuery, now=None):
    """Return reported events, never an independently verified current state."""
    if query.category and query.category not in CATEGORIES:
        raise HTTPException(422, "事实类别无效")
    now = time.time() if now is None else now
    since = query.since
    if query.view == "recent" and since is None:
        since = now - 30 * 86400
    until = min(query.until, now) if query.until is not None else now
    if since is not None and since > until:
        raise HTTPException(422, "时间范围无效")
    conditions = ["owner=?", "recorded_at<=?"]
    params = [owner, until]
    for column, value in (("recorded_at>=?", since), ("category=?", query.category),
                          ("subject=?", query.subject), ("predicate=?", query.predicate)):
        if value is not None:
            conditions.append(column)
            params.append(value)
    rows = db.execute("SELECT * FROM agent_fact_events WHERE " + " AND ".join(conditions) +
                      " ORDER BY recorded_at DESC, created_at DESC, id DESC", params)
    events = []
    seen = set()
    amendments = {}
    source_cache = {}
    for row in rows:
        sid = row["source_session_id"]
        if sid not in source_cache:
            session_row = db.execute("SELECT payload FROM sessions WHERE owner=? AND id=?", (owner, sid)).fetchone()
            messages = {}
            if session_row:
                for message in json.loads(session_row["payload"]).get("messages", []):
                    if message.get("role") == "user":
                        messages.setdefault(message.get("id"), message.get("content", ""))
            source_cache[sid] = messages
        content = source_cache[sid].get(row["source_message_id"])
        if not isinstance(content, str) or row["source_quote"] not in content:
            continue
        event = dict(row)
        if query.view == "current":
            if event["relation"] in ("correction", "retraction"):
                amendments.setdefault(event["target_event_id"], event)
                continue
            key = (event["category"], event["subject"], event["predicate"])
            if key in seen:
                continue
            seen.add(key)
            amendment = amendments.get(event["id"])
            if amendment and amendment["relation"] == "retraction":
                continue
            if amendment:
                event = amendment
        events.append(event)
        if len(events) == query.limit:
            break
    return {
        "view": query.view,
        "time_basis": "recorded_at",
        "since": since,
        "until": until,
        "interpretation": "latest_user_report" if query.view == "current" else "reported_events",
        "events": events,
    }


_RECALL_STOP_TERMS = {"我的", "我是", "我在", "我们", "最近", "现在", "情况", "什么",
                      "如何", "怎么", "是否", "已经", "之前", "以前", "可以", "知道"}


def _recall_terms(value):
    terms = set()
    for segment in re.findall(r"[\u3400-\u9fff]+", value.lower()):
        terms.update(segment[index:index + 2] for index in range(len(segment) - 1))
    terms.update(word for word in re.findall(r"[a-z0-9]+", value.lower()) if len(word) >= 4)
    return terms - _RECALL_STOP_TERMS


def recall_for_chat(db, owner, current_session_id, question, limit=5):
    """Select relevant earlier user reports; no match is safer than broad recall."""
    terms = _recall_terms(question[:500])
    if not terms:
        return []
    enabled = {item["id"] for item in categories(db, owner) if item["auto_recall_enabled"]}
    if not enabled:
        return []
    events = query_timeline(db, owner, FactTimelineQuery(view="current", limit=100))["events"]
    ranked = []
    for event in events:
        if event["category"] not in enabled or event["source_session_id"] == current_session_id:
            continue
        key_overlap = terms & _recall_terms(event["predicate"] + " " + event["value"])
        quote_overlap = terms & _recall_terms(event["source_quote"])
        score = 2 * len(key_overlap) + len(quote_overlap)
        if score:
            ranked.append((score, event))
    ranked.sort(key=lambda pair: (-pair[0], -pair[1]["recorded_at"], pair[1]["id"]))
    return [{key: event[key] for key in ("id", "category", "subject", "predicate", "value",
                                        "source_quote", "source_session_id", "source_message_id",
                                        "time_text", "time_precision", "relation")}
            | {"recorded_at_utc": datetime.fromtimestamp(event["recorded_at"], timezone.utc).isoformat()}
            for _, event in ranked[:limit]]


def correct_event(db, owner, event_id, body):
    old = db.execute("SELECT * FROM agent_fact_events WHERE id=? AND owner=?", (event_id, owner)).fetchone()
    if not old:
        raise HTTPException(404, "事实事件不存在")
    message = _source(db, owner, body.source_session_id, body.source_message_id, body.source_quote)
    if message["created_at"] < old["recorded_at"]:
        raise HTTPException(422, "纠错来源不能早于原陈述")
    if body.relation == "correction" and (not body.value.strip() or body.value not in body.source_quote):
        raise HTTPException(422, "纠错值必须来自用户原文")
    if body.relation == "retraction" and body.value:
        raise HTTPException(422, "撤回不能提交替代值")
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
