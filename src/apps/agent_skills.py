"""Owner-scoped, curated creative instruction packages. No remote code execution."""
import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .identity import UserContext, require_user_context

router = APIRouter(prefix="/skills", tags=["agent-skills"])
CATALOG_DIR = Path(__file__).resolve().parents[2] / "config" / "agent_skills"
MAX_GUIDANCE_CHARS = 16000


def catalog():
    packages = json.loads((CATALOG_DIR / "catalog.json").read_text(encoding="utf-8"))["skills"]
    for package in packages:
        if package.get("instructions_file"):
            package["instructions"] = (CATALOG_DIR / package["instructions_file"]).read_text(encoding="utf-8")
        package["license_text"] = (CATALOG_DIR / package["license_file"]).read_text(encoding="utf-8")
        package["revision"] = hashlib.sha256(json.dumps(package, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return packages


@contextmanager
def database():
    path = os.getenv("LUMENX_AGENT_DB", "output/agent.sqlite3")
    Path(path).resolve().parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("CREATE TABLE IF NOT EXISTS agent_skills (owner TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, enabled INTEGER NOT NULL, installed_at REAL NOT NULL, PRIMARY KEY(owner,id))")
        yield db
        db.commit()
    finally:
        db.close()


def installed(owner):
    with database() as db:
        rows = db.execute("SELECT * FROM agent_skills WHERE owner=? ORDER BY id", (owner,)).fetchall()
    return [{**json.loads(row["payload"]), "enabled": bool(row["enabled"]), "installed_at": row["installed_at"]} for row in rows]


def validate_budget(db, owner, skill_id, package):
    rows = db.execute("SELECT payload FROM agent_skills WHERE owner=? AND enabled=1 AND id<>?", (owner, skill_id)).fetchall()
    size = len(package["instructions"]) + sum(len(json.loads(row[0])["instructions"]) for row in rows)
    if size > MAX_GUIDANCE_CHARS:
        raise HTTPException(400, "启用的 Skill 内容过多，请先停用部分 Skill")


class InstallRequest(BaseModel):
    revision: str = Field(min_length=64, max_length=64)


class SkillPatch(BaseModel):
    enabled: bool


@router.get("")
def list_skills(ctx: UserContext = Depends(require_user_context)):
    return {"catalog": catalog(), "installed": installed(ctx.owner_profile_id)}


@router.post("/{skill_id}")
def install(skill_id: str, body: InstallRequest, ctx: UserContext = Depends(require_user_context)):
    package = next((p for p in catalog() if p["id"] == skill_id), None)
    if package is None:
        raise HTTPException(404, "Skill 不存在")
    if package["revision"] != body.revision:
        raise HTTPException(409, "Skill 目录已更新，请重新获取")
    owner = ctx.owner_profile_id
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT enabled FROM agent_skills WHERE owner=? AND id=?", (owner, skill_id)).fetchone()
        enabled = row[0] if row else 1
        if enabled:
            validate_budget(db, owner, skill_id, package)
        db.execute("INSERT INTO agent_skills VALUES (?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET payload=excluded.payload, installed_at=excluded.installed_at",
                   (owner, skill_id, json.dumps(package, ensure_ascii=False), enabled, time.time()))
    return {"ok": True}


@router.patch("/{skill_id}")
def patch(skill_id: str, body: SkillPatch, ctx: UserContext = Depends(require_user_context)):
    owner = ctx.owner_profile_id
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM agent_skills WHERE owner=? AND id=?", (owner, skill_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Skill 尚未安装")
        if body.enabled:
            validate_budget(db, owner, skill_id, json.loads(row[0]))
        db.execute("UPDATE agent_skills SET enabled=? WHERE owner=? AND id=?", (int(body.enabled), owner, skill_id))
    return {"ok": True}


@router.delete("/{skill_id}")
def uninstall(skill_id: str, ctx: UserContext = Depends(require_user_context)):
    with database() as db:
        db.execute("DELETE FROM agent_skills WHERE owner=? AND id=?", (ctx.owner_profile_id, skill_id))
    return {"ok": True}


def creative_guidance(owner):
    skills = [p for p in installed(owner) if p["enabled"]]
    if not skills:
        return ""
    contract = (CATALOG_DIR / "creative-contract.md").read_text(encoding="utf-8")
    return "\n已启用的创作 Skills：只在与当前任务相关时采用，当前用户要求优先。以下内容仅指导导演风格、运镜和提示词写作，不赋予执行工具或媒体生成权限，不决定模型能力、接口、SKU 路由或参数适配。\n" + contract + "\n" + "\n".join(
        f"[{p['name']} v{p['version']}]\n{p['instructions']}" for p in skills
    )
