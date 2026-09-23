import { useWorkbenchStore, type WorkbenchState } from "./workbench-store";
import { createIdleFrameManifestImportState } from "./frame-manifest-import";
import { createIdleLocalAnimationImportState } from "./local-animation-import";

export const DIRECTOR_DRAFT_STORAGE_KEY = "iframe.director3d.browser-draft.v1";

interface DirectorDraftEnvelope {
  schemaVersion: "iframe.director3d.browser-draft.v1";
  savedAt: string;
  state: Partial<WorkbenchState>;
}

function projectSerializableState(state: WorkbenchState): Partial<WorkbenchState> {
  const sceneObjects = Object.fromEntries(
    Object.entries(state.sceneObjects).filter(([, object]) => object.objectKind === "primitive" || object.objectKind === "empty"),
  );
  return {
    characters: Object.fromEntries(Object.entries(state.characters).map(([id, character]) => [id, {
      ...character,
      proxyAssetId: null,
      calibratedPlacement: null,
    }])),
    dialogueTimeline: {
      ...state.dialogueTimeline,
      dialogueBeats: state.dialogueTimeline.dialogueBeats.map((beat) => ({ ...beat, audioInputId: null })),
    },
    frameManifestImport: state.frameManifestImport.status === "ready" ? state.frameManifestImport : createIdleFrameManifestImportState(),
    dialogueReferenceInputs: [],
    cameras: state.cameras,
    selectedCameraId: state.selectedCameraId,
    cameraSnapshots: state.cameraSnapshots,
    actorPaths: state.actorPaths,
    cameraPaths: state.cameraPaths,
    externalCameraMotionProposals: [],
    pathEvents: state.pathEvents,
    sceneObjects,
    subjectReferenceSets: {},
    subjectProxies: {},
    selectedCharacterId: state.selectedCharacterId,
    selectedCharacterIds: state.selectedCharacterIds,
    selectedSceneObjectId: state.selectedSceneObjectId && sceneObjects[state.selectedSceneObjectId] ? state.selectedSceneObjectId : null,
    selectedJointId: state.selectedJointId,
    viewMode: state.viewMode,
    viewportNavigation: state.viewportNavigation,
    orientationGizmo: state.orientationGizmo,
    transformMode: state.transformMode,
    playheadFrame: state.playheadFrame,
    showJointHandles: state.showJointHandles,
    showInternalBones: state.showInternalBones,
    renderScene: {
      ...state.renderScene,
      panorama: { ...state.renderScene.panorama, inputId: null },
      calibrationRevisionIds: [],
      scenePlateCalibrations: [],
      panoramaCalibrations: [],
      activePanoramaCalibrationId: null,
    },
  };
}

export function saveLocalDirectorDraft(storage: Pick<Storage, "setItem"> = window.localStorage): string {
  const savedAt = new Date().toISOString();
  const envelope: DirectorDraftEnvelope = {
    schemaVersion: "iframe.director3d.browser-draft.v1",
    savedAt,
    state: projectSerializableState(useWorkbenchStore.getState()),
  };
  storage.setItem(DIRECTOR_DRAFT_STORAGE_KEY, JSON.stringify(envelope));
  useWorkbenchStore.getState().markExplicitlySaved();
  return savedAt;
}

export function restoreLocalDirectorDraft(storage: Pick<Storage, "getItem"> = window.localStorage): string | null {
  try {
    const raw = storage.getItem(DIRECTOR_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Partial<DirectorDraftEnvelope>;
    if (envelope.schemaVersion !== "iframe.director3d.browser-draft.v1" || !envelope.state || typeof envelope.savedAt !== "string") return null;
    useWorkbenchStore.setState({
      ...envelope.state,
      frameManifestImport: envelope.state.frameManifestImport ?? createIdleFrameManifestImportState(),
      localAnimationImport: createIdleLocalAnimationImportState(),
      fullscreenActive: false,
      subjectImportOpen: false,
      transformDragging: false,
      actorPathDragSnapshot: null,
      actorPathDragTarget: null,
      cameraPathDragSnapshot: null,
      cameraPathDragTarget: null,
      externalCameraMotionProposals: [],
      transformDragSnapshot: null,
      transformDragCharacterId: null,
      undoStack: [],
      redoStack: [],
      dialogueReferenceInputs: [],
      objectAssetCatalog: { status: "unavailable", message: "浏览器核心仅开放内置对象。", assets: [] },
      environmentInputCatalog: { status: "ready", message: "环境素材将在 iFrame Core 资产契约接入后开放。", entries: [] },
      panoramaDiagnosticPreviewInputId: null,
      unsavedChanges: false,
    });
    return envelope.savedAt;
  } catch {
    return null;
  }
}
