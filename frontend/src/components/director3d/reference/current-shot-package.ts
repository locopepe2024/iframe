import type { useWorkbenchStore } from "../state/workbench-store";
import { projectDirectorShotPackage } from "./director-shot-package";

/** The same projection supplies browser references, video and metric-depth provenance. */
export function currentDirectorShotPackage(state: ReturnType<typeof useWorkbenchStore.getState>, frame = state.playheadFrame) {
  return projectDirectorShotPackage({
    crowdGroups: state.crowdGroups,
    frame,
    durationSeconds: state.dialogueTimeline.durationSeconds,
    fps: state.dialogueTimeline.fps,
    tracks: state.dialogueTimeline.tracks,
    activeCameraTrackId: state.dialogueTimeline.activeCameraTrackId,
    selectedCameraId: state.selectedCameraId,
    characters: state.characters,
    cameras: state.cameras,
    sceneObjects: state.sceneObjects,
    actorPaths: state.actorPaths,
    cameraPaths: state.cameraPaths,
    renderScene: state.renderScene,
    environmentInputs: state.environmentInputCatalog.entries,
  });
}
