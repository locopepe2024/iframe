import { expect, it } from "vitest";

import { useWorkbenchStore } from "../state/workbench-store";
import { projectDirectorShotPackage } from "./director-shot-package";

it("projects the evaluated active camera and stable authored identities", () => {
  const state = useWorkbenchStore.getState();
  const packageState = projectDirectorShotPackage({
    frame: 1,
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
  });
  expect(packageState.schemaVersion).toBe("iframe.director3d.shot-package.v1");
  expect(packageState.activeCameraId).toBe(state.selectedCameraId);
  expect(packageState.characters.map((item) => item.characterId)).toContain(state.selectedCharacterId);
  expect(packageState.camera.focalLengthMm).toBeGreaterThan(0);
  expect(packageState.provenance.unit).toBe("meter");
});
