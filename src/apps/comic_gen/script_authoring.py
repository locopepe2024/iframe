"""Independent screenplay planning; episode bodies use the existing document editor."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import re
import shutil
from threading import RLock
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException

from .models import ScriptWritingPlanDraft

_LOCK = RLock()
logger = logging.getLogger(__name__)
_EMPTY_DOCUMENT = {"type": "doc", "content": [{"type": "action", "content": []}]}


def document_text(node: dict) -> str:
    if node.get("type") == "text":
        return str(node.get("text") or "")
    separator = "\n" if node.get("type") in {"doc", "section"} else ""
    return separator.join(document_text(child) for child in node.get("content", []))


def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(500, "读取剧本写作资料失败") from exc


def _write(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class ScriptAuthoringStore:
    def __init__(self, owner_directory: Path):
        self.owner_directory = owner_directory

    def directory(self, document_id: str) -> Path:
        try:
            canonical = str(UUID(document_id))
        except (ValueError, AttributeError):
            raise HTTPException(404, "剧本文档不存在")
        directory = self.owner_directory / canonical
        if not directory.is_dir():
            raise HTTPException(404, "剧本文档不存在")
        return directory

    def delete(self, document_id: str) -> dict:
        """Remove a root and its owned episode documents as one library action."""
        with _LOCK:
            root = self.directory(document_id)
            metadata = _read(root / "metadata.json")
            if metadata.get("authoring_parent_id"):
                raise HTTPException(409, "请在剧本库删除所属总纲，不能单独删除分集正文")
            # Scan parent metadata, including empty episodes removed from an old
            # plan. Never trust document IDs supplied by the client or plan file.
            directories = []
            for candidate in self.owner_directory.iterdir():
                if candidate == root or not (candidate / "metadata.json").is_file():
                    continue
                if _read(candidate / "metadata.json").get("authoring_parent_id") == metadata["id"]:
                    directories.append(candidate)
            directories.append(root)
            staging = self.owner_directory / f".deleted-{uuid4().hex}"
            moved = []
            try:
                staging.mkdir()
                for directory in directories:
                    directory.rename(staging / directory.name)
                    moved.append(directory)
            except OSError as exc:
                for directory in reversed(moved):
                    (staging / directory.name).rename(directory)
                if staging.exists():
                    staging.rmdir()
                raise HTTPException(500, "删除剧本失败，请重试") from exc
            # All documents are now inaccessible through the owner UUID API.
            # A cleanup failure must not undo a deletion after a partial purge.
            try:
                shutil.rmtree(staging)
            except OSError:
                logger.warning("Deleted screenplay files await cleanup: %s", staging.name)
            return {"status": "deleted", "id": metadata["id"], "title": metadata["title"]}

    def workspace(self, document_id: str) -> dict:
        directory = self.directory(document_id)
        metadata = _read(directory / "metadata.json")
        root_id = metadata.get("authoring_parent_id") or document_id
        root = self.directory(root_id)
        root_metadata = _read(root / "metadata.json")
        text = document_text(_read(root / "document.json"))
        plan_path = root / "writing-plan.json"
        plan = _read(plan_path) if plan_path.exists() else None
        if plan:
            plan["revision"] = source_hash(plan_path.read_text(encoding="utf-8"))
            for episode in plan["episodes"]:
                body = self.directory(episode["document_id"]) / "document.json"
                episode["word_count"] = len(re.sub(r"\s", "", document_text(_read(body))))
        return {
            "root_document_id": root_id,
            "root_title": root_metadata["title"],
            "selected_episode_number": metadata.get("episode_number"),
            "source_text": text,
            "source_hash": source_hash(text),
            "source_changed": bool(plan and plan["source_hash"] != source_hash(text)),
            "plan": plan,
        }

    def confirm(self, root_id: str, draft: ScriptWritingPlanDraft,
                expected_revision: str | None, expected_source_hash: str) -> dict:
        with _LOCK:
            workspace = self.workspace(root_id)
            if workspace["root_document_id"] != root_id:
                raise HTTPException(422, "请在总纲文档确认分集规划")
            current = workspace["plan"]
            if (current["revision"] if current else None) != expected_revision:
                raise HTTPException(409, "分集规划已更新，请重新加载后保存")
            if workspace["source_hash"] != expected_source_hash:
                raise HTTPException(409, "总纲已修改，请重新解析当前总纲")
            existing = {e["number"]: e for e in current["episodes"]} if current else {}
            # Removing a planned episode must never orphan its written body.
            for number, episode in existing.items():
                if number > len(draft.episodes) and episode["word_count"]:
                    raise HTTPException(409, f"第 {number} 集已有正文，不能从规划中移除")
            created = []
            try:
                episodes = []
                for episode in draft.episodes:
                    document_id = existing.get(episode.number, {}).get("document_id")
                    if not document_id:
                        document_id = str(uuid4())
                        directory = self.owner_directory / document_id
                        directory.mkdir()
                        created.append(directory)
                        _write(directory / "metadata.json", {
                            "id": document_id, "title": episode.title,
                            "authoring_parent_id": root_id, "episode_number": episode.number,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        })
                        _write(directory / "document.json", _EMPTY_DOCUMENT)
                    episodes.append({**episode.model_dump(), "document_id": document_id})
                plan = {**draft.model_dump(exclude={"episodes"}), "episodes": episodes,
                        "source_text": workspace["source_text"], "source_hash": workspace["source_hash"]}
                root = self.directory(root_id)
                plan_path = root / "writing-plan.json"
                if current:
                    history = root / "plan-history"
                    history.mkdir(exist_ok=True)
                    shutil.copy2(plan_path, history / f"{uuid4().hex}.json")
                _write(plan_path, plan)
            except OSError as exc:
                for directory in created:
                    shutil.rmtree(directory)
                raise HTTPException(500, "保存分集规划失败，请重试") from exc
            return self.workspace(root_id)

    def writing_context(self, document_id: str, mode: str) -> dict | None:
        workspace = self.workspace(document_id)
        plan = workspace["plan"]
        selected = workspace["selected_episode_number"]
        if not selected:
            if plan or mode == "expand_outline":
                raise HTTPException(409, "请先解析并确认总纲，选择要写的集数")
            return None  # A standalone, manually written screenplay can continue.
        if not plan:
            raise HTTPException(409, "分集规划不存在，请返回总纲重新确认")
        if workspace["source_changed"]:
            raise HTTPException(409, "总纲已修改，请重新解析并确认分集规划")
        episode = next((e for e in plan["episodes"]
                        if e["number"] == selected and e["document_id"] == document_id), None)
        if not episode:
            raise HTTPException(409, "该集已不在当前分集规划中，请返回目录")
        globals_ = {key: plan[key] for key in ("background", "style", "point_of_view", "characters", "constraints")}
        series_context = json.dumps(globals_, ensure_ascii=False)
        outline = (f"第 {selected} 集《{episode['title']}》\n本集大纲：{episode['outline']}\n"
                   f"开场状态：{episode['opening_state']}\n结尾状态：{episode['ending_state']}\n"
                   f"出场人物：{episode['characters']}")
        body = document_text(_read(self.directory(document_id) / "document.json"))
        previous_context = ""
        if selected > 1:
            previous = plan["episodes"][selected - 2]
            previous_body = document_text(_read(self.directory(previous["document_id"]) / "document.json"))
            previous_context = (f"上一集《{previous['title']}》已保存正文结尾：\n{previous_body[-2400:]}"
                                if previous_body.strip() else
                                f"上一集尚无正文，以下仅为已确认规划的结尾：{previous['ending_state']}")
        return {"title": episode["title"], "source_text": outline if mode == "expand_outline" else body,
                "series_context": series_context + "\n本集已确认规划：\n" + outline,
                "previous_episode_context": previous_context,
                "episode_number": selected, "plan_revision": plan["revision"]}


def analyze_outline(llm: Any, text: str) -> dict:
    schema = ScriptWritingPlanDraft.model_json_schema()
    messages = [
        {"role": "system", "content": (
            "你是剧本写作规划助手。解析用户的全剧总纲，提取已确定的世界观、叙事风格、视角、人物和创作约束，"
            "整理完整分集目录。当前是写作阶段，不做导演分析、分镜、镜头时长或资产生成。"
            "保留原文既定集数、每集标题、关键事件、人物动机和结尾，不把总纲当成第一集正文。"
            "原文有24集就输出全部24集，不能只输出第一集或把两集合为一集。"
            "缺失设定留空并写入missing_information；补充建议仅放suggestions，不混入已确认事实。"
            "target_word_count默认2000，仅在原文明确单集字数时覆盖，不从分钟换算。"
            "只输出符合以下schema的JSON对象，不输出代码围栏：\n" + json.dumps(schema, ensure_ascii=False))},
        {"role": "user", "content": "请解析以下完整总纲：\n<source_outline>\n" + text + "\n</source_outline>"},
    ]
    output = llm.chat(messages=messages, timeout_seconds=900, max_retries=1, stream=True).strip()
    if output.startswith("```"):
        output = output.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        draft = ScriptWritingPlanDraft.model_validate_json(output)
    except ValueError as exc:
        raise RuntimeError("总纲解析结果不完整或分集编号无效，请重新解析") from exc
    declared = re.search(r"(?:共|全剧)\s*(\d+)\s*集", text)
    if declared and len(draft.episodes) != int(declared.group(1)):
        raise RuntimeError(f"总纲约定 {declared.group(1)} 集，解析返回 {len(draft.episodes)} 集，请重新解析")
    return {"draft": draft.model_dump(), "source_hash": source_hash(text)}
