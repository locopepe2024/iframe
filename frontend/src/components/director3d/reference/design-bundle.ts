import type { DirectorShotPackage } from "./director-shot-package";
import type { AuthoringSnapshot, CharacterAuthoringState, WorkbenchState } from "../state/workbench-store";
import type { CameraSnapshotState, ObjectAssetCatalogState, SubjectProxyAssetState, SubjectReferenceSetState, EnvironmentInputCatalogState, DialogueReferenceInputState } from "../types";
import { currentDirectorShotPackage } from "./current-shot-package";

export const DIRECTOR_DESIGN_BUNDLE_SCHEMA = "iframe.director3d.design-bundle.v1" as const;

type CoreAuthoring = AuthoringSnapshot & {
  cameraSnapshots: CameraSnapshotState[];
  dialogueReferenceInputs: DialogueReferenceInputState[];
  subjectReferenceSets: Record<string, SubjectReferenceSetState>;
  subjectProxies: Record<string, SubjectProxyAssetState>;
  environmentInputCatalog: EnvironmentInputCatalogState;
  objectAssetCatalog: ObjectAssetCatalogState;
};

export interface DirectorDesignBundleV1 {
  schemaVersion: typeof DIRECTOR_DESIGN_BUNDLE_SCHEMA;
  kind: "director3d_design_bundle";
  sourcePackageChecksum: string;
  package: DirectorShotPackage;
  authoring: CoreAuthoring;
  dependencies: {
    layoutReferenceId: string;
    sourceAssetIds: string[];
    sourceVariantIds: string[];
    sourceMediaIds: string[];
    environmentInputIds: string[];
    objectAssetIds: string[];
    subjectReferenceSetIds: string[];
    subjectProxyIds: string[];
    limitations: string[];
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(value).sort().join("|");
  const expected = [...keys].sort().join("|");
  if (actual !== expected) throw new Error(`${label} 包含未知或缺失字段。`);
}
function string(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} 无效。`);
  return value;
}
function array(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  return value;
}
function map(value: unknown, label: string) {
  return record(value, label);
}

function validateDependencies(authoring: CoreAuthoring, pkg: DirectorShotPackage) {
  const characters = new Set(Object.keys(authoring.characters));
  const cameras = new Set(Object.keys(authoring.cameras));
  const objects = new Set(Object.keys(authoring.sceneObjects));
  if (!cameras.has(pkg.activeCameraId)) throw new Error("设计包引用了不存在的活动机位。");
  for (const group of Object.values(authoring.crowdGroups)) {
    if (group.actorIds.some((id) => !characters.has(id))) throw new Error("群演组缺少人物依赖。");
  }
  for (const character of Object.values(authoring.characters)) {
    if (!authoring.actorMappings[character.actorMappingId]) throw new Error(`人物 ${character.characterId} 缺少 actor mapping。`);
  }
  for (const mapping of Object.values(authoring.actorMappings)) {
    if (!characters.has(mapping.characterId)) throw new Error(`actor mapping ${mapping.actorMappingId} 引用了不存在的人物。`);
  }
  for (const path of Object.values(authoring.actorPaths)) {
    if (!characters.has(path.targetId)) throw new Error(`人物路径 ${path.pathId} 缺少目标人物。`);
  }
  for (const path of Object.values(authoring.cameraPaths)) {
    if (!cameras.has(path.targetId)) throw new Error(`机位路径 ${path.pathId} 缺少目标机位。`);
  }
  for (const camera of Object.values(authoring.cameras)) {
    for (const targetId of camera.subjectTargetIds) if (!characters.has(targetId) && !objects.has(targetId)) throw new Error(`机位 ${camera.cameraId} 引用了不存在的主体。`);
    for (const target of [camera.lookAt, camera.follow]) {
      if (target && target.targetType !== "world_point" && !characters.has(target.targetId) && !objects.has(target.targetId)) throw new Error(`机位 ${camera.cameraId} 引用了不存在的目标。`);
    }
  }
  for (const track of authoring.dialogueTimeline.tracks) {
    if (track.target.targetType === "camera" && !cameras.has(track.target.targetId)) throw new Error(`时间线轨道 ${track.trackId} 缺少机位依赖。`);
    if (track.target.targetType === "character" && !characters.has(track.target.targetId)) throw new Error(`时间线轨道 ${track.trackId} 缺少人物依赖。`);
    if (track.target.targetType === "scene_object" && !objects.has(track.target.targetId)) throw new Error(`时间线轨道 ${track.trackId} 缺少道具依赖。`);
  }
  for (const item of pkg.characters) if (!characters.has(item.characterId)) throw new Error("shot package 的人物依赖缺失。");
  for (const path of pkg.actorPaths) if (!characters.has(path.targetId)) throw new Error("shot package 的人物路径依赖缺失。");
  for (const path of pkg.cameraPaths) if (!cameras.has(path.targetId)) throw new Error("shot package 的机位路径依赖缺失。");
}

export function createDirectorDesignBundle(state: WorkbenchState): DirectorDesignBundleV1 {
  const pkg = currentDirectorShotPackage(state);
  const authoring: CoreAuthoring = {
    crowdGroups: structuredClone(state.crowdGroups),
    characters: structuredClone(state.characters), actorMappings: structuredClone(state.actorMappings), sceneObjects: structuredClone(state.sceneObjects),
    renderScene: structuredClone(state.renderScene), panoramaScenePackage: structuredClone(state.panoramaScenePackage), dialogueTimeline: structuredClone(state.dialogueTimeline),
    cameras: structuredClone(state.cameras), actorPaths: structuredClone(state.actorPaths), cameraPaths: structuredClone(state.cameraPaths),
    externalCameraMotionProposals: structuredClone(state.externalCameraMotionProposals), pathEvents: structuredClone(state.pathEvents),
    cameraSnapshots: structuredClone(state.cameraSnapshots), dialogueReferenceInputs: structuredClone(state.dialogueReferenceInputs),
    subjectReferenceSets: structuredClone(state.subjectReferenceSets), subjectProxies: structuredClone(state.subjectProxies),
    environmentInputCatalog: structuredClone(state.environmentInputCatalog), objectAssetCatalog: structuredClone(state.objectAssetCatalog),
  };
  const dependencies = {
    layoutReferenceId: `layout-${pkg.packageChecksum}`,
    sourceAssetIds: Array.from(new Set([
      ...Object.values(authoring.characters).flatMap((character) => character.proxyAssetId ? [character.proxyAssetId] : []),
      ...Object.values(authoring.sceneObjects).flatMap((object) => [object.modelAssetId, object.proxyAssetId].filter((id): id is string => Boolean(id))),
      ...Object.values(authoring.subjectProxies).map((proxy) => proxy.proxy_asset_id),
    ])),
    sourceVariantIds: [],
    sourceMediaIds: authoring.environmentInputCatalog.entries.map((entry) => entry.inputId),
    environmentInputIds: Object.keys(authoring.environmentInputCatalog.entries.reduce<Record<string, true>>((acc, entry) => { acc[entry.inputId] = true; return acc; }, {})),
    objectAssetIds: authoring.objectAssetCatalog.assets.map((asset) => asset.assetId),
    subjectReferenceSetIds: Object.keys(authoring.subjectReferenceSets), subjectProxyIds: Object.keys(authoring.subjectProxies),
    limitations: ["这是导演台设计包；参考图/视频是过程资产，需用户显式保存到普通资产库。", "浏览器占位几何不是米制深度结果；米制深度需使用深度工具提交。"],
  };
  return { schemaVersion: DIRECTOR_DESIGN_BUNDLE_SCHEMA, kind: "director3d_design_bundle", sourcePackageChecksum: pkg.packageChecksum, package: pkg, authoring, dependencies };
}

export function parseDirectorDesignBundle(raw: unknown): DirectorDesignBundleV1 {
  const root = record(raw, "设计包");
  exactKeys(root, ["schemaVersion", "kind", "sourcePackageChecksum", "package", "authoring", "dependencies"], "设计包");
  if (root.schemaVersion !== DIRECTOR_DESIGN_BUNDLE_SCHEMA || root.kind !== "director3d_design_bundle") throw new Error("设计包版本不受支持。");
  const sourceChecksum = string(root.sourcePackageChecksum, "设计包 checksum");
  const pkg = record(root.package, "shot package");
  if (pkg.schemaVersion !== "iframe.director3d.shot-package.v1") throw new Error("shot package 版本不受支持。");
  if (pkg.packageChecksum !== sourceChecksum) throw new Error("设计包 checksum 与 shot package 不一致。");
  const a = record(root.authoring, "authoring");
  exactKeys(a, ["crowdGroups", "characters", "actorMappings", "sceneObjects", "renderScene", "panoramaScenePackage", "dialogueTimeline", "cameras", "actorPaths", "cameraPaths", "externalCameraMotionProposals", "pathEvents", "cameraSnapshots", "dialogueReferenceInputs", "subjectReferenceSets", "subjectProxies", "environmentInputCatalog", "objectAssetCatalog"], "authoring");
  for (const [key, value] of Object.entries(a)) if (key.endsWith("Catalog") || ["characters", "actorMappings", "sceneObjects", "cameras", "actorPaths", "cameraPaths", "subjectReferenceSets", "subjectProxies"].includes(key)) map(value, `authoring.${key}`);
  for (const key of ["externalCameraMotionProposals", "pathEvents", "cameraSnapshots", "dialogueReferenceInputs"]) array(a[key], `authoring.${key}`);
  const d = record(root.dependencies, "dependencies");
  exactKeys(d, ["layoutReferenceId", "sourceAssetIds", "sourceVariantIds", "sourceMediaIds", "environmentInputIds", "objectAssetIds", "subjectReferenceSetIds", "subjectProxyIds", "limitations"], "dependencies");
  for (const key of ["sourceAssetIds", "sourceVariantIds", "sourceMediaIds", "environmentInputIds", "objectAssetIds", "subjectReferenceSetIds", "subjectProxyIds", "limitations"]) array(d[key], `dependencies.${key}`);
  const bundle = raw as DirectorDesignBundleV1;
  validateDependencies(bundle.authoring, bundle.package);
  return structuredClone(bundle);
}
