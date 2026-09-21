import { useEffect, useState, type KeyboardEvent } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { ActorPathControlPointState, ActorPathEasing } from "../types";

function PathNumberField({ label, value, minimum = -30, maximum = 30, step = 0.05, onCommit }: { label: string; value: number; minimum?: number; maximum?: number; step?: number; onCommit: (value: number) => void }) {
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
  return <input aria-label={label} type="number" min={minimum} max={maximum} step={step} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown}/>;
}

function VectorRow({ point, field, label, onCommit }: { point: ActorPathControlPointState; field: "positionM" | "handleInM" | "handleOutM"; label: string; onCommit: (axis: number, value: number) => void }) {
  return <fieldset className="path-vector-row"><legend>{label}</legend>{(["X", "Y", "Z"] as const).map((axisLabel, axis) => <label key={axisLabel}><span>{axisLabel}</span><PathNumberField label={`${point.controlPointId} ${label} ${axisLabel}`} value={point[field][axis]} onCommit={(value) => onCommit(axis, value)}/></label>)}</fieldset>;
}

export function ActorPathPanel() {
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const character = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const path = useWorkbenchStore((state) => state.actorPaths[`path-${state.selectedCharacterId}`]);
  const selectedControlPointId = useWorkbenchStore((state) => state.selectedActorPathControlPointId);
  const selectControlPoint = useWorkbenchStore((state) => state.selectActorPathControlPoint);
  const setDuration = useWorkbenchStore((state) => state.setActorPathDuration);
  const setEasing = useWorkbenchStore((state) => state.setActorPathEasing);
  const setVector = useWorkbenchStore((state) => state.setActorPathControlPointVector);
  const appendPoint = useWorkbenchStore((state) => state.appendActorPathControlPoint);
  const removePoint = useWorkbenchStore((state) => state.removeActorPathControlPoint);
  const reversePath = useWorkbenchStore((state) => state.reverseActorPath);
  if (!path) return null;
  const points = [...path.controlPoints].sort((left, right) => left.order - right.order);
  const selectedPoint = points.find((point) => point.controlPointId === selectedControlPointId) ?? points[0];
  return <section className="actor-path-panel" aria-labelledby="actor-path-title">
    <div className="dialogue-heading"><div><p className="kicker">Actor trajectory</p><h3 id="actor-path-title">人物动作路径</h3></div><span className="revision-badge">rev {path.revision}</span></div>
    <p>路径属于当前人物并以米为单位。可在舞台直接拖动点位和两个手柄；播放头驱动人物移动仍待时间线切片完成。</p>
    <dl className="environment-summary"><div><dt>人物</dt><dd>{character.label}</dd></div><div><dt>路径</dt><dd>{path.pathId}</dd></div><div><dt>控制点</dt><dd>{points.length}</dd></div></dl>
    <div className="actor-path-settings">
      <label><span>时长</span><span className="number-input"><PathNumberField label="人物路径时长" value={path.durationSeconds} minimum={0.1} maximum={3600} step={0.1} onCommit={(value) => setDuration(path.pathId, value)}/><span>s</span></span></label>
      <label><span>缓动</span><select value={path.easing} disabled={character.locked || path.locked} onChange={(event) => setEasing(path.pathId, event.target.value as ActorPathEasing)}><option value="linear">线性</option><option value="bezier">Bezier</option><option value="ease_in">缓入</option><option value="ease_out">缓出</option><option value="ease_in_out">缓入缓出</option></select></label>
    </div>
    <div className="environment-input-actions"><button type="button" disabled={character.locked || path.locked || points.length >= 12} onClick={() => appendPoint(path.pathId)}>追加控制点</button><button type="button" className="secondary" disabled={character.locked || path.locked} onClick={() => reversePath(path.pathId)}>反向路径</button></div>
    <ol className="actor-path-point-list">{points.map((point) => <li key={point.controlPointId} className={selectedPoint.controlPointId === point.controlPointId ? "active" : ""}><button type="button" onClick={() => selectControlPoint(point.controlPointId)}><strong>点 {point.order + 1}</strong><span>{point.positionM.map((value) => value.toFixed(2)).join(" / ")} m</span></button><button type="button" className="dialogue-remove" disabled={points.length <= 2 || character.locked || path.locked} aria-label={`删除路径控制点 ${point.order + 1}`} onClick={() => removePoint(path.pathId, point.controlPointId)}>删除</button></li>)}</ol>
    {selectedPoint && <div className="actor-path-point-editor"><strong>编辑点 {selectedPoint.order + 1}</strong><small>{selectedPoint.controlPointId}</small><VectorRow point={selectedPoint} field="positionM" label="点位" onCommit={(axis, value) => setVector(path.pathId, selectedPoint.controlPointId, "positionM", axis, value)}/><VectorRow point={selectedPoint} field="handleInM" label="进入手柄" onCommit={(axis, value) => setVector(path.pathId, selectedPoint.controlPointId, "handleInM", axis, value)}/><VectorRow point={selectedPoint} field="handleOutM" label="离开手柄" onCommit={(axis, value) => setVector(path.pathId, selectedPoint.controlPointId, "handleOutM", axis, value)}/></div>}
    <p className="dialogue-status" role="status" aria-live="polite">{selectedCharacterId} · target-owned · 拖动释放后写入单条 undo · timeline evaluation pending 6.5–6.6</p>
  </section>;
}
