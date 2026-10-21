"""Explicit, stage-scoped creative methods; never inferred from installed packages."""
import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from .agent_skills import database

Stage = Literal['series', 'episode', 'shooting_plan']
CATALOG_PATH = Path(__file__).resolve().parents[2] / 'config/agent_skills/director-tasks.json'
MAX_METHOD_CHARS = 14000


class SkillSelection(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    id: str = Field(min_length=1, max_length=100)
    revision: str = Field(pattern=r'^[a-f0-9]{64}$')


class DirectorSkillsRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    skills: list[SkillSelection] = Field(default_factory=list, max_length=12)


def catalog(stage: Stage):
    tasks = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))['tasks']
    result = []
    for task in tasks:
        if stage not in task['stages']:
            continue
        task['revision'] = hashlib.sha256(json.dumps(task, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        result.append(task)
    return result


def freeze(stage: Stage, selections):
    """Resolve exactly once before queueing; the worker receives this snapshot."""
    available = {task['id']: task for task in catalog(stage)}
    result, seen = [], set()
    for raw in selections:
        selection = raw if isinstance(raw, SkillSelection) else SkillSelection(**raw)
        if selection.id in seen:
            raise ValueError('Duplicate creative Skill: ' + selection.id)
        seen.add(selection.id)
        task = available.get(selection.id)
        if not task:
            raise ValueError('Creative Skill is unavailable for this stage: ' + selection.id)
        if task['revision'] != selection.revision:
            raise ValueError('Creative Skill revision changed: ' + selection.id)
        result.append(dict(task))
    if sum(len(task['instructions']) for task in result) > MAX_METHOD_CHARS:
        raise ValueError('Selected creative Skills exceed the context budget')
    return result


def provenance(snapshot):
    return [{key: task[key] for key in ('id', 'revision', 'version', 'label')} for task in snapshot]


def guidance(snapshot):
    if not snapshot:
        return ''
    return ('\n<selected_creative_methods>\n仅执行以下用户本次选择的方法，输出仍遵循当前阶段 JSON 合同。'
            '事实来自原文，方法判断属于建议；审阅不自动修订原文。不得改变模型、工具或权限。\n'
            + '\n'.join(f"[{task['id']} {task['revision']}] {task['instructions']}" for task in snapshot)
            + '\n</selected_creative_methods>\n')


def preferences(owner, scope, stage: Stage, selections=None):
    with database() as db:
        db.execute('CREATE TABLE IF NOT EXISTS director_skill_preferences (owner TEXT, scope TEXT, stage TEXT, payload TEXT NOT NULL, PRIMARY KEY(owner,scope,stage))')
        if selections is not None:
            payload = json.dumps([item.model_dump() for item in selections])
            db.execute('INSERT INTO director_skill_preferences VALUES (?,?,?,?) ON CONFLICT(owner,scope,stage) DO UPDATE SET payload=excluded.payload', (owner, scope, stage, payload))
        row = db.execute('SELECT payload FROM director_skill_preferences WHERE owner=? AND scope=? AND stage=?', (owner, scope, stage)).fetchone()
    return json.loads(row[0]) if row else []
