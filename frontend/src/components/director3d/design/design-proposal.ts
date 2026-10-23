import { Vector3 } from "three";
import type { AuthoringSnapshot, WorkbenchState } from "../state/workbench-store";
import { cameraProjection, cameraRuntime, stateTargetPosition } from "../timeline/timeline-evaluation";
import { currentDirectorShotPackage } from "../reference/current-shot-package";

type Vec = [number, number, number];
export type DesignOperation =
  | { kind: "place_entity"; entityId: string; positionM: Vec; yawDeg: number }
  | { kind: "arrange_pair"; actorIds: [string, string]; centerM: Vec; separationM: number; axisDeg: number }
  | { kind: "add_box"; entityId: string; label: string; positionM: Vec; dimensionsM: Vec }
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
export type DesignPreview = Pick<AuthoringSnapshot, "characters" | "sceneObjects" | "cameras"> & { cameraId: string; baseRevision: string };

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
    actors: Object.values(state.characters).map(({ characterId, label, locked }) => ({ characterId, label, locked })),
    selectedCharacterId: state.selectedCharacterId, selectedObjectId: state.selectedSceneObjectId,
    selectedCameraId: state.selectedCameraId, groundHeightM: state.renderScene.ground.heightM,
    animated: state.dialogueTimeline.tracks.length > 0 || Object.keys(state.actorPaths).length > 0 || Object.keys(state.cameraPaths).length > 0,
    supported: ["static placement", "pair facing", "box proxy", "static camera", "static dolly"],
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
    } else if (op.kind === "add_box") {
      keys(op, ["kind", "entityId", "label", "positionM", "dimensionsM"]); text(op.entityId); text(op.label, 80); vector(op.positionM); vector(op.dimensionsM, .050001, 20);
      if (!(op.entityId as string).startsWith("design-box-")) throw new Error("新占位物体 ID 无效。");
    } else if (op.kind === "frame_camera") {
      keys(op, ["kind", "cameraId", "targetIds", "azimuthDeg", "elevationDeg", "distanceM", "focalLengthMm"]); text(op.cameraId); ids(op.targetIds, 1, 8);
      number(op.azimuthDeg, -360, 360); number(op.elevationDeg, -60, 80); number(op.distanceM, .5, 50); number(op.focalLengthMm, 12, 200);
    } else if (op.kind === "dolly_camera") {
      keys(op, ["kind", "cameraId", "towardM"]); text(op.cameraId); number(op.towardM, -20, 20);
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
  if (state.playheadFrame !== 1 || state.dialogueTimeline.tracks.length || Object.keys(state.actorPaths).length || Object.keys(state.cameraPaths).length) throw new Error("首版仅支持无动画场景的第 1 帧；请先保留草稿并使用静态场景。");
  const root = state.renderScene.sceneRootTransform;
  if ([...root.position, ...root.rotationDeg].some((v) => v !== 0) || root.scale.some((v) => v !== 1)) throw new Error("当前场景根变换尚不支持自然语言设计。");
  const characters = structuredClone(state.characters);
  const sceneObjects = structuredClone(state.sceneObjects);
  const cameras = structuredClone(state.cameras);
  let cameraId = state.selectedCameraId;
  const moved = new Set<string>();
  const changedCameras = new Set<string>();
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
    if (op.kind === "place_entity") place(op.entityId, op.positionM, op.yawDeg);
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
      if (op.kind === "frame_camera") {
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
  // Conservative blocking checks use actor centers and axis-aligned box proxies only.
  for (const actor of Object.values(characters).filter((a) => a.visible)) {
    for (const other of Object.values(characters).filter((a) => a.visible && a.characterId !== actor.characterId)) {
      if ((moved.has(actor.characterId) || moved.has(other.characterId)) && Math.hypot(actor.transform.position[0] - other.transform.position[0], actor.transform.position[1] - other.transform.position[1]) < .6) throw new Error("人物间距过小，请调整摆位。");
    }
    for (const box of Object.values(sceneObjects).filter((o) => o.visible && o.primitiveKind === "cube")) {
      if (!(moved.has(actor.characterId) || moved.has(box.sceneObjectId))) continue;
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
  return { characters, sceneObjects, cameras, cameraId, baseRevision: plan.baseRevision };
}
