import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { ActorPathControlPointState, ActorPathEasing, CameraPathApplyMode, CameraPathPresetId } from "../types";
import { CAMERA_PATH_PRESETS } from "./camera-path-presets";

function PathNumberField({ label, value, disabled = false, minimum = -30, maximum = 30, step = 0.05, onCommit }: { label: string; value: number; disabled?: boolean; minimum?: number; maximum?: number; step?: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(value));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { setDraft(String(value)); event.currentTarget.blur(); }
  };
  return <input aria-label={label} type="number" min={minimum} max={maximum} step={step} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown}/>;
}

function VectorRow({ point, field, label, disabled, onCommit }: { point: ActorPathControlPointState; field: "positionM" | "handleInM" | "handleOutM"; label: string; disabled: boolean; onCommit: (axis: number, value: number) => void }) {
  return <fieldset className="path-vector-row" disabled={disabled}><legend>{label}</legend>{(["X", "Y", "Z"] as const).map((axisLabel, axis) => <label key={axisLabel}><span>{axisLabel}</span><PathNumberField label={`${point.controlPointId} ${label} ${axisLabel}`} value={point[field][axis]} disabled={disabled} onCommit={(value) => onCommit(axis, value)}/></label>)}</fieldset>;
}

export function CameraPathPresetPanel() {
  const camera = useWorkbenchStore((state) => state.cameras[state.selectedCameraId]);
  const path = useWorkbenchStore((state) => state.cameraPaths[`path-${state.selectedCameraId}-motion`]);
  const selectedControlPointId = useWorkbenchStore((state) => state.selectedCameraPathControlPointId);
  const applyPreset = useWorkbenchStore((state) => state.applyCameraPathPreset);
  const selectControlPoint = useWorkbenchStore((state) => state.selectCameraPathControlPoint);
  const setPathDuration = useWorkbenchStore((state) => state.setCameraPathDuration);
  const setPathEasing = useWorkbenchStore((state) => state.setCameraPathEasing);
  const setVector = useWorkbenchStore((state) => state.setCameraPathControlPointVector);
  const appendPoint = useWorkbenchStore((state) => state.appendCameraPathControlPoint);
  const removePoint = useWorkbenchStore((state) => state.removeCameraPathControlPoint);
  const reversePath = useWorkbenchStore((state) => state.reverseCameraPath);
  const [presetId, setPresetId] = useState<CameraPathPresetId>("push_in");
  const [mode, setMode] = useState<CameraPathApplyMode>("replace");
  const [duration, setDuration] = useState("4");
  const [easing, setEasing] = useState<ActorPathEasing>("ease_in_out");
  const preset = CAMERA_PATH_PRESETS.find((item) => item.presetId === presetId)!;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    applyPreset(camera.cameraId, presetId, mode, Number(duration), easing);
  };
  const points = path ? [...path.controlPoints].sort((left, right) => left.order - right.order) : [];
  const selectedPoint = points.find((point) => point.controlPointId === selectedControlPointId) ?? points[0];
  const disabled = camera.locked || Boolean(path?.locked);
  return <section className="camera-path-panel" aria-labelledby="camera-path-title">
    <div className="dialogue-heading"><div><p className="kicker">Camera motion paths</p><h3 id="camera-path-title">相机运动路径</h3></div><span className="revision-badge">{path ? `rev ${path.revision}` : "未创建"}</span></div>
    <p>预设生成真实 cubic Bezier 路径。创建后可数值编辑或在舞台直接拖动点位和两个手柄；所有修改继续归属当前机位。</p>
    <form className="camera-path-form" onSubmit={submit}>
      <label><span>运镜预设</span><select value={presetId} disabled={disabled} onChange={(event) => setPresetId(event.target.value as CameraPathPresetId)}>{CAMERA_PATH_PRESETS.map((item) => <option key={item.presetId} value={item.presetId}>{item.label}</option>)}</select></label>
      <label><span>应用方式</span><select value={mode} disabled={disabled} onChange={(event) => setMode(event.target.value as CameraPathApplyMode)}><option value="replace">替换当前路径</option><option value="append">追加后续路径段</option></select></label>
      <label><span>本段时长</span><span className="number-input"><input type="number" min="0.1" max="600" step="0.1" value={duration} disabled={disabled} onChange={(event) => setDuration(event.target.value)}/><span>s</span></span></label>
      <label><span>预设缓动</span><select value={easing} disabled={disabled} onChange={(event) => setEasing(event.target.value as ActorPathEasing)}><option value="linear">线性</option><option value="bezier">Bezier</option><option value="ease_in">缓入</option><option value="ease_out">缓出</option><option value="ease_in_out">缓入缓出</option></select></label>
      <small>{preset.description}</small>
      <button type="submit" disabled={disabled}>{mode === "append" && path ? "追加路径段" : "生成并替换路径"}</button>
    </form>
    {path ? <>
      <dl className="environment-summary"><div><dt>机位</dt><dd>{camera.label}</dd></div><div><dt>路径</dt><dd>{path.pathId}</dd></div><div><dt>控制点</dt><dd>{points.length}</dd></div></dl>
      <div className="actor-path-settings">
        <label><span>总时长</span><span className="number-input"><PathNumberField label="相机路径总时长" value={path.durationSeconds} disabled={disabled} minimum={0.1} maximum={3600} step={0.1} onCommit={(value) => setPathDuration(path.pathId, value)}/><span>s</span></span></label>
        <label><span>整条路径缓动</span><select value={path.easing} disabled={disabled} onChange={(event) => setPathEasing(path.pathId, event.target.value as ActorPathEasing)}><option value="linear">线性</option><option value="bezier">Bezier</option><option value="ease_in">缓入</option><option value="ease_out">缓出</option><option value="ease_in_out">缓入缓出</option></select></label>
      </div>
      <ol className="camera-path-segments">{path.presetIds.map((item, index) => <li key={`${item}-${index}`}><span>预设段 {index + 1}</span><strong>{CAMERA_PATH_PRESETS.find((presetItem) => presetItem.presetId === item)?.label ?? item}</strong></li>)}</ol>
      <div className="environment-input-actions"><button type="button" disabled={disabled || points.length >= 128} onClick={() => appendPoint(path.pathId)}>追加控制点</button><button type="button" className="secondary" disabled={disabled} onClick={() => reversePath(path.pathId)}>反向路径</button></div>
      <ol className="actor-path-point-list camera-path-point-list">{points.map((point) => <li key={point.controlPointId} className={selectedPoint?.controlPointId === point.controlPointId ? "active" : ""}><button type="button" onClick={() => selectControlPoint(point.controlPointId)}><strong>点 {point.order + 1}</strong><span>{point.positionM.map((value) => value.toFixed(2)).join(" / ")} m</span></button><button type="button" className="dialogue-remove" disabled={disabled || points.length <= 2} aria-label={`删除相机路径控制点 ${point.order + 1}`} onClick={() => removePoint(path.pathId, point.controlPointId)}>删除</button></li>)}</ol>
      {selectedPoint && <div className="actor-path-point-editor camera-path-point-editor"><strong>编辑点 {selectedPoint.order + 1}</strong><small>{selectedPoint.controlPointId}</small><VectorRow point={selectedPoint} field="positionM" label="点位" disabled={disabled} onCommit={(axis, value) => setVector(path.pathId, selectedPoint.controlPointId, "positionM", axis, value)}/><VectorRow point={selectedPoint} field="handleInM" label="进入手柄" disabled={disabled} onCommit={(axis, value) => setVector(path.pathId, selectedPoint.controlPointId, "handleInM", axis, value)}/><VectorRow point={selectedPoint} field="handleOutM" label="离开手柄" disabled={disabled} onCommit={(axis, value) => setVector(path.pathId, selectedPoint.controlPointId, "handleOutM", axis, value)}/></div>}
      <p className="dialogue-status" role="status" aria-live="polite">{path.pathId} · target {path.targetId} · target-owned · 拖动释放后写入单条 undo · playhead evaluation pending 6.5–6.6</p>
    </> : <p className="dialogue-status" role="status">当前机位尚无运动路径；静态 transform 与构图保持有效。</p>}
  </section>;
}
