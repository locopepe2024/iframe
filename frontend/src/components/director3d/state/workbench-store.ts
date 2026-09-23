import { create } from "zustand";

import { createManualScenePlateCalibration, evaluateScenePlateCalibration, intersectGroundPlane, placeTargetOnScenePlate, pointInsideGroundRegion } from "../calibration/scene-plate-calibration";
import { createManualPanoramaCalibration, evaluatePanoramaCalibration, panoramaRotationTuple } from "../calibration/panorama-calibration";
import { createCameraPathPresetControlPoints } from "../camera/camera-path-presets";
import { downsampleToBezierPoints, parseExternalCameraMotionManifest } from "../camera/external-camera-motion";
import { CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID, CHARACTER_LABELS, rigProfile } from "../data/humanoid";
import { mirrorRotation, posePresetById, type PosePresetId } from "../pose/pose-presets";
import type { RigAdmissionIssue } from "../pose/rig-admission";
import type { ActorMappingState, ActorPathControlPointState, ActorPathEasing, ActorPathState, AdmittedObjectAsset, Axis, CalibratedPlacementState, CalibrationSupportLayerState, CameraAspectRatio, CameraCompositionPresetId, CameraCompositionState, CameraNoiseTrackState, CameraPathApplyMode, CameraPathPresetId, CameraPathState, CameraSnapshotState, CameraTargetState, DialogueBeatState, DialogueReferenceInputState, DialogueTimelineState, DirectorValidationPresetId, EnvironmentInputCatalogState, EnvironmentInputEntry, EquirectangularPanoramaCalibrationState, ExternalCameraMotionProposalState, FocusTargetState, FocusTrackState, FrameManifestImportState, InteractionAnchorState, JointDefinition, LocalAnimationImportState, ObjectAssetCatalogState, ObjectTransform, OrientationGizmoState, PathEventState, PathEventType, PerspectiveScenePlateCalibrationState, PrimitiveKind, RenderSceneState, Rotation, SceneObjectAuthoringState, ScenePlateCompositingState, SpeakerTrackState, SubjectProxyAssetState, SubjectReferenceSetState, TimelineInterpolation, TimelineKeyframeState, TimelineTargetType, TimelineTrackKind, TimelineTrackState, TransformMode, ViewMode, ViewportNavigation, ViewportNavigationByView } from "../types";
import { createIdleLocalAnimationImportState } from "./local-animation-import";
import { createIdleFrameManifestImportState } from "./frame-manifest-import";
import { ACTION_STRUCTURES, validateActionStructure } from "../action/action-structures";
import { DEFAULT_ORIENTATION_GIZMO, DEFAULT_VIEWPORT_NAVIGATION, navigationEqual, sanitizeViewportNavigation } from "./viewport-navigation";

const ZERO_ROTATION: Rotation = { x: 0, y: 0, z: 0 };
const jointById = new Map(rigProfile.joints.map((joint) => [joint.joint_id, joint]));

export interface CharacterAuthoringState {
  characterId: string;
  actorMappingId: string;
  proxyAssetId: string | null;
  label: string;
  transform: ObjectTransform;
  poseRevision: number;
  poseRootOffsetM: [number, number, number];
  jointRotations: Record<string, Rotation>;
  activePresetId: PosePresetId | null;
  adjustedJointIds: string[];
  visible: boolean;
  locked: boolean;
  calibratedPlacement: CalibratedPlacementState | null;
}

export interface AuthoringSnapshot {
  characters: Record<string, CharacterAuthoringState>;
  actorMappings: Record<string, ActorMappingState>;
  sceneObjects: Record<string, SceneObjectAuthoringState>;
  renderScene: RenderSceneState;
  dialogueTimeline: DialogueTimelineState;
  cameras: Record<string, CameraCompositionState>;
  actorPaths: Record<string, ActorPathState>;
  cameraPaths: Record<string, CameraPathState>;
  externalCameraMotionProposals: ExternalCameraMotionProposalState[];
  pathEvents: PathEventState[];
}

export type ActorPathVectorField = keyof Pick<ActorPathControlPointState, "positionM" | "handleInM" | "handleOutM">;

interface ActorPathDragTarget {
  pathId: string;
  controlPointId: string;
  field: ActorPathVectorField;
}

interface CameraPathDragTarget {
  pathId: string;
  controlPointId: string;
  field: ActorPathVectorField;
}

const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: "立方体",
  sphere: "球体",
  cylinder: "圆柱体",
  torus: "圆环",
  cone: "圆锥体",
  pyramid: "棱锥",
};

const PRIMITIVE_COLORS: Record<PrimitiveKind, string> = {
  cube: "#60A5FA",
  sphere: "#34D399",
  cylinder: "#E5E7EB",
  torus: "#F472B6",
  cone: "#A78BFA",
  pyramid: "#FB7185",
};

function boundsForDimensions(dimensionsM: [number, number, number], pivotM: [number, number, number]) {
  return {
    minimum: dimensionsM.map((value, axis) => -value / 2 - pivotM[axis]) as [number, number, number],
    maximum: dimensionsM.map((value, axis) => value / 2 - pivotM[axis]) as [number, number, number],
  };
}

function nextSceneObjectId(sceneObjects: Record<string, SceneObjectAuthoringState>, kind: PrimitiveKind | "empty" | "model" | "splat" | "proxy" | "reference"): string {
  const prefix = `object-${kind}-`;
  const next = Object.keys(sceneObjects).reduce((maximum, objectId) => objectId.startsWith(prefix) ? Math.max(maximum, Number(objectId.slice(prefix.length)) || 0) : maximum, 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function nextCameraId(cameras: Record<string, CameraCompositionState>): string {
  const next = Object.keys(cameras).reduce((maximum, cameraId) => Math.max(maximum, Number(cameraId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
  return `camera-${String(Math.max(2, next)).padStart(3, "0")}`;
}

function cameraRotationFromNavigation(navigation: ViewportNavigation): [number, number, number] {
  const [dx, dy, dz] = navigation.targetM.map((value, index) => value - navigation.positionM[index]) as [number, number, number];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return [72, 0, 0];
  const normalizedZ = dz / length;
  const pitchX = Math.acos(Math.max(-1, Math.min(1, -normalizedZ))) * 180 / Math.PI;
  const yawZ = Math.atan2(-dx, dy) * 180 / Math.PI;
  return [Number(pitchX.toFixed(4)), 0, Number(yawZ.toFixed(4))];
}

function cameraTargetExists(state: WorkbenchState, target: CameraTargetState | null): boolean {
  if (target === null) return true;
  if (target.targetType === "world_point") return target.targetId.startsWith("world-point-");
  return target.targetType === "character" ? Boolean(state.characters[target.targetId]) : Boolean(state.sceneObjects[target.targetId]);
}

function cameraPathTargetPosition(state: WorkbenchState, camera: CameraCompositionState): [number, number, number] {
  const resolveTarget = (targetId: string): [number, number, number] | null => {
    const character = state.characters[targetId];
    if (character) return [character.transform.position[0], character.transform.position[1], character.transform.position[2] + 1];
    const sceneObject = state.sceneObjects[targetId];
    if (sceneObject) return [sceneObject.transform.position[0], sceneObject.transform.position[1], sceneObject.transform.position[2] + sceneObject.dimensionsM[2] / 2];
    return null;
  };
  const explicitTarget = camera.lookAt ?? camera.follow;
  if (explicitTarget) {
    const position = resolveTarget(explicitTarget.targetId);
    if (position) return position;
  }
  const targets = Array.from(new Set(camera.subjectTargetIds)).flatMap((targetId) => {
    const position = resolveTarget(targetId);
    return position ? [position] : [];
  });
  if (targets.length === 0) return [camera.transform.position[0], camera.transform.position[1] + 1, camera.transform.position[2]];
  return targets.reduce((sum, target) => sum.map((value, index) => value + target[index]) as [number, number, number], [0, 0, 0]).map((value) => value / targets.length) as [number, number, number];
}

function createReferenceSceneObject(sceneObjects: Record<string, SceneObjectAuthoringState>, input: EnvironmentInputEntry): SceneObjectAuthoringState {
  const sceneObjectId = nextSceneObjectId(sceneObjects, "reference");
  const aspect = input.width > 0 && input.height > 0 ? input.width / input.height : 16 / 9;
  const width = 2.4;
  const height = Math.min(4, Math.max(0.4, width / aspect));
  const dimensionsM: [number, number, number] = [width, 0.02, height];
  const pivotM: [number, number, number] = [0, 0, 0];
  const video = input.mediaKind === "video";
  return {
    sceneObjectId,
    revision: 1,
    label: input.label.slice(0, 80),
    objectKind: video ? "reference_video" : "reference_board",
    primitiveKind: null,
    proxyRepresentationType: null,
    proxyAssetId: null,
    modelAssetId: null,
    inputId: input.inputId,
    transform: { position: [0, 1.5, 1.4], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: false },
    dimensionsM,
    pivotM,
    boundingBoxM: boundsForDimensions(dimensionsM, pivotM),
    scaleBasis: "unknown",
    materialHint: null,
    visible: true,
    locked: false,
    browserCapabilityState: "available",
    compilerCapabilityState: video ? "unavailable" : "available",
    capabilityIds: ["director.scene.inspect", "director.scene.object.transform"],
    limitations: video
      ? ["有限参考视频平面；不解析动作捕捉、骨骼、姿势或相机轨迹。", "当前 Blender 视频平面编译尚未准入，仅提供浏览器参考预览。"]
      : [input.usage === "panorama" ? "全景候选当前作为有限参考板使用，不获得球面环境语义。" : "有限透视参考板；不自动推断相机、地面、空间位置或结构化场景。"],
    calibratedPlacement: null,
  };
}

function createAdmittedAssetSceneObject(sceneObjects: Record<string, SceneObjectAuthoringState>, asset: AdmittedObjectAsset, groundHeightM: number): SceneObjectAuthoringState {
  const sceneObjectId = nextSceneObjectId(sceneObjects, asset.objectKind === "model_3d" ? "model" : "splat");
  return {
    sceneObjectId,
    revision: 1,
    label: asset.label.slice(0, 80),
    objectKind: asset.objectKind,
    primitiveKind: null,
    proxyRepresentationType: null,
    proxyAssetId: null,
    modelAssetId: asset.objectKind === "model_3d" ? asset.assetId : null,
    inputId: asset.inputId,
    transform: { position: [0, 0, groundHeightM], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: true },
    dimensionsM: [...asset.dimensionsM],
    pivotM: [...asset.pivotM],
    boundingBoxM: structuredClone(asset.boundingBoxM),
    scaleBasis: asset.scaleBasis,
    materialHint: null,
    visible: true,
    locked: false,
    browserCapabilityState: asset.browserCapabilityState,
    compilerCapabilityState: asset.compilerCapabilityState,
    capabilityIds: [...asset.capabilityIds],
    limitations: [...asset.limitations],
    calibratedPlacement: null,
  };
}

function createPrimitiveSceneObject(sceneObjects: Record<string, SceneObjectAuthoringState>, kind: PrimitiveKind, groundHeightM: number): SceneObjectAuthoringState {
  const sceneObjectId = nextSceneObjectId(sceneObjects, kind);
  const dimensionsM: [number, number, number] = kind === "torus" ? [1, 1, 0.3] : [1, 1, 1];
  const pivotM: [number, number, number] = [0, 0, -dimensionsM[2] / 2];
  return {
    sceneObjectId,
    revision: 1,
    label: `${PRIMITIVE_LABELS[kind]} ${sceneObjectId.slice(-3)}`,
    objectKind: "primitive",
    primitiveKind: kind,
    proxyRepresentationType: null,
    proxyAssetId: null,
    modelAssetId: null,
    inputId: null,
    transform: { position: [0, 0, groundHeightM], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: true },
    dimensionsM,
    pivotM,
    boundingBoxM: boundsForDimensions(dimensionsM, pivotM),
    scaleBasis: "canonical_parameter",
    materialHint: { color: PRIMITIVE_COLORS[kind], roughness: 0.72 },
    visible: true,
    locked: false,
    browserCapabilityState: "available",
    compilerCapabilityState: "available",
    capabilityIds: ["director.scene.inspect", "director.scene.object.transform"],
    limitations: ["参数化低细节白模；不包含纹理、骨架、动画或物理属性。"],
    calibratedPlacement: null,
  };
}

function createEmptySceneObject(sceneObjects: Record<string, SceneObjectAuthoringState>, groundHeightM: number): SceneObjectAuthoringState {
  const sceneObjectId = nextSceneObjectId(sceneObjects, "empty");
  return {
    sceneObjectId,
    revision: 1,
    label: `空对象 ${sceneObjectId.slice(-3)}`,
    objectKind: "empty",
    primitiveKind: null,
    proxyRepresentationType: null,
    proxyAssetId: null,
    modelAssetId: null,
    inputId: null,
    transform: { position: [0, 0, groundHeightM], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: false },
    dimensionsM: [0.2, 0.2, 0.2],
    pivotM: [0, 0, 0],
    boundingBoxM: { minimum: [-0.1, -0.1, -0.1], maximum: [0.1, 0.1, 0.1] },
    scaleBasis: "unknown",
    materialHint: null,
    visible: true,
    locked: false,
    browserCapabilityState: "available",
    compilerCapabilityState: "available",
    capabilityIds: ["director.scene.inspect", "director.scene.object.transform"],
    limitations: ["仅提供空间锚点，不生成可见表面。"],
    calibratedPlacement: null,
  };
}

export function createInitialRenderSceneState(): RenderSceneState {
  return {
    metricWorldScale: 1,
    skyColor: "#080D19",
    sceneRootTransformRevision: 1,
    sceneRootTransform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: false },
    ground: { visible: true, locked: true, heightM: 0, opacity: 1, gridSpacingM: 0.25, gridSnap: true, surfaceSnap: false },
    panorama: { inputId: null, rotationDeg: [0, 0, 0], radiusM: 10, exposure: 1 },
    labels: [],
    calibrationRevisionIds: [],
    scenePlateCalibrations: [],
    panoramaCalibrations: [],
    activePanoramaCalibrationId: null,
  };
}

function initialCharacter(characterId: string, positionX: number): CharacterAuthoringState {
  const actorMappingId = `actor-mapping-${characterId.replace(/^character-/, "")}`;
  return {
    characterId,
    actorMappingId,
    proxyAssetId: null,
    label: CHARACTER_LABELS[characterId as keyof typeof CHARACTER_LABELS],
    transform: {
      position: [positionX, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
      groundSnap: true,
    },
    poseRevision: 1,
    poseRootOffsetM: [0, 0, 0],
    jointRotations: {},
    activePresetId: "pose.neutral",
    adjustedJointIds: [],
    visible: true,
    locked: false,
    calibratedPlacement: null,
  };
}

export function createInitialActorMappings(): Record<string, ActorMappingState> {
  return Object.fromEntries(Object.values(createInitialCharacters()).map((character) => [character.actorMappingId, {
    actorMappingId: character.actorMappingId,
    characterId: character.characterId,
    subjectId: null,
    referenceSetId: null,
    proxyAssetId: null,
    appearanceRole: "unassigned" as const,
  }]));
}

export function createInitialDialogueTimeline(): DialogueTimelineState {
  return { timelineId: "timeline-main", durationSeconds: 6, fps: 24, dialogueBeats: [], speakerTracks: [], focusTracks: [], interactionAnchors: [], cameraNoiseTracks: [], tracks: [], activeCameraTrackId: null };
}

export function createInitialCameras(): Record<string, CameraCompositionState> {
  return { "camera-main": { cameraId: "camera-main", label: "主机位", transform: { position: [0, -7, 2.5], rotationDeg: [72, 0, 0], scale: [1, 1, 1], groundSnap: false }, fovDeg: 50, focalLengthMm: 38.6, zoom: 1, aspectRatio: "16:9", compositionPresetId: "medium_wide", subjectTargetIds: [CHARACTER_A_ID, CHARACTER_B_ID], lookAt: { targetType: "character", targetId: CHARACTER_A_ID }, follow: null, framingGuides: { ruleOfThirds: true, centerCross: false, safeArea: true }, snapshotIds: [], visible: true, locked: false } };
}

function snapshotChecksum(snapshot: Omit<CameraSnapshotState, "stateChecksum">): string {
  const text = JSON.stringify(snapshot); let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const COMPOSITION_PRESETS: Record<CameraCompositionPresetId, { fovDeg: number; focalLengthMm: number }> = { close_up: { fovDeg: 32, focalLengthMm: 58 }, medium: { fovDeg: 42, focalLengthMm: 46 }, medium_wide: { fovDeg: 50, focalLengthMm: 38.6 }, wide: { fovDeg: 65, focalLengthMm: 28 }, full_body: { fovDeg: 55, focalLengthMm: 34 }, two_shot: { fovDeg: 50, focalLengthMm: 38.6 } };

function snapshotDimensions(aspectRatio: CameraAspectRatio): { width: number; height: number } {
  if (aspectRatio === "auto") return { width: 1920, height: 1080 };
  const [widthRatio, heightRatio] = aspectRatio.split(":").map(Number);
  if (widthRatio >= heightRatio) return { width: 1920, height: Math.round(1920 * heightRatio / widthRatio) };
  return { width: Math.round(1920 * widthRatio / heightRatio), height: 1920 };
}

export function createInitialCharacters(): Record<string, CharacterAuthoringState> {
  return {
    [CHARACTER_A_ID]: initialCharacter(CHARACTER_A_ID, -0.8),
    [CHARACTER_B_ID]: initialCharacter(CHARACTER_B_ID, 0.8),
  };
}

export function createInitialSceneObjects(): Record<string, SceneObjectAuthoringState> {
  return {};
}

export function createInitialActorPaths(characters: Record<string, CharacterAuthoringState>): Record<string, ActorPathState> {
  return Object.fromEntries(Object.values(characters).map((character) => {
    const [x, y, z] = character.transform.position;
    const pathId = `path-${character.characterId}`;
    return [pathId, {
      pathId,
      targetType: "character" as const,
      targetId: character.characterId,
      durationSeconds: 6,
      easing: "bezier" as const,
      revision: 1,
      locked: false,
      visible: true,
      controlPoints: [
        { controlPointId: `point-${character.characterId}-start`, positionM: [x, y, z], handleInM: [x, y, z], handleOutM: [x, y + 0.33, z], order: 0 },
        { controlPointId: `point-${character.characterId}-end`, positionM: [x, y + 1, z], handleInM: [x, y + 0.67, z], handleOutM: [x, y + 1, z], order: 1 },
      ],
    }];
  }));
}

function validationCharacter(
  character: CharacterAuthoringState,
  position: [number, number, number],
  presetId: PosePresetId,
  visible = true,
): CharacterAuthoringState {
  const preset = posePresetById.get(presetId);
  return {
    ...character,
    transform: { ...character.transform, position, groundSnap: true },
    poseRootOffsetM: [...(preset?.rootOffsetM ?? [0, 0, 0])],
    jointRotations: structuredClone(preset?.rotations ?? {}),
    activePresetId: presetId,
    adjustedJointIds: [],
    poseRevision: character.poseRevision + 1,
    visible,
  };
}

function validationCube(
  sceneObjectId: string,
  label: string,
  dimensionsM: [number, number, number],
  position: [number, number, number],
  color: string,
): SceneObjectAuthoringState {
  const pivotM: [number, number, number] = [0, 0, -dimensionsM[2] / 2];
  return {
    sceneObjectId,
    revision: 1,
    label,
    objectKind: "primitive",
    primitiveKind: "cube",
    proxyRepresentationType: null,
    proxyAssetId: null,
    modelAssetId: null,
    inputId: null,
    transform: { position, rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: false },
    dimensionsM,
    pivotM,
    boundingBoxM: boundsForDimensions(dimensionsM, pivotM),
    scaleBasis: "declared_dimension",
    materialHint: { color, roughness: 0.86 },
    visible: true,
    locked: false,
    browserCapabilityState: "available",
    compilerCapabilityState: "available",
    capabilityIds: ["director.scene.inspect", "director.scene.object.transform"],
    limitations: ["验证场景参数化白模；不包含材质、纹理、物理或可变形家具。"],
    calibratedPlacement: null,
  };
}

function validationTrack(
  trackId: string,
  trackKind: TimelineTrackKind,
  targetId: string,
  propertyKey: string,
  keyframes: TimelineKeyframeState[],
): TimelineTrackState {
  return { trackId, trackKind, target: { targetType: trackKind.startsWith("camera_") ? "camera" : "character", targetId }, propertyKey, keyframes };
}

function poseKeyframes(
  trackId: string,
  characterId: string,
  phases: Array<{ timeSeconds: number; presetId: PosePresetId }>,
): TimelineTrackState {
  return validationTrack(trackId, "character_pose", characterId, "pose.normalized_values", phases.map((phase, index) => {
    const preset = posePresetById.get(phase.presetId);
    return {
      keyframeId: `${trackId}-key-${String(index + 1).padStart(2, "0")}`,
      timeSeconds: phase.timeSeconds,
      value: Object.fromEntries(Object.entries(preset?.rotations ?? {}).map(([jointId, rotation]) => [jointId, [rotation.x, rotation.y, rotation.z]])),
      interpolation: "step" as const,
    };
  }));
}

function transformKeyframes(
  trackId: string,
  characterId: string,
  phases: Array<{ timeSeconds: number; position: [number, number, number] }>,
): TimelineTrackState {
  return validationTrack(trackId, "character_transform", characterId, "transform.position_m", phases.map((phase, index) => ({
    keyframeId: `${trackId}-key-${String(index + 1).padStart(2, "0")}`,
    timeSeconds: phase.timeSeconds,
    value: phase.position,
    interpolation: "bezier" as const,
  })));
}

function indoorSofaValidationScene() {
  const baseCharacters = createInitialCharacters();
  const characters = {
    [CHARACTER_A_ID]: validationCharacter(baseCharacters[CHARACTER_A_ID], [-1.15, -0.08, 0], "seated.sit"),
    [CHARACTER_B_ID]: validationCharacter(baseCharacters[CHARACTER_B_ID], [0, -0.08, 0], "seated.sit"),
    [CHARACTER_C_ID]: validationCharacter(initialCharacter(CHARACTER_C_ID, 1.15), [1.15, -0.08, 0], "seated.sit"),
  };
  const sceneObjects = Object.fromEntries([
    validationCube("validation-room-floor", "室内地面", [8, 6, 0.1], [0, 0, -0.05], "#1f2937"),
    validationCube("validation-room-back-wall", "室内后墙", [8, 0.12, 4], [0, 2.65, 0], "#334155"),
    validationCube("validation-room-left-wall", "室内左墙", [0.12, 6, 4], [-4, 0, 0], "#293548"),
    validationCube("validation-room-right-wall", "室内右墙", [0.12, 6, 4], [4, 0, 0], "#293548"),
    validationCube("validation-sofa-seat", "沙发座面白模", [3.8, 1.2, 0.42], [0, 0, 0.38], "#64748b"),
    validationCube("validation-sofa-back", "沙发靠背白模", [3.8, 0.28, 1.55], [0, 0.48, 0.42], "#475569"),
    validationCube("validation-sofa-arm-left", "沙发左扶手白模", [0.38, 1.2, 0.78], [-1.71, 0, 0.4], "#52637a"),
    validationCube("validation-sofa-arm-right", "沙发右扶手白模", [0.38, 1.2, 0.78], [1.71, 0, 0.4], "#52637a"),
    validationCube("validation-coffee-table", "茶几白模", [2.2, 1, 0.12], [0, -1.55, 0.48], "#6b7280"),
  ].map((sceneObject) => [sceneObject.sceneObjectId, sceneObject]));
  const camera = createInitialCameras()["camera-main"];
  const cameras = {
    "camera-main": {
      ...camera,
      label: "室内沙发全景",
      transform: { ...camera.transform, position: [0, -8.4, 3.1] as [number, number, number], rotationDeg: [78, 0, 0] as [number, number, number] },
      fovDeg: 62,
      focalLengthMm: 30,
      compositionPresetId: "wide" as const,
      subjectTargetIds: [CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID, "validation-sofa-seat"],
      lookAt: { targetType: "scene_object" as const, targetId: "validation-sofa-seat" },
      framingGuides: { ruleOfThirds: true, centerCross: false, safeArea: true },
    },
  };
  return {
    characters,
    actorMappings: createInitialActorMappingsForCharacters(characters),
    actorPaths: createInitialActorPaths(characters),
    sceneObjects,
    cameras,
    cameraPaths: {},
    cameraSnapshots: [],
    dialogueTimeline: { ...createInitialDialogueTimeline(), durationSeconds: 6 },
    pathEvents: [],
    selectedCharacterId: CHARACTER_B_ID,
    selectedCharacterIds: [CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID],
    selectedSceneObjectId: null,
    selectedCameraId: "camera-main",
    viewMode: "camera" as const,
  };
}

function createInitialActorMappingsForCharacters(characters: Record<string, CharacterAuthoringState>): Record<string, ActorMappingState> {
  return Object.fromEntries(Object.values(characters).map((character) => [character.actorMappingId, {
    actorMappingId: character.actorMappingId,
    characterId: character.characterId,
    subjectId: null,
    referenceSetId: null,
    proxyAssetId: null,
    appearanceRole: "unassigned" as const,
  }]));
}

function fightValidationScene() {
  const baseCharacters = createInitialCharacters();
  const characters = {
    [CHARACTER_A_ID]: validationCharacter(baseCharacters[CHARACTER_A_ID], [-1.25, 0, 0], "action.guard"),
    [CHARACTER_B_ID]: validationCharacter(baseCharacters[CHARACTER_B_ID], [1.25, 0, 0], "action.guard"),
    [CHARACTER_C_ID]: validationCharacter(initialCharacter(CHARACTER_C_ID, 4.5), [4.5, 2, 0], "pose.neutral", false),
  };
  const sceneObjects = Object.fromEntries([
    validationCube("validation-fight-floor", "武打场地地面", [10, 7, 0.1], [0, 0, -0.05], "#1f2937"),
    validationCube("validation-fight-backdrop", "武打场地背景墙", [10, 0.12, 4], [0, 3, 0], "#334155"),
    validationCube("validation-fight-mat", "动作参考垫", [5.5, 3.2, 0.12], [0, 0, 0.02], "#475569"),
    validationCube("validation-fight-marker", "接触定位标记", [0.35, 0.35, 0.04], [0, -0.02, 0.14], "#34d399"),
  ].map((sceneObject) => [sceneObject.sceneObjectId, sceneObject]));
  const baseCamera = createInitialCameras()["camera-main"];
  const cameras = {
    "camera-main": {
      ...baseCamera,
      label: "武打参考主机位",
      transform: { ...baseCamera.transform, position: [0, -9, 3.2] as [number, number, number], rotationDeg: [78, 0, 0] as [number, number, number] },
      fovDeg: 58,
      focalLengthMm: 32,
      compositionPresetId: "wide" as const,
      subjectTargetIds: [CHARACTER_A_ID, CHARACTER_B_ID],
      lookAt: { targetType: "scene_object" as const, targetId: "validation-fight-mat" },
      framingGuides: { ruleOfThirds: true, centerCross: true, safeArea: true },
    },
  };
  const tracks = [
    poseKeyframes("validation-fight-pose-a", CHARACTER_A_ID, [
      { timeSeconds: 0, presetId: "action.guard" },
      { timeSeconds: 2.8, presetId: "action.throw" },
      { timeSeconds: 5.2, presetId: "interaction.push" },
      { timeSeconds: 8.1, presetId: "action.guard" },
      { timeSeconds: 11.4, presetId: "action.kick" },
      { timeSeconds: 15, presetId: "action.guard" },
    ]),
    poseKeyframes("validation-fight-pose-b", CHARACTER_B_ID, [
      { timeSeconds: 0, presetId: "action.guard" },
      { timeSeconds: 2.8, presetId: "action.guard" },
      { timeSeconds: 5.2, presetId: "action.throw" },
      { timeSeconds: 8.1, presetId: "action.kick" },
      { timeSeconds: 11.4, presetId: "interaction.push" },
      { timeSeconds: 15, presetId: "action.guard" },
    ]),
    transformKeyframes("validation-fight-transform-a", CHARACTER_A_ID, [
      { timeSeconds: 0, position: [-1.25, 0, 0] },
      { timeSeconds: 5.2, position: [-0.45, 0, 0] },
      { timeSeconds: 9.4, position: [-1.05, 0, 0] },
      { timeSeconds: 15, position: [-0.8, 0.1, 0] },
    ]),
    transformKeyframes("validation-fight-transform-b", CHARACTER_B_ID, [
      { timeSeconds: 0, position: [1.25, 0, 0] },
      { timeSeconds: 5.2, position: [0.45, 0, 0] },
      { timeSeconds: 9.4, position: [1.1, 0, 0] },
      { timeSeconds: 15, position: [0.8, 0.1, 0] },
    ]),
  ];
  const timeline = {
    ...createInitialDialogueTimeline(),
    durationSeconds: 15,
    tracks,
  };
  const actorPath = createInitialActorPaths(characters);
  Object.values(actorPath).forEach((path) => { path.durationSeconds = 15; });
  return {
    characters,
    actorMappings: createInitialActorMappingsForCharacters(characters),
    actorPaths: actorPath,
    sceneObjects,
    cameras,
    cameraPaths: {},
    cameraSnapshots: [],
    dialogueTimeline: timeline,
    pathEvents: [{
      pathEventId: "validation-fight-contact-01",
      pathId: `path-${CHARACTER_A_ID}`,
      actorId: CHARACTER_A_ID,
      eventType: "contact" as const,
      obstacleObjectId: "validation-fight-marker",
      startSeconds: 5.05,
      endSeconds: 5.35,
      pathParameter: 0.35,
      spatialAnchorM: [0, -0.02, 0.35] as [number, number, number],
      requiredJointIds: ["wrist_r", "spine_chest"],
      requiredContacts: [{ jointId: "wrist_r", targetObjectId: "validation-fight-marker", contactMode: "touch" as const }],
      releasePolicy: "at_event_end" as const,
      previewMarker: { label: "接触检查", color: "#34d399" },
      exportMarker: true,
      limitations: ["验证标记不等于 IK、碰撞或物理求解。"],
    }],
    selectedCharacterId: CHARACTER_A_ID,
    selectedCharacterIds: [CHARACTER_A_ID, CHARACTER_B_ID],
    selectedSceneObjectId: null,
    selectedCameraId: "camera-main",
    viewMode: "camera" as const,
  };
}

function clampRotation(joint: JointDefinition, axis: Axis, value: number): number {
  const limits = joint.rotation_limits_deg[axis];
  if (!joint.supported_axes.includes(axis) || !limits) return 0;
  return Math.min(limits[1], Math.max(limits[0], value));
}

function finiteBounded(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}

function timelineTargetExists(state: WorkbenchState, targetType: TimelineTargetType, targetId: string): boolean {
  if (targetType === "timeline") return targetId === state.dialogueTimeline.timelineId;
  if (targetType === "character") return Boolean(state.characters[targetId]);
  if (targetType === "camera") return Boolean(state.cameras[targetId]);
  if (targetType === "scene_object") return Boolean(state.sceneObjects[targetId]);
  return Boolean(state.actorPaths[targetId] || state.cameraPaths[targetId]);
}

function timelineTrackTargetAllowed(state: WorkbenchState, trackKind: TimelineTrackKind, targetType: TimelineTargetType, targetId: string): boolean {
  if (!timelineTargetExists(state, targetType, targetId)) return false;
  if (trackKind === "active_camera") return targetType === "timeline" && targetId === state.dialogueTimeline.timelineId;
  if (trackKind === "actor_path_progress") return targetType === "path" && Boolean(state.actorPaths[targetId]);
  if (trackKind === "camera_path_progress") return targetType === "path" && Boolean(state.cameraPaths[targetId]);
  if (trackKind === "object_visibility") return targetType === "scene_object";
  if (trackKind.startsWith("camera_")) return targetType === "camera";
  return targetType === "character";
}

function timelineTargetLocked(state: WorkbenchState, track: TimelineTrackState): boolean {
  if (track.target.targetType === "character") return Boolean(state.characters[track.target.targetId]?.locked);
  if (track.target.targetType === "camera") return Boolean(state.cameras[track.target.targetId]?.locked);
  if (track.target.targetType === "scene_object") return Boolean(state.sceneObjects[track.target.targetId]?.locked);
  if (track.target.targetType === "path") return Boolean(state.actorPaths[track.target.targetId]?.locked || state.cameraPaths[track.target.targetId]?.locked);
  return false;
}

function minimumTimelineDuration(state: WorkbenchState): number {
  const timedEnds = [
    ...state.dialogueTimeline.dialogueBeats.map((item) => item.endSeconds),
    ...state.dialogueTimeline.focusTracks.map((item) => item.endSeconds),
    ...state.dialogueTimeline.interactionAnchors.map((item) => item.endSeconds),
    ...state.dialogueTimeline.cameraNoiseTracks.map((item) => item.endSeconds),
    ...state.pathEvents.map((item) => item.endSeconds),
    ...Object.values(state.actorPaths).map((item) => item.durationSeconds),
    ...Object.values(state.cameraPaths).map((item) => item.durationSeconds),
    ...state.dialogueTimeline.tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.timeSeconds)),
  ];
  return Math.max(0.05, ...timedEnds);
}

function orderedKeyframes(keyframes: TimelineKeyframeState[]): TimelineKeyframeState[] {
  return [...keyframes].sort((left, right) => left.timeSeconds - right.timeSeconds || left.keyframeId.localeCompare(right.keyframeId));
}

function timelineKeyframeValueAllowed(state: WorkbenchState, track: TimelineTrackState, value: unknown): boolean {
  if (track.trackKind === "active_camera") return typeof value === "string" && Boolean(state.cameras[value]);
  if (track.trackKind === "camera_fov") return typeof value === "number" && Number.isFinite(value) && value >= 10 && value <= 140;
  if (track.trackKind === "actor_path_progress" || track.trackKind === "camera_path_progress") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (track.trackKind === "object_visibility") return typeof value === "boolean";
  if (track.trackKind === "camera_target") {
    if (value === null) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const target = value as Record<string, unknown>;
    if (target.target_type === "character") return typeof target.target_id === "string" && Boolean(state.characters[target.target_id]);
    if (target.target_type === "scene_object") return typeof target.target_id === "string" && Boolean(state.sceneObjects[target.target_id]);
    return target.target_type === "world_point" && typeof target.target_id === "string" && target.target_id.startsWith("world-point-");
  }
  return true;
}

function boundTransformValues(
  field: "position" | "rotationDeg" | "scale",
  values: [number, number, number],
): [number, number, number] {
  const bounds = field === "scale" ? [0.1, 5] : field === "rotationDeg" ? [-360, 360] : [-30, 30];
  return values.map((value) => finiteBounded(value, bounds[0], bounds[1])) as [number, number, number];
}

function constrainPosition(
  state: WorkbenchState,
  character: CharacterAuthoringState,
  values: [number, number, number],
  applyGridSnap: boolean,
): [number, number, number] {
  const next = boundTransformValues("position", values);
  if (applyGridSnap && state.renderScene.ground.gridSnap) {
    const step = state.renderScene.ground.gridSpacingM;
    next[0] = Math.round(next[0] / step) * step;
    next[1] = Math.round(next[1] / step) * step;
  }
  if (character.transform.groundSnap) next[2] = state.renderScene.ground.heightM;
  return next;
}

function constrainSceneObjectPosition(
  state: WorkbenchState,
  sceneObject: SceneObjectAuthoringState,
  values: [number, number, number],
): [number, number, number] {
  const next = boundTransformValues("position", values);
  if (sceneObject.transform.groundSnap) next[2] = state.renderScene.ground.heightM;
  return next;
}

export interface WorkbenchState {
  characters: Record<string, CharacterAuthoringState>;
  actorMappings: Record<string, ActorMappingState>;
  dialogueTimeline: DialogueTimelineState;
  localAnimationImport: LocalAnimationImportState;
  frameManifestImport: FrameManifestImportState;
  dialogueReferenceInputs: DialogueReferenceInputState[];
  cameras: Record<string, CameraCompositionState>;
  selectedCameraId: string;
  cameraSnapshots: CameraSnapshotState[];
  actorPaths: Record<string, ActorPathState>;
  cameraPaths: Record<string, CameraPathState>;
  externalCameraMotionProposals: ExternalCameraMotionProposalState[];
  selectedActorPathControlPointId: string | null;
  selectedActorPathVectorField: ActorPathVectorField;
  actorPathDragSnapshot: AuthoringSnapshot | null;
  actorPathDragTarget: ActorPathDragTarget | null;
  selectedCameraPathControlPointId: string | null;
  selectedCameraPathVectorField: ActorPathVectorField;
  cameraPathDragSnapshot: AuthoringSnapshot | null;
  cameraPathDragTarget: CameraPathDragTarget | null;
  cameraPathDragUnsavedChanges: boolean | null;
  pathEvents: PathEventState[];
  pathEventDiagnostic: string | null;
  sceneObjects: Record<string, SceneObjectAuthoringState>;
  subjectReferenceSets: Record<string, SubjectReferenceSetState>;
  subjectProxies: Record<string, SubjectProxyAssetState>;
  subjectImportOpen: boolean;
  selectedCharacterId: string;
  selectedCharacterIds: string[];
  selectedSceneObjectId: string | null;
  sceneFilter: string;
  sceneTypeFilter: "all" | "character" | "camera" | "object" | "environment";
  objectAssetCatalog: ObjectAssetCatalogState;
  environmentInputCatalog: EnvironmentInputCatalogState;
  panoramaPreviewStatus: { state: "idle" | "loading" | "ready" | "error"; message: string };
  panoramaDiagnosticPreviewInputId: string | null;
  panoramaDiagnosticPreviewYawDeg: number;
  panoramaDiagnosticPreviewFlipVertical: boolean;
  renderScene: RenderSceneState;
  selectedJointId: string;
  jointFilter: string;
  viewMode: ViewMode;
  viewportNavigation: ViewportNavigationByView;
  orientationGizmo: OrientationGizmoState;
  transformMode: TransformMode;
  transformDragging: boolean;
  transformDragSnapshot: AuthoringSnapshot | null;
  transformDragCharacterId: string | null;
  fullscreenActive: boolean;
  playheadFrame: number;
  commandHistory: string[];
  undoStack: AuthoringSnapshot[];
  redoStack: AuthoringSnapshot[];
  unsavedChanges: boolean;
  markExplicitlySaved: () => void;
  showJointHandles: boolean;
  showInternalBones: boolean;
  rigAdmissionStatus: "pending" | "passed" | "failed";
  rigAdmissionIssues: RigAdmissionIssue[];
  selectCharacter: (characterId: string, additive?: boolean) => void;
  selectSceneObject: (sceneObjectId: string) => void;
  setSceneFilter: (value: string) => void;
  setSceneTypeFilter: (value: "all" | "character" | "camera" | "object" | "environment") => void;
  renameCharacter: (characterId: string, label: string) => void;
  toggleCharacterVisible: (characterId: string) => void;
  toggleCharacterLocked: (characterId: string) => void;
  addPrimitive: (kind: PrimitiveKind) => void;
  addEmptyObject: () => void;
  renameSceneObject: (sceneObjectId: string, label: string) => void;
  toggleSceneObjectVisible: (sceneObjectId: string) => void;
  toggleSceneObjectLocked: (sceneObjectId: string) => void;
  removeSceneObject: (sceneObjectId: string) => void;
  setSceneObjectTransformAxis: (sceneObjectId: string, field: "position" | "rotationDeg" | "scale", axis: number, value: number) => void;
  setSceneObjectDimensionAxis: (sceneObjectId: string, axis: number, value: number) => void;
  setSceneObjectPivotAxis: (sceneObjectId: string, axis: number, value: number) => void;
  toggleSceneObjectGroundSnap: (sceneObjectId: string) => void;
  setObjectAssetCatalog: (catalog: ObjectAssetCatalogState) => void;
  insertAdmittedObjectAsset: (assetId: string) => void;
  setEnvironmentInputCatalog: (catalog: EnvironmentInputCatalogState) => void;
  setPanoramaPreviewStatus: (status: { state: "idle" | "loading" | "ready" | "error"; message: string }) => void;
  previewPanoramaDiagnostic: (inputId: string | null) => void;
  setPanoramaDiagnosticPreviewYawDeg: (yawDeg: number) => void;
  togglePanoramaDiagnosticPreviewFlipVertical: () => void;
  resetPanoramaDiagnosticPreviewDirection: () => void;
  setSkyColor: (color: string) => void;
  assignPanoramaInput: (inputId: string | null) => void;
  updatePanoramaCalibration: (calibrationId: string, update: (current: EquirectangularPanoramaCalibrationState) => EquirectangularPanoramaCalibrationState) => void;
  confirmPanoramaCalibration: (calibrationId: string) => void;
  insertReferenceInput: (inputId: string) => void;
  createScenePlateCalibration: (inputId: string) => void;
  updateScenePlateCalibration: (calibrationId: string, update: (current: PerspectiveScenePlateCalibrationState) => PerspectiveScenePlateCalibrationState) => void;
  attachScenePlateSupportLayer: (calibrationId: string, inputId: string) => void;
  updateDepthSurfaceRange: (calibrationId: string, layerId: string, nearM: number, farM: number) => void;
  confirmScenePlateSupportLayer: (calibrationId: string, layerId: string) => void;
  updateScenePlateCompositing: (calibrationId: string, update: (current: ScenePlateCompositingState) => ScenePlateCompositingState) => void;
  confirmScenePlateCalibration: (calibrationId: string) => void;
  placeSelectedTargetOnScenePlate: (calibrationId: string, screenAnchor: [number, number], depthInputId?: string | null) => void;
  setSubjectImportOpen: (open: boolean) => void;
  registerSubjectReferenceSet: (referenceSet: SubjectReferenceSetState) => void;
  registerSubjectProxy: (referenceSet: SubjectReferenceSetState, proxy: SubjectProxyAssetState) => void;
  bindActorToSubjectProxy: (characterId: string, proxyAssetId: string | null, appearanceRole?: ActorMappingState["appearanceRole"]) => void;
  setDialogueReferenceInputs: (inputs: DialogueReferenceInputState[]) => void;
  upsertDialogueBeat: (beat: { dialogueBeatId?: string; characterId: string; text: string; startSeconds: number; endSeconds: number; deliveryHint?: string | null; audioInputId?: string | null }) => void;
  removeDialogueBeat: (dialogueBeatId: string) => void;
  upsertFocusTrack: (track: { focusTrackId?: string; cameraId: string; startSeconds: number; endSeconds: number; fromTarget: FocusTargetState; toTarget: FocusTargetState; transition: FocusTrackState["transition"]; narrativeIntent?: string | null }) => void;
  removeFocusTrack: (focusTrackId: string) => void;
  upsertInteractionAnchor: (anchor: { interactionAnchorId?: string; characterId: string; jointId: string; contactTarget: FocusTargetState; contactMode: InteractionAnchorState["contactMode"]; startSeconds: number; endSeconds: number; offsetM: [number, number, number]; releasePolicy: InteractionAnchorState["releasePolicy"] }) => void;
  removeInteractionAnchor: (interactionAnchorId: string) => void;
  upsertCameraNoiseTrack: (track: Omit<CameraNoiseTrackState, "cameraNoiseTrackId" | "compositionMode"> & { cameraNoiseTrackId?: string }) => void;
  removeCameraNoiseTrack: (cameraNoiseTrackId: string) => void;
  setTimelineDuration: (durationSeconds: number) => void;
  setTimelineFps: (fps: number) => void;
  setLocalAnimationImportState: (state: LocalAnimationImportState) => void;
  clearLocalAnimationImport: () => void;
  applyLocalAnimationManifest: () => void;
  setFrameManifestImportState: (state: FrameManifestImportState) => void;
  clearFrameManifestImport: () => void;
  applyActionStructure: (request: { actionId: string; characterId: string; opponentId: string | null; startSeconds: number; durationSeconds: number; includeContact: boolean }) => void;
  addTimelineTrack: (track: { trackKind: TimelineTrackKind; targetType: TimelineTargetType; targetId: string; propertyKey: string }) => void;
  removeTimelineTrack: (trackId: string) => void;
  upsertTimelineKeyframe: (trackId: string, keyframe: { keyframeId?: string; timeSeconds: number; value: unknown; interpolation: TimelineInterpolation }) => void;
  moveTimelineKeyframe: (trackId: string, keyframeId: string, timeSeconds: number) => void;
  copyTimelineKeyframe: (trackId: string, keyframeId: string, timeSeconds: number) => void;
  removeTimelineKeyframe: (trackId: string, keyframeId: string) => void;
  setActiveCameraTrack: (trackId: string | null) => void;
  applyCameraCompositionPreset: (cameraId: string, presetId: CameraCompositionPresetId, subjectTargetIds?: string[]) => void;
  setCameraAspectRatio: (cameraId: string, aspectRatio: CameraAspectRatio) => void;
  toggleCameraFramingGuide: (cameraId: string, guide: keyof CameraCompositionState["framingGuides"]) => void;
  createCameraSnapshot: (cameraId: string, label?: string) => void;
  selectCamera: (cameraId: string, openCameraView?: boolean) => void;
  addCameraFromCurrentView: (label?: string) => void;
  renameCamera: (cameraId: string, label: string) => void;
  toggleCameraVisible: (cameraId: string) => void;
  toggleCameraLocked: (cameraId: string) => void;
  setCameraTransformAxis: (cameraId: string, field: "position" | "rotationDeg", axis: number, value: number) => void;
  setCameraFov: (cameraId: string, fovDeg: number) => void;
  setCameraZoom: (cameraId: string, zoom: number) => void;
  setCameraLookAt: (cameraId: string, target: CameraTargetState | null) => void;
  setCameraFollow: (cameraId: string, target: CameraTargetState | null) => void;
  applyCameraPathPreset: (cameraId: string, presetId: CameraPathPresetId, mode: CameraPathApplyMode, segmentDurationSeconds: number, easing: ActorPathEasing) => void;
  importExternalCameraMotionProposal: (manifest: unknown, targetCameraId: string, options?: { audioInputId?: string | null; audioChecksum?: string | null; timelineStartSeconds?: number; audioOffsetSeconds?: number; smoothingWindow?: number; scaleMultiplier?: number; originM?: [number, number, number]; rotationOffsetDeg?: [number, number, number]; confidence?: number; limitations?: string[] }) => void;
  setExternalCameraMotionReviewState: (proposalId: string, reviewState: "approved" | "rejected") => void;
  applyExternalCameraMotionProposal: (proposalId: string, sourceChecksum: string, audioChecksum?: string | null) => void;
  selectCameraPathControlPoint: (controlPointId: string | null, field?: ActorPathVectorField) => void;
  setCameraPathDuration: (pathId: string, durationSeconds: number) => void;
  setCameraPathEasing: (pathId: string, easing: ActorPathEasing) => void;
  setCameraPathControlPointVector: (pathId: string, controlPointId: string, field: ActorPathVectorField, axis: number, value: number) => void;
  beginCameraPathControlDrag: (pathId: string, controlPointId: string, field: ActorPathVectorField) => void;
  previewCameraPathControlVector: (pathId: string, controlPointId: string, field: ActorPathVectorField, values: [number, number, number]) => void;
  commitCameraPathControlDrag: () => void;
  cancelCameraPathControlDrag: () => void;
  appendCameraPathControlPoint: (pathId: string) => void;
  removeCameraPathControlPoint: (pathId: string, controlPointId: string) => void;
  reverseCameraPath: (pathId: string) => void;
  selectActorPathControlPoint: (controlPointId: string | null, field?: ActorPathVectorField) => void;
  setActorPathDuration: (pathId: string, durationSeconds: number) => void;
  setActorPathEasing: (pathId: string, easing: ActorPathEasing) => void;
  setActorPathControlPointVector: (pathId: string, controlPointId: string, field: "positionM" | "handleInM" | "handleOutM", axis: number, value: number) => void;
  beginActorPathControlDrag: (pathId: string, controlPointId: string, field: ActorPathVectorField) => void;
  previewActorPathControlVector: (pathId: string, controlPointId: string, field: ActorPathVectorField, values: [number, number, number]) => void;
  commitActorPathControlDrag: () => void;
  cancelActorPathControlDrag: () => void;
  appendActorPathControlPoint: (pathId: string) => void;
  removeActorPathControlPoint: (pathId: string, controlPointId: string) => void;
  reverseActorPath: (pathId: string) => void;
  upsertPathEvent: (event: { pathEventId?: string; pathId: string; actorId: string; eventType: PathEventType; obstacleObjectId: string | null; startSeconds: number; endSeconds: number; pathParameter: number | null; spatialAnchorM: [number, number, number]; requiredJointIds: string[]; requiredContacts: PathEventState["requiredContacts"]; releasePolicy: PathEventState["releasePolicy"]; previewLabel?: string; exportMarker: boolean }) => void;
  removePathEvent: (pathEventId: string) => void;
  insertApprovedSubjectProxy: (proxyAssetId: string) => void;
  applySubjectProxyReplacement: (replacedProxyAssetId: string, proxyAssetId: string) => void;
  loadSceneObjects: (sceneObjects: Record<string, SceneObjectAuthoringState>) => void;
  applyValidationScenePreset: (presetId: DirectorValidationPresetId) => void;
  toggleGroundVisible: () => void;
  toggleGroundLocked: () => void;
  setGroundHeightM: (heightM: number) => void;
  setGroundOpacity: (opacity: number) => void;
  setGroundGridSpacingM: (gridSpacingM: number) => void;
  toggleGroundGridSnap: () => void;
  toggleGroundSurfaceSnap: () => void;
  setSceneRootTransformAxis: (field: "position" | "rotationDeg" | "scale", axis: number, value: number) => void;
  resetSceneRootTransform: () => void;
  setPanoramaRotationAxis: (axis: number, value: number) => void;
  setPanoramaRadiusM: (radiusM: number) => void;
  setPanoramaExposure: (exposure: number) => void;
  addEnvironmentLabel: (label: string) => void;
  removeEnvironmentLabel: (label: string) => void;
  loadRenderScene: (renderScene: RenderSceneState) => void;
  undo: () => void;
  redo: () => void;
  selectJoint: (jointId: string) => void;
  setJointFilter: (value: string) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setViewportNavigation: (viewMode: ViewMode, navigation: ViewportNavigation) => void;
  setOrientationGizmo: (orientationGizmo: OrientationGizmoState) => void;
  setTransformMode: (transformMode: TransformMode) => void;
  setTransformDragging: (transformDragging: boolean) => void;
  beginTransformDrag: (characterId: string) => void;
  previewTransformVector: (characterId: string, field: "position" | "rotationDeg" | "scale", values: [number, number, number]) => void;
  commitTransformDrag: (characterId: string, mode: TransformMode) => void;
  cancelTransformDrag: () => void;
  setFullscreenActive: (fullscreenActive: boolean) => void;
  setPlayheadFrame: (playheadFrame: number) => void;
  toggleJointHandles: () => void;
  toggleInternalBones: () => void;
  setRigAdmissionIssues: (issues: RigAdmissionIssue[]) => void;
  setTransformVector: (characterId: string, field: "position" | "rotationDeg" | "scale", values: [number, number, number]) => void;
  setTransformAxis: (characterId: string, field: "position" | "rotationDeg" | "scale", axis: number, value: number) => void;
  toggleGroundSnap: (characterId: string) => void;
  applyPosePreset: (characterId: string, presetId: PosePresetId) => void;
  setPoseRootOffsetAxis: (characterId: string, axis: number, value: number) => void;
  mirrorPose: (characterId: string) => void;
  setJointRotation: (characterId: string, jointId: string, axis: Axis, value: number) => void;
  resetJoint: (characterId: string, jointId: string) => void;
  resetPose: (characterId: string) => void;
}

function updateCharacter(
  state: WorkbenchState,
  characterId: string,
  update: (character: CharacterAuthoringState) => CharacterAuthoringState,
): Partial<WorkbenchState> | WorkbenchState {
  const character = state.characters[characterId];
  if (!character) return state;
  const nextCharacter = update(character);
  if (nextCharacter === character) return state;
  return { characters: { ...state.characters, [characterId]: nextCharacter } };
}

function mutateCharacter(
  state: WorkbenchState,
  characterId: string,
  command: string,
  update: (character: CharacterAuthoringState) => CharacterAuthoringState,
): Partial<WorkbenchState> | WorkbenchState {
  if (state.characters[characterId]?.locked) return state;
  const result = updateCharacter(state, characterId, update);
  if (result === state) return state;
  const nextCharacters = result.characters;
  if (!nextCharacters || nextCharacters[characterId] === state.characters[characterId]) return state;
  return {
    ...result,
    unsavedChanges: true,
    commandHistory: [...state.commandHistory, command].slice(-100),
    undoStack: [...state.undoStack, snapshotAuthoring(state)].slice(-100),
    redoStack: [],
  };
}

function mutateSceneObject(
  state: WorkbenchState,
  sceneObjectId: string,
  command: string,
  update: (sceneObject: SceneObjectAuthoringState) => SceneObjectAuthoringState,
): Partial<WorkbenchState> | WorkbenchState {
  const sceneObject = state.sceneObjects[sceneObjectId];
  if (!sceneObject || sceneObject.locked) return state;
  const nextSceneObject = update(sceneObject);
  if (nextSceneObject === sceneObject) return state;
  return mutateScene(state, command, {
    sceneObjects: { ...state.sceneObjects, [sceneObjectId]: { ...nextSceneObject, revision: sceneObject.revision + 1 } },
  });
}

function snapshotAuthoring(state: WorkbenchState): AuthoringSnapshot {
  return {
    characters: state.characters,
    actorMappings: state.actorMappings,
    sceneObjects: state.sceneObjects,
    renderScene: state.renderScene,
    dialogueTimeline: state.dialogueTimeline,
    cameras: state.cameras,
    actorPaths: state.actorPaths,
    cameraPaths: state.cameraPaths,
    externalCameraMotionProposals: state.externalCameraMotionProposals,
    pathEvents: state.pathEvents,
  };
}

function mutateActorPath(
  state: WorkbenchState,
  pathId: string,
  command: string,
  update: (path: ActorPathState) => ActorPathState,
): Partial<WorkbenchState> | WorkbenchState {
  const path = state.actorPaths[pathId];
  const character = path && state.characters[path.targetId];
  if (!path || path.locked || !character || character.locked) return state;
  const nextPath = update(path);
  if (nextPath === path) return state;
  return mutateScene(state, command, {
    actorPaths: { ...state.actorPaths, [pathId]: { ...nextPath, revision: path.revision + 1 } },
    dialogueTimeline: nextPath.durationSeconds > state.dialogueTimeline.durationSeconds ? { ...state.dialogueTimeline, durationSeconds: nextPath.durationSeconds } : state.dialogueTimeline,
  });
}

function mutateCameraPath(
  state: WorkbenchState,
  pathId: string,
  command: string,
  update: (path: CameraPathState) => CameraPathState,
): Partial<WorkbenchState> | WorkbenchState {
  const path = state.cameraPaths[pathId];
  const camera = path && path.targetType === "camera" ? state.cameras[path.targetId] : null;
  if (!path || path.targetType !== "camera" || path.locked || !camera || camera.locked) return state;
  const nextPath = update(path);
  if (nextPath === path || nextPath.targetType !== "camera" || nextPath.targetId !== path.targetId) return state;
  return mutateScene(state, command, {
    cameraPaths: { ...state.cameraPaths, [pathId]: { ...nextPath, revision: path.revision + 1 } },
    dialogueTimeline: nextPath.durationSeconds > state.dialogueTimeline.durationSeconds ? { ...state.dialogueTimeline, durationSeconds: nextPath.durationSeconds } : state.dialogueTimeline,
  });
}

function preserveImmutableSnapshotLinks(cameras: Record<string, CameraCompositionState>, snapshots: CameraSnapshotState[]): Record<string, CameraCompositionState> {
  return Object.fromEntries(Object.entries(cameras).map(([cameraId, camera]) => [cameraId, { ...camera, snapshotIds: snapshots.filter((snapshot) => snapshot.cameraId === cameraId).sort((left, right) => left.order - right.order).map((snapshot) => snapshot.snapshotId) }]));
}

function mutateScene(state: WorkbenchState, command: string, changes: Partial<AuthoringSnapshot>): Partial<WorkbenchState> {
  return {
    ...changes,
    unsavedChanges: true,
    commandHistory: [...state.commandHistory, command].slice(-100),
    undoStack: [...state.undoStack, snapshotAuthoring(state)].slice(-100),
    redoStack: [],
  };
}

function reviseScenePlateCalibration(
  state: WorkbenchState,
  calibrationId: string,
  command: string,
  update: (current: PerspectiveScenePlateCalibrationState, nextRevision: number) => PerspectiveScenePlateCalibrationState,
): Partial<WorkbenchState> | WorkbenchState {
  const current = state.renderScene.scenePlateCalibrations.find((calibration) => calibration.calibrationId === calibrationId);
  if (!current) return state;
  const nextRevision = current.revision + 1;
  const updated = update(structuredClone(current), nextRevision);
  const evaluated = evaluateScenePlateCalibration({
    ...updated,
    calibrationId: current.calibrationId,
    sourceInputId: current.sourceInputId,
    revision: nextRevision,
    confirmed: false,
    supportLayers: updated.supportLayers.map((layer) => ({ ...layer, confirmed: layer.confirmed && layer.calibrationRevision === nextRevision })),
  });
  const markPlacement = <T extends { calibratedPlacement: CalibratedPlacementState | null }>(target: T): T => target.calibratedPlacement?.calibrationId === calibrationId ? { ...target, calibratedPlacement: { ...target.calibratedPlacement, reviewRequired: true } } : target;
  return mutateScene(state, command, {
    characters: Object.fromEntries(Object.entries(state.characters).map(([id, character]) => [id, markPlacement(character)])),
    sceneObjects: Object.fromEntries(Object.entries(state.sceneObjects).map(([id, sceneObject]) => [id, markPlacement(sceneObject)])),
    renderScene: {
      ...state.renderScene,
      scenePlateCalibrations: state.renderScene.scenePlateCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? evaluated : calibration),
      calibrationRevisionIds: state.renderScene.calibrationRevisionIds.filter((id) => !id.startsWith(`${calibrationId}@`)),
      ground: { ...state.renderScene.ground, surfaceSnap: false },
    },
  });
}

function revisePanoramaCalibration(
  state: WorkbenchState,
  calibrationId: string,
  command: string,
  update: (current: EquirectangularPanoramaCalibrationState) => EquirectangularPanoramaCalibrationState,
): Partial<WorkbenchState> | WorkbenchState {
  const current = state.renderScene.panoramaCalibrations.find((calibration) => calibration.calibrationId === calibrationId);
  if (!current) return state;
  const evaluated = evaluatePanoramaCalibration({
    ...update(structuredClone(current)),
    calibrationId: current.calibrationId,
    sourceInputId: current.sourceInputId,
    revision: current.revision + 1,
    confirmed: false,
  });
  const active = state.renderScene.activePanoramaCalibrationId === calibrationId;
  return mutateScene(state, command, {
    renderScene: {
      ...state.renderScene,
      panoramaCalibrations: state.renderScene.panoramaCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? evaluated : calibration),
      calibrationRevisionIds: state.renderScene.calibrationRevisionIds.filter((id) => !id.startsWith(`${calibrationId}@`)),
      panorama: active ? {
        inputId: evaluated.sourceInputId,
        rotationDeg: panoramaRotationTuple(evaluated),
        radiusM: evaluated.radiusM,
        exposure: evaluated.exposure,
      } : state.renderScene.panorama,
    },
  });
}

const initialCharacters = createInitialCharacters();

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  characters: initialCharacters,
  actorMappings: createInitialActorMappings(),
  dialogueTimeline: createInitialDialogueTimeline(),
  localAnimationImport: createIdleLocalAnimationImportState(),
  frameManifestImport: createIdleFrameManifestImportState(),
  dialogueReferenceInputs: [],
  cameras: createInitialCameras(),
  selectedCameraId: "camera-main",
  cameraSnapshots: [],
  actorPaths: createInitialActorPaths(initialCharacters),
  cameraPaths: {},
  externalCameraMotionProposals: [],
  selectedActorPathControlPointId: null,
  selectedActorPathVectorField: "positionM",
  actorPathDragSnapshot: null,
  actorPathDragTarget: null,
  selectedCameraPathControlPointId: null,
  selectedCameraPathVectorField: "positionM",
  cameraPathDragSnapshot: null,
  cameraPathDragTarget: null,
  cameraPathDragUnsavedChanges: null,
  pathEvents: [],
  pathEventDiagnostic: null,
  sceneObjects: createInitialSceneObjects(),
  subjectReferenceSets: {},
  subjectProxies: {},
  subjectImportOpen: false,
  selectedCharacterId: CHARACTER_A_ID,
  selectedCharacterIds: [CHARACTER_A_ID],
  selectedSceneObjectId: null,
  sceneFilter: "",
  sceneTypeFilter: "all",
  objectAssetCatalog: { status: "unavailable", message: "3D 与 Gaussian importer 尚未完成格式准入；当前只开放内置对象。", assets: [] },
  environmentInputCatalog: { status: "loading", message: "正在读取环境素材…", entries: [] },
  panoramaPreviewStatus: { state: "idle", message: "尚未选择球面环境。" },
  panoramaDiagnosticPreviewInputId: null,
  panoramaDiagnosticPreviewYawDeg: 0,
  panoramaDiagnosticPreviewFlipVertical: false,
  renderScene: createInitialRenderSceneState(),
  selectedJointId: "root",
  jointFilter: "",
  viewMode: "director",
  viewportNavigation: structuredClone(DEFAULT_VIEWPORT_NAVIGATION),
  orientationGizmo: { ...DEFAULT_ORIENTATION_GIZMO },
  transformMode: "translate",
  transformDragging: false,
  transformDragSnapshot: null,
  transformDragCharacterId: null,
  fullscreenActive: false,
  playheadFrame: 1,
  commandHistory: [],
  undoStack: [],
  redoStack: [],
  unsavedChanges: false,
  markExplicitlySaved: () => set({ unsavedChanges: false }),
  showJointHandles: true,
  showInternalBones: false,
  rigAdmissionStatus: "pending",
  rigAdmissionIssues: [],
  selectCharacter: (selectedCharacterId, additive = false) => set((state) => {
    if (!state.characters[selectedCharacterId]) return state;
    if (!additive) return { selectedCharacterId, selectedCharacterIds: [selectedCharacterId], selectedSceneObjectId: null, selectedActorPathControlPointId: null, selectedActorPathVectorField: "positionM", selectedCameraPathControlPointId: null, selectedCameraPathVectorField: "positionM" };
    const alreadySelected = state.selectedCharacterIds.includes(selectedCharacterId);
    if (alreadySelected && state.selectedCharacterIds.length === 1) return state;
    const selectedCharacterIds = alreadySelected
      ? state.selectedCharacterIds.filter((id) => id !== selectedCharacterId)
      : [...state.selectedCharacterIds, selectedCharacterId];
    return { selectedCharacterId: selectedCharacterIds.at(-1) ?? selectedCharacterId, selectedCharacterIds, selectedSceneObjectId: null, selectedActorPathControlPointId: null, selectedActorPathVectorField: "positionM", selectedCameraPathControlPointId: null, selectedCameraPathVectorField: "positionM" };
  }),
  selectSceneObject: (selectedSceneObjectId) => set((state) => state.sceneObjects[selectedSceneObjectId]
    ? { selectedSceneObjectId, selectedCharacterIds: [], selectedActorPathControlPointId: null, selectedActorPathVectorField: "positionM", selectedCameraPathControlPointId: null, selectedCameraPathVectorField: "positionM" }
    : state),
  setSceneFilter: (sceneFilter) => set({ sceneFilter: sceneFilter.slice(0, 80) }),
  setSceneTypeFilter: (sceneTypeFilter) => set({ sceneTypeFilter }),
  renameCharacter: (characterId, label) => set((state) => {
    const normalized = label.trim().slice(0, 40);
    const character = state.characters[characterId];
    if (!character || character.locked || !normalized || normalized === character.label) return state;
    return mutateScene(state, `scene.character.${characterId}.rename`, {
      characters: { ...state.characters, [characterId]: { ...character, label: normalized } },
    });
  }),
  toggleCharacterVisible: (characterId) => set((state) => {
    const character = state.characters[characterId];
    if (!character) return state;
    return mutateScene(state, `scene.character.${characterId}.visibility`, {
      characters: { ...state.characters, [characterId]: { ...character, visible: !character.visible } },
    });
  }),
  toggleCharacterLocked: (characterId) => set((state) => {
    const character = state.characters[characterId];
    if (!character) return state;
    return mutateScene(state, `scene.character.${characterId}.lock`, {
      characters: { ...state.characters, [characterId]: { ...character, locked: !character.locked } },
    });
  }),
  addPrimitive: (kind) => set((state) => {
    const sceneObject = createPrimitiveSceneObject(state.sceneObjects, kind, state.renderScene.ground.heightM);
    return {
      ...mutateScene(state, `scene.object.add.primitive.${kind}`, {
        sceneObjects: { ...state.sceneObjects, [sceneObject.sceneObjectId]: sceneObject },
      }),
      selectedSceneObjectId: sceneObject.sceneObjectId,
      selectedCharacterIds: [],
    };
  }),
  addEmptyObject: () => set((state) => {
    const sceneObject = createEmptySceneObject(state.sceneObjects, state.renderScene.ground.heightM);
    return {
      ...mutateScene(state, "scene.object.add.empty", {
        sceneObjects: { ...state.sceneObjects, [sceneObject.sceneObjectId]: sceneObject },
      }),
      selectedSceneObjectId: sceneObject.sceneObjectId,
      selectedCharacterIds: [],
    };
  }),
  renameSceneObject: (sceneObjectId, value) => set((state) => mutateSceneObject(state, sceneObjectId, "scene.object.rename", (sceneObject) => {
    const label = value.trim().slice(0, 80);
    return !label || label === sceneObject.label ? sceneObject : { ...sceneObject, label };
  })),
  toggleSceneObjectVisible: (sceneObjectId) => set((state) => {
    const sceneObject = state.sceneObjects[sceneObjectId];
    if (!sceneObject) return state;
    return mutateScene(state, "scene.object.visibility", {
      sceneObjects: { ...state.sceneObjects, [sceneObjectId]: { ...sceneObject, revision: sceneObject.revision + 1, visible: !sceneObject.visible } },
    });
  }),
  toggleSceneObjectLocked: (sceneObjectId) => set((state) => {
    const sceneObject = state.sceneObjects[sceneObjectId];
    if (!sceneObject) return state;
    return mutateScene(state, "scene.object.lock", {
      sceneObjects: { ...state.sceneObjects, [sceneObjectId]: { ...sceneObject, revision: sceneObject.revision + 1, locked: !sceneObject.locked } },
    });
  }),
  removeSceneObject: (sceneObjectId) => set((state) => {
    const sceneObject = state.sceneObjects[sceneObjectId];
    if (!sceneObject || sceneObject.locked) return state;
    const sceneObjects = { ...state.sceneObjects };
    delete sceneObjects[sceneObjectId];
    return {
      ...mutateScene(state, "scene.object.remove", { sceneObjects }),
      selectedSceneObjectId: state.selectedSceneObjectId === sceneObjectId ? null : state.selectedSceneObjectId,
    };
  }),
  setSceneObjectTransformAxis: (sceneObjectId, field, axis, value) => set((state) => mutateSceneObject(state, sceneObjectId, `scene.object.transform.${field}.${axis}`, (sceneObject) => {
    if (axis < 0 || axis > 2) return sceneObject;
    const values = [...sceneObject.transform[field]] as [number, number, number];
    values[axis] = value;
    const next = field === "position" ? constrainSceneObjectPosition(state, sceneObject, values) : boundTransformValues(field, values);
    return sceneObject.transform[field].every((current, index) => current === next[index])
      ? sceneObject
      : { ...sceneObject, transform: { ...sceneObject.transform, [field]: next } };
  })),
  setSceneObjectDimensionAxis: (sceneObjectId, axis, value) => set((state) => mutateSceneObject(state, sceneObjectId, `scene.object.dimensions.${axis}`, (sceneObject) => {
    if (axis < 0 || axis > 2 || sceneObject.objectKind !== "primitive") return sceneObject;
    const dimensionsM = [...sceneObject.dimensionsM] as [number, number, number];
    dimensionsM[axis] = finiteBounded(value, 0.05, 20);
    if (dimensionsM[axis] === sceneObject.dimensionsM[axis]) return sceneObject;
    return { ...sceneObject, dimensionsM, boundingBoxM: boundsForDimensions(dimensionsM, sceneObject.pivotM) };
  })),
  setSceneObjectPivotAxis: (sceneObjectId, axis, value) => set((state) => mutateSceneObject(state, sceneObjectId, `scene.object.pivot.${axis}`, (sceneObject) => {
    if (axis < 0 || axis > 2 || sceneObject.objectKind !== "primitive") return sceneObject;
    const pivotM = [...sceneObject.pivotM] as [number, number, number];
    pivotM[axis] = finiteBounded(value, -10, 10);
    if (pivotM[axis] === sceneObject.pivotM[axis]) return sceneObject;
    return { ...sceneObject, pivotM, boundingBoxM: boundsForDimensions(sceneObject.dimensionsM, pivotM) };
  })),
  toggleSceneObjectGroundSnap: (sceneObjectId) => set((state) => mutateSceneObject(state, sceneObjectId, "scene.object.ground_snap", (sceneObject) => {
    const groundSnap = !sceneObject.transform.groundSnap;
    const position = [...sceneObject.transform.position] as [number, number, number];
    if (groundSnap) position[2] = state.renderScene.ground.heightM;
    return { ...sceneObject, transform: { ...sceneObject.transform, groundSnap, position } };
  })),
  setObjectAssetCatalog: (objectAssetCatalog) => set({ objectAssetCatalog }),
  insertAdmittedObjectAsset: (assetId) => set((state) => {
    if (state.objectAssetCatalog.status !== "ready") return state;
    const asset = state.objectAssetCatalog.assets.find((item) => item.assetId === assetId);
    if (!asset || asset.browserCapabilityState !== "available") return state;
    const sceneObject = createAdmittedAssetSceneObject(state.sceneObjects, asset, state.renderScene.ground.heightM);
    return {
      ...mutateScene(state, `scene.object.add.${asset.objectKind}`, {
        sceneObjects: { ...state.sceneObjects, [sceneObject.sceneObjectId]: sceneObject },
      }),
      selectedSceneObjectId: sceneObject.sceneObjectId,
      selectedCharacterIds: [],
    };
  }),
  setEnvironmentInputCatalog: (environmentInputCatalog) => set((state) => {
    const panoramaDiagnosticPreviewInputId = state.panoramaDiagnosticPreviewInputId && environmentInputCatalog.entries.some((entry) => entry.inputId === state.panoramaDiagnosticPreviewInputId) ? state.panoramaDiagnosticPreviewInputId : null;
    return {
      environmentInputCatalog,
      panoramaDiagnosticPreviewInputId,
      panoramaDiagnosticPreviewYawDeg: panoramaDiagnosticPreviewInputId ? state.panoramaDiagnosticPreviewYawDeg : 0,
      panoramaDiagnosticPreviewFlipVertical: panoramaDiagnosticPreviewInputId ? state.panoramaDiagnosticPreviewFlipVertical : false,
    };
  }),
  setPanoramaPreviewStatus: (panoramaPreviewStatus) => set({ panoramaPreviewStatus }),
  previewPanoramaDiagnostic: (inputId) => set((state) => {
    if (inputId === null) return state.panoramaDiagnosticPreviewInputId === null ? state : { panoramaDiagnosticPreviewInputId: null, panoramaDiagnosticPreviewYawDeg: 0, panoramaDiagnosticPreviewFlipVertical: false, panoramaPreviewStatus: state.renderScene.panorama.inputId ? { state: "loading", message: "正在恢复正式球面环境纹理…" } : { state: "idle", message: "尚未选择球面环境。" } };
    const input = state.environmentInputCatalog.entries.find((entry) => entry.inputId === inputId);
    if (!input || input.usage !== "panorama" || input.projection !== "equirectangular" || input.environmentAllowed || state.panoramaDiagnosticPreviewInputId === inputId) return state;
    return { panoramaDiagnosticPreviewInputId: inputId, panoramaDiagnosticPreviewYawDeg: 0, panoramaDiagnosticPreviewFlipVertical: false, panoramaPreviewStatus: { state: "loading", message: `正在加载有限球面预览；${input.blockingCodes.join("、") || input.workflowState} 仍阻止正式环境。` } };
  }),
  setPanoramaDiagnosticPreviewYawDeg: (value) => set((state) => state.panoramaDiagnosticPreviewInputId ? { panoramaDiagnosticPreviewYawDeg: finiteBounded(value, -180, 180) } : state),
  togglePanoramaDiagnosticPreviewFlipVertical: () => set((state) => state.panoramaDiagnosticPreviewInputId ? { panoramaDiagnosticPreviewFlipVertical: !state.panoramaDiagnosticPreviewFlipVertical } : state),
  resetPanoramaDiagnosticPreviewDirection: () => set((state) => state.panoramaDiagnosticPreviewInputId && (state.panoramaDiagnosticPreviewYawDeg !== 0 || state.panoramaDiagnosticPreviewFlipVertical) ? { panoramaDiagnosticPreviewYawDeg: 0, panoramaDiagnosticPreviewFlipVertical: false } : state),
  setSkyColor: (value) => set((state) => {
    const skyColor = value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(skyColor) || skyColor === state.renderScene.skyColor) return state;
    return mutateScene(state, "scene.sky.color", { renderScene: { ...state.renderScene, skyColor } });
  }),
  assignPanoramaInput: (inputId) => set((state) => {
    if (inputId === null) {
      if (state.renderScene.panorama.inputId === null) return state;
      return { ...mutateScene(state, "scene.panorama.clear", { renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, inputId: null }, activePanoramaCalibrationId: null } }), panoramaDiagnosticPreviewInputId: null, panoramaDiagnosticPreviewYawDeg: 0, panoramaDiagnosticPreviewFlipVertical: false, panoramaPreviewStatus: { state: "idle", message: "尚未选择球面环境。" } };
    }
    const input = state.environmentInputCatalog.entries.find((entry) => entry.inputId === inputId);
    if (!input || input.projection !== "equirectangular" || !input.environmentAllowed || input.admissionChecksum !== input.checksum || state.renderScene.panorama.inputId === inputId) return state;
    const existing = state.renderScene.panoramaCalibrations.find((calibration) => calibration.sourceInputId === inputId);
    const calibration = existing ?? createManualPanoramaCalibration(inputId, state.renderScene.panoramaCalibrations.length + 1);
    return { ...mutateScene(state, "scene.panorama.assign", { renderScene: {
      ...state.renderScene,
      panorama: { inputId, rotationDeg: panoramaRotationTuple(calibration), radiusM: calibration.radiusM, exposure: calibration.exposure },
      panoramaCalibrations: existing ? state.renderScene.panoramaCalibrations : [...state.renderScene.panoramaCalibrations, calibration],
      activePanoramaCalibrationId: calibration.calibrationId,
    } }), panoramaDiagnosticPreviewInputId: null, panoramaDiagnosticPreviewYawDeg: 0, panoramaDiagnosticPreviewFlipVertical: false, panoramaPreviewStatus: { state: "loading", message: calibration.confirmed ? "正在加载已确认球面环境纹理…" : "正在加载未确认方向的球面预览…" } };
  }),
  updatePanoramaCalibration: (calibrationId, update) => set((state) => revisePanoramaCalibration(state, calibrationId, "scene.calibration.panorama.update", update)),
  confirmPanoramaCalibration: (calibrationId) => set((state) => {
    const current = state.renderScene.panoramaCalibrations.find((calibration) => calibration.calibrationId === calibrationId);
    const input = current && state.environmentInputCatalog.entries.find((entry) => entry.inputId === current.sourceInputId);
    if (!current || !input || input.usage !== "panorama" || input.projection !== "equirectangular" || !input.environmentAllowed || input.admissionChecksum !== input.checksum) return state;
    const evaluated = evaluatePanoramaCalibration({ ...current, confirmed: true });
    if (evaluated.qualityState === "draft") return state;
    const confirmed = { ...evaluated, confirmed: true, qualityState: "verified" as const };
    const characters = Object.fromEntries(Object.entries(state.characters).map(([id, character]) => [id, character.transform.groundSnap ? { ...character, transform: { ...character.transform, position: [character.transform.position[0], character.transform.position[1], confirmed.groundHeightM] as [number, number, number] } } : character]));
    const sceneObjects = Object.fromEntries(Object.entries(state.sceneObjects).map(([id, sceneObject]) => [id, sceneObject.transform.groundSnap ? { ...sceneObject, transform: { ...sceneObject.transform, position: [sceneObject.transform.position[0], sceneObject.transform.position[1], confirmed.groundHeightM] as [number, number, number] } } : sceneObject]));
    return mutateScene(state, "scene.calibration.panorama.confirm", { characters, sceneObjects, renderScene: {
      ...state.renderScene,
      panoramaCalibrations: state.renderScene.panoramaCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? confirmed : calibration),
      activePanoramaCalibrationId: calibrationId,
      panorama: { inputId: confirmed.sourceInputId, rotationDeg: panoramaRotationTuple(confirmed), radiusM: confirmed.radiusM, exposure: confirmed.exposure },
      ground: { ...state.renderScene.ground, heightM: confirmed.groundHeightM },
      calibrationRevisionIds: [...state.renderScene.calibrationRevisionIds.filter((id) => !id.startsWith(`${calibrationId}@`)), `${calibrationId}@${confirmed.revision}`],
    } });
  }),
  insertReferenceInput: (inputId) => set((state) => {
    const input = state.environmentInputCatalog.entries.find((entry) => entry.inputId === inputId);
    if (!input) return state;
    const sceneObject = createReferenceSceneObject(state.sceneObjects, input);
    return {
      ...mutateScene(state, `scene.reference.insert.${input.mediaKind}`, { sceneObjects: { ...state.sceneObjects, [sceneObject.sceneObjectId]: sceneObject } }),
      selectedSceneObjectId: sceneObject.sceneObjectId,
      selectedCharacterIds: [],
    };
  }),
  createScenePlateCalibration: (inputId) => set((state) => {
    const input = state.environmentInputCatalog.entries.find((entry) => entry.inputId === inputId && entry.usage === "scene_plate" && entry.mediaKind === "image");
    if (!input || state.renderScene.scenePlateCalibrations.some((calibration) => calibration.sourceInputId === inputId)) return state;
    const calibration = createManualScenePlateCalibration(input, state.renderScene.scenePlateCalibrations.length + 1);
    return mutateScene(state, "scene.calibration.scene_plate.create", { renderScene: { ...state.renderScene, scenePlateCalibrations: [...state.renderScene.scenePlateCalibrations, calibration] } });
  }),
  updateScenePlateCalibration: (calibrationId, update) => set((state) => reviseScenePlateCalibration(state, calibrationId, "scene.calibration.scene_plate.update", (current) => update(current))),
  attachScenePlateSupportLayer: (calibrationId, inputId) => set((state) => {
    const input = state.environmentInputCatalog.entries.find((entry) => entry.inputId === inputId && entry.mediaKind === "image" && ["calibration_depth", "foreground_mask", "occlusion_mask", "segmentation_mask", "shadow_contact_mask"].includes(entry.usage));
    const current = state.renderScene.scenePlateCalibrations.find((calibration) => calibration.calibrationId === calibrationId);
    if (!input || !current || input.width !== current.imageWidth || input.height !== current.imageHeight || current.supportLayers.some((layer) => layer.inputId === inputId)) return state;
    const depthGrid = input.depthSampleGrid;
    const layer: CalibrationSupportLayerState = {
        layerId: `calibration-layer-${current.calibrationId.replace(/^calibration-/, "")}-${current.supportLayers.length + 1}`,
        role: input.usage as CalibrationSupportLayerState["role"],
        inputId: input.inputId,
        sourceScenePlateInputId: current.sourceInputId,
        calibrationRevision: current.revision,
        width: input.width,
        height: input.height,
        alignment: "pixel_aligned",
        qualityState: "draft" as const,
        confirmed: false,
        depthSurface: input.usage === "calibration_depth" && depthGrid && depthGrid.width * depthGrid.height === depthGrid.samples.length ? {
          encoding: "normalized_grayscale_ray_distance",
          nearM: 0.5,
          farM: 20,
          gridWidth: depthGrid.width,
          gridHeight: depthGrid.height,
          samplesNormalized: [...depthGrid.samples],
        } : null,
    };
    return mutateScene(state, "scene.calibration.support.attach", { renderScene: { ...state.renderScene, scenePlateCalibrations: state.renderScene.scenePlateCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? { ...calibration, supportLayers: [...calibration.supportLayers, layer] } : calibration) } });
  }),
  updateDepthSurfaceRange: (calibrationId, layerId, nearM, farM) => set((state) => {
    const target = state.renderScene.scenePlateCalibrations.find((calibration) => calibration.calibrationId === calibrationId)?.supportLayers.find((layer) => layer.layerId === layerId);
    if (!target?.depthSurface) return state;
    const updateLayer = (calibration: PerspectiveScenePlateCalibrationState): PerspectiveScenePlateCalibrationState => ({
      ...calibration,
      supportLayers: calibration.supportLayers.map((layer) => layer.layerId === layerId && layer.depthSurface ? {
        ...layer,
        confirmed: false,
        qualityState: "draft" as const,
        depthSurface: { ...layer.depthSurface, nearM: Math.max(0.01, Math.min(9_999.99, nearM)), farM: Math.min(10_000, Math.max(Math.max(0.01, Math.min(9_999.99, nearM)) + 0.01, farM)) },
      } : layer),
    });
    const markPlacement = <T extends { calibratedPlacement: CalibratedPlacementState | null }>(item: T): T => item.calibratedPlacement?.placementSurfaceInputId === target.inputId ? { ...item, calibratedPlacement: { ...item.calibratedPlacement, reviewRequired: true } } : item;
    return mutateScene(state, "scene.calibration.depth.range", {
      characters: Object.fromEntries(Object.entries(state.characters).map(([id, character]) => [id, markPlacement(character)])),
      sceneObjects: Object.fromEntries(Object.entries(state.sceneObjects).map(([id, sceneObject]) => [id, markPlacement(sceneObject)])),
      renderScene: { ...state.renderScene, scenePlateCalibrations: state.renderScene.scenePlateCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? updateLayer(calibration) : calibration) },
    });
  }),
  confirmScenePlateSupportLayer: (calibrationId, layerId) => set((state) => {
    const target = state.renderScene.scenePlateCalibrations.find((calibration) => calibration.calibrationId === calibrationId)?.supportLayers.find((layer) => layer.layerId === layerId);
    if (!target || (target.role === "calibration_depth" && !target.depthSurface)) return state;
    return mutateScene(state, "scene.calibration.support.confirm", { renderScene: { ...state.renderScene, scenePlateCalibrations: state.renderScene.scenePlateCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? { ...calibration, supportLayers: calibration.supportLayers.map((layer) => layer.layerId === layerId ? { ...layer, calibrationRevision: calibration.revision, confirmed: true, qualityState: "usable" } : layer) } : calibration) } });
  }),
  updateScenePlateCompositing: (calibrationId, update) => set((state) => {
    const calibration = state.renderScene.scenePlateCalibrations.find((item) => item.calibrationId === calibrationId);
    if (!calibration) return state;
    const requested = update(structuredClone(calibration.compositing));
    const admittedLayers = calibration.supportLayers.filter((layer) => layer.confirmed && layer.calibrationRevision === calibration.revision);
    const layerFor = (inputId: string | null, roles: CalibrationSupportLayerState["role"][]) => admittedLayers.find((layer) => layer.inputId === inputId && roles.includes(layer.role)) ?? null;
    const foreground = layerFor(requested.foregroundInputId, ["foreground_mask", "occlusion_mask", "segmentation_mask"]);
    const depth = layerFor(requested.depthInputId, ["calibration_depth"]);
    const shadow = layerFor(requested.shadowContactInputId, ["shadow_contact_mask"]);
    const next: ScenePlateCompositingState = {
      ...requested,
      revision: calibration.compositing.revision + 1,
      enabled: requested.enabled && calibration.confirmed,
      layerOrder: ["background_plate", "three_d_subjects", "shadow_contact", "foreground_occlusion"],
      foregroundInputId: foreground?.inputId ?? null,
      depthInputId: depth?.inputId ?? null,
      shadowContactInputId: shadow?.inputId ?? null,
      depthOrderingMode: requested.depthOrderingMode === "depth_surface" && depth ? "depth_surface" : requested.depthOrderingMode === "foreground_mask" && foreground ? "foreground_mask" : "none",
      availability: { occlusion: Boolean(foreground), depth: Boolean(depth), shadowContact: Boolean(shadow) },
      quality: { occlusion: foreground?.qualityState ?? "unavailable", depth: depth?.qualityState ?? "unavailable", shadowContact: shadow?.qualityState ?? "unavailable", colorMatch: requested.quality.colorMatch },
      parityTarget: { schemaVersion: "director-scene-plate-compositing-parity.v1", colorSpace: "srgb", alphaMode: "straight", layerOrderChecksum: "background_plate>three_d_subjects>shadow_contact>foreground_occlusion" },
    };
    return mutateScene(state, "scene.calibration.compositing.update", {
      renderScene: { ...state.renderScene, scenePlateCalibrations: state.renderScene.scenePlateCalibrations.map((item) => item.calibrationId === calibrationId ? { ...item, compositing: next } : next.enabled ? { ...item, compositing: { ...item.compositing, enabled: false } } : item) },
    });
  }),
  confirmScenePlateCalibration: (calibrationId) => set((state) => {
    const current = state.renderScene.scenePlateCalibrations.find((calibration) => calibration.calibrationId === calibrationId);
    if (!current) return state;
    const evaluated = evaluateScenePlateCalibration(current);
    if (!pointInsideGroundRegion(evaluated, evaluated.scaleAnchor.startNormalized) || !pointInsideGroundRegion(evaluated, evaluated.scaleAnchor.endNormalized)) return state;
    try {
      if (!intersectGroundPlane(evaluated, evaluated.scaleAnchor.startNormalized) || !intersectGroundPlane(evaluated, evaluated.scaleAnchor.endNormalized)) return state;
    } catch {
      return state;
    }
    const confirmed = { ...evaluated, confirmed: true };
    return mutateScene(state, "scene.calibration.scene_plate.confirm", {
      renderScene: {
        ...state.renderScene,
        scenePlateCalibrations: state.renderScene.scenePlateCalibrations.map((calibration) => calibration.calibrationId === calibrationId ? confirmed : calibration),
        calibrationRevisionIds: [...state.renderScene.calibrationRevisionIds.filter((id) => !id.startsWith(`${calibrationId}@`)), `${calibrationId}@${confirmed.revision}`],
      },
    });
  }),
  placeSelectedTargetOnScenePlate: (calibrationId, screenAnchor, depthInputId = null) => set((state) => {
    const calibration = state.renderScene.scenePlateCalibrations.find((item) => item.calibrationId === calibrationId);
    if (!calibration?.confirmed || (!depthInputId && !pointInsideGroundRegion(calibration, screenAnchor))) return state;
    const depthLayer = depthInputId ? calibration.supportLayers.find((layer) => layer.inputId === depthInputId && layer.role === "calibration_depth" && layer.confirmed && layer.calibrationRevision === calibration.revision) ?? null : null;
    if (depthInputId && !depthLayer) return state;
    if (state.selectedSceneObjectId) {
      const sceneObject = state.sceneObjects[state.selectedSceneObjectId];
      if (!sceneObject || sceneObject.locked || sceneObject.objectKind === "reference_board" || sceneObject.objectKind === "reference_video") return state;
      let placement: CalibratedPlacementState;
      try { placement = placeTargetOnScenePlate(calibration, { targetType: "scene_object", targetId: sceneObject.sceneObjectId }, screenAnchor, depthLayer); } catch { return state; }
      return mutateScene(state, "scene.placement.scene_object.calibrated", { sceneObjects: { ...state.sceneObjects, [sceneObject.sceneObjectId]: { ...sceneObject, revision: sceneObject.revision + 1, transform: { ...sceneObject.transform, position: placement.worldPositionM, groundSnap: false }, calibratedPlacement: placement } } });
    }
    const character = state.characters[state.selectedCharacterId];
    if (!character || character.locked) return state;
    let placement: CalibratedPlacementState;
    try { placement = placeTargetOnScenePlate(calibration, { targetType: "character", targetId: character.characterId }, screenAnchor, depthLayer); } catch { return state; }
    return mutateScene(state, "scene.placement.character.calibrated", { characters: { ...state.characters, [character.characterId]: { ...character, transform: { ...character.transform, position: placement.worldPositionM, groundSnap: false }, calibratedPlacement: placement } } });
  }),
  setSubjectImportOpen: (subjectImportOpen) => set({ subjectImportOpen }),
  registerSubjectReferenceSet: (referenceSet) => set((state) => ({
    subjectReferenceSets: { ...state.subjectReferenceSets, [referenceSet.reference_set_id]: structuredClone(referenceSet) },
  })),
  registerSubjectProxy: (referenceSet, proxy) => set((state) => ({
    subjectReferenceSets: { ...state.subjectReferenceSets, [referenceSet.reference_set_id]: structuredClone(referenceSet) },
    subjectProxies: { ...state.subjectProxies, [proxy.proxy_asset_id]: structuredClone(proxy) },
  })),
  bindActorToSubjectProxy: (characterId, proxyAssetId, appearanceRole = "primary_identity") => set((state) => {
    const character = state.characters[characterId];
    const mapping = character && state.actorMappings[character.actorMappingId];
    if (!character || !mapping || character.locked) return state;
    if (proxyAssetId === null) {
      if (mapping.proxyAssetId === null) return state;
      return mutateScene(state, "scene.actor_mapping.clear", {
        characters: { ...state.characters, [characterId]: { ...character, proxyAssetId: null } },
        actorMappings: { ...state.actorMappings, [mapping.actorMappingId]: { ...mapping, subjectId: null, referenceSetId: null, proxyAssetId: null, appearanceRole: "unassigned" } },
      });
    }
    const proxy = state.subjectProxies[proxyAssetId];
    const referenceSet = proxy && state.subjectReferenceSets[proxy.reference_set_id];
    if (!proxy || !referenceSet || proxy.status !== "approved" || proxy.subject_id !== referenceSet.subject_id) return state;
    if (mapping.proxyAssetId === proxyAssetId && mapping.appearanceRole === appearanceRole) return state;
    return mutateScene(state, "scene.actor_mapping.bind", {
      characters: { ...state.characters, [characterId]: { ...character, proxyAssetId } },
      actorMappings: { ...state.actorMappings, [mapping.actorMappingId]: { ...mapping, subjectId: proxy.subject_id, referenceSetId: proxy.reference_set_id, proxyAssetId, appearanceRole } },
    });
  }),
  setDialogueReferenceInputs: (dialogueReferenceInputs) => set({ dialogueReferenceInputs: dialogueReferenceInputs.map((input) => ({ ...input })) }),
  upsertDialogueBeat: (request) => set((state) => {
    const character = state.characters[request.characterId];
    const mapping = character && state.actorMappings[character.actorMappingId];
    if (!character || !mapping || character.locked) return state;
    const text = request.text.trim().slice(0, 4000);
    const startSeconds = finiteBounded(request.startSeconds, 0, state.dialogueTimeline.durationSeconds);
    const endSeconds = finiteBounded(request.endSeconds, 0, state.dialogueTimeline.durationSeconds);
    if (!text || endSeconds <= startSeconds) return state;
    const audioInputId = request.audioInputId && state.dialogueReferenceInputs.some((input) => input.inputId === request.audioInputId) ? request.audioInputId : null;
    const existing = request.dialogueBeatId ? state.dialogueTimeline.dialogueBeats.find((beat) => beat.dialogueBeatId === request.dialogueBeatId) : null;
    if (existing && (existing.characterId !== character.characterId || existing.actorMappingId !== mapping.actorMappingId)) return state;
    const nextSequence = state.dialogueTimeline.dialogueBeats.reduce((maximum, beat) => Math.max(maximum, Number(beat.dialogueBeatId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const dialogueBeatId = existing?.dialogueBeatId ?? `dialogue-${String(nextSequence).padStart(4, "0")}`;
    const beat: DialogueBeatState = { dialogueBeatId, characterId: character.characterId, actorMappingId: mapping.actorMappingId, text, startSeconds, endSeconds, deliveryHint: request.deliveryHint?.trim().slice(0, 200) || null, audioInputId };
    const dialogueBeats = existing ? state.dialogueTimeline.dialogueBeats.map((item) => item.dialogueBeatId === dialogueBeatId ? beat : item) : [...state.dialogueTimeline.dialogueBeats, beat];
    const speakerTrackId = `speaker-track-${character.characterId.replace(/^character-/, "")}`;
    const ownedBeats = dialogueBeats.filter((item) => item.characterId === character.characterId).sort((left, right) => left.startSeconds - right.startSeconds || left.dialogueBeatId.localeCompare(right.dialogueBeatId));
    const speakerTrack: SpeakerTrackState = { speakerTrackId, characterId: character.characterId, actorMappingId: mapping.actorMappingId, dialogueBeatIds: ownedBeats.map((item) => item.dialogueBeatId), startSeconds: Math.min(...ownedBeats.map((item) => item.startSeconds)), endSeconds: Math.max(...ownedBeats.map((item) => item.endSeconds)), audioInputId: ownedBeats.find((item) => item.audioInputId)?.audioInputId ?? null };
    const speakerTracks = state.dialogueTimeline.speakerTracks.some((track) => track.speakerTrackId === speakerTrackId)
      ? state.dialogueTimeline.speakerTracks.map((track) => track.speakerTrackId === speakerTrackId ? speakerTrack : track)
      : [...state.dialogueTimeline.speakerTracks, speakerTrack];
    return mutateScene(state, existing ? "timeline.dialogue.update" : "timeline.dialogue.add", { dialogueTimeline: { ...state.dialogueTimeline, dialogueBeats, speakerTracks } });
  }),
  removeDialogueBeat: (dialogueBeatId) => set((state) => {
    const existing = state.dialogueTimeline.dialogueBeats.find((beat) => beat.dialogueBeatId === dialogueBeatId);
    if (!existing || state.characters[existing.characterId]?.locked) return state;
    const dialogueBeats = state.dialogueTimeline.dialogueBeats.filter((beat) => beat.dialogueBeatId !== dialogueBeatId);
    const speakerTracks = state.dialogueTimeline.speakerTracks.flatMap((track) => {
      if (track.characterId !== existing.characterId) return [track];
      const ownedBeats = dialogueBeats.filter((beat) => beat.characterId === track.characterId).sort((left, right) => left.startSeconds - right.startSeconds || left.dialogueBeatId.localeCompare(right.dialogueBeatId));
      return ownedBeats.length === 0 ? [] : [{ ...track, dialogueBeatIds: ownedBeats.map((beat) => beat.dialogueBeatId), startSeconds: Math.min(...ownedBeats.map((beat) => beat.startSeconds)), endSeconds: Math.max(...ownedBeats.map((beat) => beat.endSeconds)), audioInputId: ownedBeats.find((beat) => beat.audioInputId)?.audioInputId ?? null }];
    });
    return mutateScene(state, "timeline.dialogue.remove", { dialogueTimeline: { ...state.dialogueTimeline, dialogueBeats, speakerTracks } });
  }),
  upsertFocusTrack: (request) => set((state) => {
    if (!state.cameras[request.cameraId]) return state;
    const normalizeTarget = (target: FocusTargetState): FocusTargetState | null => {
      if (target.targetType === "character") return state.characters[target.targetId] ? { targetType: "character", targetId: target.targetId, worldPositionM: null } : null;
      if (target.targetType === "scene_object") return state.sceneObjects[target.targetId] ? { targetType: "scene_object", targetId: target.targetId, worldPositionM: null } : null;
      if (!target.targetId.startsWith("world-point-") || !target.worldPositionM) return null;
      return { targetType: "world_point", targetId: target.targetId, worldPositionM: target.worldPositionM.map((value) => finiteBounded(value, -1000, 1000)) as [number, number, number] };
    };
    const fromTarget = normalizeTarget(request.fromTarget); const toTarget = normalizeTarget(request.toTarget);
    const startSeconds = finiteBounded(request.startSeconds, 0, state.dialogueTimeline.durationSeconds);
    const endSeconds = finiteBounded(request.endSeconds, 0, state.dialogueTimeline.durationSeconds);
    if (!fromTarget || !toTarget || endSeconds <= startSeconds) return state;
    const existing = request.focusTrackId ? state.dialogueTimeline.focusTracks.find((track) => track.focusTrackId === request.focusTrackId) : null;
    if (existing && existing.cameraId !== request.cameraId) return state;
    const nextSequence = state.dialogueTimeline.focusTracks.reduce((maximum, track) => Math.max(maximum, Number(track.focusTrackId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const focusTrack: FocusTrackState = { focusTrackId: existing?.focusTrackId ?? `focus-track-${String(nextSequence).padStart(4, "0")}`, cameraId: request.cameraId, startSeconds, endSeconds, fromTarget, toTarget, transition: request.transition, narrativeIntent: request.narrativeIntent?.trim().slice(0, 240) || null };
    const focusTracks = existing ? state.dialogueTimeline.focusTracks.map((track) => track.focusTrackId === focusTrack.focusTrackId ? focusTrack : track) : [...state.dialogueTimeline.focusTracks, focusTrack];
    return mutateScene(state, existing ? "timeline.focus.update" : "timeline.focus.add", { dialogueTimeline: { ...state.dialogueTimeline, focusTracks } });
  }),
  removeFocusTrack: (focusTrackId) => set((state) => state.dialogueTimeline.focusTracks.some((track) => track.focusTrackId === focusTrackId) ? mutateScene(state, "timeline.focus.remove", { dialogueTimeline: { ...state.dialogueTimeline, focusTracks: state.dialogueTimeline.focusTracks.filter((track) => track.focusTrackId !== focusTrackId) } }) : state),
  upsertInteractionAnchor: (request) => set((state) => {
    const character = state.characters[request.characterId]; const mapping = character && state.actorMappings[character.actorMappingId]; const joint = jointById.get(request.jointId);
    if (!character || !mapping || character.locked || !joint || joint.control_class !== "product_joint" || joint.edit_policy !== "direct") return state;
    const target = request.contactTarget;
    const contactTarget: FocusTargetState | null = target.targetType === "character"
      ? state.characters[target.targetId] ? { targetType: "character", targetId: target.targetId, worldPositionM: null } : null
      : target.targetType === "scene_object"
        ? state.sceneObjects[target.targetId] ? { targetType: "scene_object", targetId: target.targetId, worldPositionM: null } : null
        : target.targetId.startsWith("world-point-") && target.worldPositionM ? { targetType: "world_point", targetId: target.targetId, worldPositionM: target.worldPositionM.map((value) => finiteBounded(value, -1000, 1000)) as [number, number, number] } : null;
    const startSeconds = finiteBounded(request.startSeconds, 0, state.dialogueTimeline.durationSeconds); const endSeconds = finiteBounded(request.endSeconds, 0, state.dialogueTimeline.durationSeconds);
    if (!contactTarget || endSeconds <= startSeconds) return state;
    const existing = request.interactionAnchorId ? state.dialogueTimeline.interactionAnchors.find((anchor) => anchor.interactionAnchorId === request.interactionAnchorId) : null;
    if (existing && existing.characterId !== character.characterId) return state;
    const nextSequence = state.dialogueTimeline.interactionAnchors.reduce((maximum, anchor) => Math.max(maximum, Number(anchor.interactionAnchorId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const interactionAnchor: InteractionAnchorState = { interactionAnchorId: existing?.interactionAnchorId ?? `interaction-${String(nextSequence).padStart(4, "0")}`, characterId: character.characterId, actorMappingId: mapping.actorMappingId, jointId: joint.joint_id, contactTarget, contactMode: request.contactMode, startSeconds, endSeconds, offsetM: request.offsetM.map((value) => finiteBounded(value, -10, 10)) as [number, number, number], releasePolicy: request.releasePolicy, limitation: "reference_constraint_not_physics" };
    const interactionAnchors = existing ? state.dialogueTimeline.interactionAnchors.map((anchor) => anchor.interactionAnchorId === interactionAnchor.interactionAnchorId ? interactionAnchor : anchor) : [...state.dialogueTimeline.interactionAnchors, interactionAnchor];
    return mutateScene(state, existing ? "timeline.interaction.update" : "timeline.interaction.add", { dialogueTimeline: { ...state.dialogueTimeline, interactionAnchors } });
  }),
  removeInteractionAnchor: (interactionAnchorId) => set((state) => {
    const anchor = state.dialogueTimeline.interactionAnchors.find((item) => item.interactionAnchorId === interactionAnchorId);
    if (!anchor || state.characters[anchor.characterId]?.locked) return state;
    return mutateScene(state, "timeline.interaction.remove", { dialogueTimeline: { ...state.dialogueTimeline, interactionAnchors: state.dialogueTimeline.interactionAnchors.filter((item) => item.interactionAnchorId !== interactionAnchorId) } });
  }),
  upsertCameraNoiseTrack: (request) => set((state) => {
    if (!state.cameras[request.cameraId]) return state;
    const startSeconds = finiteBounded(request.startSeconds, 0, state.dialogueTimeline.durationSeconds); const endSeconds = finiteBounded(request.endSeconds, 0, state.dialogueTimeline.durationSeconds);
    if (endSeconds <= startSeconds || !Number.isInteger(request.seed)) return state;
    const existing = request.cameraNoiseTrackId ? state.dialogueTimeline.cameraNoiseTracks.find((track) => track.cameraNoiseTrackId === request.cameraNoiseTrackId) : null;
    if (existing && existing.cameraId !== request.cameraId) return state;
    const nextSequence = state.dialogueTimeline.cameraNoiseTracks.reduce((maximum, track) => Math.max(maximum, Number(track.cameraNoiseTrackId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const cameraNoiseTrack: CameraNoiseTrackState = { cameraNoiseTrackId: existing?.cameraNoiseTrackId ?? `camera-noise-${String(nextSequence).padStart(4, "0")}`, cameraId: request.cameraId, profile: request.profile, translationAmplitudeM: finiteBounded(request.translationAmplitudeM, 0, 2), rotationAmplitudeDeg: finiteBounded(request.rotationAmplitudeDeg, 0, 45), frequencyHz: finiteBounded(request.frequencyHz, 0.01, 30), translationAxisLimitsM: request.translationAxisLimitsM.map((value) => finiteBounded(value, 0, 2)) as [number, number, number], rotationAxisLimitsDeg: request.rotationAxisLimitsDeg.map((value) => finiteBounded(value, 0, 45)) as [number, number, number], startSeconds, endSeconds, seed: Math.max(-2147483648, Math.min(2147483647, request.seed)), enabled: request.enabled, compositionMode: "additive_after_base_path" };
    const cameraNoiseTracks = existing ? state.dialogueTimeline.cameraNoiseTracks.map((track) => track.cameraNoiseTrackId === cameraNoiseTrack.cameraNoiseTrackId ? cameraNoiseTrack : track) : [...state.dialogueTimeline.cameraNoiseTracks, cameraNoiseTrack];
    return mutateScene(state, existing ? "timeline.camera_noise.update" : "timeline.camera_noise.add", { dialogueTimeline: { ...state.dialogueTimeline, cameraNoiseTracks } });
  }),
  removeCameraNoiseTrack: (cameraNoiseTrackId) => set((state) => state.dialogueTimeline.cameraNoiseTracks.some((track) => track.cameraNoiseTrackId === cameraNoiseTrackId) ? mutateScene(state, "timeline.camera_noise.remove", { dialogueTimeline: { ...state.dialogueTimeline, cameraNoiseTracks: state.dialogueTimeline.cameraNoiseTracks.filter((track) => track.cameraNoiseTrackId !== cameraNoiseTrackId) } }) : state),
  setTimelineDuration: (requestedDuration) => set((state) => {
    const durationSeconds = finiteBounded(requestedDuration, minimumTimelineDuration(state), 3600);
    if (durationSeconds === state.dialogueTimeline.durationSeconds) return state;
    const maximumFrame = Math.max(1, Math.round(durationSeconds * state.dialogueTimeline.fps) + 1);
    return { ...mutateScene(state, "timeline.duration.set", { dialogueTimeline: { ...state.dialogueTimeline, durationSeconds } }), playheadFrame: Math.min(state.playheadFrame, maximumFrame) };
  }),
  setTimelineFps: (requestedFps) => set((state) => {
    const fps = Math.round(finiteBounded(requestedFps, 1, 120));
    if (fps === state.dialogueTimeline.fps) return state;
    const playheadSeconds = (state.playheadFrame - 1) / state.dialogueTimeline.fps;
    return { ...mutateScene(state, "timeline.fps.set", { dialogueTimeline: { ...state.dialogueTimeline, fps } }), playheadFrame: Math.min(Math.max(1, Math.round(playheadSeconds * fps) + 1), Math.max(1, Math.round(state.dialogueTimeline.durationSeconds * fps) + 1)) };
  }),
  setLocalAnimationImportState: (localAnimationImport) => set({ localAnimationImport: structuredClone(localAnimationImport) }),
  clearLocalAnimationImport: () => set({ localAnimationImport: createIdleLocalAnimationImportState() }),
  applyLocalAnimationManifest: () => set((state) => {
    const imported = state.localAnimationImport;
    if (imported.status !== "ready" || !imported.manifest || imported.tracks.length === 0) return state;
    const invalidTrack = imported.tracks.find((track) => track.target.targetType !== "character" || !state.characters[track.target.targetId] || timelineTargetLocked(state, track));
    if (invalidTrack) {
      return {
        localAnimationImport: {
          ...imported,
          status: "error" as const,
          errors: [`轨道“${invalidTrack.trackId}”的目标人物不存在或已锁定，未应用任何改动。`],
          appliedAt: null,
        },
      };
    }
    const importedTrackIds = new Set(imported.tracks.map((track) => track.trackId));
    const nextTracks = [
      ...state.dialogueTimeline.tracks.filter((track) => !importedTrackIds.has(track.trackId)),
      ...structuredClone(imported.tracks),
    ];
    const dialogueTimeline = {
      ...state.dialogueTimeline,
      durationSeconds: Math.max(state.dialogueTimeline.durationSeconds, imported.manifest.durationSeconds),
      fps: imported.manifest.fps,
      tracks: nextTracks,
    };
    const mutation = mutateScene(state, "timeline.local_animation_import", { dialogueTimeline });
    return {
      ...mutation,
      localAnimationImport: {
        ...imported,
        status: "applied" as const,
        errors: [],
        appliedAt: new Date().toISOString(),
      },
      playheadFrame: 1,
    };
  }),
  setFrameManifestImportState: (frameManifestImport) => set((state) => ({
    frameManifestImport: {
      ...structuredClone(frameManifestImport),
      revision: frameManifestImport.status === "ready" ? state.frameManifestImport.revision + 1 : state.frameManifestImport.revision,
    },
    unsavedChanges: frameManifestImport.status === "ready" ? true : state.unsavedChanges,
  })),
  clearFrameManifestImport: () => set((state) => ({
    frameManifestImport: { ...createIdleFrameManifestImportState(), revision: state.frameManifestImport.revision + (state.frameManifestImport.manifest ? 1 : 0) },
    unsavedChanges: state.frameManifestImport.manifest ? true : state.unsavedChanges,
  })),
  applyActionStructure: (request) => set((state) => {
    const action = ACTION_STRUCTURES.find((entry) => entry.actionId === request.actionId);
    const character = state.characters[request.characterId];
    if (!action || validateActionStructure(action).length || !character || character.locked || !state.actorMappings[character.actorMappingId]) return state;
    if (!Number.isFinite(request.startSeconds) || request.startSeconds < 0 || !Number.isFinite(request.durationSeconds) || request.durationSeconds < action.durationRangeSeconds[0] || request.durationSeconds > action.durationRangeSeconds[1]) return state;
    const opponent = request.opponentId ? state.characters[request.opponentId] : null;
    if (request.opponentId && (!opponent || opponent.characterId === character.characterId)) return state;
    const startSeconds = request.startSeconds;
    const endSeconds = startSeconds + request.durationSeconds;
    if (!Number.isFinite(endSeconds) || endSeconds > 3600) return state;
    const trackPrefix = `action-${action.actionId}-${character.characterId}-${Math.round(startSeconds * 1000)}`;
    const basePosition = character.transform.position;
    const phaseFrames = action.phases.map((phase) => {
      const preset = posePresetById.get(phase.posePresetId)!;
      const displacement = phase.rootDisplacementM ?? [0, 0, 0];
      return {
        phase,
        timeSeconds: startSeconds + phase.startFraction * request.durationSeconds,
        pose: Object.fromEntries(Object.entries({ ...preset.rotations, ...phase.jointOverrides }).map(([jointId, rotation]) => [jointId, [rotation.x, rotation.y, rotation.z]])),
        position: basePosition.map((value, index) => value + displacement[index]) as [number, number, number],
      };
    });
    const last = phaseFrames.at(-1)!;
    const keyframes = [...phaseFrames, { ...last, timeSeconds: endSeconds }];
    const tracks: TimelineTrackState[] = [
      { trackId: `${trackPrefix}-pose`, trackKind: "character_pose", target: { targetType: "character", targetId: character.characterId }, propertyKey: "pose.normalized_values", keyframes: keyframes.map((frame, index) => ({ keyframeId: `${trackPrefix}-pose-${index}`, timeSeconds: frame.timeSeconds, value: frame.pose, interpolation: frame.phase.interpolation })) },
      { trackId: `${trackPrefix}-transform`, trackKind: "character_transform", target: { targetType: "character", targetId: character.characterId }, propertyKey: "transform.position_m", keyframes: keyframes.map((frame, index) => ({ keyframeId: `${trackPrefix}-transform-${index}`, timeSeconds: frame.timeSeconds, value: frame.position, interpolation: frame.phase.interpolation })) },
    ];
    const existingIds = new Set(tracks.map((track) => track.trackId));
    const contactPhase = action.phases.find((phase) => phase.phaseId === action.contacts[0]?.phaseId);
    const contact = request.includeContact && opponent && contactPhase ? [{
      interactionAnchorId: `${trackPrefix}-contact`, characterId: character.characterId, actorMappingId: character.actorMappingId,
      jointId: action.contacts[0].sourceJointId,
      contactTarget: { targetType: "character" as const, targetId: opponent.characterId, worldPositionM: null },
      contactMode: "touch" as const,
      startSeconds: startSeconds + contactPhase.startFraction * request.durationSeconds,
      endSeconds: startSeconds + contactPhase.endFraction * request.durationSeconds,
      offsetM: [0, 0, 0] as [number, number, number], releasePolicy: "release_at_end" as const,
      limitation: "reference_constraint_not_physics" as const,
    }] : [];
    const dialogueTimeline = {
      ...state.dialogueTimeline,
      durationSeconds: Math.max(state.dialogueTimeline.durationSeconds, endSeconds),
      tracks: [...state.dialogueTimeline.tracks.filter((track) => !existingIds.has(track.trackId)), ...tracks],
      interactionAnchors: [...state.dialogueTimeline.interactionAnchors.filter((anchor) => anchor.interactionAnchorId !== `${trackPrefix}-contact`), ...contact],
    };
    return mutateScene(state, `timeline.action.apply.${action.actionId}.${action.catalogVersion}`, { dialogueTimeline });
  }),
  addTimelineTrack: (request) => set((state) => {
    if (!timelineTrackTargetAllowed(state, request.trackKind, request.targetType, request.targetId) || !request.propertyKey.trim()) return state;
    const nextSequence = state.dialogueTimeline.tracks.reduce((maximum, track) => Math.max(maximum, Number(track.trackId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const track: TimelineTrackState = { trackId: `track-${String(nextSequence).padStart(4, "0")}`, trackKind: request.trackKind, target: { targetType: request.targetType, targetId: request.targetId }, propertyKey: request.propertyKey.trim().slice(0, 120), keyframes: [] };
    return mutateScene(state, "timeline.track.add", { dialogueTimeline: { ...state.dialogueTimeline, tracks: [...state.dialogueTimeline.tracks, track], activeCameraTrackId: request.trackKind === "active_camera" ? track.trackId : state.dialogueTimeline.activeCameraTrackId } });
  }),
  removeTimelineTrack: (trackId) => set((state) => {
    const track = state.dialogueTimeline.tracks.find((item) => item.trackId === trackId);
    if (!track || timelineTargetLocked(state, track)) return state;
    return mutateScene(state, "timeline.track.remove", { dialogueTimeline: { ...state.dialogueTimeline, tracks: state.dialogueTimeline.tracks.filter((item) => item.trackId !== trackId), activeCameraTrackId: state.dialogueTimeline.activeCameraTrackId === trackId ? null : state.dialogueTimeline.activeCameraTrackId } });
  }),
  upsertTimelineKeyframe: (trackId, request) => set((state) => {
    const track = state.dialogueTimeline.tracks.find((item) => item.trackId === trackId);
    if (!track || timelineTargetLocked(state, track) || request.timeSeconds < 0 || request.timeSeconds > state.dialogueTimeline.durationSeconds) return state;
    if (!timelineKeyframeValueAllowed(state, track, request.value)) return state;
    const existing = request.keyframeId ? track.keyframes.find((item) => item.keyframeId === request.keyframeId) : null;
    const globallyOwned = request.keyframeId && state.dialogueTimeline.tracks.some((item) => item.trackId !== trackId && item.keyframes.some((keyframe) => keyframe.keyframeId === request.keyframeId));
    if (globallyOwned) return state;
    const nextSequence = state.dialogueTimeline.tracks.flatMap((item) => item.keyframes).reduce((maximum, item) => Math.max(maximum, Number(item.keyframeId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const keyframe: TimelineKeyframeState = { keyframeId: existing?.keyframeId ?? `keyframe-${String(nextSequence).padStart(4, "0")}`, timeSeconds: request.timeSeconds, value: structuredClone(request.value), interpolation: track.trackKind === "active_camera" ? "step" : request.interpolation };
    const keyframes = orderedKeyframes(existing ? track.keyframes.map((item) => item.keyframeId === keyframe.keyframeId ? keyframe : item) : [...track.keyframes, keyframe]);
    return mutateScene(state, existing ? "timeline.keyframe.update" : "timeline.keyframe.add", { dialogueTimeline: { ...state.dialogueTimeline, tracks: state.dialogueTimeline.tracks.map((item) => item.trackId === trackId ? { ...track, keyframes } : item) } });
  }),
  moveTimelineKeyframe: (trackId, keyframeId, timeSeconds) => {
    const keyframe = get().dialogueTimeline.tracks.find((track) => track.trackId === trackId)?.keyframes.find((item) => item.keyframeId === keyframeId);
    if (keyframe) get().upsertTimelineKeyframe(trackId, { keyframeId, timeSeconds, value: keyframe.value, interpolation: keyframe.interpolation });
  },
  copyTimelineKeyframe: (trackId, keyframeId, timeSeconds) => {
    const keyframe = get().dialogueTimeline.tracks.find((track) => track.trackId === trackId)?.keyframes.find((item) => item.keyframeId === keyframeId);
    if (keyframe) get().upsertTimelineKeyframe(trackId, { timeSeconds, value: keyframe.value, interpolation: keyframe.interpolation });
  },
  removeTimelineKeyframe: (trackId, keyframeId) => set((state) => {
    const track = state.dialogueTimeline.tracks.find((item) => item.trackId === trackId);
    if (!track || timelineTargetLocked(state, track) || !track.keyframes.some((item) => item.keyframeId === keyframeId)) return state;
    return mutateScene(state, "timeline.keyframe.remove", { dialogueTimeline: { ...state.dialogueTimeline, tracks: state.dialogueTimeline.tracks.map((item) => item.trackId === trackId ? { ...track, keyframes: track.keyframes.filter((keyframe) => keyframe.keyframeId !== keyframeId) } : item) } });
  }),
  setActiveCameraTrack: (trackId) => set((state) => {
    if (trackId !== null && !state.dialogueTimeline.tracks.some((track) => track.trackId === trackId && track.trackKind === "active_camera")) return state;
    if (trackId === state.dialogueTimeline.activeCameraTrackId) return state;
    return mutateScene(state, "timeline.active_camera.set", { dialogueTimeline: { ...state.dialogueTimeline, activeCameraTrackId: trackId } });
  }),
  applyCameraCompositionPreset: (cameraId, presetId, requestedTargets) => set((state) => {
    const camera = state.cameras[cameraId]; const preset = COMPOSITION_PRESETS[presetId];
    if (!camera || camera.locked || !preset) return state;
    const subjectTargetIds = requestedTargets === undefined ? camera.subjectTargetIds : Array.from(new Set(requestedTargets.filter((targetId) => state.characters[targetId] || state.sceneObjects[targetId]))).slice(0, 8);
    return mutateScene(state, "camera.composition.apply", { cameras: { ...state.cameras, [cameraId]: { ...camera, compositionPresetId: presetId, fovDeg: preset.fovDeg, focalLengthMm: preset.focalLengthMm, subjectTargetIds } } });
  }),
  setCameraAspectRatio: (cameraId, aspectRatio) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked || camera.aspectRatio === aspectRatio) return state;
    return mutateScene(state, "camera.aspect_ratio.set", { cameras: { ...state.cameras, [cameraId]: { ...camera, aspectRatio } } });
  }),
  toggleCameraFramingGuide: (cameraId, guide) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked) return state;
    return mutateScene(state, "camera.framing_guide.toggle", { cameras: { ...state.cameras, [cameraId]: { ...camera, framingGuides: { ...camera.framingGuides, [guide]: !camera.framingGuides[guide] } } } });
  }),
  createCameraSnapshot: (cameraId, requestedLabel) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera) return state;
    const order = state.cameraSnapshots.filter((snapshot) => snapshot.cameraId === cameraId).length;
    const snapshotId = `snapshot-${cameraId.replace(/^camera-/, "")}-${String(order + 1).padStart(4, "0")}`;
    const base: Omit<CameraSnapshotState, "stateChecksum"> = { snapshotId, cameraId, label: requestedLabel?.trim().slice(0, 80) || `${camera.label} 快照 ${order + 1}`, order, frame: state.playheadFrame, transform: structuredClone(camera.transform), fovDeg: camera.fovDeg, focalLengthMm: camera.focalLengthMm, zoom: camera.zoom, aspectRatio: camera.aspectRatio, compositionPresetId: camera.compositionPresetId, subjectTargetIds: [...camera.subjectTargetIds], lookAt: camera.lookAt ? { ...camera.lookAt } : null, follow: camera.follow ? { ...camera.follow } : null, actorMappingIds: camera.subjectTargetIds.flatMap((targetId) => state.characters[targetId]?.actorMappingId ? [state.characters[targetId].actorMappingId] : []), framingGuides: { ...camera.framingGuides }, dimensionsPx: snapshotDimensions(camera.aspectRatio) };
    const snapshot: CameraSnapshotState = { ...base, stateChecksum: snapshotChecksum(base) };
    return { cameraSnapshots: [...state.cameraSnapshots, snapshot], cameras: { ...state.cameras, [cameraId]: { ...camera, snapshotIds: [...camera.snapshotIds, snapshotId] } }, unsavedChanges: true, commandHistory: [...state.commandHistory, "camera.snapshot.create"].slice(-100) };
  }),
  selectCamera: (selectedCameraId, openCameraView = false) => set((state) => state.cameras[selectedCameraId] ? {
    selectedCameraId,
    selectedActorPathControlPointId: null,
    selectedActorPathVectorField: "positionM",
    selectedCameraPathControlPointId: state.cameraPaths[`path-${selectedCameraId}-motion`]?.controlPoints.some((point) => point.controlPointId === state.selectedCameraPathControlPointId) ? state.selectedCameraPathControlPointId : null,
    selectedCameraPathVectorField: "positionM",
    ...(openCameraView ? { viewMode: "camera" as const } : {}),
  } : state),
  addCameraFromCurrentView: (requestedLabel) => set((state) => {
    const cameraId = nextCameraId(state.cameras);
    const sourceCamera = state.viewMode === "camera" ? state.cameras[state.selectedCameraId] : null;
    const navigation = state.viewportNavigation[state.viewMode];
    const subjectTargetIds = state.selectedSceneObjectId
      ? [state.selectedSceneObjectId]
      : state.selectedCharacterIds.length
        ? [...state.selectedCharacterIds]
        : [state.selectedCharacterId];
    const fovDeg = sourceCamera?.fovDeg ?? 42;
    const camera: CameraCompositionState = {
      cameraId,
      label: requestedLabel?.trim().slice(0, 80) || `机位 ${Object.keys(state.cameras).length + 1}`,
      transform: sourceCamera ? structuredClone(sourceCamera.transform) : { position: [...navigation.positionM], rotationDeg: cameraRotationFromNavigation(navigation), scale: [1, 1, 1], groundSnap: false },
      fovDeg,
      focalLengthMm: sourceCamera?.focalLengthMm ?? Number((18 / Math.tan(fovDeg * Math.PI / 360)).toFixed(2)),
      zoom: sourceCamera?.zoom ?? navigation.zoom,
      aspectRatio: sourceCamera?.aspectRatio ?? "16:9",
      compositionPresetId: sourceCamera?.compositionPresetId ?? "medium_wide",
      subjectTargetIds,
      lookAt: sourceCamera?.lookAt ? { ...sourceCamera.lookAt } : null,
      follow: sourceCamera?.follow ? { ...sourceCamera.follow } : null,
      framingGuides: sourceCamera ? { ...sourceCamera.framingGuides } : { ruleOfThirds: true, centerCross: false, safeArea: true },
      snapshotIds: [],
      visible: true,
      locked: false,
    };
    return {
      ...mutateScene(state, "camera.create_from_view", { cameras: { ...state.cameras, [cameraId]: camera } }),
      selectedCameraId: cameraId,
      selectedActorPathControlPointId: null,
      selectedActorPathVectorField: "positionM",
      selectedCameraPathControlPointId: null,
      selectedCameraPathVectorField: "positionM",
      viewMode: "camera" as const,
    };
  }),
  renameCamera: (cameraId, requestedLabel) => set((state) => {
    const camera = state.cameras[cameraId]; const label = requestedLabel.trim().slice(0, 80);
    if (!camera || camera.locked || !label || label === camera.label) return state;
    return mutateScene(state, "camera.rename", { cameras: { ...state.cameras, [cameraId]: { ...camera, label } } });
  }),
  toggleCameraVisible: (cameraId) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera) return state;
    return mutateScene(state, "camera.visibility.toggle", { cameras: { ...state.cameras, [cameraId]: { ...camera, visible: !camera.visible } } });
  }),
  toggleCameraLocked: (cameraId) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera) return state;
    return mutateScene(state, "camera.lock.toggle", { cameras: { ...state.cameras, [cameraId]: { ...camera, locked: !camera.locked } } });
  }),
  setCameraTransformAxis: (cameraId, field, axis, value) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked || axis < 0 || axis > 2) return state;
    const vector = [...camera.transform[field]] as [number, number, number]; vector[axis] = value;
    const next = boundTransformValues(field, vector); if (next.every((item, index) => item === camera.transform[field][index])) return state;
    return mutateScene(state, `camera.transform.${field}.${axis}`, { cameras: { ...state.cameras, [cameraId]: { ...camera, transform: { ...camera.transform, [field]: next } } } });
  }),
  setCameraFov: (cameraId, value) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked) return state;
    const fovDeg = finiteBounded(value, 10, 140); if (fovDeg === camera.fovDeg) return state;
    return mutateScene(state, "camera.fov.set", { cameras: { ...state.cameras, [cameraId]: { ...camera, fovDeg, focalLengthMm: Number((18 / Math.tan(fovDeg * Math.PI / 360)).toFixed(2)) } } });
  }),
  setCameraZoom: (cameraId, value) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked) return state;
    const zoom = finiteBounded(value, 0.1, 10); if (zoom === camera.zoom) return state;
    return mutateScene(state, "camera.zoom.set", { cameras: { ...state.cameras, [cameraId]: { ...camera, zoom } } });
  }),
  setCameraLookAt: (cameraId, lookAt) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked || !cameraTargetExists(state, lookAt)) return state;
    if (JSON.stringify(camera.lookAt) === JSON.stringify(lookAt)) return state;
    return mutateScene(state, "camera.look_at.set", { cameras: { ...state.cameras, [cameraId]: { ...camera, lookAt: lookAt ? { ...lookAt } : null } } });
  }),
  setCameraFollow: (cameraId, follow) => set((state) => {
    const camera = state.cameras[cameraId]; if (!camera || camera.locked || !cameraTargetExists(state, follow)) return state;
    if (JSON.stringify(camera.follow) === JSON.stringify(follow)) return state;
    return mutateScene(state, "camera.follow.set", { cameras: { ...state.cameras, [cameraId]: { ...camera, follow: follow ? { ...follow } : null } } });
  }),
  applyCameraPathPreset: (cameraId, presetId, mode, requestedDuration, easing) => set((state) => {
    const camera = state.cameras[cameraId];
    const pathId = `path-${cameraId}-motion`;
    const existing = state.cameraPaths[pathId];
    if (!camera || camera.locked || existing?.locked) return state;
    const segmentDurationSeconds = finiteBounded(requestedDuration, 0.1, 600);
    const sequence = (existing?.revision ?? 0) + 1;
    const append = mode === "append" && Boolean(existing);
    const existingPoints = existing ? [...existing.controlPoints].sort((left, right) => left.order - right.order) : [];
    const startPositionM = append ? [...existingPoints.at(-1)!.positionM] as [number, number, number] : [...camera.transform.position] as [number, number, number];
    const generated = createCameraPathPresetControlPoints({ cameraId, presetId, sequence, startPositionM, targetPositionM: cameraPathTargetPosition(state, camera) });
    if (generated.length < 2 || (append && existingPoints.length + generated.length - 1 > 128)) return state;
    const controlPoints = append
      ? [
          ...existingPoints.slice(0, -1),
          { ...existingPoints.at(-1)!, handleOutM: [...generated[0].handleOutM] as [number, number, number] },
          ...generated.slice(1),
        ].map((point, order) => ({ ...point, order }))
      : generated;
    const durationSeconds = append ? finiteBounded(existing!.durationSeconds + segmentDurationSeconds, 0.1, 3600) : segmentDurationSeconds;
    const cameraPath: CameraPathState = {
      pathId,
      targetType: "camera",
      targetId: cameraId,
      durationSeconds,
      easing,
      presetIds: append ? [...existing!.presetIds, presetId].slice(-32) : [presetId],
      controlPoints,
      revision: sequence,
      locked: existing?.locked ?? false,
      visible: existing?.visible ?? true,
    };
    return {
      ...mutateScene(state, `camera.path.preset.${presetId}.${append ? "append" : "replace"}`, {
        cameraPaths: { ...state.cameraPaths, [pathId]: cameraPath },
        dialogueTimeline: durationSeconds > state.dialogueTimeline.durationSeconds ? { ...state.dialogueTimeline, durationSeconds } : state.dialogueTimeline,
      }),
      selectedCameraPathControlPointId: state.selectedCameraId === cameraId
        ? controlPoints.some((point) => point.controlPointId === state.selectedCameraPathControlPointId) ? state.selectedCameraPathControlPointId : controlPoints[0]?.controlPointId ?? null
        : state.selectedCameraPathControlPointId,
      selectedCameraPathVectorField: state.selectedCameraId === cameraId ? "positionM" : state.selectedCameraPathVectorField,
    };
  }),
  importExternalCameraMotionProposal: (manifest, targetCameraId, options = {}) => set((state) => {
    const camera = state.cameras[targetCameraId];
    if (!camera || camera.locked) return state;
    try {
      const proposal = parseExternalCameraMotionManifest(manifest, options);
      const sourceInputId = proposal.sourceInputId;
      const source = state.environmentInputCatalog.entries.find((entry) => entry.inputId === sourceInputId);
      if (!source || source.mediaKind !== "video" || source.usage !== "external_camera_motion_reference" || source.checksum !== proposal.sourceChecksum) return state;
      const audio = options.audioInputId ? state.dialogueReferenceInputs.find((input) => input.inputId === options.audioInputId) : null;
      if (options.audioInputId && !audio) return state;
      const enriched = { ...proposal, targetCameraId, audioInputId: options.audioInputId ?? null, audioChecksum: options.audioChecksum ?? null, confidence: Math.max(0, Math.min(1, options.confidence ?? 0)), limitations: Array.from(new Set([...proposal.limitations, ...(options.limitations ?? [])])) };
      return mutateScene(state, "camera.motion.external.propose", { externalCameraMotionProposals: [...state.externalCameraMotionProposals, enriched].slice(-32) });
    } catch {
      return state;
    }
  }),
  setExternalCameraMotionReviewState: (proposalId, reviewState) => set((state) => {
    const proposal = state.externalCameraMotionProposals.find((item) => item.proposalId === proposalId);
    if (!proposal || (reviewState !== "approved" && reviewState !== "rejected")) return state;
    return mutateScene(state, `camera.motion.external.${reviewState}`, { externalCameraMotionProposals: state.externalCameraMotionProposals.map((item) => item.proposalId === proposalId ? { ...item, revision: item.revision + 1, reviewState } : item) });
  }),
  applyExternalCameraMotionProposal: (proposalId, sourceChecksum, audioChecksum = null) => set((state) => {
    const proposal = state.externalCameraMotionProposals.find((item) => item.proposalId === proposalId);
    const camera = proposal && state.cameras[proposal.targetCameraId];
    const source = proposal && state.environmentInputCatalog.entries.find((entry) => entry.inputId === proposal.sourceInputId);
    const audio = proposal?.audioInputId ? state.dialogueReferenceInputs.find((input) => input.inputId === proposal.audioInputId) : null;
    if (!proposal || !camera || camera.locked || proposal.reviewState !== "approved" || !source || source.checksum !== sourceChecksum || proposal.sourceChecksum !== sourceChecksum || (proposal.audioInputId && (!audio || proposal.audioChecksum !== audioChecksum))) return state;
    const controlPoints = downsampleToBezierPoints(proposal.convertedSamples);
    if (controlPoints.length < 2) return state;
    const pathId = `path-${camera.cameraId}-motion`;
    const existing = state.cameraPaths[pathId];
    if (existing?.locked || (existing && existing.targetId !== camera.cameraId)) return state;
    const nextRevision = (existing?.revision ?? 0) + 1;
    const durationSeconds = Math.max(0.1, Math.min(3600, Math.max(...proposal.convertedSamples.map((sample) => sample.alignedTimeSeconds)) - Math.min(...proposal.convertedSamples.map((sample) => sample.alignedTimeSeconds))));
    const path: CameraPathState = { pathId, targetType: "camera", targetId: camera.cameraId, durationSeconds, easing: "linear", presetIds: [], controlPoints, revision: nextRevision, locked: false, visible: true };
    return mutateScene(state, "camera.motion.external.apply", { cameraPaths: { ...state.cameraPaths, [pathId]: path }, dialogueTimeline: durationSeconds > state.dialogueTimeline.durationSeconds ? { ...state.dialogueTimeline, durationSeconds } : state.dialogueTimeline, externalCameraMotionProposals: state.externalCameraMotionProposals.map((item) => item.proposalId === proposalId ? { ...item, revision: item.revision + 1, reviewState: "applied", appliedPathId: pathId, appliedPathRevision: nextRevision } : item) });
  }),
  selectCameraPathControlPoint: (selectedCameraPathControlPointId, selectedCameraPathVectorField = "positionM") => set((state) => selectedCameraPathControlPointId === null || state.cameraPaths[`path-${state.selectedCameraId}-motion`]?.controlPoints.some((point) => point.controlPointId === selectedCameraPathControlPointId) ? {
    selectedCameraPathControlPointId,
    selectedCameraPathVectorField,
    selectedActorPathControlPointId: null,
    selectedActorPathVectorField: "positionM",
  } : state),
  setCameraPathDuration: (pathId, value) => set((state) => mutateCameraPath(state, pathId, "camera.path.duration.set", (path) => {
    const durationSeconds = finiteBounded(value, 0.1, 3600);
    return durationSeconds === path.durationSeconds ? path : { ...path, durationSeconds };
  })),
  setCameraPathEasing: (pathId, easing) => set((state) => mutateCameraPath(state, pathId, "camera.path.easing.set", (path) => easing === path.easing ? path : { ...path, easing })),
  setCameraPathControlPointVector: (pathId, controlPointId, field, axis, value) => set((state) => mutateCameraPath(state, pathId, `camera.path.control_point.${field}.${axis}`, (path) => {
    if (axis < 0 || axis > 2) return path;
    const controlPoint = path.controlPoints.find((point) => point.controlPointId === controlPointId);
    if (!controlPoint) return path;
    const vector = [...controlPoint[field]] as [number, number, number];
    vector[axis] = finiteBounded(value, -30, 30);
    if (vector[axis] === controlPoint[field][axis]) return path;
    return { ...path, controlPoints: path.controlPoints.map((point) => point.controlPointId === controlPointId ? { ...point, [field]: vector } : point) };
  })),
  beginCameraPathControlDrag: (pathId, controlPointId, field) => set((state) => {
    const path = state.cameraPaths[pathId];
    const camera = path && path.targetType === "camera" ? state.cameras[path.targetId] : null;
    if (!path || path.targetType !== "camera" || path.locked || !camera || camera.locked || state.transformDragSnapshot || state.actorPathDragSnapshot || state.cameraPathDragSnapshot || !path.controlPoints.some((point) => point.controlPointId === controlPointId)) return state;
    return {
      selectedCameraPathControlPointId: controlPointId,
      selectedCameraPathVectorField: field,
      selectedActorPathControlPointId: null,
      selectedActorPathVectorField: "positionM",
      transformDragging: true,
      cameraPathDragSnapshot: snapshotAuthoring(state),
      cameraPathDragTarget: { pathId, controlPointId, field },
      cameraPathDragUnsavedChanges: state.unsavedChanges,
    };
  }),
  previewCameraPathControlVector: (pathId, controlPointId, field, values) => set((state) => {
    const target = state.cameraPathDragTarget;
    const path = state.cameraPaths[pathId];
    const camera = path && path.targetType === "camera" ? state.cameras[path.targetId] : null;
    if (!target || target.pathId !== pathId || target.controlPointId !== controlPointId || target.field !== field || !path || path.targetType !== "camera" || path.locked || !camera || camera.locked) return state;
    const controlPoint = path.controlPoints.find((point) => point.controlPointId === controlPointId);
    if (!controlPoint) return state;
    const vector = values.map((value) => finiteBounded(value, -30, 30)) as [number, number, number];
    if (controlPoint[field].every((value, axis) => value === vector[axis])) return state;
    return {
      cameraPaths: {
        ...state.cameraPaths,
        [pathId]: {
          ...path,
          controlPoints: path.controlPoints.map((point) => point.controlPointId === controlPointId ? { ...point, [field]: vector } : point),
        },
      },
      unsavedChanges: true,
    };
  }),
  commitCameraPathControlDrag: () => set((state) => {
    const snapshot = state.cameraPathDragSnapshot;
    const target = state.cameraPathDragTarget;
    if (!snapshot || !target) return { transformDragging: false, cameraPathDragSnapshot: null, cameraPathDragTarget: null, cameraPathDragUnsavedChanges: null };
    const before = snapshot.cameraPaths[target.pathId];
    const after = state.cameraPaths[target.pathId];
    const changed = Boolean(before && after && before.targetId === after.targetId && JSON.stringify(before.controlPoints) !== JSON.stringify(after.controlPoints));
    return {
      transformDragging: false,
      cameraPathDragSnapshot: null,
      cameraPathDragTarget: null,
      cameraPathDragUnsavedChanges: null,
      ...(changed ? {
        cameraPaths: { ...state.cameraPaths, [target.pathId]: { ...after, revision: before.revision + 1 } },
        undoStack: [...state.undoStack, snapshot].slice(-100),
        redoStack: [],
        commandHistory: [...state.commandHistory, `camera.path.control_point.drag.${target.field}`].slice(-100),
        unsavedChanges: true,
      } : {}),
    };
  }),
  cancelCameraPathControlDrag: () => set((state) => state.cameraPathDragSnapshot ? {
    ...state.cameraPathDragSnapshot,
    transformDragging: false,
    unsavedChanges: state.cameraPathDragUnsavedChanges ?? state.unsavedChanges,
    cameraPathDragSnapshot: null,
    cameraPathDragTarget: null,
    cameraPathDragUnsavedChanges: null,
  } : { transformDragging: false, cameraPathDragSnapshot: null, cameraPathDragTarget: null, cameraPathDragUnsavedChanges: null }),
  appendCameraPathControlPoint: (pathId) => set((state) => mutateCameraPath(state, pathId, "camera.path.control_point.append", (path) => {
    const points = [...path.controlPoints].sort((left, right) => left.order - right.order);
    const last = points.at(-1); const previous = points.at(-2);
    if (!last || points.length >= 128) return path;
    const delta: [number, number, number] = previous ? last.positionM.map((value, axis) => value - previous.positionM[axis]) as [number, number, number] : [0, 1, 0];
    if (Math.hypot(...delta) < 0.05) delta[1] = 1;
    const positionM = last.positionM.map((value, axis) => finiteBounded(value + delta[axis], -30, 30)) as [number, number, number];
    const handleInM = positionM.map((value, axis) => value - delta[axis] / 3) as [number, number, number];
    const controlPointId = `point-${path.targetId}-manual-${String(path.revision + 1).padStart(4, "0")}-${String(points.length + 1).padStart(3, "0")}`;
    return { ...path, controlPoints: [...points, { controlPointId, positionM, handleInM, handleOutM: [...positionM], order: points.length }] };
  })),
  removeCameraPathControlPoint: (pathId, controlPointId) => set((state) => {
    const mutation = mutateCameraPath(state, pathId, "camera.path.control_point.remove", (path) => {
      if (path.controlPoints.length <= 2 || !path.controlPoints.some((point) => point.controlPointId === controlPointId)) return path;
      return { ...path, controlPoints: path.controlPoints.filter((point) => point.controlPointId !== controlPointId).sort((left, right) => left.order - right.order).map((point, order) => ({ ...point, order })) };
    });
    if (mutation === state) return state;
    const nextPath = (mutation.cameraPaths ?? state.cameraPaths)[pathId];
    return {
      ...mutation,
      selectedCameraPathControlPointId: state.selectedCameraPathControlPointId === controlPointId ? nextPath.controlPoints[0]?.controlPointId ?? null : state.selectedCameraPathControlPointId,
      selectedCameraPathVectorField: state.selectedCameraPathControlPointId === controlPointId ? "positionM" : state.selectedCameraPathVectorField,
    };
  }),
  reverseCameraPath: (pathId) => set((state) => mutateCameraPath(state, pathId, "camera.path.direction.reverse", (path) => ({ ...path, controlPoints: [...path.controlPoints].sort((left, right) => right.order - left.order).map((point, order) => ({ ...point, order, handleInM: [...point.handleOutM], handleOutM: [...point.handleInM] })) }))),
  selectActorPathControlPoint: (selectedActorPathControlPointId, selectedActorPathVectorField = "positionM") => set((state) => selectedActorPathControlPointId === null || Object.values(state.actorPaths).some((path) => path.controlPoints.some((point) => point.controlPointId === selectedActorPathControlPointId)) ? { selectedActorPathControlPointId, selectedActorPathVectorField, selectedCameraPathControlPointId: null, selectedCameraPathVectorField: "positionM" } : state),
  setActorPathDuration: (pathId, value) => set((state) => mutateActorPath(state, pathId, "path.duration.set", (path) => {
    const durationSeconds = finiteBounded(value, 0.1, 3600);
    return durationSeconds === path.durationSeconds ? path : { ...path, durationSeconds };
  })),
  setActorPathEasing: (pathId, easing) => set((state) => mutateActorPath(state, pathId, "path.easing.set", (path) => easing === path.easing ? path : { ...path, easing })),
  setActorPathControlPointVector: (pathId, controlPointId, field, axis, value) => set((state) => mutateActorPath(state, pathId, `path.control_point.${field}.${axis}`, (path) => {
    if (axis < 0 || axis > 2) return path;
    const controlPoint = path.controlPoints.find((point) => point.controlPointId === controlPointId);
    if (!controlPoint) return path;
    const vector = [...controlPoint[field]] as [number, number, number];
    vector[axis] = finiteBounded(value, -30, 30);
    if (vector[axis] === controlPoint[field][axis]) return path;
    return { ...path, controlPoints: path.controlPoints.map((point) => point.controlPointId === controlPointId ? { ...point, [field]: vector } : point) };
  })),
  beginActorPathControlDrag: (pathId, controlPointId, field) => set((state) => {
    const path = state.actorPaths[pathId];
    const character = path && state.characters[path.targetId];
    if (!path || path.locked || !character || character.locked || state.transformDragSnapshot || state.actorPathDragSnapshot || state.cameraPathDragSnapshot || !path.controlPoints.some((point) => point.controlPointId === controlPointId)) return state;
    return {
      selectedActorPathControlPointId: controlPointId,
      selectedActorPathVectorField: field,
      transformDragging: true,
      actorPathDragSnapshot: snapshotAuthoring(state),
      actorPathDragTarget: { pathId, controlPointId, field },
    };
  }),
  previewActorPathControlVector: (pathId, controlPointId, field, values) => set((state) => {
    const target = state.actorPathDragTarget;
    const path = state.actorPaths[pathId];
    const character = path && state.characters[path.targetId];
    if (!target || target.pathId !== pathId || target.controlPointId !== controlPointId || target.field !== field || !path || path.locked || !character || character.locked) return state;
    const controlPoint = path.controlPoints.find((point) => point.controlPointId === controlPointId);
    if (!controlPoint) return state;
    const vector = values.map((value) => finiteBounded(value, -30, 30)) as [number, number, number];
    if (controlPoint[field].every((value, axis) => value === vector[axis])) return state;
    return {
      actorPaths: {
        ...state.actorPaths,
        [pathId]: {
          ...path,
          controlPoints: path.controlPoints.map((point) => point.controlPointId === controlPointId ? { ...point, [field]: vector } : point),
        },
      },
      unsavedChanges: true,
    };
  }),
  commitActorPathControlDrag: () => set((state) => {
    const snapshot = state.actorPathDragSnapshot;
    const target = state.actorPathDragTarget;
    if (!snapshot || !target) return { actorPathDragSnapshot: null, actorPathDragTarget: null };
    const before = snapshot.actorPaths[target.pathId];
    const after = state.actorPaths[target.pathId];
    const changed = Boolean(before && after && JSON.stringify(before.controlPoints) !== JSON.stringify(after.controlPoints));
    return {
      transformDragging: false,
      actorPathDragSnapshot: null,
      actorPathDragTarget: null,
      ...(changed ? {
        actorPaths: { ...state.actorPaths, [target.pathId]: { ...after, revision: before.revision + 1 } },
        undoStack: [...state.undoStack, snapshot].slice(-100),
        redoStack: [],
        commandHistory: [...state.commandHistory, `path.control_point.drag.${target.field}`].slice(-100),
        unsavedChanges: true,
      } : {}),
    };
  }),
  cancelActorPathControlDrag: () => set((state) => state.actorPathDragSnapshot ? {
    ...state.actorPathDragSnapshot,
    transformDragging: false,
    actorPathDragSnapshot: null,
    actorPathDragTarget: null,
  } : { actorPathDragSnapshot: null, actorPathDragTarget: null }),
  appendActorPathControlPoint: (pathId) => set((state) => mutateActorPath(state, pathId, "path.control_point.append", (path) => {
    const points = [...path.controlPoints].sort((left, right) => left.order - right.order);
    const last = points.at(-1); const previous = points.at(-2);
    if (!last || points.length >= 12) return path;
    const delta: [number, number, number] = previous ? last.positionM.map((value, axis) => value - previous.positionM[axis]) as [number, number, number] : [0, 1, 0];
    if (Math.hypot(...delta) < 0.05) delta[1] = 1;
    const positionM = last.positionM.map((value, axis) => finiteBounded(value + delta[axis], -30, 30)) as [number, number, number];
    const handleInM = positionM.map((value, axis) => value - delta[axis] / 3) as [number, number, number];
    const controlPointId = `point-${path.targetId}-${String(points.reduce((maximum, point) => Math.max(maximum, Number(point.controlPointId.match(/(\d+)$/)?.[1]) || 0), 0) + 1).padStart(4, "0")}`;
    return { ...path, controlPoints: [...points, { controlPointId, positionM, handleInM, handleOutM: [...positionM], order: points.length }] };
  })),
  removeActorPathControlPoint: (pathId, controlPointId) => set((state) => mutateActorPath(state, pathId, "path.control_point.remove", (path) => {
    if (path.controlPoints.length <= 2 || !path.controlPoints.some((point) => point.controlPointId === controlPointId)) return path;
    return { ...path, controlPoints: path.controlPoints.filter((point) => point.controlPointId !== controlPointId).sort((left, right) => left.order - right.order).map((point, order) => ({ ...point, order })) };
  })),
  reverseActorPath: (pathId) => set((state) => mutateActorPath(state, pathId, "path.direction.reverse", (path) => ({ ...path, controlPoints: [...path.controlPoints].sort((left, right) => right.order - left.order).map((point, order) => ({ ...point, order, handleInM: [...point.handleOutM], handleOutM: [...point.handleInM] })) }))),
  upsertPathEvent: (request) => set((state) => {
    const actor = state.characters[request.actorId];
    const expectedPathId = `path-${request.actorId}`;
    if (!actor) return { pathEventDiagnostic: "角色目标不存在。" };
    if (actor.locked) return { pathEventDiagnostic: "角色已锁定，不能修改其路径事件。" };
    if (request.pathId !== expectedPathId) return { pathEventDiagnostic: "路径与角色归属不一致。" };
    if (request.obstacleObjectId && !state.sceneObjects[request.obstacleObjectId]) return { pathEventDiagnostic: "障碍或道具目标不存在。" };
    const obstacleObjectId = request.obstacleObjectId;
    const existing = request.pathEventId ? state.pathEvents.find((event) => event.pathEventId === request.pathEventId) : null;
    if (existing && (existing.pathId !== request.pathId || existing.actorId !== request.actorId)) return { pathEventDiagnostic: "不能通过编辑事件改变原有角色或路径归属。" };
    const nextSequence = state.pathEvents.reduce((maximum, event) => Math.max(maximum, Number(event.pathEventId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
    const startSeconds = finiteBounded(request.startSeconds, 0, state.dialogueTimeline.durationSeconds);
    const endSeconds = finiteBounded(request.endSeconds, startSeconds, state.dialogueTimeline.durationSeconds);
    if (endSeconds <= startSeconds) return { pathEventDiagnostic: "事件结束时间必须晚于开始时间。" };
    const supportedJoints = new Set(rigProfile.joints.filter((joint) => joint.control_class === "product_joint").map((joint) => joint.joint_id));
    const unsupportedJointIds = Array.from(new Set([...request.requiredJointIds, ...request.requiredContacts.map((contact) => contact.jointId)].filter((jointId) => !supportedJoints.has(jointId))));
    if (unsupportedJointIds.length) return { pathEventDiagnostic: `角色骨架不支持关节：${unsupportedJointIds.join(", ")}` };
    const missingContactTargets = request.requiredContacts.filter((contact) => !state.sceneObjects[contact.targetObjectId]).map((contact) => contact.targetObjectId);
    if (missingContactTargets.length) return { pathEventDiagnostic: `接触目标不存在：${missingContactTargets.join(", ")}` };
    const requiredJointIds = Array.from(new Set(request.requiredJointIds)).slice(0, 12);
    const requiredContacts = request.requiredContacts.slice(0, 8).map((contact) => ({ ...contact }));
    const pathEvent: PathEventState = { pathEventId: existing?.pathEventId ?? `path-event-${String(nextSequence).padStart(4, "0")}`, pathId: request.pathId, actorId: request.actorId, eventType: request.eventType, obstacleObjectId, startSeconds, endSeconds, pathParameter: request.pathParameter === null ? null : finiteBounded(request.pathParameter, 0, 1), spatialAnchorM: request.spatialAnchorM.map((value) => finiteBounded(value, -1000, 1000)) as [number, number, number], requiredJointIds, requiredContacts, releasePolicy: request.releasePolicy, previewMarker: { label: request.previewLabel?.trim().slice(0, 80) || request.eventType, color: { approach: "#34d399", avoid: "#d1fae5", pass: "#34d399", vault: "#f472b6", take_cover: "#a78bfa", reveal: "#22d3ee", contact: "#fb7185", release: "#94a3b8" }[request.eventType] }, exportMarker: request.exportMarker, limitations: ["preview_marker_not_motion_solver", "contacts_require_pose_and_compiler_review"] };
    const pathEvents = existing ? state.pathEvents.map((event) => event.pathEventId === pathEvent.pathEventId ? pathEvent : event) : [...state.pathEvents, pathEvent];
    return { ...mutateScene(state, existing ? "path.event.update" : "path.event.add", { pathEvents }), pathEventDiagnostic: null };
  }),
  removePathEvent: (pathEventId) => set((state) => state.pathEvents.some((event) => event.pathEventId === pathEventId) ? { ...mutateScene(state, "path.event.remove", { pathEvents: state.pathEvents.filter((event) => event.pathEventId !== pathEventId) }), pathEventDiagnostic: null } : state),
  insertApprovedSubjectProxy: (proxyAssetId) => set((state) => {
    const proxy = state.subjectProxies[proxyAssetId];
    if (!proxy || proxy.status !== "approved" || proxy.browser_capability_state !== "available") return state;
    if (!state.subjectReferenceSets[proxy.reference_set_id]) return state;
    const sceneObjectId = nextSceneObjectId(state.sceneObjects, "proxy");
    const sceneObject: SceneObjectAuthoringState = {
      sceneObjectId,
      revision: 1,
      label: `${state.subjectReferenceSets[proxy.reference_set_id].label} image-card`,
      objectKind: "proxy",
      primitiveKind: null,
      proxyRepresentationType: proxy.representation_type,
      proxyAssetId: proxy.proxy_asset_id,
      modelAssetId: null,
      inputId: proxy.source_input_id,
      transform: { position: [0, 0, state.renderScene.ground.heightM], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: true },
      dimensionsM: [...proxy.dimensions_m],
      pivotM: [...proxy.pivot_m],
      boundingBoxM: structuredClone(proxy.bounding_box_m),
      scaleBasis: ["declared_dimension", "estimated", "unknown"].includes(proxy.scale_basis) ? proxy.scale_basis as SceneObjectAuthoringState["scaleBasis"] : "unknown",
      materialHint: null,
      visible: true,
      locked: false,
      browserCapabilityState: proxy.browser_capability_state,
      compilerCapabilityState: proxy.compiler_capability_state,
      capabilityIds: [...proxy.capability_ids],
      limitations: [...proxy.limitations],
      calibratedPlacement: null,
    };
    return {
      ...mutateScene(state, "scene.object.add.subject_proxy", { sceneObjects: { ...state.sceneObjects, [sceneObjectId]: sceneObject } }),
      selectedSceneObjectId: sceneObjectId,
      selectedCharacterIds: [],
      subjectImportOpen: false,
    };
  }),
  applySubjectProxyReplacement: (replacedProxyAssetId, proxyAssetId) => set((state) => {
    const replaced = state.subjectProxies[replacedProxyAssetId];
    const replacement = state.subjectProxies[proxyAssetId];
    if (!replaced || !replacement || replaced.status !== "superseded" || replacement.status !== "approved") return state;
    if (replaced.subject_id !== replacement.subject_id || replacement.replaces_proxy_asset_id !== replacedProxyAssetId || replaced.superseded_by_proxy_asset_id !== proxyAssetId) return state;
    const referenceSet = state.subjectReferenceSets[replacement.reference_set_id];
    if (!referenceSet) return state;
    if (Object.values(state.actorMappings).some((mapping) => mapping.proxyAssetId === replacedProxyAssetId && mapping.subjectId !== null && mapping.subjectId !== replacement.subject_id)) return state;
    let changed = false;
    const actorMappings = Object.fromEntries(Object.entries(state.actorMappings).map(([mappingId, mapping]) => {
      if (mapping.proxyAssetId !== replacedProxyAssetId) return [mappingId, mapping];
      if (mapping.subjectId !== null && mapping.subjectId !== replacement.subject_id) return [mappingId, mapping];
      changed = true;
      return [mappingId, { ...mapping, subjectId: replacement.subject_id, referenceSetId: replacement.reference_set_id, proxyAssetId }];
    })) as Record<string, ActorMappingState>;
    const characters = Object.fromEntries(Object.entries(state.characters).map(([characterId, character]) => {
      if (character.proxyAssetId !== replacedProxyAssetId) return [characterId, character];
      changed = true;
      return [characterId, { ...character, proxyAssetId }];
    })) as Record<string, CharacterAuthoringState>;
    const sceneObjects = Object.fromEntries(Object.entries(state.sceneObjects).map(([sceneObjectId, sceneObject]) => {
      if (sceneObject.proxyAssetId !== replacedProxyAssetId) return [sceneObjectId, sceneObject];
      changed = true;
      return [sceneObjectId, {
        ...sceneObject,
        revision: sceneObject.revision + 1,
        proxyRepresentationType: replacement.representation_type,
        proxyAssetId: proxyAssetId,
        inputId: replacement.source_input_id,
        dimensionsM: [...replacement.dimensions_m],
        pivotM: [...replacement.pivot_m],
        boundingBoxM: structuredClone(replacement.bounding_box_m),
        scaleBasis: ["declared_dimension", "estimated", "unknown"].includes(replacement.scale_basis) ? replacement.scale_basis as SceneObjectAuthoringState["scaleBasis"] : "unknown",
        browserCapabilityState: replacement.browser_capability_state,
        compilerCapabilityState: replacement.compiler_capability_state,
        capabilityIds: [...replacement.capability_ids],
        limitations: [...replacement.limitations],
      }];
    })) as Record<string, SceneObjectAuthoringState>;
    return changed ? mutateScene(state, "scene.subject_proxy.replace", { actorMappings, characters, sceneObjects }) : state;
  }),
  loadSceneObjects: (sceneObjects) => set({
    sceneObjects: structuredClone(sceneObjects),
    selectedSceneObjectId: null,
    undoStack: [],
    redoStack: [],
    commandHistory: [],
    unsavedChanges: false,
  }),
  applyValidationScenePreset: (presetId) => set((state) => {
    const preset = presetId === "indoor-sofa-wide" ? indoorSofaValidationScene() : fightValidationScene();
    const renderScene = createInitialRenderSceneState();
    renderScene.labels = presetId === "indoor-sofa-wide"
      ? ["validation:indoor", "blocking:seated-trio", "camera:wide"]
      : ["validation:fight", "blocking:15s", "reference:pending"];
    const mutation = mutateScene(state, `scene.validation_preset.${presetId}`, {
      characters: preset.characters,
      actorMappings: preset.actorMappings,
      actorPaths: preset.actorPaths,
      sceneObjects: preset.sceneObjects,
      cameras: preset.cameras,
      cameraPaths: preset.cameraPaths,
      dialogueTimeline: preset.dialogueTimeline,
      pathEvents: preset.pathEvents,
      renderScene,
    });
    return {
      ...mutation,
      localAnimationImport: createIdleLocalAnimationImportState(),
      frameManifestImport: createIdleFrameManifestImportState(),
      selectedCharacterId: preset.selectedCharacterId,
      selectedCharacterIds: preset.selectedCharacterIds,
      selectedSceneObjectId: preset.selectedSceneObjectId,
      selectedCameraId: preset.selectedCameraId,
      viewMode: preset.viewMode,
      cameraSnapshots: preset.cameraSnapshots,
      externalCameraMotionProposals: [],
      selectedActorPathControlPointId: null,
      selectedActorPathVectorField: "positionM",
      actorPathDragSnapshot: null,
      actorPathDragTarget: null,
      selectedCameraPathControlPointId: null,
      selectedCameraPathVectorField: "positionM",
      cameraPathDragSnapshot: null,
      cameraPathDragTarget: null,
      cameraPathDragUnsavedChanges: null,
      pathEventDiagnostic: null,
      transformDragging: false,
      transformDragSnapshot: null,
      transformDragCharacterId: null,
      playheadFrame: 1,
    };
  }),
  toggleGroundVisible: () => set((state) => mutateScene(state, "scene.ground.visibility", {
    renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, visible: !state.renderScene.ground.visible } },
  })),
  toggleGroundLocked: () => set((state) => mutateScene(state, "scene.ground.lock", {
    renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, locked: !state.renderScene.ground.locked } },
  })),
  setGroundHeightM: (value) => set((state) => {
    if (state.renderScene.ground.locked) return state;
    const heightM = finiteBounded(value, -10, 10);
    if (heightM === state.renderScene.ground.heightM) return state;
    const characters = Object.fromEntries(Object.entries(state.characters).map(([characterId, character]) => [
      characterId,
      character.transform.groundSnap
        ? { ...character, transform: { ...character.transform, position: [character.transform.position[0], character.transform.position[1], heightM] as [number, number, number] } }
        : character,
    ]));
    const sceneObjects = Object.fromEntries(Object.entries(state.sceneObjects).map(([sceneObjectId, sceneObject]) => [
      sceneObjectId,
      sceneObject.transform.groundSnap
        ? { ...sceneObject, transform: { ...sceneObject.transform, position: [sceneObject.transform.position[0], sceneObject.transform.position[1], heightM] as [number, number, number] } }
        : sceneObject,
    ]));
    return mutateScene(state, "scene.ground.height", {
      characters,
      sceneObjects,
      renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, heightM } },
    });
  }),
  setGroundOpacity: (value) => set((state) => {
    if (state.renderScene.ground.locked) return state;
    const opacity = finiteBounded(value, 0, 1);
    if (opacity === state.renderScene.ground.opacity) return state;
    return mutateScene(state, "scene.ground.opacity", {
      renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, opacity } },
    });
  }),
  setGroundGridSpacingM: (value) => set((state) => {
    if (state.renderScene.ground.locked) return state;
    const gridSpacingM = finiteBounded(value, 0.05, 5);
    if (gridSpacingM === state.renderScene.ground.gridSpacingM) return state;
    return mutateScene(state, "scene.ground.grid_spacing", {
      renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, gridSpacingM } },
    });
  }),
  toggleGroundGridSnap: () => set((state) => state.renderScene.ground.locked ? state : mutateScene(state, "scene.ground.grid_snap", {
    renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, gridSnap: !state.renderScene.ground.gridSnap } },
  })),
  toggleGroundSurfaceSnap: () => set((state) => state.renderScene.ground.locked || state.renderScene.calibrationRevisionIds.length === 0 ? state : mutateScene(state, "scene.ground.surface_snap", {
    renderScene: { ...state.renderScene, ground: { ...state.renderScene.ground, surfaceSnap: !state.renderScene.ground.surfaceSnap } },
  })),
  setSceneRootTransformAxis: (field, axis, value) => set((state) => {
    if (axis < 0 || axis > 2) return state;
    const values = [...state.renderScene.sceneRootTransform[field]] as [number, number, number];
    values[axis] = value;
    const next = boundTransformValues(field, values);
    if (state.renderScene.sceneRootTransform[field].every((current, index) => current === next[index])) return state;
    return mutateScene(state, `scene.root_transform.${field}.${axis}`, {
      renderScene: {
        ...state.renderScene,
        sceneRootTransformRevision: state.renderScene.sceneRootTransformRevision + 1,
        sceneRootTransform: { ...state.renderScene.sceneRootTransform, [field]: next },
      },
    });
  }),
  resetSceneRootTransform: () => set((state) => {
    const identity = createInitialRenderSceneState().sceneRootTransform;
    if (JSON.stringify(state.renderScene.sceneRootTransform) === JSON.stringify(identity)) return state;
    return mutateScene(state, "scene.root_transform.reset", {
      renderScene: {
        ...state.renderScene,
        sceneRootTransformRevision: state.renderScene.sceneRootTransformRevision + 1,
        sceneRootTransform: identity,
      },
    });
  }),
  setPanoramaRotationAxis: (axis, value) => set((state) => {
    if (axis < 0 || axis > 2) return state;
    const calibrationId = state.renderScene.activePanoramaCalibrationId;
    if (calibrationId) return revisePanoramaCalibration(state, calibrationId, `scene.panorama.rotation.${axis}`, (calibration) => {
      const keys = ["pitch", "roll", "yaw"] as const;
      return { ...calibration, orientationDeg: { ...calibration.orientationDeg, [keys[axis]]: finiteBounded(value, -360, 360) } };
    });
    const rotationDeg = [...state.renderScene.panorama.rotationDeg] as [number, number, number];
    rotationDeg[axis] = finiteBounded(value, -360, 360);
    if (rotationDeg[axis] === state.renderScene.panorama.rotationDeg[axis]) return state;
    return mutateScene(state, `scene.panorama.rotation.${axis}`, {
      renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, rotationDeg } },
    });
  }),
  setPanoramaRadiusM: (value) => set((state) => {
    const calibrationId = state.renderScene.activePanoramaCalibrationId;
    if (calibrationId) return revisePanoramaCalibration(state, calibrationId, "scene.panorama.radius", (calibration) => ({ ...calibration, radiusM: finiteBounded(value, 1, 1000) }));
    const radiusM = finiteBounded(value, 1, 1000);
    if (radiusM === state.renderScene.panorama.radiusM) return state;
    return mutateScene(state, "scene.panorama.radius", {
      renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, radiusM } },
    });
  }),
  setPanoramaExposure: (value) => set((state) => {
    const calibrationId = state.renderScene.activePanoramaCalibrationId;
    if (calibrationId) return revisePanoramaCalibration(state, calibrationId, "scene.panorama.exposure", (calibration) => ({ ...calibration, exposure: finiteBounded(value, 0, 8) }));
    const exposure = finiteBounded(value, 0, 8);
    if (exposure === state.renderScene.panorama.exposure) return state;
    return mutateScene(state, "scene.panorama.exposure", {
      renderScene: { ...state.renderScene, panorama: { ...state.renderScene.panorama, exposure } },
    });
  }),
  addEnvironmentLabel: (value) => set((state) => {
    const label = value.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!label || state.renderScene.labels.includes(label) || state.renderScene.labels.length >= 32) return state;
    return mutateScene(state, "scene.labels.add", {
      renderScene: { ...state.renderScene, labels: [...state.renderScene.labels, label] },
    });
  }),
  removeEnvironmentLabel: (label) => set((state) => {
    if (!state.renderScene.labels.includes(label)) return state;
    return mutateScene(state, "scene.labels.remove", {
      renderScene: { ...state.renderScene, labels: state.renderScene.labels.filter((item) => item !== label) },
    });
  }),
  loadRenderScene: (renderScene) => set({
    renderScene: structuredClone(renderScene),
    panoramaDiagnosticPreviewInputId: null,
    panoramaDiagnosticPreviewYawDeg: 0,
    panoramaDiagnosticPreviewFlipVertical: false,
    panoramaPreviewStatus: renderScene.panorama.inputId ? { state: "loading", message: "正在恢复已保存的球面环境纹理…" } : { state: "idle", message: "尚未选择球面环境。" },
    undoStack: [],
    redoStack: [],
    commandHistory: [],
    unsavedChanges: false,
  }),
  undo: () => set((state) => {
    const snapshot = state.undoStack.at(-1);
    if (!snapshot) return state;
    const cameras = preserveImmutableSnapshotLinks(snapshot.cameras, state.cameraSnapshots);
    return {
      ...snapshot,
      cameras,
      selectedCameraId: cameras[state.selectedCameraId] ? state.selectedCameraId : Object.keys(cameras)[0] ?? state.selectedCameraId,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snapshotAuthoring(state)].slice(-100),
      commandHistory: [...state.commandHistory, "history.undo"].slice(-100),
      unsavedChanges: true,
    };
  }),
  redo: () => set((state) => {
    const snapshot = state.redoStack.at(-1);
    if (!snapshot) return state;
    const cameras = preserveImmutableSnapshotLinks(snapshot.cameras, state.cameraSnapshots);
    return {
      ...snapshot,
      cameras,
      selectedCameraId: cameras[state.selectedCameraId] ? state.selectedCameraId : Object.keys(cameras)[0] ?? state.selectedCameraId,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, snapshotAuthoring(state)].slice(-100),
      commandHistory: [...state.commandHistory, "history.redo"].slice(-100),
      unsavedChanges: true,
    };
  }),
  selectJoint: (selectedJointId) => set({ selectedJointId }),
  setJointFilter: (jointFilter) => set({ jointFilter }),
  setViewMode: (viewMode) => set({ viewMode }),
  setViewportNavigation: (viewMode, navigation) => set((state) => {
    const sanitized = sanitizeViewportNavigation(navigation, state.viewportNavigation[viewMode]);
    if (navigationEqual(sanitized, state.viewportNavigation[viewMode])) return state;
    return { viewportNavigation: { ...state.viewportNavigation, [viewMode]: sanitized } };
  }),
  setOrientationGizmo: (orientationGizmo) => set({ orientationGizmo }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setTransformDragging: (transformDragging) => set({ transformDragging }),
  beginTransformDrag: (characterId) => set((state) => {
    if (!state.characters[characterId] || state.characters[characterId].locked || state.transformDragSnapshot || state.actorPathDragSnapshot || state.cameraPathDragSnapshot) return state;
    return {
      transformDragging: true,
      transformDragSnapshot: snapshotAuthoring(state),
      transformDragCharacterId: characterId,
    };
  }),
  previewTransformVector: (characterId, field, values) => set((state) => {
    const character = state.characters[characterId];
    if (!character || character.locked || state.transformDragCharacterId !== characterId) return state;
    const next = field === "position" ? constrainPosition(state, character, values, true) : boundTransformValues(field, values);
    if (character.transform[field].every((value, index) => value === next[index])) return state;
    return {
      characters: { ...state.characters, [characterId]: { ...character, transform: { ...character.transform, [field]: next } } },
      unsavedChanges: true,
    };
  }),
  commitTransformDrag: (characterId, mode) => set((state) => {
    const snapshot = state.transformDragSnapshot;
    if (!snapshot || state.transformDragCharacterId !== characterId) return { transformDragging: false, transformDragSnapshot: null, transformDragCharacterId: null };
    const before = snapshot.characters[characterId]?.transform;
    const after = state.characters[characterId]?.transform;
    const changed = Boolean(before && after && JSON.stringify(before) !== JSON.stringify(after));
    return {
      transformDragging: false,
      transformDragSnapshot: null,
      transformDragCharacterId: null,
      ...(changed ? {
        undoStack: [...state.undoStack, snapshot].slice(-100),
        redoStack: [],
        commandHistory: [...state.commandHistory, `transform.drag.${mode}`].slice(-100),
        unsavedChanges: true,
      } : {}),
    };
  }),
  cancelTransformDrag: () => set((state) => state.transformDragSnapshot ? {
    ...state.transformDragSnapshot,
    transformDragging: false,
    transformDragSnapshot: null,
    transformDragCharacterId: null,
  } : { transformDragging: false, transformDragSnapshot: null, transformDragCharacterId: null }),
  setFullscreenActive: (fullscreenActive) => set({ fullscreenActive }),
  setPlayheadFrame: (playheadFrame) => set((state) => ({ playheadFrame: Math.round(finiteBounded(playheadFrame, 1, Math.max(1, Math.round(state.dialogueTimeline.durationSeconds * state.dialogueTimeline.fps) + 1))) })),
  toggleJointHandles: () => set((state) => ({ showJointHandles: !state.showJointHandles })),
  toggleInternalBones: () => set((state) => ({ showInternalBones: !state.showInternalBones })),
  setRigAdmissionIssues: (issues) => set({ rigAdmissionIssues: issues, rigAdmissionStatus: issues.length ? "failed" : "passed" }),
  setTransformVector: (characterId, field, values) =>
    set((state) => mutateCharacter(state, characterId, `transform.${field}`, (character) => {
      const next = field === "position" ? constrainPosition(state, character, values, false) : boundTransformValues(field, values);
      return { ...character, transform: { ...character.transform, [field]: next } };
    })),
  setTransformAxis: (characterId, field, axis, value) =>
    set((state) => mutateCharacter(state, characterId, `transform.${field}.${axis}`, (character) => {
      const values = [...character.transform[field]] as [number, number, number];
      values[axis] = value;
      const next = field === "position" ? constrainPosition(state, character, values, false) : boundTransformValues(field, values);
      return { ...character, transform: { ...character.transform, [field]: next } };
    })),
  toggleGroundSnap: (characterId) =>
    set((state) => mutateCharacter(state, characterId, "transform.ground_snap", (character) => {
      const groundSnap = !character.transform.groundSnap;
      const position = [...character.transform.position] as [number, number, number];
      if (groundSnap) position[2] = state.renderScene.ground.heightM;
      return { ...character, transform: { ...character.transform, groundSnap, position } };
    })),
  applyPosePreset: (characterId, presetId) =>
    set((state) => {
      if (state.rigAdmissionStatus !== "passed") return state;
      const preset = posePresetById.get(presetId);
      if (!preset) return state;
      return mutateCharacter(state, characterId, `pose.preset.${presetId}`, (character) => ({
        ...character,
        poseRootOffsetM: [...(preset.rootOffsetM ?? [0, 0, 0])],
        jointRotations: structuredClone(preset.rotations),
        activePresetId: presetId,
        adjustedJointIds: [],
        poseRevision: character.poseRevision + 1,
      }));
    }),
  mirrorPose: (characterId) =>
    set((state) => {
      if (state.rigAdmissionStatus !== "passed") return state;
      return mutateCharacter(state, characterId, "pose.mirror", (character) => {
        if (Object.keys(character.jointRotations).length === 0) return character;
        const mirrored: Record<string, Rotation> = {};
        for (const [jointId, rotation] of Object.entries(character.jointRotations)) {
          const joint = jointById.get(jointId);
          mirrored[joint?.mirror_joint_id ?? jointId] = mirrorRotation(rotation);
        }
        return {
          ...character,
          poseRootOffsetM: [-character.poseRootOffsetM[0], character.poseRootOffsetM[1], character.poseRootOffsetM[2]],
          jointRotations: mirrored,
          activePresetId: null,
          adjustedJointIds: Object.keys(mirrored).sort(),
          poseRevision: character.poseRevision + 1,
        };
      });
    }),
  setPoseRootOffsetAxis: (characterId, axis, value) =>
    set((state) => {
      if (state.rigAdmissionStatus !== "passed") return state;
      return mutateCharacter(state, characterId, `pose.root_offset.${axis}`, (character) => {
        if (axis < 0 || axis > 2) return character;
        const poseRootOffsetM = [...character.poseRootOffsetM] as [number, number, number];
        const nextValue = finiteBounded(value, -1, 1);
        if (poseRootOffsetM[axis] === nextValue) return character;
        poseRootOffsetM[axis] = nextValue;
        return { ...character, poseRootOffsetM, poseRevision: character.poseRevision + 1 };
      });
    }),
  setJointRotation: (characterId, jointId, axis, value) =>
    set((state) => {
      if (state.rigAdmissionStatus !== "passed") return state;
      const joint = jointById.get(jointId);
      if (!joint || joint.control_class !== "product_joint" || joint.edit_policy !== "direct") return state;
      return mutateCharacter(state, characterId, `pose.joint.${jointId}.${axis}`, (character) => {
        const current = character.jointRotations[jointId] ?? ZERO_ROTATION;
        const nextValue = clampRotation(joint, axis, value);
        if (current[axis] === nextValue) return character;
        return {
          ...character,
          jointRotations: { ...character.jointRotations, [jointId]: { ...current, [axis]: nextValue } },
          adjustedJointIds: Array.from(new Set([...character.adjustedJointIds, jointId])).sort(),
          poseRevision: character.poseRevision + 1,
        };
      });
    }),
  resetJoint: (characterId, jointId) =>
    set((state) => {
      if (state.rigAdmissionStatus !== "passed") return state;
      return mutateCharacter(state, characterId, `pose.joint.${jointId}.reset`, (character) => {
        const presetRotation = character.activePresetId ? posePresetById.get(character.activePresetId)?.rotations[jointId] : undefined;
        const current = character.jointRotations[jointId];
        if (!current && !presetRotation) return character;
        if (presetRotation && !character.adjustedJointIds.includes(jointId)) return character;
        const jointRotations = { ...character.jointRotations };
        if (presetRotation) jointRotations[jointId] = { ...presetRotation };
        else delete jointRotations[jointId];
        return {
          ...character,
          jointRotations,
          adjustedJointIds: character.adjustedJointIds.filter((id) => id !== jointId),
          poseRevision: character.poseRevision + 1,
        };
      });
    }),
  resetPose: (characterId) =>
    set((state) => {
      if (state.rigAdmissionStatus !== "passed") return state;
      return mutateCharacter(state, characterId, "pose.reset", (character) => {
        if (
          Object.keys(character.jointRotations).length === 0
          && character.activePresetId === "pose.neutral"
          && character.poseRootOffsetM.every((value) => value === 0)
        ) return character;
        return {
          ...character,
          poseRootOffsetM: [0, 0, 0],
          jointRotations: {},
          activePresetId: "pose.neutral",
          adjustedJointIds: [],
          poseRevision: character.poseRevision + 1,
        };
      });
    }),
}));

export { clampRotation };
