import type { CharacterAuthoringState } from "../state/workbench-store";
import type {
  ActorPathState,
  RenderSceneState,
  EnvironmentInputEntry,
  CameraCompositionState,
  CameraPathState,
  SceneObjectAuthoringState,
  TimelineTrackState,
} from "../types";
import { evaluateDirectorFrame } from "../timeline/timeline-evaluation";

export interface DirectorShotPackage {
  schemaVersion: "iframe.director3d.shot-package.v1";
  packageChecksum: string;
  frame: number;
  timeSeconds: number;
  fps: number;
  durationSeconds: number;
  activeCameraId: string;
  aspectRatio: CameraCompositionState["aspectRatio"];
  characters: Array<Pick<CharacterAuthoringState, "characterId" | "actorMappingId" | "proxyAssetId" | "label" | "transform" | "jointRotations" | "poseRootOffsetM" | "visible">>;
  objects: SceneObjectAuthoringState[];
  environment: { renderScene: RenderSceneState; panoramaSource: Pick<EnvironmentInputEntry, "inputId" | "checksum" | "admissionChecksum" | "environmentAllowed"> | null };
  camera: Pick<CameraCompositionState, "cameraId" | "label" | "transform" | "fovDeg" | "focalLengthMm" | "depthOfField" | "aspectRatio" | "lookAt" | "subjectTargetIds" | "visible">;
  actorPaths: ActorPathState[];
  cameraPaths: CameraPathState[];
  timelineTrackIds: string[];
  provenance: {
    coordinateSystem: "director_z_up";
    unit: "meter";
    source: "browser-workbench-evaluation";
    limitations: string[];
  };
}

function packageChecksum(value: Omit<DirectorShotPackage, "packageChecksum">): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export interface DirectorShotPackageInput {
  renderScene: RenderSceneState;
  environmentInputs: EnvironmentInputEntry[];
  frame: number;
  durationSeconds: number;
  fps: number;
  tracks: TimelineTrackState[];
  activeCameraTrackId: string | null;
  selectedCameraId: string;
  characters: Record<string, CharacterAuthoringState>;
  cameras: Record<string, CameraCompositionState>;
  sceneObjects: Record<string, SceneObjectAuthoringState>;
  actorPaths: Record<string, ActorPathState>;
  cameraPaths: Record<string, CameraPathState>;
}

/** Projects one evaluated frame without making the package a second state owner. */
export function projectDirectorShotPackage(input: DirectorShotPackageInput): DirectorShotPackage {
  const evaluated = evaluateDirectorFrame(input);
  const camera = evaluated.cameras[evaluated.activeCameraId];
  if (!camera) throw new Error("当前时间线没有可用的活动机位。");
  const projected: Omit<DirectorShotPackage, "packageChecksum"> = {
    schemaVersion: "iframe.director3d.shot-package.v1",
    frame: Math.round(input.frame),
    timeSeconds: evaluated.timeSeconds,
    fps: input.fps,
    durationSeconds: input.durationSeconds,
    activeCameraId: evaluated.activeCameraId,
    aspectRatio: camera.aspectRatio,
    characters: Object.values(evaluated.characters).map(({ characterId, actorMappingId, proxyAssetId, label, transform, jointRotations, poseRootOffsetM, visible }) => ({ characterId, actorMappingId, proxyAssetId, label, transform, jointRotations, poseRootOffsetM, visible })),
    objects: Object.values(evaluated.sceneObjects).map((object) => structuredClone(object)),
    environment: {
      renderScene: structuredClone(input.renderScene),
      panoramaSource: (() => {
        const source = input.environmentInputs.find((entry) => entry.inputId === input.renderScene.panorama.inputId);
        return source ? { inputId: source.inputId, checksum: source.checksum, admissionChecksum: source.admissionChecksum, environmentAllowed: source.environmentAllowed } : null;
      })(),
    },
    camera: { cameraId: camera.cameraId, label: camera.label, transform: camera.transform, fovDeg: camera.fovDeg, focalLengthMm: camera.focalLengthMm, depthOfField: camera.depthOfField, aspectRatio: camera.aspectRatio, lookAt: camera.lookAt, subjectTargetIds: camera.subjectTargetIds, visible: camera.visible },
    actorPaths: Object.values(input.actorPaths).map((path) => structuredClone(path)),
    cameraPaths: Object.values(input.cameraPaths).map((path) => structuredClone(path)),
    timelineTrackIds: input.tracks.map((track) => track.trackId),
    provenance: {
      coordinateSystem: "director_z_up",
      unit: "meter",
      source: "browser-workbench-evaluation",
      limitations: ["lights are not authored in the browser workbench manifest yet", "depth is not implied by browser preview geometry"],
    },
  };
  return { ...projected, packageChecksum: packageChecksum(projected) };
}
