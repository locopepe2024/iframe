import { useRef, useState } from "react";

import { useWorkbenchStore } from "../state/workbench-store";
import { selectCharactersRecord } from "../state/workbench-selectors";
import type { DirectorValidationPresetId } from "../types";
import { ObjectAddMenu } from "./ObjectAddMenu";

const VALIDATION_PRESETS: ReadonlyArray<{ id: DirectorValidationPresetId; label: string; description: string }> = [
  { id: "indoor-sofa-wide", label: "室内沙发三人全景", description: "室内宽景、沙发和三名坐姿白模。" },
  { id: "fight-15s", label: "15 秒武打参考", description: "两名白模、15 秒关键帧与接触标记。" },
];

function ValidationSceneMenu() {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const applyPreset = useWorkbenchStore((state) => state.applyValidationScenePreset);
  const load = (presetId: DirectorValidationPresetId) => {
    applyPreset(presetId);
    menuRef.current?.removeAttribute("open");
  };
  return (
    <details className="object-add-menu validation-scene-menu" ref={menuRef}>
      <summary aria-label="加载验证场景"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5"/></svg><span>验证场景</span></summary>
      <div className="object-add-popover">
        <div className="object-add-heading"><strong>浏览器白模验证</strong><small>仅装配本地导演台状态，不上传素材或调用模型。</small></div>
        <div className="validation-scene-actions">
          {VALIDATION_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => load(preset.id)}><span><strong>{preset.label}</strong><small>{preset.description}</small></span><span className="availability available">可用</span></button>)}
        </div>
        <p className="director-boundary-note">真实视频抽帧、姿态求解和 MP4 输出需另行验证。</p>
      </div>
    </details>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M9.9 4.2A10.6 10.6 0 0 1 21 12a11.7 11.7 0 0 1-2.1 3.2"/><path d="M6.6 6.6A11.8 11.8 0 0 0 3 12s3.2 6 9 6a9.8 9.8 0 0 0 3.4-.6"/></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
}

function LockIcon({ locked }: { locked: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{locked ? <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></> : <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/></>}</svg>;
}

export function SceneTree() {
  const charactersRecord = useWorkbenchStore(selectCharactersRecord);
  const characters = Object.values(charactersRecord);
  const selectedCharacterIds = useWorkbenchStore((state) => state.selectedCharacterIds);
  const sceneObjects = useWorkbenchStore((state) => state.sceneObjects);
  const cameras = useWorkbenchStore((state) => state.cameras);
  const selectedCameraId = useWorkbenchStore((state) => state.selectedCameraId);
  const selectedSceneObjectId = useWorkbenchStore((state) => state.selectedSceneObjectId);
  const sceneFilter = useWorkbenchStore((state) => state.sceneFilter);
  const sceneTypeFilter = useWorkbenchStore((state) => state.sceneTypeFilter);
  const ground = useWorkbenchStore((state) => state.renderScene.ground);
  const selectCharacter = useWorkbenchStore((state) => state.selectCharacter);
  const selectSceneObject = useWorkbenchStore((state) => state.selectSceneObject);
  const selectCamera = useWorkbenchStore((state) => state.selectCamera);
  const setSceneFilter = useWorkbenchStore((state) => state.setSceneFilter);
  const setSceneTypeFilter = useWorkbenchStore((state) => state.setSceneTypeFilter);
  const renameCharacter = useWorkbenchStore((state) => state.renameCharacter);
  const toggleCharacterVisible = useWorkbenchStore((state) => state.toggleCharacterVisible);
  const toggleCharacterLocked = useWorkbenchStore((state) => state.toggleCharacterLocked);
  const renameSceneObject = useWorkbenchStore((state) => state.renameSceneObject);
  const toggleSceneObjectVisible = useWorkbenchStore((state) => state.toggleSceneObjectVisible);
  const toggleSceneObjectLocked = useWorkbenchStore((state) => state.toggleSceneObjectLocked);
  const toggleGroundVisible = useWorkbenchStore((state) => state.toggleGroundVisible);
  const toggleGroundLocked = useWorkbenchStore((state) => state.toggleGroundLocked);
  const toggleCameraVisible = useWorkbenchStore((state) => state.toggleCameraVisible);
  const toggleCameraLocked = useWorkbenchStore((state) => state.toggleCameraLocked);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingObjectId, setRenamingObjectId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const filter = sceneFilter.trim().toLowerCase();
  const visibleCharacters = ["camera", "object", "environment"].includes(sceneTypeFilter) ? [] : characters.filter((character) => !filter || `${character.label} ${character.characterId}`.toLowerCase().includes(filter));
  const visibleCameras = ["character", "object", "environment"].includes(sceneTypeFilter) ? [] : Object.values(cameras).filter((camera) => !filter || `${camera.label} ${camera.cameraId}`.toLowerCase().includes(filter));
  const visibleSceneObjects = ["character", "camera", "environment"].includes(sceneTypeFilter) ? [] : Object.values(sceneObjects).filter((sceneObject) => !filter || `${sceneObject.label} ${sceneObject.sceneObjectId} ${sceneObject.primitiveKind ?? sceneObject.objectKind}`.toLowerCase().includes(filter));
  const showGround = !["character", "camera", "object"].includes(sceneTypeFilter) && (!filter || "地面 ground environment".includes(filter));
  const resultCount = visibleCharacters.length + visibleCameras.length + visibleSceneObjects.length + Number(showGround);

  const beginRename = (characterId: string, label: string) => {
    setRenamingId(characterId);
    setDraftName(label);
  };
  const commitRename = () => {
    if (renamingId) renameCharacter(renamingId, draftName);
    setRenamingId(null);
  };
  const beginObjectRename = (sceneObjectId: string, label: string) => {
    setRenamingObjectId(sceneObjectId);
    setDraftName(label);
  };
  const commitObjectRename = () => {
    if (renamingObjectId) renameSceneObject(renamingObjectId, draftName);
    setRenamingObjectId(null);
  };

  return (
    <section className="panel-section scene-tree" aria-labelledby="scene-tree-title">
      <div className="section-heading"><div><p className="kicker">Scene</p><h2 id="scene-tree-title">场景对象</h2></div><div className="scene-heading-actions"><span className="count-badge">{resultCount}</span><ValidationSceneMenu /><ObjectAddMenu /></div></div>
      <div className="scene-tree-filters">
        <label className="search-field"><span className="sr-only">搜索场景对象</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={sceneFilter} onChange={(event) => setSceneFilter(event.target.value)} placeholder="搜索名称或 ID" /></label>
        <label><span className="sr-only">对象类型</span><select value={sceneTypeFilter} onChange={(event) => setSceneTypeFilter(event.target.value as "all" | "character" | "camera" | "object" | "environment")}><option value="all">全部类型</option><option value="character">人物</option><option value="camera">机位</option><option value="object">物体</option><option value="environment">环境</option></select></label>
      </div>
      <p className="multi-select-hint">按住 Ctrl / Command 点击可多选人物。</p>
      <div className="scene-items">
        {visibleCharacters.map((character) => {
          const selected = selectedCharacterIds.includes(character.characterId);
          return (
            <div className={`scene-item ${selected ? "selected" : ""} ${character.visible ? "" : "hidden-object"}`} key={character.characterId}>
              {renamingId === character.characterId ? (
                <div className="scene-select static">
                  <span className="object-icon person" aria-hidden="true" />
                  <label><span className="sr-only">人物名称</span><input className="rename-input" autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") setRenamingId(null); }} /></label>
                </div>
              ) : (
                <button className="scene-select" type="button" aria-label={`选择${character.label}，${character.visible ? "可见" : "隐藏"}，${character.locked ? "已锁定" : "未锁定"}`} aria-pressed={selected} onClick={(event) => selectCharacter(character.characterId, event.metaKey || event.ctrlKey)}>
                  <span className="object-icon person" aria-hidden="true" />
                  <span><strong>{character.label}</strong><small>X {character.transform.position[0].toFixed(2)} · Y {character.transform.position[1].toFixed(2)} · Z {character.transform.position[2].toFixed(2)}</small></span>
                  <span className="capability-chip">可调姿势</span>
                </button>
              )}
              <div className="scene-actions">
                <button type="button" aria-label={`${character.visible ? "隐藏" : "显示"}${character.label}`} title={character.visible ? "隐藏" : "显示"} onClick={() => toggleCharacterVisible(character.characterId)}><EyeIcon hidden={!character.visible} /></button>
                <button type="button" aria-label={`${character.locked ? "解锁" : "锁定"}${character.label}`} title={character.locked ? "解锁" : "锁定"} onClick={() => toggleCharacterLocked(character.characterId)}><LockIcon locked={character.locked} /></button>
                <button type="button" aria-label={`重命名${character.label}`} title="重命名" disabled={character.locked} onClick={() => beginRename(character.characterId, character.label)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/><path d="m14 7.5 2.5 2.5"/></svg></button>
              </div>
            </div>
          );
        })}
        {visibleCameras.map((camera) => <div className={`scene-item ${selectedCameraId === camera.cameraId ? "selected" : ""} ${camera.visible ? "" : "hidden-object"}`} key={camera.cameraId}><button className="scene-select" type="button" aria-label={`切换到机位${camera.label}，${camera.visible ? "Frustum 可见" : "Frustum 隐藏"}，${camera.locked ? "已锁定" : "未锁定"}`} aria-pressed={selectedCameraId === camera.cameraId} onClick={() => selectCamera(camera.cameraId, true)}><span className="object-icon camera" aria-hidden="true"/><span><strong>{camera.label}</strong><small>{camera.fovDeg.toFixed(0)}° · zoom {camera.zoom.toFixed(2)} · {camera.aspectRatio}</small></span><span className="capability-chip">机位</span></button><div className="scene-actions"><button type="button" aria-label={`${camera.visible ? "隐藏" : "显示"}${camera.label} Frustum`} onClick={() => toggleCameraVisible(camera.cameraId)}><EyeIcon hidden={!camera.visible}/></button><button type="button" aria-label={`${camera.locked ? "解锁" : "锁定"}${camera.label}`} onClick={() => toggleCameraLocked(camera.cameraId)}><LockIcon locked={camera.locked}/></button></div></div>)}
        {visibleSceneObjects.map((sceneObject) => {
          const selected = selectedSceneObjectId === sceneObject.sceneObjectId;
          return (
            <div className={`scene-item ${selected ? "selected" : ""} ${sceneObject.visible ? "" : "hidden-object"}`} key={sceneObject.sceneObjectId}>
              {renamingObjectId === sceneObject.sceneObjectId ? (
                <div className="scene-select static"><span className={`object-icon ${sceneObject.objectKind === "empty" ? "empty" : "primitive"}`} aria-hidden="true"/><label><span className="sr-only">物体名称</span><input className="rename-input" autoFocus value={draftName} onChange={(event) => setDraftName(event.target.value)} onBlur={commitObjectRename} onKeyDown={(event) => { if (event.key === "Enter") commitObjectRename(); if (event.key === "Escape") setRenamingObjectId(null); }}/></label></div>
              ) : (
                <button className="scene-select" type="button" aria-label={`选择${sceneObject.label}，${sceneObject.visible ? "可见" : "隐藏"}，${sceneObject.locked ? "已锁定" : "未锁定"}`} aria-pressed={selected} onClick={() => selectSceneObject(sceneObject.sceneObjectId)}>
                  <span className={`object-icon ${sceneObject.objectKind === "empty" ? "empty" : "primitive"}`} aria-hidden="true"/>
                  <span><strong>{sceneObject.label}</strong><small>{sceneObject.primitiveKind ?? sceneObject.objectKind} · {sceneObject.dimensionsM.map((value) => value.toFixed(2)).join(" × ")} m</small></span>
                  <span className="capability-chip">{sceneObject.compilerCapabilityState === "available" ? "可编译" : "仅预览"}</span>
                </button>
              )}
              <div className="scene-actions">
                <button type="button" aria-label={`${sceneObject.visible ? "隐藏" : "显示"}${sceneObject.label}`} title={sceneObject.visible ? "隐藏" : "显示"} onClick={() => toggleSceneObjectVisible(sceneObject.sceneObjectId)}><EyeIcon hidden={!sceneObject.visible}/></button>
                <button type="button" aria-label={`${sceneObject.locked ? "解锁" : "锁定"}${sceneObject.label}`} title={sceneObject.locked ? "解锁" : "锁定"} onClick={() => toggleSceneObjectLocked(sceneObject.sceneObjectId)}><LockIcon locked={sceneObject.locked}/></button>
                <button type="button" aria-label={`重命名${sceneObject.label}`} title="重命名" disabled={sceneObject.locked} onClick={() => beginObjectRename(sceneObject.sceneObjectId, sceneObject.label)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6 4 16Z"/><path d="m14 7.5 2.5 2.5"/></svg></button>
              </div>
            </div>
          );
        })}
        {showGround && <div className="scene-item environment-item"><div className="scene-select static"><span className="object-icon ground" aria-hidden="true" /><span><strong>地面</strong><small>高度 {ground.heightM.toFixed(2)} m · 网格 {ground.gridSpacingM.toFixed(2)} m</small></span><span className="lock-chip">环境</span></div><div className="scene-actions"><button type="button" aria-label={ground.visible ? "隐藏地面" : "显示地面"} title={ground.visible ? "隐藏" : "显示"} onClick={toggleGroundVisible}><EyeIcon hidden={!ground.visible} /></button><button type="button" aria-label={ground.locked ? "解锁地面" : "锁定地面"} title={ground.locked ? "解锁" : "锁定"} onClick={toggleGroundLocked}><LockIcon locked={ground.locked} /></button></div></div>}
        {resultCount === 0 && <div className="empty-filter">没有匹配的场景对象。</div>}
      </div>
    </section>
  );
}
