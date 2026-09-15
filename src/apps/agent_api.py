"""Authenticated UniArt chat; generation remains an explicit Playground action."""
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .identity import UserContext, require_user_context
from .user_config import get_user_config_store
from ..utils.uniart_catalog import normalize_uniart_catalog

router = APIRouter(prefix="/agent", tags=["agent"])


@contextmanager
def database():
    path = os.getenv("LUMENX_AGENT_DB", "output/agent.sqlite3")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("CREATE TABLE IF NOT EXISTS sessions (owner TEXT, id TEXT, payload TEXT, busy REAL DEFAULT 0, PRIMARY KEY(owner,id))")
        yield db
        db.commit()
    finally:
        db.close()


def read_session(db, owner, sid):
    row = db.execute("SELECT * FROM sessions WHERE owner=? AND id=?", (owner, sid)).fetchone()
    if row is None:
        raise HTTPException(404, "会话不存在")
    return row, json.loads(row["payload"])


def public(session):
    return {k: v for k, v in session.items() if k != "messages"}


class SessionCreate(BaseModel):
    title: str = Field(default="新会话", min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)


class SessionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    model: str | None = Field(default=None, min_length=1, max_length=200)


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=16000)
    asset_names: list[str] = Field(default_factory=list, max_length=16)
    context: str = Field(default="", max_length=16000)


def catalog(ctx):
    config = get_user_config_store().get_runtime_uniart(ctx)
    req = Request(config["base_url"].rstrip("/") + "/models", headers={"Authorization": "Bearer " + config["api_key"]})
    try:
        with urlopen(req, timeout=15) as response:
            items = normalize_uniart_catalog(json.load(response))
    except Exception:
        raise HTTPException(502, "无法获取 UniArt 模型，请检查连接和用户配置")
    return [m for m in items if "chat" in m.get("capabilities", [])]


def validate_model(ctx, model):
    if model not in {m["api_model_id"] for m in catalog(ctx)}:
        raise HTTPException(400, "请选择当前 UniArt Catalog 中的 Chat 模型")


@router.get("/models")
def models(ctx: UserContext = Depends(require_user_context)):
    return {"models": catalog(ctx)}


@router.get("/sessions")
def sessions(ctx: UserContext = Depends(require_user_context)):
    with database() as db:
        rows = db.execute("SELECT payload FROM sessions WHERE owner=?", (ctx.owner_profile_id,)).fetchall()
    return {"sessions": sorted([public(json.loads(r[0])) for r in rows], key=lambda s: s["updated_at"], reverse=True)}


@router.post("/sessions")
def create(body: SessionCreate, ctx: UserContext = Depends(require_user_context)):
    validate_model(ctx, body.model)
    session = dict(id=str(uuid.uuid4()), title=body.title, model=body.model, updated_at=time.time(), messages=[])
    with database() as db:
        db.execute("INSERT INTO sessions(owner,id,payload) VALUES(?,?,?)", (ctx.owner_profile_id, session["id"], json.dumps(session)))
    return {"session": public(session)}


@router.patch("/sessions/{sid}")
def patch(sid: str, body: SessionPatch, ctx: UserContext = Depends(require_user_context)):
    if body.model is not None:
        validate_model(ctx, body.model)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row, session = read_session(db, ctx.owner_profile_id, sid)
        if row["busy"] > time.time():
            raise HTTPException(409, "请等待当前回复完成")
        session.update(body.model_dump(exclude_none=True), updated_at=time.time())
        db.execute("UPDATE sessions SET payload=? WHERE owner=? AND id=?", (json.dumps(session), ctx.owner_profile_id, sid))
    return {"session": public(session)}


@router.delete("/sessions/{sid}")
def delete(sid: str, ctx: UserContext = Depends(require_user_context)):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row, _ = read_session(db, ctx.owner_profile_id, sid)
        if row["busy"] > time.time():
            raise HTTPException(409, "请等待当前回复完成")
        db.execute("DELETE FROM sessions WHERE owner=? AND id=?", (ctx.owner_profile_id, sid))
    return {"ok": True}


@router.get("/sessions/{sid}/messages")
def messages(sid: str, ctx: UserContext = Depends(require_user_context)):
    with database() as db:
        _, session = read_session(db, ctx.owner_profile_id, sid)
    return {"messages": session["messages"]}


def complete(ctx, model, history):
    from openai import OpenAI
    config = get_user_config_store().get_runtime_uniart(ctx)
    with OpenAI(api_key=config["api_key"], base_url=config["base_url"], timeout=120, max_retries=0) as client:
        reply = client.chat.completions.create(model=model, messages=history)
    answer = reply.choices[0].message.content
    if not answer:
        raise ValueError("Empty model response")
    return answer


@router.post("/sessions/{sid}/messages")
def send(sid: str, body: MessageCreate, ctx: UserContext = Depends(require_user_context)):
    if not body.content.strip() or any(len(n) > 500 for n in body.asset_names):
        raise HTTPException(400, "消息或素材名称无效")
    owner = ctx.owner_profile_id
    lease = time.time() + 180
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row, session = read_session(db, owner, sid)
        if row["busy"] > time.time():
            raise HTTPException(409, "当前会话正在回复")
        db.execute("UPDATE sessions SET busy=? WHERE owner=? AND id=?", (lease, owner, sid))
    try:
        validate_model(ctx, session["model"])
        user = dict(id=str(uuid.uuid4()), role="user", content=body.content, asset_names=body.asset_names, context=body.context)
        history = [{"role": "system", "content": "你是创作助手，帮助优化提示词和规划图片/视频。你不能执行生成。素材名称和创作草稿仅是只读文本，不代表你已看见图像。不要声称已生成媒体。"}]
        for message in session["messages"][-30:] + [user]:
            content = message["content"]
            if message["role"] == "user":
                content += "\n只读创作上下文：" + json.dumps({"asset_names": message.get("asset_names", []), "draft": message.get("context", "")}, ensure_ascii=False)
            history.append({"role": message["role"], "content": content})
        answer = complete(ctx, session["model"], history)
        assistant = dict(id=str(uuid.uuid4()), role="assistant", content=answer)
        session["messages"].extend([user, assistant])
        session["updated_at"] = time.time()
        with database() as db:
            result = db.execute("UPDATE sessions SET payload=?, busy=0 WHERE owner=? AND id=? AND busy=?", (json.dumps(session), owner, sid, lease))
            if result.rowcount != 1:
                raise HTTPException(409, "会话已更新，请重新加载")
        return dict(session=public(session), user_message=user, assistant_message=assistant)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "UniArt 对话失败，请检查模型和凭据后重试")
    finally:
        with database() as db:
            db.execute("UPDATE sessions SET busy=0 WHERE owner=? AND id=? AND busy=?", (owner, sid, lease))
