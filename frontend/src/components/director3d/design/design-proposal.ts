import { Vector3 } from "three";
import type { AuthoringSnapshot, WorkbenchState } from "../state/workbench-store";
import { cameraProjection, cameraRuntime, stateTargetPosition } from "../timeline/timeline-evaluation";
import { currentDirectorShotPackage } from "../reference/current-shot-package";
import { applyDesignPose, DESIGN_POSES, SEATED_FIT, type DesignPoseId } from "./design-poses";
import { createCameraPathPresetControlPoints } from "../camera/camera-path-presets";
import type { ActorPathEasing, CameraPathPresetId, CameraPathState, DialogueTimelineState, TimelineTrackState } from "../types";

type Vec = [number, number, number];
export type DesignOperation =
  | { kind: "place_entity"; entityId: string; positionM: Vec; yawDeg: number }
  | { kind: "arrange_pair"; actorIds: [string, string]; centerM: Vec; separationM: number; axisDeg: number }
  | { kind: "arrange_group"; members: Array<{ actorId: string; positionM: Vec; yawDeg: number; presetId?: DesignPoseId }> }
  | { kind: "add_box"; entityId: string; label: string; positionM: Vec; dimensionsM: Vec }
  | { kind: "set_pose"; actorId: string; presetId: DesignPoseId }
  | { kind: "seat_actor"; actorId: string; chairId: string }
  | { kind: "camera_motion"; cameraId: string; presetId: CameraPathPresetId; durationSeconds: number; easing: ActorPathEasing }
  | { kind: "frame_camera"; cameraId: string; targetIds: string[]; azimuthDeg: number; elevationDeg: number; distanceM: number; focalLengthMm: number }
  | { kind: "dolly_camera"; cameraId: string; towardM: number };
export interface DesignProposal {
  schemaVersion: "iframe.director3d.design-proposal.v1";
  baseRevision: string;
  summary: string;
  assumptions: string[];
  clarification: string | null;
  operations: DesignOperation[];
}
export type DesignPreview = Pick<AuthoringSnapshot, "characters" | "sceneObjects" | "cameras" | "cameraPaths" | "dialogueTimeline"> & { cameraId: string; baseRevision: string };

export function designRevision(state: WorkbenchState): string {
  const source = JSON.stringify({ characters: state.characters, objects: state.sceneObjects, cameras: state.cameras,
    renderScene: state.renderScene, actorPaths: state.actorPaths, cameraPaths: state.cameraPaths,
    timeline: state.dialogueTimeline, selectedCameraId: state.selectedCameraId, frame: state.playheadFrame,
    viewMode: state.viewMode, selectedCharacterIds: state.selectedCharacterIds, selectedObjectId: state.selectedSceneObjectId,
    environmentInputs: state.environmentInputCatalog.entries, rig: state.rigAdmissionStatus,
  });
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `design-fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function designContext(state: WorkbenchState): string {
  const shot = currentDirectorShotPackage(state);
  return JSON.stringify({ package: shot, cameras: state.cameras,
    actors: Object.values(state.characters).map(({ characterId, label, locked, visible, proxyAssetId, activePresetId }) => ({ characterId, label, locked, visible, proxyAssetId, activePresetId })),
    selectedCharacterId: state.selectedCharacterId, selectedObjectId: state.selectedSceneObjectId,
    selectedCameraId: state.selectedCameraId, groundHeightM: state.renderScene.ground.heightM,
    animated: state.dialogueTimeline.tracks.length > 0 || Object.keys(state.actorPaths).length > 0 || Object.keys(state.cameraPaths).length > 0,
    supported: ["static placement", "pair facing", "numbered group blocking", "box proxy", "static camera", "static dolly", "timed camera path", "pose preset", "seated procedural chair reference"],
    posePresets: DESIGN_POSES,
    seating: { representation: "procedural_reference", calibratedRig: "canonical_white_model", seatHeightM: SEATED_FIT.supportHeightM + SEATED_FIT.groundLiftM, preservesCamera: true },
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("提案数据格式无效。");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join() !== [...expected].sort().join()) throw new Error("提案包含不支持或缺少的字段。");
}
function text(value: unknown, max = 100): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("提案文字或对象 ID 无效。");
}
function number(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("提案数值超出支持范围。");
}
function vector(value: unknown, min = -100, max = 100): asserts value is Vec {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("提案坐标须有三个分量。");
  value.forEach((v) => number(v, min, max));
}
function ids(value: unknown, min: number, max: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("目标数量不受支持。");
  value.forEach((v) => text(v));
  if (new Set(value).size !== value.length) throw new Error("目标不能重复。");
}
/** Validate untrusted model/API data independently of server validation. */
export function parseDesignProposal(raw: unknown): DesignProposal {
  const p = object(raw);
  keys(p, ["schemaVersion", "baseRevision", "summary", "assumptions", "clarification", "operations"]);
  if (p.schemaVersion !== "iframe.director3d.design-proposal.v1" || typeof p.baseRevision !== "string" || !/^design-fnv1a32:[0-9a-f]{8}$/.test(p.baseRevision)) throw new Error("提案版本无效。");
  text(p.summary, 1000);
  if (!Array.isArray(p.assumptions) || p.assumptions.length > 12) throw new Error("提案假设格式无效。");
  p.assumptions.forEach((v) => text(v, 300));
  if (p.clarification !== null) text(p.clarification, 1000);
  if (!Array.isArray(p.operations) || p.operations.length > 16 || Boolean(p.clarification) === Boolean(p.operations.length)) throw new Error("提案须包含操作或待澄清问题。");
  for (const value of p.operations) {
    const op = object(value);
    if (op.kind === "place_entity") {
      keys(op, ["kind", "entityId", "positionM", "yawDeg"]); text(op.entityId); vector(op.positionM); number(op.yawDeg, -360, 360);
    } else if (op.kind === "arrange_pair") {
      keys(op, ["kind", "actorIds", "centerM", "separationM", "axisDeg"]); ids(op.actorIds, 2, 2); vector(op.centerM); number(op.separationM, .8, 20); number(op.axisDeg, -360, 360);
    } else if (op.kind === "arrange_group") {
      keys(op, ["kind", "members"]);
      if (!Array.isArray(op.members) || op.members.length < 2 || op.members.length > 10) throw new Error("多人编排数量须在 2 到 10 人之间。");
      const memberIds = new Set<string>();
      op.members.forEach((member) => {
        const item = object(member); keys(item, ["actorId", "positionM", "yawDeg", ...(item.presetId === undefined ? [] : ["presetId"])]);
        text(item.actorId); if (memberIds.has(item.actorId as string)) throw new Error("多人编排人物不能重复。"); memberIds.add(item.actorId as string);
        vector(item.positionM); number(item.yawDeg, -360, 360); if (item.presetId !== undefined && !DESIGN_POSES.includes(item.presetId as DesignPoseId)) throw new Error("多人编排姿态不受支持。");
      });
    } else if (op.kind === "add_box") {
      keys(op, ["kind", "entityId", "label", "positionM", "dimensionsM"]); text(op.entityId); text(op.label, 80); vector(op.positionM); vector(op.dimensionsM, .050001, 20);
      if (!(op.entityId as string).startsWith("design-box-")) throw new Error("新占位物体 ID 无效。");
    } else if (op.kind === "frame_camera") {
      keys(op, ["kind", "cameraId", "targetIds", "azimuthDeg", "elevationDeg", "distanceM", "focalLengthMm"]); text(op.cameraId); ids(op.targetIds, 1, 8);
      number(op.azimuthDeg, -360, 360); number(op.elevationDeg, -60, 80); number(op.distanceM, .5, 50); number(op.focalLengthMm, 12, 200);
    } else if (op.kind === "dolly_camera") {
      keys(op, ["kind", "cameraId", "towardM"]); text(op.cameraId); number(op.towardM, -20, 20);
    } else if (op.kind === "set_pose") {
      keys(op, ["kind", "actorId", "presetId"]); text(op.actorId);
      if (!DESIGN_POSES.includes(op.presetId as DesignPoseId)) throw new Error("姿态预设不受支持。");
    } else if (op.kind === "seat_actor") {
      keys(op, ["kind", "actorId", "chairId"]); text(op.actorId); text(op.chairId, 80);
      if (!/^design-chair-[A-Za-z0-9_-]+$/.test(op.chairId as string)) throw new Error("椅子参考 ID 无效。");
    } else if (op.kind === "camera_motion") {
      keys(op, ["kind", "cameraId", "presetId", "durationSeconds", "easing"]); text(op.cameraId);
      if (!["orbit", "half_arc", "push_in", "pull_out", "lift", "drop", "lateral", "spiral_rise"].includes(op.presetId as string)) throw new Error("运镜预设不受支持。");
      number(op.durationSeconds, .1, 600);
      if (!["linear", "bezier", "ease_in", "ease_out", "ease_in_out"].includes(op.easing as string)) throw new Error("运镜缓动不受支持。");
    } else throw new Error("提案包含不支持的操作。");
  }
  return structuredClone(p) as unknown as DesignProposal;
}

const radians = (deg: number) => deg * Math.PI / 180;

/** Pure risk-bounded compiler; never invokes store actions or executes model code. */
export function compileDesignProposal(state: WorkbenchState, raw: unknown): DesignPreview {
  const plan = parseDesignProposal(raw);
  if (plan.baseRevision !== designRevision(state)) throw new Error("场景已变化，请基于当前场景重新生成设计。");
  if (plan.clarification) throw new Error(plan.clarification);
  const hasCameraMotion = plan.operations.some((operation) => operation.kind === "camera_motion");
  if (hasCameraMotion && Object.keys(state.cameraPaths).length) throw new Error("当前机位已有运镜路径，请先在机位路径工具中编辑。");
  if (state.playheadFrame !== 1 || state.dialogueTimeline.tracks.length || Object.keys(state.actorPaths).length || (!hasCameraMotion && Object.keys(state.cameraPaths).length)) throw new Error("自然语言设计仅支持第 1 帧；已有动画或机位路径时请先保留草稿。");
  const root = state.renderScene.sceneRootTransform;
  if ([...root.position, ...root.rotationDeg].some((v) => v !== 0) || root.scale.some((v) => v !== 1)) throw new Error("当前场景根变换尚不支持自然语言设计。");
  const characters = structuredClone(state.characters);
  const sceneObjects = structuredClone(state.sceneObjects);
  const cameras = structuredClone(state.cameras);
  let cameraId = state.selectedCameraId;
  const moved = new Set<string>();
  const changedCameras = new Set<string>();
  let cameraPaths = structuredClone(state.cameraPaths);
  let dialogueTimeline: DialogueTimelineState = structuredClone(state.dialogueTimeline);
  const chairOwners = new Map<string, string>();
  const posed = new Set<string>();
  const editableActor = (id: string) => {
    const actor = characters[id];
    if (!actor || actor.locked || !actor.visible || actor.calibratedPlacement) throw new Error("人物不存在、已锁定、隐藏或已校准。");
    if (actor.proxyAssetId || actor.transform.rotationDeg.slice(0, 2).some((v) => v !== 0) || actor.transform.scale.some((v) => v !== 1)) throw new Error("姿态设计当前仅支持未缩放、未倾斜的标准白模人物。");
    if (state.rigAdmissionStatus !== "passed") throw new Error("当前骨架尚未通过准入检查，请等待白模加载完成。");
    if (posed.has(id)) throw new Error("同一提案不能重复设置同一人物的姿态。");
    posed.add(id);
    return actor;
  };
  const place = (id: string, position: Vec, yaw: number) => {
    const entity = characters[id] ?? sceneObjects[id];
    if (!entity || entity.locked || !entity.visible || entity.calibratedPlacement) throw new Error(`对象 ${id} 不存在、已锁定、隐藏或已校准。`);
    if (position[2] < state.renderScene.ground.heightM - .001) throw new Error("对象位置不能低于地面。");
    entity.transform = { ...entity.transform, position: [...position], rotationDeg: [entity.transform.rotationDeg[0], entity.transform.rotationDeg[1], yaw] };
    if (characters[id]) characters[id].poseRevision += 1;
    else sceneObjects[id].revision += 1;
    moved.add(id);
  };
  for (const op of plan.operations) {
    if (op.kind === "set_pose") {
      applyDesignPose(editableActor(op.actorId), op.presetId);
    } else if (op.kind === "arrange_group") {
      for (const member of op.members) {
        if (member.presetId) applyDesignPose(editableActor(member.actorId), member.presetId);
        place(member.actorId, member.positionM, member.yawDeg);
      }
    } else if (op.kind === "seat_actor") {
      const actor = editableActor(op.actorId);
      if (Math.abs(actor.transform.position[2] - state.renderScene.ground.heightM) > .001) throw new Error("坐姿椅子参考需要人物位于当前地面。");
      applyDesignPose(actor, "seated.sit");
      actor.poseRootOffsetM[2] += SEATED_FIT.groundLiftM;
      const height = SEATED_FIT.supportHeightM + SEATED_FIT.groundLiftM;
      const legHeight = height - .06;
      const parts: { suffix: string; label: string; position: Vec; size: Vec }[] = [
        { suffix: "seat", label: "座面", position: [0, -.06, legHeight], size: [.58, .52, .06] },
        { suffix: "back", label: "靠背", position: [0, .23, height], size: [.58, .06, .5] },
        ...[-.23, .23].flatMap((x, i) => [-.27, .15].map((y, j) => ({ suffix: `leg-${i}-${j}`, label: "椅腿", position: [x, y, 0] as Vec, size: [.05, .05, legHeight] as Vec }))),
      ];
      const yaw = actor.transform.rotationDeg[2], cos = Math.cos(radians(yaw)), sin = Math.sin(radians(yaw));
      for (const part of parts) {
        const id = `${op.chairId}-${part.suffix}`;
        if (characters[id] || sceneObjects[id] || cameras[id]) throw new Error("椅子参考 ID 与已有对象重复。");
        const [w, d, h] = part.size, [x, y, z] = part.position;
        sceneObjects[id] = { sceneObjectId: id, revision: 1, label: `椅子参考·${part.label}（程序化占位）`, objectKind: "primitive", primitiveKind: "cube",
          proxyRepresentationType: null, proxyAssetId: null, modelAssetId: null, inputId: null,
          transform: { position: [actor.transform.position[0] + x * cos - y * sin, actor.transform.position[1] + x * sin + y * cos, state.renderScene.ground.heightM + z], rotationDeg: [0, 0, yaw], scale: [1, 1, 1], groundSnap: false },
          dimensionsM: [w, d, h], pivotM: [0, 0, -h / 2], boundingBoxM: { minimum: [-w / 2, -d / 2, 0], maximum: [w / 2, d / 2, h] }, scaleBasis: "declared_dimension",
          materialHint: { color: "#64748b", roughness: .8 }, visible: true, locked: false, browserCapabilityState: "available", compilerCapabilityState: "available",
          capabilityIds: [], limitations: ["标准白模坐姿的程序化椅子参考，不是真实模型资产。", "仅校验静态支撑区域与地面，不提供物理约束；手动移动后需重新检查接触。"], calibratedPlacement: null };
        chairOwners.set(id, actor.characterId); moved.add(id);
      }
      moved.add(actor.characterId);
    } else if (op.kind === "place_entity") place(op.entityId, op.positionM, op.yawDeg);
    else if (op.kind === "arrange_pair") {
      if (op.actorIds.some((id) => !characters[id])) throw new Error("双人摆位必须引用两个现有人物。");
      const offset = [Math.cos(radians(op.axisDeg)) * op.separationM / 2, Math.sin(radians(op.axisDeg)) * op.separationM / 2, 0];
      op.actorIds.forEach((id, i) => place(id, op.centerM.map((v, axis) => v + (i === 0 ? -1 : 1) * offset[axis]) as Vec, op.axisDeg + (i === 0 ? -90 : 90)));
    } else if (op.kind === "add_box") {
      if (characters[op.entityId] || sceneObjects[op.entityId] || cameras[op.entityId]) throw new Error("新占位物体 ID 与已有对象重复。");
      const [w, d, h] = op.dimensionsM;
      sceneObjects[op.entityId] = { sceneObjectId: op.entityId, revision: 1, label: `${op.label}（占位）`, objectKind: "primitive", primitiveKind: "cube",
        proxyRepresentationType: null, proxyAssetId: null, modelAssetId: null, inputId: null,
        transform: { position: [...op.positionM], rotationDeg: [0, 0, 0], scale: [1, 1, 1], groundSnap: true },
        dimensionsM: [...op.dimensionsM], pivotM: [0, 0, -h / 2], boundingBoxM: { minimum: [-w / 2, -d / 2, 0], maximum: [w / 2, d / 2, h] },
        scaleBasis: "declared_dimension", materialHint: { color: "#94a3b8", roughness: .8 }, visible: true, locked: false,
        browserCapabilityState: "available", compilerCapabilityState: "available", capabilityIds: [], limitations: ["自然语言设计的几何占位，不是已确认资产。"], calibratedPlacement: null };
      place(op.entityId, op.positionM, 0);
    } else {
      const camera = cameras[op.cameraId];
      if (op.cameraId !== state.selectedCameraId) throw new Error("请先选择需要设计的机位。首版仅修改当前机位。");
      if (!camera || camera.locked || !camera.visible) throw new Error("机位不存在、已锁定或隐藏。");
      if (op.kind === "camera_motion") {
        if (cameraPaths[`path-${op.cameraId}-motion`]) throw new Error("当前机位已有运镜路径，请先在机位路径工具中编辑。");
        const runtime = cameraRuntime(camera, characters, sceneObjects);
        const pathId = `path-${op.cameraId}-motion`;
        const controlPoints = createCameraPathPresetControlPoints({ cameraId: op.cameraId, presetId: op.presetId, sequence: 1, startPositionM: [...camera.transform.position] as Vec, targetPositionM: [...runtime.targetM] as Vec });
        if (controlPoints.length < 2) throw new Error("无法生成有效运镜路径。");
        const path: CameraPathState = { pathId, targetType: "camera", targetId: op.cameraId, durationSeconds: op.durationSeconds, easing: op.easing, presetIds: [op.presetId], controlPoints, revision: 1, locked: false, visible: true };
        cameraPaths[pathId] = path;
        const nextTrack = dialogueTimeline.tracks.reduce((maximum, track) => Math.max(maximum, Number(track.trackId.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
        const track: TimelineTrackState = { trackId: `track-${String(nextTrack).padStart(4, "0")}`, trackKind: "camera_path_progress", target: { targetType: "path", targetId: pathId }, propertyKey: "path.progress", keyframes: [] };
        dialogueTimeline = { ...dialogueTimeline, durationSeconds: Math.max(dialogueTimeline.durationSeconds, op.durationSeconds), tracks: [...dialogueTimeline.tracks, track] };
        cameraId = op.cameraId;
      } else if (op.kind === "frame_camera") {
        const points = op.targetIds.map((id) => {
          if (!(characters[id] ?? sceneObjects[id])?.visible) throw new Error("机位目标不存在或隐藏。");
          return stateTargetPosition(id, characters, sceneObjects)!;
        });
        const center = points.reduce((sum, p) => sum.add(new Vector3(...p)), new Vector3()).divideScalar(points.length);
        const azimuth = radians(op.azimuthDeg), elevation = radians(op.elevationDeg);
        const position = center.clone().add(new Vector3(Math.cos(elevation) * Math.sin(azimuth), -Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation)).multiplyScalar(op.distanceM));
        camera.transform = { ...camera.transform, position: position.toArray() as Vec };
        camera.subjectTargetIds = [...op.targetIds]; camera.lookAt = null; camera.follow = null;
        camera.focalLengthMm = op.focalLengthMm;
        camera.fovDeg = 2 * Math.atan(36 / (2 * op.focalLengthMm)) * 180 / Math.PI;
        camera.zoom = 1;
      } else {
        if (!camera.lookAt && !camera.follow && !camera.subjectTargetIds.length) throw new Error("请先为机位设置主体目标，再调整距离。");
        const runtime = cameraRuntime(camera, characters, sceneObjects);
        const direction = new Vector3(...runtime.targetM).sub(new Vector3(...runtime.positionM));
        if (direction.length() - op.towardM < .5) throw new Error("相机推进后距目标过近，请减小推进距离。");
        direction.normalize().multiplyScalar(op.towardM);
        camera.transform = { ...camera.transform, position: new Vector3(...camera.transform.position).add(direction).toArray() as Vec };
      }
      cameraId = op.cameraId;
      changedCameras.add(cameraId);
    }
  }
  // A fitted chair can intersect its owner only. Check other furniture as
  // oriented rectangles with vertical overlap, not just actor center spacing.
  for (const id of Array.from(chairOwners.keys())) {
    const chair = sceneObjects[id];
    for (const other of Object.values(sceneObjects)) {
      if (id === other.sceneObjectId || !other.visible || chairOwners.has(other.sceneObjectId) && chairOwners.get(id) === chairOwners.get(other.sceneObjectId)) continue;
      if (other.primitiveKind !== "cube" || other.transform.rotationDeg.slice(0, 2).some((v) => v !== 0) || other.transform.scale.some((v) => v !== 1)) throw new Error("场景含尚不支持座椅间距校验的物体，请先隔离待设计人物。");
      const bounds = (box: typeof chair) => {
        const yaw = radians(box.transform.rotationDeg[2]);
        const localCenter = box.boundingBoxM.minimum.map((v, axis) => (v + box.boundingBoxM.maximum[axis]) / 2);
        return { center: [box.transform.position[0] + localCenter[0] * Math.cos(yaw) - localCenter[1] * Math.sin(yaw), box.transform.position[1] + localCenter[0] * Math.sin(yaw) + localCenter[1] * Math.cos(yaw)],
          axes: [[Math.cos(yaw), Math.sin(yaw)], [-Math.sin(yaw), Math.cos(yaw)]],
          half: box.boundingBoxM.maximum.slice(0, 2).map((v, axis) => (v - box.boundingBoxM.minimum[axis]) / 2),
          low: box.transform.position[2] + box.boundingBoxM.minimum[2], high: box.transform.position[2] + box.boundingBoxM.maximum[2] };
      };
      const a = bounds(chair), b = bounds(other);
      if (a.high <= b.low + .001 || b.high <= a.low + .001) continue;
      const overlaps = [...a.axes, ...b.axes].every((axis) => {
        const radius = (box: typeof a) => box.axes.reduce((r, unit, i) => r + box.half[i] * Math.abs(unit[0] * axis[0] + unit[1] * axis[1]), 0);
        return Math.abs((a.center[0] - b.center[0]) * axis[0] + (a.center[1] - b.center[1]) * axis[1]) < radius(a) + radius(b) - .001;
      });
      if (overlaps) throw new Error("椅子参考与场景物体重叠，请调整摆位。");
    }
  }
  // Conservative blocking checks use actor centers and axis-aligned box proxies only.
  for (const actor of Object.values(characters).filter((a) => a.visible)) {
    for (const other of Object.values(characters).filter((a) => a.visible && a.characterId !== actor.characterId)) {
      if ((moved.has(actor.characterId) || moved.has(other.characterId)) && Math.hypot(actor.transform.position[0] - other.transform.position[0], actor.transform.position[1] - other.transform.position[1]) < .6) throw new Error("人物间距过小，请调整摆位。");
    }
    for (const box of Object.values(sceneObjects).filter((o) => o.visible && o.primitiveKind === "cube")) {
      if (!(moved.has(actor.characterId) || moved.has(box.sceneObjectId))) continue;
      if (chairOwners.get(box.sceneObjectId) === actor.characterId) continue;
      if (chairOwners.has(box.sceneObjectId)) {
        const angle = -radians(box.transform.rotationDeg[2]);
        const dx = actor.transform.position[0] - box.transform.position[0], dy = actor.transform.position[1] - box.transform.position[1];
        if (Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) < box.dimensionsM[0] / 2 + .3 && Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) < box.dimensionsM[1] / 2 + .3) throw new Error("椅子参考与其他人物重叠，请先调整人物间距。");
        continue;
      }
      if (box.transform.rotationDeg.some((v) => v !== 0) || box.transform.scale.some((v) => v !== 1)) throw new Error("旋转或缩放的占位道具暂不支持自动间距校验。");
      const [x, y, z] = actor.transform.position, [bx, by, bz] = box.transform.position;
      if (z < bz + box.dimensionsM[2] && z + 1.8 > bz && Math.abs(x - bx) < box.dimensionsM[0] / 2 + .3 && Math.abs(y - by) < box.dimensionsM[1] / 2 + .3) throw new Error("人物与占位道具重叠，请调整间距。");
    }
  }
  for (const id of Array.from(changedCameras)) {
    const camera = cameras[id];
    vector(camera.transform.position);
    if (camera.transform.position[2] < state.renderScene.ground.heightM) throw new Error("机位不能低于地面。");
    const runtime = cameraRuntime(camera, characters, sceneObjects);
    const forward = new Vector3(...runtime.targetM).sub(new Vector3(...runtime.positionM)).normalize();
    const right = forward.clone().cross(new Vector3(0, 0, 1)).normalize(), up = right.clone().cross(forward).normalize();
    if (right.lengthSq() < .01) throw new Error("垂直机位尚不支持自动构图校验。");
    const projection = cameraProjection(camera.fovDeg, camera.zoom, camera.aspectRatio);
    for (const target of camera.subjectTargetIds) {
      const point = stateTargetPosition(target, characters, sceneObjects);
      if (!point) throw new Error("机位目标缺失。");
      const delta = new Vector3(...point).sub(new Vector3(...runtime.positionM)), depth = delta.dot(forward);
      if (depth < .1 || Math.abs(delta.dot(right) * projection.projectionScaleX / depth) > .95 || Math.abs(delta.dot(up) * projection.projectionScaleY / depth) > .95) throw new Error("主体中心超出机位画幅，请增加距离或调整焦距。");
    }
  }
  return { characters, sceneObjects, cameras, cameraPaths, dialogueTimeline, cameraId, baseRevision: plan.baseRevision };
}
