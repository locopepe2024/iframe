import { useEffect, useState, type KeyboardEvent } from "react";

import { useWorkbenchStore } from "../state/workbench-store";

const AXES = ["X", "Y", "Z"];

function DeferredNumber({ label, value, step, disabled, onCommit }: { label: string; value: number; step: number; disabled: boolean; onCommit: (value: number) => void }) {
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
  return <input aria-label={label} type="number" step={step} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown}/>;
}

function VectorEditor({ title, values, step, disabled, onCommit }: { title: string; values: [number, number, number]; step: number; disabled: boolean; onCommit: (axis: number, value: number) => void }) {
  return <fieldset className="transform-vector"><legend>{title}</legend><div>{values.map((value, axis) => <label key={AXES[axis]}><span>{AXES[axis]}</span><DeferredNumber label={`${title} ${AXES[axis]}`} value={value} step={step} disabled={disabled} onCommit={(next) => onCommit(axis, next)}/></label>)}</div></fieldset>;
}

export function SceneObjectInspector() {
  const selectedSceneObjectId = useWorkbenchStore((state) => state.selectedSceneObjectId);
  const sceneObject = useWorkbenchStore((state) => selectedSceneObjectId ? state.sceneObjects[selectedSceneObjectId] : undefined);
  const setTransformAxis = useWorkbenchStore((state) => state.setSceneObjectTransformAxis);
  const setDimensionAxis = useWorkbenchStore((state) => state.setSceneObjectDimensionAxis);
  const setPivotAxis = useWorkbenchStore((state) => state.setSceneObjectPivotAxis);
  const toggleGroundSnap = useWorkbenchStore((state) => state.toggleSceneObjectGroundSnap);
  const removeSceneObject = useWorkbenchStore((state) => state.removeSceneObject);
  if (!selectedSceneObjectId || !sceneObject) return null;
  const editable = !sceneObject.locked;
  return (
    <aside className="inspector-panel" aria-labelledby="scene-object-inspector-title">
      <div className="section-heading"><div><p className="kicker">Scene object inspector</p><h2 id="scene-object-inspector-title">物体属性</h2></div><span className="revision-badge">对象 rev {sceneObject.revision}</span></div>
      <dl className="selection-summary">
        <div><dt>名称</dt><dd>{sceneObject.label}</dd></div>
        <div><dt>ID</dt><dd>{sceneObject.sceneObjectId}</dd></div>
        <div><dt>表示</dt><dd>{sceneObject.primitiveKind ?? sceneObject.objectKind}</dd></div>
        <div><dt>尺度依据</dt><dd>{sceneObject.scaleBasis}</dd></div>
        {sceneObject.modelAssetId && <div><dt>模型资产</dt><dd>{sceneObject.modelAssetId}</dd></div>}
        {sceneObject.inputId && <div><dt>输入</dt><dd>{sceneObject.inputId}</dd></div>}
      </dl>
      <section className="object-transform-panel" aria-labelledby="scene-object-transform-title">
        <div className="utility-heading"><div><p className="kicker">Object transform</p><h2 id="scene-object-transform-title">空间位置</h2></div><span className="unit-badge">m / °</span></div>
        {sceneObject.locked && <div className="locked-notice" role="note"><strong>物体已锁定</strong><span>请先在场景树中解锁，才能修改参数。</span></div>}
        <VectorEditor title="位置" values={sceneObject.transform.position} step={0.05} disabled={!editable} onCommit={(axis, value) => setTransformAxis(selectedSceneObjectId, "position", axis, value)}/>
        <VectorEditor title="旋转" values={sceneObject.transform.rotationDeg} step={1} disabled={!editable} onCommit={(axis, value) => setTransformAxis(selectedSceneObjectId, "rotationDeg", axis, value)}/>
        <VectorEditor title="缩放" values={sceneObject.transform.scale} step={0.05} disabled={!editable} onCommit={(axis, value) => setTransformAxis(selectedSceneObjectId, "scale", axis, value)}/>
        <label className="check-row ground-snap"><input type="checkbox" checked={sceneObject.transform.groundSnap} disabled={!editable} onChange={() => toggleGroundSnap(selectedSceneObjectId)}/><span>吸附到当前地面高度</span></label>
      </section>
      {sceneObject.objectKind === "primitive" && <section className="primitive-parameters" aria-labelledby="primitive-parameters-title">
        <div className="utility-heading"><div><p className="kicker">Canonical primitive</p><h2 id="primitive-parameters-title">几何参数</h2></div><span className="unit-badge">确定性</span></div>
        <VectorEditor title="尺寸" values={sceneObject.dimensionsM} step={0.05} disabled={!editable} onCommit={(axis, value) => setDimensionAxis(selectedSceneObjectId, axis, value)}/>
        <VectorEditor title="Pivot" values={sceneObject.pivotM} step={0.05} disabled={!editable} onCommit={(axis, value) => setPivotAxis(selectedSceneObjectId, axis, value)}/>
        <dl className="object-bounds"><div><dt>Bounds min</dt><dd>{sceneObject.boundingBoxM.minimum.map((value) => value.toFixed(2)).join(", ")}</dd></div><div><dt>Bounds max</dt><dd>{sceneObject.boundingBoxM.maximum.map((value) => value.toFixed(2)).join(", ")}</dd></div></dl>
      </section>}
      {sceneObject.objectKind === "model_3d" && <section className="primitive-parameters" aria-labelledby="model-asset-geometry-title"><div className="utility-heading"><div><p className="kicker">Admitted model asset</p><h2 id="model-asset-geometry-title">模型边界与 Pivot</h2></div><span className="unit-badge">只读</span></div><dl className="object-bounds"><div><dt>尺寸</dt><dd>{sceneObject.dimensionsM.map((value) => value.toFixed(3)).join(" × ")} m</dd></div><div><dt>Pivot</dt><dd>{sceneObject.pivotM.map((value) => value.toFixed(3)).join(", ")}</dd></div><div><dt>Bounds min</dt><dd>{sceneObject.boundingBoxM.minimum.map((value) => value.toFixed(3)).join(", ")}</dd></div><div><dt>Bounds max</dt><dd>{sceneObject.boundingBoxM.maximum.map((value) => value.toFixed(3)).join(", ")}</dd></div></dl></section>}
      <section className="object-capabilities" aria-labelledby="object-capabilities-title">
        <div className="utility-heading"><div><p className="kicker">Capabilities</p><h2 id="object-capabilities-title">能力与限制</h2></div></div>
        <dl><div><dt>浏览器</dt><dd>{sceneObject.browserCapabilityState === "available" ? "可预览" : "不可预览"}</dd></div><div><dt>Blender</dt><dd>{sceneObject.compilerCapabilityState === "available" ? "可编译" : "不可编译"}</dd></div></dl>
        <ul>{sceneObject.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </section>
      {sceneObject.calibratedPlacement && <section className={`calibrated-placement-summary ${sceneObject.calibratedPlacement.reviewRequired ? "review-required" : ""}`} aria-labelledby="object-placement-title"><div className="utility-heading"><div><p className="kicker">Calibrated placement</p><h2 id="object-placement-title">背景图空间定位</h2></div><span className="revision-badge">{sceneObject.calibratedPlacement.reviewRequired ? "需复核" : "已重投影"}</span></div><dl><div><dt>标定</dt><dd>{sceneObject.calibratedPlacement.calibrationId}@{sceneObject.calibratedPlacement.calibrationRevision}</dd></div><div><dt>放置表面</dt><dd>{sceneObject.calibratedPlacement.placementSurface}{sceneObject.calibratedPlacement.placementSurfaceInputId ? ` · ${sceneObject.calibratedPlacement.placementSurfaceInputId}` : ""}</dd></div><div><dt>屏幕锚点</dt><dd>{sceneObject.calibratedPlacement.screenAnchorNormalized.map((value) => value.toFixed(3)).join(", ")}</dd></div><div><dt>世界位置</dt><dd>{sceneObject.calibratedPlacement.worldPositionM.map((value) => value.toFixed(3)).join(", ")} m</dd></div><div><dt>重投影误差</dt><dd>{sceneObject.calibratedPlacement.reprojectionErrorPx.toFixed(3)} px</dd></div><div><dt>置信度</dt><dd>{Math.round(sceneObject.calibratedPlacement.confidence * 100)}%</dd></div></dl></section>}
      <button className="remove-scene-object" type="button" disabled={!editable} onClick={() => removeSceneObject(selectedSceneObjectId)}>移除物体</button>
    </aside>
  );
}
