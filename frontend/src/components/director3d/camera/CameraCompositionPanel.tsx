import { useEffect, useMemo, useState } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import type { CameraAspectRatio, CameraCompositionPresetId, CameraTargetState } from "../types";

function targetValue(target: CameraTargetState | null) { return target ? `${target.targetType}:${target.targetId}` : "none:"; }
function parseTarget(value: string): CameraTargetState | null { const [targetType, targetId] = value.split(":"); return ["character", "scene_object", "world_point"].includes(targetType) && targetId ? { targetType: targetType as CameraTargetState["targetType"], targetId } : null; }

export function CameraCompositionPanel() {
  const cameras = useWorkbenchStore((state) => state.cameras);
  const selectedCameraId = useWorkbenchStore((state) => state.selectedCameraId);
  const camera = cameras[selectedCameraId] ?? Object.values(cameras)[0];
  const snapshotRecords = useWorkbenchStore((state) => state.cameraSnapshots);
  const snapshots = useMemo(() => snapshotRecords.filter((snapshot) => snapshot.cameraId === camera.cameraId), [camera.cameraId, snapshotRecords]);
  const characters = useWorkbenchStore((state) => state.characters);
  const sceneObjects = useWorkbenchStore((state) => state.sceneObjects);
  const selectCamera = useWorkbenchStore((state) => state.selectCamera);
  const addCamera = useWorkbenchStore((state) => state.addCameraFromCurrentView);
  const renameCamera = useWorkbenchStore((state) => state.renameCamera);
  const toggleVisible = useWorkbenchStore((state) => state.toggleCameraVisible);
  const toggleLocked = useWorkbenchStore((state) => state.toggleCameraLocked);
  const setTransformAxis = useWorkbenchStore((state) => state.setCameraTransformAxis);
  const setFov = useWorkbenchStore((state) => state.setCameraFov);
  const setZoom = useWorkbenchStore((state) => state.setCameraZoom);
  const setLookAt = useWorkbenchStore((state) => state.setCameraLookAt);
  const setFollow = useWorkbenchStore((state) => state.setCameraFollow);
  const applyPreset = useWorkbenchStore((state) => state.applyCameraCompositionPreset);
  const setAspect = useWorkbenchStore((state) => state.setCameraAspectRatio);
  const toggleGuide = useWorkbenchStore((state) => state.toggleCameraFramingGuide);
  const createSnapshot = useWorkbenchStore((state) => state.createCameraSnapshot);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [cameraLabel, setCameraLabel] = useState(camera.label);
  useEffect(() => setCameraLabel(camera.label), [camera.cameraId, camera.label]);
  const targets = [
    ...Object.values(characters).map((character) => ({ value: `character:${character.characterId}`, label: `人物 · ${character.label}` })),
    ...Object.values(sceneObjects).map((object) => ({ value: `scene_object:${object.sceneObjectId}`, label: `物体 · ${object.label}` })),
  ];
  const preservedTargets = [camera.lookAt, camera.follow].filter((target): target is CameraTargetState => target?.targetType === "world_point").filter((target, index, items) => items.findIndex((item) => item.targetId === target.targetId) === index);
  const toggleSubject = (characterId: string) => { const next = camera.subjectTargetIds.includes(characterId) ? camera.subjectTargetIds.filter((id) => id !== characterId) : [...camera.subjectTargetIds, characterId]; applyPreset(camera.cameraId, camera.compositionPresetId, next); };
  const vectorEditor = (field: "position" | "rotationDeg", label: string, suffix: string) => <fieldset className="camera-vector-fields"><legend>{label}</legend>{(["X", "Y", "Z"] as const).map((axis, index) => <label key={axis}><span>{axis}</span><input type="number" step={field === "position" ? 0.05 : 1} value={camera.transform[field][index]} disabled={camera.locked} onChange={(event) => setTransformAxis(camera.cameraId, field, index, Number(event.target.value))}/><small>{suffix}</small></label>)}</fieldset>;
  return <section className="camera-composition-panel" aria-labelledby="camera-composition-title">
    <div className="dialogue-heading"><div><p className="kicker">Multi-camera authoring</p><h3 id="camera-composition-title">机位、构图与快照</h3></div><span className="revision-badge">{Object.keys(cameras).length} cameras</span></div>
    <p>机位拥有独立变换、镜头参数和目标。相机运动路径仍在 6.3–6.4。</p>
    <div className="camera-list-toolbar"><label><span>当前机位</span><select value={camera.cameraId} onChange={(event) => selectCamera(event.target.value, true)}>{Object.values(cameras).map((item) => <option key={item.cameraId} value={item.cameraId}>{item.label} · {item.cameraId}</option>)}</select></label><button type="button" onClick={() => addCamera()}>从当前视图新建机位</button></div>
    <div className="camera-identity-row"><label><span>机位名称</span><input maxLength={80} value={cameraLabel} disabled={camera.locked} onChange={(event) => setCameraLabel(event.target.value)} onBlur={() => renameCamera(camera.cameraId, cameraLabel)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setCameraLabel(camera.label); event.currentTarget.blur(); } }}/></label><button type="button" className="secondary" onClick={() => selectCamera(camera.cameraId, true)}>切到此机位</button><button type="button" className="secondary" aria-pressed={camera.visible} onClick={() => toggleVisible(camera.cameraId)}>{camera.visible ? "隐藏 Frustum" : "显示 Frustum"}</button><button type="button" className="secondary" aria-pressed={camera.locked} onClick={() => toggleLocked(camera.cameraId)}>{camera.locked ? "解锁" : "锁定"}</button></div>
    {vectorEditor("position", "位置", "m")}{vectorEditor("rotationDeg", "旋转", "°")}
    <div className="camera-composition-form"><label><span>水平 FOV</span><input type="number" min={10} max={140} step={1} value={camera.fovDeg} disabled={camera.locked} onChange={(event) => setFov(camera.cameraId, Number(event.target.value))}/></label><label><span>Zoom</span><input type="number" min={0.1} max={10} step={0.1} value={camera.zoom} disabled={camera.locked} onChange={(event) => setZoom(camera.cameraId, Number(event.target.value))}/></label><label><span>Look-at</span><select value={targetValue(camera.lookAt)} disabled={camera.locked} onChange={(event) => setLookAt(camera.cameraId, parseTarget(event.target.value))}><option value="none:">无 · 使用旋转值</option>{preservedTargets.map((target) => <option key={`look-at-${target.targetId}`} value={targetValue(target)}>保留世界点 · {target.targetId}</option>)}{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label><label><span>Follow</span><select value={targetValue(camera.follow)} disabled={camera.locked} onChange={(event) => setFollow(camera.cameraId, parseTarget(event.target.value))}><option value="none:">无</option>{preservedTargets.map((target) => <option key={`follow-${target.targetId}`} value={targetValue(target)}>保留世界点 · {target.targetId}</option>)}{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label><label><span>静态构图预设</span><select value={camera.compositionPresetId} disabled={camera.locked} onChange={(event) => applyPreset(camera.cameraId, event.target.value as CameraCompositionPresetId, camera.subjectTargetIds)}><option value="close_up">近景</option><option value="medium">中景</option><option value="medium_wide">中宽景</option><option value="wide">广角全景</option><option value="full_body">全身</option><option value="two_shot">双人构图</option></select></label><label><span>画幅比例</span><select value={camera.aspectRatio} disabled={camera.locked} onChange={(event) => setAspect(camera.cameraId, event.target.value as CameraAspectRatio)}><option value="auto">自动</option><option value="21:9">21:9 超宽屏</option><option value="16:9">16:9 横屏</option><option value="4:3">4:3</option><option value="1:1">1:1 方形</option><option value="3:4">3:4 竖幅</option><option value="9:16">9:16 竖屏</option></select></label></div>
    <dl className="environment-summary"><div><dt>焦距提示</dt><dd>{camera.focalLengthMm} mm</dd></div><div><dt>Frustum</dt><dd>{camera.visible ? "舞台可见" : "已隐藏"}</dd></div><div><dt>Follow</dt><dd>{camera.follow?.targetId ?? "未绑定"}</dd></div></dl>
    <fieldset className="camera-subject-targets"><legend>构图主体</legend>{Object.values(characters).map((character) => <label key={character.characterId}><input type="checkbox" checked={camera.subjectTargetIds.includes(character.characterId)} disabled={camera.locked} onChange={() => toggleSubject(character.characterId)}/><span>{character.label}</span></label>)}</fieldset>
    <fieldset className="camera-guide-toggles"><legend>构图辅助线</legend><label><input type="checkbox" checked={camera.framingGuides.ruleOfThirds} disabled={camera.locked} onChange={() => toggleGuide(camera.cameraId, "ruleOfThirds")}/><span>三分法</span></label><label><input type="checkbox" checked={camera.framingGuides.centerCross} disabled={camera.locked} onChange={() => toggleGuide(camera.cameraId, "centerCross")}/><span>中心十字</span></label><label><input type="checkbox" checked={camera.framingGuides.safeArea} disabled={camera.locked} onChange={() => toggleGuide(camera.cameraId, "safeArea")}/><span>安全区</span></label></fieldset>
    <div className="camera-snapshot-create"><label htmlFor="camera-snapshot-label">快照名称</label><div><input id="camera-snapshot-label" maxLength={80} value={snapshotLabel} onChange={(event) => setSnapshotLabel(event.target.value)} placeholder="例如：竖屏近景确认"/><button type="button" onClick={() => { createSnapshot(camera.cameraId, snapshotLabel); setSnapshotLabel(""); }}>创建不可变快照</button></div></div>
    {snapshots.length > 0 && <ol className="camera-snapshot-list">{snapshots.map((snapshot) => <li key={snapshot.snapshotId}><strong>{snapshot.label}</strong><span>{snapshot.aspectRatio} · {snapshot.compositionPresetId} · {snapshot.fovDeg}° × {snapshot.zoom.toFixed(2)} · frame {snapshot.frame} · {snapshot.dimensionsPx.width}×{snapshot.dimensionsPx.height}</span><small>{snapshot.stateChecksum}</small></li>)}</ol>}
  </section>;
}
