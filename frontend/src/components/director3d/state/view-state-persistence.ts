import { rigProfile } from "../data/humanoid";
import type { OrientationGizmoState, TransformMode, ViewMode, ViewportNavigationByView } from "../types";
import { DEFAULT_ORIENTATION_GIZMO, sanitizeViewportNavigationByView } from "./viewport-navigation";
import { useWorkbenchStore } from "./workbench-store";

export const VIEW_STATE_STORAGE_KEY = "iframe.director3d.browser-view.v2";
export const LEGACY_VIEW_STATE_STORAGE_KEY = "iframe.director3d.browser-view.v1";

export interface BrowserViewState {
  schemaVersion: "standalone-director-browser-view.v2";
  selectedCharacterId: string;
  selectedCharacterIds: string[];
  selectedSceneObjectId: string | null;
  selectedCameraId: string;
  sceneFilter: string;
  sceneTypeFilter: "all" | "character" | "camera" | "object" | "environment";
  selectedJointId: string;
  jointFilter: string;
  viewMode: ViewMode;
  viewportNavigation: ViewportNavigationByView;
  orientationGizmo: OrientationGizmoState;
  transformMode: TransformMode;
  showJointHandles: boolean;
  showInternalBones: boolean;
  playheadFrame: number;
}

export function projectBrowserViewState(): BrowserViewState {
  const state = useWorkbenchStore.getState();
  return {
    schemaVersion: "standalone-director-browser-view.v2",
    selectedCharacterId: state.selectedCharacterId,
    selectedCharacterIds: state.selectedCharacterIds,
    selectedSceneObjectId: state.selectedSceneObjectId,
    selectedCameraId: state.selectedCameraId,
    sceneFilter: state.sceneFilter,
    sceneTypeFilter: state.sceneTypeFilter,
    selectedJointId: state.selectedJointId,
    jointFilter: state.jointFilter,
    viewMode: state.viewMode,
    viewportNavigation: state.viewportNavigation,
    orientationGizmo: state.orientationGizmo,
    transformMode: state.transformMode,
    showJointHandles: state.showJointHandles,
    showInternalBones: state.showInternalBones,
    playheadFrame: state.playheadFrame,
  };
}

export function projectSchemaViewState() {
  const state = projectBrowserViewState();
  return {
    viewport_navigation: {
      active_view: state.viewMode,
      views: Object.fromEntries(Object.entries(state.viewportNavigation).map(([view, navigation]) => [view, {
        position_m: navigation.positionM,
        target_m: navigation.targetM,
        up: navigation.up,
        zoom: navigation.zoom,
      }])),
      orientation_gizmo: state.orientationGizmo,
    },
    open_panels: [],
    selected_target_ids: state.selectedSceneObjectId ? [state.selectedSceneObjectId] : state.selectedCharacterIds,
    gizmo_mode: state.transformMode,
    playhead_seconds: (state.playheadFrame - 1) / 24,
  };
}

export function restoreBrowserViewState(storage: Pick<Storage, "getItem"> = window.localStorage): void {
  try {
    const raw = storage.getItem(VIEW_STATE_STORAGE_KEY) ?? storage.getItem(LEGACY_VIEW_STATE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<BrowserViewState>;
    if (parsed.schemaVersion !== "standalone-director-browser-view.v2" && parsed.schemaVersion !== "standalone-director-browser-view.v1") return;
    const state = useWorkbenchStore.getState();
    const selectedCharacterId = parsed.selectedCharacterId && state.characters[parsed.selectedCharacterId]
      ? parsed.selectedCharacterId
      : state.selectedCharacterId;
    const selectedCharacterIds = Array.isArray(parsed.selectedCharacterIds)
      ? Array.from(new Set(parsed.selectedCharacterIds.filter((id): id is string => typeof id === "string" && Boolean(state.characters[id]))))
      : [selectedCharacterId];
    if (!selectedCharacterIds.includes(selectedCharacterId)) selectedCharacterIds.push(selectedCharacterId);
    const selectedSceneObjectId = typeof parsed.selectedSceneObjectId === "string" && Boolean(state.sceneObjects[parsed.selectedSceneObjectId])
      ? parsed.selectedSceneObjectId
      : null;
    const selectedCameraId = typeof parsed.selectedCameraId === "string" && Boolean(state.cameras[parsed.selectedCameraId]) ? parsed.selectedCameraId : state.selectedCameraId;
    const selectedJointId = parsed.selectedJointId && rigProfile.joints.some((joint) => joint.joint_id === parsed.selectedJointId)
      ? parsed.selectedJointId
      : state.selectedJointId;
    useWorkbenchStore.setState({
      selectedCharacterId,
      selectedCharacterIds: selectedSceneObjectId ? [] : selectedCharacterIds,
      selectedSceneObjectId,
      selectedCameraId,
      sceneFilter: typeof parsed.sceneFilter === "string" ? parsed.sceneFilter.slice(0, 80) : state.sceneFilter,
      sceneTypeFilter: ["all", "character", "camera", "object", "environment"].includes(String(parsed.sceneTypeFilter))
        ? parsed.sceneTypeFilter as BrowserViewState["sceneTypeFilter"]
        : state.sceneTypeFilter,
      selectedJointId,
      jointFilter: typeof parsed.jointFilter === "string" ? parsed.jointFilter.slice(0, 80) : state.jointFilter,
      viewMode: ["director", "top", "camera"].includes(String(parsed.viewMode)) ? parsed.viewMode as ViewMode : state.viewMode,
      viewportNavigation: sanitizeViewportNavigationByView(parsed.viewportNavigation ?? state.viewportNavigation),
      orientationGizmo: parsed.orientationGizmo && typeof parsed.orientationGizmo === "object"
        ? {
            visible: typeof parsed.orientationGizmo.visible === "boolean" ? parsed.orientationGizmo.visible : state.orientationGizmo.visible,
            corner: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(String(parsed.orientationGizmo.corner))
              ? parsed.orientationGizmo.corner
              : state.orientationGizmo.corner,
          }
        : { ...DEFAULT_ORIENTATION_GIZMO },
      transformMode: ["translate", "rotate", "scale"].includes(String(parsed.transformMode)) ? parsed.transformMode as TransformMode : state.transformMode,
      showJointHandles: typeof parsed.showJointHandles === "boolean" ? parsed.showJointHandles : state.showJointHandles,
      showInternalBones: typeof parsed.showInternalBones === "boolean" ? parsed.showInternalBones : state.showInternalBones,
      playheadFrame: typeof parsed.playheadFrame === "number" ? Math.min(96, Math.max(1, Math.round(parsed.playheadFrame))) : state.playheadFrame,
    });
  } catch {
    // Corrupt browser-only state is discarded without touching project authoring truth.
  }
}

export function installBrowserViewStatePersistence(storage: Pick<Storage, "setItem"> = window.localStorage): () => void {
  let lastSerialized = JSON.stringify(projectBrowserViewState());
  return useWorkbenchStore.subscribe(() => {
    try {
      const serialized = JSON.stringify(projectBrowserViewState());
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      storage.setItem(VIEW_STATE_STORAGE_KEY, serialized);
    } catch {
      // Storage availability never blocks authoring.
    }
  });
}
