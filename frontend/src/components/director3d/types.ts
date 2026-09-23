import type { RecreationFrameManifest } from "@/lib/recreation";

export type ControlClass = "product_joint" | "deformation_helper" | "attachment";
export type EditPolicy = "direct" | "derived" | "read_only";
export type Axis = "x" | "y" | "z";
export type Rotation = Record<Axis, number>;

export interface JointDefinition {
  joint_id: string;
  parent_joint_id: string | null;
  rest_rotation_deg: [number, number, number];
  supported_axes: Axis[];
  rotation_limits_deg: Partial<Record<Axis, [number, number]>>;
  semantic_role: string;
  side: "left" | "right" | "center";
  mirror_joint_id: string | null;
  control_class: ControlClass;
  edit_policy: EditPolicy;
}

export interface RigProfile {
  rig_profile_id: string;
  version: string;
  joint_vocabulary_version: string;
  mapping_version: string;
  limit_policy_version: string;
  semantic_control_policy: {
    version: string;
    control_id_template: "joint.{joint_id}.{axis}";
    input_range: [-1, 1];
    neutral_value: 0;
    mapping_curve: "piecewise_linear_neutral";
    output_range_source: "joint.rotation_limits_deg";
    admission: "every_direct_product_joint_axis";
    mirror_axis_value_scale: Rotation;
  };
  joints: JointDefinition[];
  pose_preset_ids: string[];
}

export type ViewMode = "director" | "top" | "camera";
export type TransformMode = "translate" | "rotate" | "scale";
export type DirectorValidationPresetId = "indoor-sofa-wide" | "fight-15s";
export type PrimitiveKind = "cube" | "sphere" | "cylinder" | "torus" | "cone" | "pyramid";
export type SceneObjectKind = "primitive" | "proxy" | "model_3d" | "gaussian_splat" | "empty" | "reference_board" | "reference_video";

export interface ObjectTransform {
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: [number, number, number];
  groundSnap: boolean;
}

export type NormalizedPoint2 = [number, number];
export type CalibrationSupportRole = "calibration_depth" | "foreground_mask" | "occlusion_mask" | "segmentation_mask" | "shadow_contact_mask";

export interface CalibrationSupportLayerState {
  layerId: string;
  role: CalibrationSupportRole;
  inputId: string;
  sourceScenePlateInputId: string;
  calibrationRevision: number;
  width: number;
  height: number;
  alignment: "pixel_aligned";
  qualityState: "draft" | "usable" | "verified";
  confirmed: boolean;
  depthSurface: {
    encoding: "normalized_grayscale_ray_distance";
    nearM: number;
    farM: number;
    gridWidth: number;
    gridHeight: number;
    samplesNormalized: number[];
  } | null;
}

export interface ScenePlateCompositingState {
  revision: number;
  enabled: boolean;
  layerOrder: ["background_plate", "three_d_subjects", "shadow_contact", "foreground_occlusion"];
  foregroundInputId: string | null;
  depthInputId: string | null;
  shadowContactInputId: string | null;
  depthOrderingMode: "none" | "foreground_mask" | "depth_surface";
  shadowReceiver: { enabled: boolean; opacity: number; softnessPx: number; groundHeightM: number };
  lightDirectionHint: [number, number, number];
  appearance: { exposure: number; saturation: number; colorTemperatureK: number };
  availability: { occlusion: boolean; depth: boolean; shadowContact: boolean };
  quality: { occlusion: "unavailable" | "draft" | "usable" | "verified"; depth: "unavailable" | "draft" | "usable" | "verified"; shadowContact: "unavailable" | "draft" | "usable" | "verified"; colorMatch: "draft" | "usable" | "verified" };
  parityTarget: { schemaVersion: "director-scene-plate-compositing-parity.v1"; colorSpace: "srgb"; alphaMode: "straight"; layerOrderChecksum: "background_plate>three_d_subjects>shadow_contact>foreground_occlusion" };
}

export interface PerspectiveScenePlateCalibrationState {
  calibrationId: string;
  revision: number;
  sourceInputId: string;
  imageWidth: number;
  imageHeight: number;
  fitMode: "contain" | "cover";
  cropNormalized: { x: number; y: number; width: number; height: number };
  horizonYNormalized: number;
  verticalDirectionNormalized: NormalizedPoint2;
  groundRegionNormalized: [NormalizedPoint2, NormalizedPoint2, NormalizedPoint2, NormalizedPoint2];
  worldOriginM: [number, number, number];
  camera: {
    positionM: [number, number, number];
    lookAtM: [number, number, number];
    worldUp: [number, number, number];
    verticalFovDeg: number;
    principalPointNormalized: NormalizedPoint2;
  };
  groundPlane: { heightM: number };
  scaleAnchor: { startNormalized: NormalizedPoint2; endNormalized: NormalizedPoint2; distanceM: number };
  workingBoundsM: { minimum: [number, number, number]; maximum: [number, number, number] };
  method: "manual" | "automatic_suggestion";
  horizonResidualPx: number;
  scaleErrorRatio: number;
  confidence: number;
  qualityState: "draft" | "usable" | "verified";
  confirmed: boolean;
  supportLayers: CalibrationSupportLayerState[];
  compositing: ScenePlateCompositingState;
}

export interface EquirectangularPanoramaCalibrationState {
  calibrationId: string;
  revision: number;
  sourceInputId: string;
  projectionType: "equirectangular";
  orientationDeg: { yaw: number; pitch: number; roll: number };
  forwardDirection: [number, number, number];
  northDirection: [number, number, number];
  horizonYNormalized: number;
  scaleConvention: "metric_sphere_radius";
  radiusM: number;
  groundHeightM: number;
  worldOriginM: [number, number, number];
  exposure: number;
  contactAlignment: {
    enabled: boolean;
    azimuthDeg: number;
    groundOffsetM: number;
  };
  method: "manual" | "automatic_suggestion";
  qualityState: "draft" | "usable" | "verified";
  confidence: number;
  confirmed: boolean;
}

export interface CalibratedPlacementState {
  targetType: "character" | "scene_object";
  targetId: string;
  calibrationId: string;
  calibrationRevision: number;
  screenAnchorNormalized: NormalizedPoint2;
  placementSurface: "ground_plane" | "depth_surface";
  placementSurfaceInputId: string | null;
  worldPositionM: [number, number, number];
  reprojectedNormalized: NormalizedPoint2;
  reprojectionErrorPx: number;
  confidence: number;
  reviewRequired: boolean;
}

export interface SceneObjectAuthoringState {
  sceneObjectId: string;
  revision: number;
  label: string;
  objectKind: SceneObjectKind;
  primitiveKind: PrimitiveKind | null;
  proxyRepresentationType: "image_card" | "parametric_human" | "rigged_human" | "primitive" | "static_mesh" | "gaussian_splat" | null;
  proxyAssetId: string | null;
  modelAssetId: string | null;
  inputId: string | null;
  transform: ObjectTransform;
  dimensionsM: [number, number, number];
  pivotM: [number, number, number];
  boundingBoxM: { minimum: [number, number, number]; maximum: [number, number, number] };
  scaleBasis: "canonical_parameter" | "declared_dimension" | "asset_bounds" | "estimated" | "unknown";
  materialHint: { color: string; roughness: number } | null;
  visible: boolean;
  locked: boolean;
  browserCapabilityState: "available" | "unavailable";
  compilerCapabilityState: "available" | "unavailable";
  capabilityIds: string[];
  limitations: string[];
  calibratedPlacement: CalibratedPlacementState | null;
}

export interface SubjectReferenceView {
  asset_id: string;
  role: string;
  ordinal: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  mask_asset_id: string | null;
}

export interface SubjectReferenceSetState {
  reference_set_id: string;
  subject_id: string;
  subject_kind: "person" | "product";
  label: string;
  views: SubjectReferenceView[];
  known_dimensions_m: Record<string, number> | null;
  capture_assumptions: string[];
  required_view_roles: string[];
  missing_view_roles: string[];
  subject_separation_state: "unconfirmed" | "crop_only" | "mask_confirmed";
  turntable: { asset_id: string; duration_seconds: number; frame_count: number; rotation_degrees: number; direction: "clockwise" | "counterclockwise" | "unknown"; looped: boolean } | null;
}

export interface SubjectProxyAssetState {
  proxy_asset_id: string;
  revision: number;
  subject_id: string;
  reference_set_id: string;
  status: "pending_review" | "approved" | "rejected" | "superseded";
  representation_type: "image_card" | "parametric_human" | "rigged_human" | "primitive" | "static_mesh" | "gaussian_splat";
  source_input_id: string;
  source_view_role: string;
  browser_artifact_checksum: string | null;
  compiler_artifact_checksum: string | null;
  coordinate_system: string;
  transform: Record<string, unknown>;
  dimensions_m: [number, number, number];
  pivot_m: [number, number, number];
  bounding_box_m: { minimum: [number, number, number]; maximum: [number, number, number] };
  scale_basis: "declared_dimension" | "person_height" | "scene_anchor" | "estimated" | "unknown";
  conversion_method: string;
  confidence: number;
  browser_capability_state: "available" | "unavailable";
  compiler_capability_state: "available" | "unavailable";
  capability_ids: string[];
  limitations: string[];
  replaces_proxy_asset_id?: string | null;
  superseded_by_proxy_asset_id?: string | null;
}

export interface ActorMappingState {
  actorMappingId: string;
  characterId: string;
  subjectId: string | null;
  referenceSetId: string | null;
  proxyAssetId: string | null;
  appearanceRole: "primary_identity" | "supporting_identity" | "reference_only" | "unassigned";
}

export interface DialogueBeatState {
  dialogueBeatId: string;
  characterId: string;
  actorMappingId: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  deliveryHint: string | null;
  audioInputId: string | null;
}

export interface SpeakerTrackState {
  speakerTrackId: string;
  characterId: string;
  actorMappingId: string;
  dialogueBeatIds: string[];
  startSeconds: number;
  endSeconds: number;
  audioInputId: string | null;
}

export interface FocusTargetState {
  targetType: "character" | "scene_object" | "world_point";
  targetId: string;
  worldPositionM: [number, number, number] | null;
}

export interface FocusTrackState {
  focusTrackId: string;
  cameraId: string;
  startSeconds: number;
  endSeconds: number;
  fromTarget: FocusTargetState;
  toTarget: FocusTargetState;
  transition: "cut" | "linear" | "ease_in_out";
  narrativeIntent: string | null;
}

export interface InteractionAnchorState {
  interactionAnchorId: string;
  characterId: string;
  actorMappingId: string;
  jointId: string;
  contactTarget: FocusTargetState;
  contactMode: "touch" | "grip" | "plant" | "support" | "follow";
  startSeconds: number;
  endSeconds: number;
  offsetM: [number, number, number];
  releasePolicy: "release_at_end" | "hold_after_end";
  limitation: "reference_constraint_not_physics";
}

export interface CameraNoiseTrackState {
  cameraNoiseTrackId: string;
  cameraId: string;
  profile: "handheld" | "breathing" | "vehicle" | "impact";
  translationAmplitudeM: number;
  rotationAmplitudeDeg: number;
  frequencyHz: number;
  translationAxisLimitsM: [number, number, number];
  rotationAxisLimitsDeg: [number, number, number];
  startSeconds: number;
  endSeconds: number;
  seed: number;
  enabled: boolean;
  compositionMode: "additive_after_base_path";
}

export type CameraCompositionPresetId = "close_up" | "medium" | "medium_wide" | "wide" | "full_body" | "two_shot";
export type CameraAspectRatio = "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export interface CameraTargetState { targetType: "character" | "scene_object" | "world_point"; targetId: string; }

export interface CameraCompositionState {
  cameraId: string;
  label: string;
  transform: ObjectTransform;
  fovDeg: number;
  focalLengthMm: number;
  zoom: number;
  aspectRatio: CameraAspectRatio;
  compositionPresetId: CameraCompositionPresetId;
  subjectTargetIds: string[];
  lookAt: CameraTargetState | null;
  follow: CameraTargetState | null;
  framingGuides: { ruleOfThirds: boolean; centerCross: boolean; safeArea: boolean };
  snapshotIds: string[];
  visible: boolean;
  locked: boolean;
}

export interface CameraSnapshotState {
  snapshotId: string;
  cameraId: string;
  label: string;
  order: number;
  frame: number;
  transform: ObjectTransform;
  fovDeg: number;
  focalLengthMm: number;
  zoom: number;
  aspectRatio: CameraAspectRatio;
  compositionPresetId: CameraCompositionPresetId;
  subjectTargetIds: string[];
  lookAt: CameraTargetState | null;
  follow: CameraTargetState | null;
  actorMappingIds: string[];
  framingGuides: CameraCompositionState["framingGuides"];
  dimensionsPx: { width: number; height: number };
  stateChecksum: string;
}

export type PathEventType = "approach" | "avoid" | "pass" | "vault" | "take_cover" | "reveal" | "contact" | "release";

export interface PathEventState {
  pathEventId: string;
  pathId: string;
  actorId: string;
  eventType: PathEventType;
  obstacleObjectId: string | null;
  startSeconds: number;
  endSeconds: number;
  pathParameter: number | null;
  spatialAnchorM: [number, number, number];
  requiredJointIds: string[];
  requiredContacts: Array<{ jointId: string; targetObjectId: string; contactMode: "touch" | "grip" | "support" | "release" }>;
  releasePolicy: "none" | "at_event_end" | "explicit_release_event";
  previewMarker: { label: string; color: string };
  exportMarker: boolean;
  limitations: string[];
}

export type ActorPathEasing = "linear" | "bezier" | "ease_in" | "ease_out" | "ease_in_out";

export interface ActorPathControlPointState {
  controlPointId: string;
  positionM: [number, number, number];
  handleInM: [number, number, number];
  handleOutM: [number, number, number];
  order: number;
}

export interface ActorPathState {
  pathId: string;
  targetType: "character";
  targetId: string;
  durationSeconds: number;
  easing: ActorPathEasing;
  controlPoints: ActorPathControlPointState[];
  revision: number;
  locked: boolean;
  visible: boolean;
}

export type CameraPathPresetId = "orbit" | "half_arc" | "push_in" | "pull_out" | "lift" | "drop" | "lateral" | "spiral_rise";
export type CameraPathApplyMode = "replace" | "append";

export interface CameraPathState {
  pathId: string;
  targetType: "camera";
  targetId: string;
  durationSeconds: number;
  easing: ActorPathEasing;
  presetIds: CameraPathPresetId[];
  controlPoints: ActorPathControlPointState[];
  revision: number;
  locked: boolean;
  visible: boolean;
}

export type ExternalCameraCoordinateSystem = "director_z_up" | "arkit_right_handed_y_up" | "android_right_handed_y_up";
export type ExternalCameraMotionReviewState = "proposed" | "approved" | "rejected" | "applied";

export interface ExternalCameraMotionSampleState {
  timestampSeconds: number;
  position: [number, number, number];
  orientationDeg: [number, number, number];
  convertedPositionM: [number, number, number];
  convertedOrientationDeg: [number, number, number];
  alignedTimeSeconds: number;
}

export interface ExternalCameraMotionProposalState {
  proposalId: string;
  revision: number;
  sourceInputId: string;
  sourceChecksum: string;
  targetCameraId: string;
  audioInputId: string | null;
  audioChecksum: string | null;
  coordinateSystem: ExternalCameraCoordinateSystem;
  unitsPerMeter: number;
  scaleMultiplier: number;
  originM: [number, number, number];
  rotationOffsetDeg: [number, number, number];
  sourceStartSeconds: number;
  timelineStartSeconds: number;
  audioOffsetSeconds: number;
  smoothingWindow: number;
  rawSamples: ExternalCameraMotionSampleState[];
  convertedSamples: ExternalCameraMotionSampleState[];
  confidence: number;
  limitations: string[];
  reviewState: ExternalCameraMotionReviewState;
  appliedPathId: string | null;
  appliedPathRevision: number | null;
}

export type TimelineInterpolation = "step" | "linear" | "bezier";
export type TimelineTargetType = "scene_object" | "character" | "camera" | "path" | "timeline";
export type TimelineTrackKind = "character_transform" | "character_pose" | "actor_path_progress" | "camera_transform" | "camera_target" | "camera_fov" | "camera_path_progress" | "object_visibility" | "active_camera";

export interface TimelineKeyframeState {
  keyframeId: string;
  timeSeconds: number;
  value: unknown;
  interpolation: TimelineInterpolation;
}

export interface TimelineTrackState {
  trackId: string;
  trackKind: TimelineTrackKind;
  target: { targetType: TimelineTargetType; targetId: string };
  propertyKey: string;
  keyframes: TimelineKeyframeState[];
}

export interface DialogueTimelineState {
  timelineId: string;
  durationSeconds: number;
  fps: number;
  dialogueBeats: DialogueBeatState[];
  speakerTracks: SpeakerTrackState[];
  focusTracks: FocusTrackState[];
  interactionAnchors: InteractionAnchorState[];
  cameraNoiseTracks: CameraNoiseTrackState[];
  tracks: TimelineTrackState[];
  activeCameraTrackId: string | null;
}

export type LocalAnimationImportStatus = "idle" | "reading" | "ready" | "applied" | "error";
export type LocalAnimationTrackKind = "character_pose" | "character_transform";

export interface LocalAnimationTrackManifest {
  trackId: string;
  trackKind: LocalAnimationTrackKind;
  target: { characterId: string };
  propertyKey: "pose.normalized_values" | "transform.position_m";
  keyframes: Array<{
    keyframeId?: string;
    timeSeconds: number;
    value: unknown;
    interpolation: TimelineInterpolation;
  }>;
}

export interface LocalAnimationManifest {
  schemaVersion: "iframe.director3d.local-animation.v1";
  manifestId: string;
  title: string;
  durationSeconds: number;
  fps: number;
  source: { kind: "local"; label: string };
  tracks: LocalAnimationTrackManifest[];
  limitations: string[];
}

export interface LocalAnimationCharacterMapping {
  requestedId: string;
  characterId: string;
}

export interface LocalAnimationImportState {
  status: LocalAnimationImportStatus;
  fileName: string | null;
  manifest: LocalAnimationManifest | null;
  tracks: TimelineTrackState[];
  characterMappings: LocalAnimationCharacterMapping[];
  totalKeyframes: number;
  warnings: string[];
  errors: string[];
  appliedAt: string | null;
}

export type FrameManifestImportStatus = "idle" | "reading" | "ready" | "error";

export interface FrameManifestImportState {
  status: FrameManifestImportStatus;
  fileName: string | null;
  manifest: RecreationFrameManifest | null;
  revision: number;
  errors: string[];
  importedAt: string | null;
}

export interface DialogueReferenceInputState {
  inputId: string;
  label: string;
  mediaKind: "audio" | "video";
  durationSeconds: number | null;
  checksum?: string;
}

export interface ObjectAssetCatalogState {
  status: "loading" | "ready" | "error" | "unavailable";
  message: string;
  assets: AdmittedObjectAsset[];
}

export interface EnvironmentInputEntry {
  inputId: string;
  checksum: string;
  label: string;
  mediaKind: "image" | "video";
  usage: "panorama" | "scene_plate" | "reference_board" | "background_video" | "reference_video" | "external_camera_motion_reference" | CalibrationSupportRole;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  projection: "equirectangular" | "perspective_plane" | "bounded_video_plane" | "calibration_layer";
  workflowState: string;
  environmentAllowed: boolean;
  admissionChecksum?: string | null;
  blockingCodes: string[];
  depthSampleGrid: { width: number; height: number; samples: number[] } | null;
}

export interface EnvironmentInputCatalogState {
  status: "loading" | "ready" | "error";
  message: string;
  entries: EnvironmentInputEntry[];
}

export interface AdmittedObjectAsset {
  assetId: string;
  inputId: string;
  label: string;
  objectKind: "model_3d" | "gaussian_splat";
  dimensionsM: [number, number, number];
  pivotM: [number, number, number];
  boundingBoxM: { minimum: [number, number, number]; maximum: [number, number, number] };
  scaleBasis: "asset_bounds" | "unknown";
  browserCapabilityState: "available" | "unavailable";
  compilerCapabilityState: "available" | "unavailable";
  capabilityIds: string[];
  limitations: string[];
}

export interface ViewportNavigation {
  positionM: [number, number, number];
  targetM: [number, number, number];
  up: [number, number, number];
  zoom: number;
}

export type ViewportNavigationByView = Record<ViewMode, ViewportNavigation>;

export interface OrientationGizmoState {
  visible: boolean;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

export interface RenderSceneState {
  metricWorldScale: 1;
  skyColor: string;
  sceneRootTransformRevision: number;
  sceneRootTransform: ObjectTransform;
  ground: {
    visible: boolean;
    locked: boolean;
    heightM: number;
    opacity: number;
    gridSpacingM: number;
    gridSnap: boolean;
    surfaceSnap: boolean;
  };
  panorama: {
    inputId: string | null;
    rotationDeg: [number, number, number];
    radiusM: number;
    exposure: number;
  };
  labels: string[];
  calibrationRevisionIds: string[];
  scenePlateCalibrations: PerspectiveScenePlateCalibrationState[];
  panoramaCalibrations: EquirectangularPanoramaCalibrationState[];
  activePanoramaCalibrationId: string | null;
}
