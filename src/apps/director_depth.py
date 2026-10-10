"""Owner-scoped static scene depth jobs; Blender runtime is explicitly configured."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from .identity import UserContext, require_user_context

router = APIRouter(prefix="/director3d", tags=["director3d"])
_lock = threading.Lock()
_active: set[str] = set()
_render_lock = threading.Lock()
ROOT = Path(__file__).resolve().parents[2]


class Mesh(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    positions: list[tuple[float, float, float]] = Field(min_length=3, max_length=150000)
    triangles: list[tuple[StrictInt, StrictInt, StrictInt]] = Field(min_length=1, max_length=300000)

    @model_validator(mode="after")
    def bounds(self):
        if any(abs(v) > 10000 for point in self.positions for v in point):
            raise ValueError("mesh position outside scene bounds")
        if any(i < 0 or i >= len(self.positions) for triangle in self.triangles for i in triangle):
            raise ValueError("triangle index outside vertex bounds")
        return self


class Camera(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: str = Field(pattern="^(PERSP|ORTHO)$")
    matrixWorld: tuple[tuple[float, float, float, float], tuple[float, float, float, float],
                       tuple[float, float, float, float], tuple[float, float, float, float]]
    near: float = Field(gt=0, le=1000)
    far: float = Field(gt=0, le=10000)
    aspect: float = Field(ge=0.1, le=10)
    verticalFovDeg: float = Field(ge=1, le=175)
    orthoHeight: float = Field(gt=0, le=10000)

    @model_validator(mode="after")
    def bounds(self):
        if self.far <= self.near:
            raise ValueError("camera far must exceed near")
        if any(abs(v) > 10000 for row in self.matrixWorld for v in row):
            raise ValueError("camera matrix outside scene bounds")
        if self.matrixWorld[3] != (0, 0, 0, 1):
            raise ValueError("camera matrix must be affine")
        return self


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    schema_version: str = Field(default="director-scene-depth-snapshot.v1", pattern="^director-scene-depth-snapshot\\.v1$")
    frame: StrictInt = Field(ge=1, le=100000)
    fps: StrictInt = Field(ge=1, le=120)
    cameraLabel: str = Field(min_length=1, max_length=120)
    nearM: float = Field(ge=0, le=10000)
    farM: float = Field(gt=0, le=10000)
    width: StrictInt = Field(ge=64, le=1280)
    height: StrictInt = Field(ge=64, le=1280)
    camera: Camera
    meshes: list[Mesh] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def bounds(self):
        if self.farM <= self.nearM:
            raise ValueError("farM must exceed nearM")
        if abs(self.width / self.height - self.camera.aspect) > 0.02:
            raise ValueError("output aspect must match camera")
        if sum(len(m.positions) for m in self.meshes) > 300000:
            raise ValueError("scene vertex limit exceeded")
        if sum(len(m.triangles) for m in self.meshes) > 600000:
            raise ValueError("scene triangle limit exceeded")
        return self


def runtime():
    binary = os.getenv("DIRECTOR_DEPTH_BLENDER_BIN") or shutil.which("blender")
    if not binary or not Path(binary).is_file():
        raise HTTPException(503, "深度渲染运行时未配置。请配置 DIRECTOR_DEPTH_BLENDER_BIN。")
    return binary


def owner_dir(user):
    key = hashlib.sha256(user.owner_profile_id.encode()).hexdigest()[:24]
    return Path("output") / "users" / key / "director3d" / "depth-tasks"


def write_record(path, record):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(record, ensure_ascii=False))
    temporary.replace(path)


def get_record(user, task_id):
    if not task_id or not all(c in "0123456789abcdef" for c in task_id) or len(task_id) != 32:
        raise HTTPException(404, "Depth task not found")
    path = owner_dir(user) / task_id / "task.json"
    if not path.is_file():
        raise HTTPException(404, "Depth task not found")
    with _lock:
        record = json.loads(path.read_text())
        if record["status"] in {"queued", "running"} and str(path) not in _active:
            record.update(status="failed", error="任务被服务重启中断，请重新提交。")
            write_record(path, record)
    return record


def run_task(path, binary):
    record_path = path / "task.json"
    try:
        with _render_lock:
            with _lock:
                record = json.loads(record_path.read_text())
                record["status"] = "running"
                write_record(record_path, record)
            script = ROOT.parent / "scripts" / "director3d" / "render_scene_depth.py"
            with (path / "render.log").open("w") as log:
                subprocess.run([binary, "--background", "--factory-startup", "--python-exit-code", "1",
                    "--python", str(script), "--", "--snapshot", str((path / "snapshot.json").resolve()),
                    "--output", str((path / "result").resolve())], check=True, timeout=120,
                    stdout=log, stderr=subprocess.STDOUT)
            manifest = json.loads((path / "result" / "depth-reference.v1.json").read_text())
            if manifest.get("status") != "completed" or any(len(manifest["outputs"][kind]) != 1 for kind in ("meters", "preview")):
                raise ValueError("invalid depth result")
            outputs = {"preview": manifest["outputs"]["preview"][0],
                       "meters": manifest["outputs"]["meters"][0], "manifest": "depth-reference.v1.json"}
            if any(Path(name).name != name or not (path / "result" / name).is_file() for name in outputs.values()):
                raise ValueError("missing depth result files")
            record.update(status="completed", outputs=outputs)
    except Exception as exc:
        record = json.loads(record_path.read_text())
        error = "深度渲染超时，请减少场景复杂度。" if isinstance(exc, subprocess.TimeoutExpired) else "深度渲染失败，请检查服务端 Blender 日志后重试。"
        record.update(status="failed", error=error)
    finally:
        with _lock:
            write_record(record_path, record)
            _active.discard(str(record_path))


@router.get("/depth-capability")
def capability(user: UserContext = Depends(require_user_context)):
    try:
        runtime()
        return {"available": True, "message": ""}
    except HTTPException as exc:
        return {"available": False, "message": exc.detail}


@router.post("/depth-tasks", status_code=202)
def submit(snapshot: Snapshot, background: BackgroundTasks, user: UserContext = Depends(require_user_context)):
    binary = runtime()
    root = owner_dir(user)
    with _lock:
        if any(str(p) in _active for p in root.glob("*/task.json")):
            raise HTTPException(409, "已有深度任务正在执行。")
        task_id = uuid.uuid4().hex
        path = root / task_id
        path.mkdir(parents=True)
        payload = snapshot.model_dump_json()
        (path / "snapshot.json").write_text(payload)
        record = {"id": task_id, "status": "queued", "createdAt": time.time(),
                  "frame": snapshot.frame, "cameraLabel": snapshot.cameraLabel,
                  "nearM": snapshot.nearM, "farM": snapshot.farM,
                  "snapshotChecksum": hashlib.sha256(payload.encode()).hexdigest(), "outputs": {}, "error": None}
        write_record(path / "task.json", record)
        _active.add(str(path / "task.json"))
    background.add_task(run_task, path, binary)
    return record


@router.get("/depth-tasks")
def recent(user: UserContext = Depends(require_user_context)):
    paths = sorted(owner_dir(user).glob("*/task.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]
    return [get_record(user, path.parent.name) for path in paths]


@router.get("/depth-tasks/{task_id}")
def status(task_id: str, user: UserContext = Depends(require_user_context)):
    return get_record(user, task_id)


@router.get("/depth-tasks/{task_id}/outputs/{kind}")
def output(task_id: str, kind: str, user: UserContext = Depends(require_user_context)):
    record = get_record(user, task_id)
    if record["status"] != "completed" or kind not in {"preview", "meters", "manifest"}:
        raise HTTPException(404, "Depth output not found")
    name = record["outputs"][kind]
    if Path(name).name != name:
        raise HTTPException(404, "Depth output not found")
    path = owner_dir(user) / task_id / "result" / name
    if not path.is_file():
        raise HTTPException(404, "Depth output not found")
    return FileResponse(path, media_type={"preview": "image/png", "meters": "image/x-exr", "manifest": "application/json"}[kind],
                        headers={"Cache-Control": "private, no-store"})
