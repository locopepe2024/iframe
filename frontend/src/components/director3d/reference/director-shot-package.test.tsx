import { expect, it } from "vitest";

import { useWorkbenchStore } from "../state/workbench-store";
import { projectDirectorShotPackage } from "./director-shot-package";

it("projects the evaluated active camera and stable authored identities", () => {
  const state = useWorkbenchStore.getState();
  const packageState = projectDirectorShotPackage({
    renderScene: state.renderScene,
    environmentInputs: state.environmentInputCatalog.entries,
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
  expect(packageState.packageChecksum).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
  expect(packageState.activeCameraId).toBe(state.selectedCameraId);
  expect(packageState.characters.map((item) => item.characterId)).toContain(state.selectedCharacterId);
  expect(packageState.camera.focalLengthMm).toBeGreaterThan(0);
  expect(packageState.provenance.unit).toBe("meter");
});

it("keeps the package checksum stable for the same evaluated state", () => {
  const state = useWorkbenchStore.getState();
  const input = {
    renderScene: state.renderScene,
    environmentInputs: state.environmentInputCatalog.entries,
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
  };
  expect(projectDirectorShotPackage(input).packageChecksum).toBe(projectDirectorShotPackage(input).packageChecksum);
});


it("binds background, panorama source, frame and camera to the common checksum", async () => {
  const { currentDirectorShotPackage } = await import("./current-shot-package");
  const state = useWorkbenchStore.getState();
  const original = currentDirectorShotPackage(state);
  const changedBackground = { ...state, renderScene: { ...state.renderScene, skyColor: "#abcdef" } };
  expect(currentDirectorShotPackage(changedBackground).packageChecksum).not.toBe(original.packageChecksum);
  expect(currentDirectorShotPackage(state, 12).packageChecksum).not.toBe(original.packageChecksum);
  const camera = state.cameras[state.selectedCameraId];
  expect(currentDirectorShotPackage({ ...state, cameras: { ...state.cameras, [camera.cameraId]: { ...camera, fovDeg: camera.fovDeg + 1 } } }).packageChecksum).not.toBe(original.packageChecksum);
  const inputId = "panorama-test";
  const panoramaState = { ...state, renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, inputId } } };
  const source = { inputId, checksum: "sha256:one", admissionChecksum: "sha256:one", environmentAllowed: true } as typeof state.environmentInputCatalog.entries[number];
  const withSource = { ...panoramaState, environmentInputCatalog: { ...state.environmentInputCatalog, entries: [source] } };
  const panoramaPackage = currentDirectorShotPackage(withSource);
  expect(currentDirectorShotPackage({ ...withSource, environmentInputCatalog: { ...state.environmentInputCatalog, entries: [{ ...source, checksum: "sha256:two" }] } }).packageChecksum).not.toBe(panoramaPackage.packageChecksum);
  const rotated = { ...state, renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, rotationDeg: [0, 0, 90] as [number, number, number] } } };
  expect(currentDirectorShotPackage(rotated).packageChecksum).not.toBe(original.packageChecksum);
  expect(original.environment.renderScene.panorama.rotationDeg).toEqual(state.renderScene.panorama.rotationDeg);
});


it("invalidates object references when a revision or material changes", async () => {
  const { currentDirectorShotPackage } = await import("./current-shot-package");
  const before = useWorkbenchStore.getState();
  try {
    before.addPrimitive("cube");
    const state = useWorkbenchStore.getState();
    const object = Object.values(state.sceneObjects)[0];
    expect(object).toBeDefined();
    const original = currentDirectorShotPackage(state);
    for (const changed of [{ ...object, revision: object.revision + 1 }, { ...object, materialHint: { color: "#ff0000", roughness: 0.5 } }]) {
      expect(currentDirectorShotPackage({ ...state, sceneObjects: { ...state.sceneObjects, [object.sceneObjectId]: changed } }).packageChecksum).not.toBe(original.packageChecksum);
    }
  } finally {
    useWorkbenchStore.setState(before, true);
  }
});
