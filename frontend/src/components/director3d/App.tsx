import { useEffect, useState } from "react";

import { resolveViewTabKey, resolveWorkbenchShortcut } from "./accessibility/workbench-accessibility";
import { rigProfile } from "./data/humanoid";
import { JointInspector } from "./pose/JointInspector";
import { JointTree } from "./pose/JointTree";
import { HumanoidStage } from "./scene/HumanoidStage";
import { SceneObjectInspector } from "./scene/SceneObjectInspector";
import { SceneTree } from "./scene/SceneTree";
import { useWorkbenchStore } from "./state/workbench-store";
import { selectCharactersRecord } from "./state/workbench-selectors";
import { CameraToolsInspector } from "./camera/CameraToolsInspector";
import { TimelinePanel } from "./timeline/TimelinePanel";
import { TemporalToolsInspector } from "./TemporalToolsInspector";
import { ConfigPanelToggle } from "./ConfigPanelToggle";
import type { TransformMode, ViewMode } from "./types";
import { saveLocalDirectorDraft } from "./state/local-draft";

const VIEW_LABELS: Record<ViewMode, string> = { director: "导演视图", top: "俯视舞台", camera: "镜头视图" };

interface DirectorAppProps {
  restoredSavedAt?: string | null;
}

function formatSavedTime(savedAt: string): string {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleTimeString();
}

export function App({ restoredSavedAt = null }: DirectorAppProps = {}) {
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const setViewMode = useWorkbenchStore((state) => state.setViewMode);
  const showJointHandles = useWorkbenchStore((state) => state.showJointHandles);
  const toggleJointHandles = useWorkbenchStore((state) => state.toggleJointHandles);
  const rigAdmissionStatus = useWorkbenchStore((state) => state.rigAdmissionStatus);
  const rigAdmissionIssues = useWorkbenchStore((state) => state.rigAdmissionIssues);
  const charactersRecord = useWorkbenchStore(selectCharactersRecord);
  const characters = Object.values(charactersRecord);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const transformMode = useWorkbenchStore((state) => state.transformMode);
  const setTransformMode = useWorkbenchStore((state) => state.setTransformMode);
  const fullscreenActive = useWorkbenchStore((state) => state.fullscreenActive);
  const setFullscreenActive = useWorkbenchStore((state) => state.setFullscreenActive);
  const commandHistoryLength = useWorkbenchStore((state) => state.commandHistory.length);
  const undoDepth = useWorkbenchStore((state) => state.undoStack.length);
  const redoDepth = useWorkbenchStore((state) => state.redoStack.length);
  const undo = useWorkbenchStore((state) => state.undo);
  const redo = useWorkbenchStore((state) => state.redo);
  const unsavedChanges = useWorkbenchStore((state) => state.unsavedChanges);
  const markExplicitlySaved = useWorkbenchStore((state) => state.markExplicitlySaved);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(restoredSavedAt);
  const [leftPanelExpanded, setLeftPanelExpanded] = useState(true);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message: string }>(() => restoredSavedAt
    ? { status: "saved", message: `本地草稿已恢复 ${formatSavedTime(restoredSavedAt)}` }
    : { status: "idle", message: "" });
  const saveIndicator = saveState.status === "saving"
    ? "saving"
    : saveState.status === "error"
      ? "error"
      : unsavedChanges
        ? "unsaved"
        : lastSavedAt
          ? "saved"
          : "idle";
  const selectedCharacterIds = useWorkbenchStore((state) => state.selectedCharacterIds);
  const selectedCharacter = useWorkbenchStore((state) => state.characters[state.selectedCharacterId]);
  const selectedSceneObjectId = useWorkbenchStore((state) => state.selectedSceneObjectId);
  const selectedSceneObject = useWorkbenchStore((state) => state.selectedSceneObjectId ? state.sceneObjects[state.selectedSceneObjectId] : undefined);
  useEffect(() => {
    const onFullscreenChange = () => setFullscreenActive(document.fullscreenElement?.id === "stage");
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [setFullscreenActive]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveWorkbenchShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector("#stage")?.requestFullscreen();
  };
  const saveProject = async () => {
    setSaveState({ status: "saving", message: "正在保存浏览器本地草稿…" });
    try {
      const savedAt = saveLocalDirectorDraft();
      setLastSavedAt(savedAt);
      markExplicitlySaved();
      setSaveState({ status: "saved", message: `本地草稿已保存 ${formatSavedTime(savedAt)}` });
    } catch (caught) {
      setSaveState({ status: "error", message: caught instanceof Error ? caught.message : "保存本地草稿失败" });
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#stage">跳到三维舞台</a>
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m8 10 4-2.2 4 2.2v4L12 16.2 8 14v-4Z"/></svg></div>
          <div><p className="kicker">iFrame Director</p><h1>3D 导演台</h1></div>
        </div>
        <div className="project-identity" role="status" aria-live="polite" aria-atomic="true" aria-busy={saveState.status === "saving"}>
          <span className={`status-dot ${saveIndicator}`} aria-hidden="true" />
          <span>浏览器场景草稿</span>
          <strong className={saveIndicator}>{unsavedChanges ? "有未保存修改" : lastSavedAt ? "已保存到本机" : "尚未保存"}</strong>
          <small>{saveState.message || `${commandHistoryLength} 条操作`}</small>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary" aria-keyshortcuts="Control+Z Meta+Z" title="撤销（Ctrl/⌘ Z）" disabled={undoDepth === 0} onClick={undo}>撤销</button>
          <button type="button" className="secondary" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" title="重做（Ctrl/⌘ Shift+Z）" disabled={redoDepth === 0} onClick={redo}>重做</button>
          <button type="button" className="primary" disabled={saveState.status === "saving" || Boolean(lastSavedAt && !unsavedChanges)} onClick={() => void saveProject()}>{saveState.status === "saving" ? "保存中…" : "保存本地草稿"}</button>
        </div>
      </header>

      <main className={`workbench-grid ${viewMode === "camera" ? "camera-workspace-active" : ""}`}>
        <aside className={`left-panel ${leftPanelExpanded ? "" : "panel-collapsed"}`} aria-label="场景配置">
          <div className="panel-collapse-bar">
            <span>场景配置</span>
            <ConfigPanelToggle
              expanded={leftPanelExpanded}
              controls="left-panel-content"
              expandedLabel="收起场景配置"
              collapsedLabel="展开场景配置"
              onToggle={() => setLeftPanelExpanded((value) => !value)}
            />
          </div>
          <div id="left-panel-content" hidden={!leftPanelExpanded}>
            <SceneTree />
            <JointTree />
          </div>
        </aside>
        <div className="center-workspace">
          <div className="stage-workspace">
            <section id="stage" className="stage-column" aria-labelledby="stage-title">
            <div className="stage-toolbar">
              <div><p className="kicker">Metric stage</p><h2 id="stage-title">{VIEW_LABELS[viewMode]}</h2></div>
              <div className="view-tabs" role="tablist" aria-label="舞台视图">
                {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => <button key={mode} id={`view-tab-${mode}`} data-view={mode} type="button" role="tab" aria-controls="director-viewport" aria-selected={viewMode === mode} tabIndex={viewMode === mode ? 0 : -1} className={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)} onKeyDown={(event) => {
                  const nextMode = resolveViewTabKey(mode, event.key);
                  if (!nextMode) return;
                  event.preventDefault();
                  setViewMode(nextMode);
                  event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-view="${nextMode}"]`)?.focus();
                }}>{VIEW_LABELS[mode]}</button>)}
              </div>
              <div className="transform-tabs" role="group" aria-label="对象变换模式">
                {(["translate", "rotate", "scale"] as TransformMode[]).map((mode) => <button key={mode} type="button" aria-pressed={transformMode === mode} className={transformMode === mode ? "active" : ""} onClick={() => setTransformMode(mode)}>{{ translate: "移动", rotate: "旋转", scale: "缩放" }[mode]}</button>)}
              </div>
              <button className={`toggle-button ${showJointHandles ? "active" : ""}`} type="button" aria-pressed={showJointHandles} onClick={toggleJointHandles}>关节控制点</button>
              <button className={`toggle-button ${fullscreenActive ? "active" : ""}`} type="button" aria-pressed={fullscreenActive} onClick={toggleFullscreen}>{fullscreenActive ? "退出全屏" : "全屏"}</button>
            </div>
            <HumanoidStage />
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {selectedSceneObject ? `当前选择物体 ${selectedSceneObject.label}；${selectedSceneObject.visible ? "可见" : "已隐藏"}，${selectedSceneObject.locked ? "已锁定" : "可编辑"}。` : `已选择 ${selectedCharacterIds.length} 个人物，当前为 ${selectedCharacter.label}；${selectedCharacter.visible ? "可见" : "已隐藏"}，${selectedCharacter.locked ? "已锁定，编辑不可用" : "未锁定，可编辑"}。`}撤销 {undoDepth > 0 ? "可用" : "不可用"}，重做 {redoDepth > 0 ? "可用" : "不可用"}。
            </p>
            <div className="stage-status" role="status" aria-live="polite">
              <span><strong>{selectedSceneObject ? "物体" : "人物"}：</strong>{selectedSceneObject?.label ?? characters.find((character) => character.characterId === selectedCharacterId)?.label}</span>
              <span><strong>骨架：</strong>{rigProfile.rig_profile_id}</span>
              <span><strong>产品关节：</strong>{rigAdmissionStatus === "passed" ? "57 / 57" : `阻止编辑 · ${rigAdmissionIssues.length} 项`}</span>
              <span><strong>单位：</strong>米 / 度</span>
            </div>
            </section>
            <TemporalToolsInspector />
          </div>
          <section className="timeline-dock" aria-label="底部时间轴">
            <TimelinePanel />
          </section>
        </div>
        <div className={`inspector-column ${viewMode === "camera" ? "camera-inspector-column" : ""} ${inspectorExpanded ? "" : "panel-collapsed"}`} aria-label="属性配置">
          <div className="panel-collapse-bar">
            <span>属性配置</span>
            <ConfigPanelToggle
              expanded={inspectorExpanded}
              controls="inspector-column-content"
              expandedLabel="收起属性配置"
              collapsedLabel="展开属性配置"
              onToggle={() => setInspectorExpanded((value) => !value)}
            />
          </div>
          <div id="inspector-column-content" hidden={!inspectorExpanded}>
            {viewMode === "camera" ? <CameraToolsInspector /> : selectedSceneObjectId ? <SceneObjectInspector /> : <JointInspector />}
          </div>
        </div>
      </main>

      <footer className="command-bar">
        <div><p className="kicker">Browser core</p><strong>当前仅保存本地草稿，不调用 UniArt 或独立导演台 API</strong></div>
        <label><span className="sr-only">导演指令</span><input disabled placeholder="例如：角色 A 举起右手，镜头改为近景并前推" /></label>
        <button type="button" disabled>预览计划</button>
      </footer>
    </div>
  );
}
