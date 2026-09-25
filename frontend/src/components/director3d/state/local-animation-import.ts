import { CHARACTER_A_ID, CHARACTER_B_ID, CHARACTER_C_ID, rigProfile } from "../data/humanoid";
import type { LocalAnimationCharacterMapping, LocalAnimationImportState, LocalAnimationManifest, LocalAnimationTrackManifest, TimelineInterpolation, TimelineTrackState } from "../types";

export const LOCAL_ANIMATION_SCHEMA_VERSION = "iframe.director3d.local-animation.v1" as const;
export const LOCAL_ANIMATION_MAX_BYTES = 2 * 1024 * 1024;
export const LOCAL_ANIMATION_MAX_TRACKS = 64;
export const LOCAL_ANIMATION_MAX_KEYFRAMES = 4096;
const MAX_TEXT_LENGTH = 160;
const MAX_TRACK_ID_LENGTH = 80;
const MAX_JOINTS_PER_POSE = 128;

const SLOT_ALIASES: Record<string, string> = {
  a: CHARACTER_A_ID,
  b: CHARACTER_B_ID,
  c: CHARACTER_C_ID,
  "character-a": CHARACTER_A_ID,
  "character-b": CHARACTER_B_ID,
  "character-c": CHARACTER_C_ID,
};
const KNOWN_JOINT_IDS = new Set(rigProfile.joints.map((joint) => joint.joint_id));
const TRACK_KINDS = new Set<LocalAnimationTrackManifest["trackKind"]>(["character_pose", "character_transform"]);
const INTERPOLATIONS = new Set<TimelineInterpolation>(["step", "linear", "bezier"]);

export interface LocalAnimationParseOptions {
  availableCharacterIds: string[];
  sourceLabel?: string;
}

export interface LocalAnimationParseResult {
  state: LocalAnimationImportState;
  ok: boolean;
}

export function createIdleLocalAnimationImportState(): LocalAnimationImportState {
  return {
    status: "idle",
    fileName: null,
    manifest: null,
    tracks: [],
    characterMappings: [],
    totalKeyframes: 0,
    warnings: [],
    errors: [],
    appliedAt: null,
  };
}

export function createLocalAnimationImportErrorState(fileName: string | null, message: string): LocalAnimationImportState {
  return {
    ...createIdleLocalAnimationImportState(),
    status: "error",
    fileName,
    errors: [message],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string") throw new Error(`${field} 必须是文本。`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} 不能为空。`);
  if (normalized.length > maxLength) throw new Error(`${field} 不能超过 ${maxLength} 个字符。`);
  return normalized;
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} 必须是 ${minimum}–${maximum} 范围内的有限数字。`);
  }
  return value;
}

function tuple3(value: unknown, field: string, minimum: number, maximum: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${field} 必须是 3 个数字。`);
  return [
    finiteNumber(value[0], `${field}[0]`, minimum, maximum),
    finiteNumber(value[1], `${field}[1]`, minimum, maximum),
    finiteNumber(value[2], `${field}[2]`, minimum, maximum),
  ];
}

function safeId(value: string, field: string, maxLength = MAX_TRACK_ID_LENGTH): string {
  const normalized = text(value, field, maxLength);
  if (normalized.startsWith("__") || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new Error(`${field} 只能包含字母、数字、点、下划线、冒号或短横线。`);
  }
  return normalized;
}

function resolveCharacterId(requestedId: string, availableCharacterIds: Set<string>): string | null {
  const alias = SLOT_ALIASES[requestedId.trim().toLowerCase()];
  const resolved = alias ?? requestedId.trim();
  return availableCharacterIds.has(resolved) ? resolved : null;
}

function normalizedTrackId(manifestId: string, trackId: string): string {
  return `local-animation-${manifestId}-${trackId}`.slice(0, 180);
}

function parsePoseValue(value: unknown, field: string): Record<string, [number, number, number]> {
  if (!isRecord(value)) throw new Error(`${field} 必须是“关节 ID → [x,y,z]”对象。`);
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_JOINTS_PER_POSE) throw new Error(`${field} 必须包含 1–${MAX_JOINTS_PER_POSE} 个关节。`);
  const result: Record<string, [number, number, number]> = {};
  for (const [jointId, rotation] of entries) {
    if (jointId.startsWith("__") || !KNOWN_JOINT_IDS.has(jointId)) throw new Error(`${field} 包含当前白模不支持的关节“${jointId}”。`);
    result[jointId] = tuple3(rotation, `${field}.${jointId}`, -360, 360);
  }
  return result;
}

function parseKeyframes(track: Record<string, unknown>, trackKind: LocalAnimationTrackManifest["trackKind"], durationSeconds: number, trackId: string) {
  if (!Array.isArray(track.keyframes) || track.keyframes.length < 1 || track.keyframes.length > LOCAL_ANIMATION_MAX_KEYFRAMES) {
    throw new Error(`轨道“${trackId}”必须包含 1–${LOCAL_ANIMATION_MAX_KEYFRAMES} 个关键帧。`);
  }
  const seenKeyframeIds = new Set<string>();
  const byTime = new Map<number, { timeSeconds: number; value: unknown; interpolation: TimelineInterpolation }>();
  track.keyframes.forEach((rawKeyframe, index) => {
    if (!isRecord(rawKeyframe)) throw new Error(`轨道“${trackId}”的第 ${index + 1} 个关键帧格式无效。`);
    const timeSeconds = finiteNumber(rawKeyframe.timeSeconds, `轨道“${trackId}”关键帧时间`, 0, durationSeconds);
    const interpolation = rawKeyframe.interpolation;
    if (typeof interpolation !== "string" || !INTERPOLATIONS.has(interpolation as TimelineInterpolation)) throw new Error(`轨道“${trackId}”的插值方式无效。`);
    const rawKeyframeId = rawKeyframe.keyframeId;
    if (rawKeyframeId !== undefined) {
      if (typeof rawKeyframeId !== "string") throw new Error(`轨道“${trackId}”关键帧 ID 必须是文本。`);
      const keyframeId = safeId(rawKeyframeId, `轨道“${trackId}”关键帧 ID`, MAX_TRACK_ID_LENGTH);
      if (seenKeyframeIds.has(keyframeId)) throw new Error(`轨道“${trackId}”存在重复关键帧 ID“${keyframeId}”。`);
      seenKeyframeIds.add(keyframeId);
    }
    const field = `轨道“${trackId}” ${timeSeconds.toFixed(3)}s`;
    const value = trackKind === "character_pose"
      ? parsePoseValue(rawKeyframe.value, field)
      : tuple3(rawKeyframe.value, field, -30, 30);
    // A duplicate timestamp is deterministic: the later file entry wins.
    byTime.set(timeSeconds, { timeSeconds, value, interpolation: interpolation as TimelineInterpolation });
  });
  return Array.from(byTime.values()).sort((left, right) => left.timeSeconds - right.timeSeconds).map((keyframe, index) => ({
    keyframeId: `${normalizedTrackId("key", trackId)}-key-${String(index + 1).padStart(4, "0")}`,
    ...keyframe,
  }));
}

function parseTrack(rawTrack: unknown, index: number, durationSeconds: number, availableCharacterIds: Set<string>, manifestId: string): { track: TimelineTrackState; manifestTrack: LocalAnimationTrackManifest; mapping: LocalAnimationCharacterMapping } {
  if (!isRecord(rawTrack)) throw new Error(`第 ${index + 1} 条轨道格式无效。`);
  if (typeof rawTrack.trackId !== "string") throw new Error(`第 ${index + 1} 条轨道 ID 必须是文本。`);
  const rawTrackId = safeId(rawTrack.trackId, `第 ${index + 1} 条轨道 ID`);
  const trackKind = rawTrack.trackKind;
  if (typeof trackKind !== "string" || !TRACK_KINDS.has(trackKind as LocalAnimationTrackManifest["trackKind"])) throw new Error(`轨道“${rawTrackId}”类型不受支持；当前只接受人物姿态或人物变换。`);
  const propertyKey = rawTrack.propertyKey;
  const expectedPropertyKey = trackKind === "character_pose" ? "pose.normalized_values" : "transform.position_m";
  if (propertyKey !== expectedPropertyKey) throw new Error(`轨道“${rawTrackId}”的 propertyKey 应为“${expectedPropertyKey}”。`);
  const target = isRecord(rawTrack.target) ? rawTrack.target.characterId : undefined;
  const requestedId = text(target, `轨道“${rawTrackId}”目标角色`, MAX_TRACK_ID_LENGTH);
  const characterId = resolveCharacterId(requestedId, availableCharacterIds);
  if (!characterId) throw new Error(`轨道“${rawTrackId}”目标角色“${requestedId}”不在当前导演台。可用槽位为 A/B/C 或当前角色 ID。`);
  const keyframes = parseKeyframes(rawTrack, trackKind as LocalAnimationTrackManifest["trackKind"], durationSeconds, rawTrackId);
  return {
    track: {
      trackId: normalizedTrackId(manifestId, rawTrackId),
      trackKind: trackKind as TimelineTrackState["trackKind"],
      target: { targetType: "character", targetId: characterId },
      propertyKey: expectedPropertyKey,
      keyframes,
    },
    manifestTrack: {
      trackId: rawTrackId,
      trackKind: trackKind as LocalAnimationTrackManifest["trackKind"],
      target: { characterId },
      propertyKey: expectedPropertyKey,
      keyframes,
    },
    mapping: { requestedId, characterId },
  };
}

export function parseLocalAnimationManifest(input: unknown, options: LocalAnimationParseOptions): LocalAnimationParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const availableCharacterIds = new Set(options.availableCharacterIds);
  try {
    if (!isRecord(input)) throw new Error("文件根节点必须是 JSON 对象。");
    if (input.schemaVersion !== LOCAL_ANIMATION_SCHEMA_VERSION) throw new Error(`schemaVersion 必须为“${LOCAL_ANIMATION_SCHEMA_VERSION}”。`);
    if (typeof input.manifestId !== "string") throw new Error("manifestId 必须是文本。");
    const manifestId = safeId(input.manifestId, "manifestId");
    const title = text(input.title, "title");
    const durationSeconds = finiteNumber(input.durationSeconds, "durationSeconds", 0.05, 3600);
    const fpsValue = finiteNumber(input.fps, "fps", 1, 120);
    if (!Number.isInteger(fpsValue)) throw new Error("fps 必须是整数。");
    if (!Array.isArray(input.tracks) || input.tracks.length < 1 || input.tracks.length > LOCAL_ANIMATION_MAX_TRACKS) throw new Error(`tracks 必须包含 1–${LOCAL_ANIMATION_MAX_TRACKS} 条轨道。`);
    const limitations = input.limitations === undefined ? [] : input.limitations;
    if (!Array.isArray(limitations) || limitations.some((item) => typeof item !== "string" || item.trim().length > MAX_TEXT_LENGTH)) throw new Error(`limitations 必须是最多 ${MAX_TEXT_LENGTH} 字符的文本数组。`);
    const source = input.source;
    if (source !== undefined && (!isRecord(source) || source.kind !== "local")) throw new Error("source.kind 必须为 local。文件只能来自本地导入。 ");
    const sourceLabel = source && isRecord(source) && typeof source.label === "string" ? source.label : options.sourceLabel ?? `${manifestId}.json`;
    const normalizedSourceLabel = text(sourceLabel, "source.label", MAX_TEXT_LENGTH);
    const tracks: TimelineTrackState[] = [];
    const manifestTracks: LocalAnimationTrackManifest[] = [];
    const mappings: LocalAnimationCharacterMapping[] = [];
    const seenTrackIds = new Set<string>();
    let totalKeyframes = 0;
    input.tracks.forEach((rawTrack, index) => {
      const parsed = parseTrack(rawTrack, index, durationSeconds, availableCharacterIds, manifestId);
      if (seenTrackIds.has(parsed.track.trackId)) throw new Error(`导入文件存在重复轨道 ID“${parsed.track.trackId}”。`);
      seenTrackIds.add(parsed.track.trackId);
      totalKeyframes += parsed.track.keyframes.length;
      if (totalKeyframes > LOCAL_ANIMATION_MAX_KEYFRAMES) throw new Error(`导入文件关键帧总数不能超过 ${LOCAL_ANIMATION_MAX_KEYFRAMES}。`);
      tracks.push(parsed.track);
      manifestTracks.push(parsed.manifestTrack);
      mappings.push(parsed.mapping);
      if (parsed.mapping.requestedId !== parsed.mapping.characterId) warnings.push(`角色槽位“${parsed.mapping.requestedId}”已映射到“${parsed.mapping.characterId}”。`);
    });
    const manifest: LocalAnimationManifest = {
      schemaVersion: LOCAL_ANIMATION_SCHEMA_VERSION,
      manifestId,
      title,
      durationSeconds,
      fps: fpsValue,
      source: { kind: "local", label: normalizedSourceLabel },
      tracks: manifestTracks,
      limitations: limitations.map((item) => item.trim()),
    };
    const state: LocalAnimationImportState = {
      status: "ready",
      fileName: options.sourceLabel ?? normalizedSourceLabel,
      manifest,
      tracks,
      characterMappings: mappings,
      totalKeyframes,
      warnings,
      errors,
      appliedAt: null,
    };
    return { ok: true, state };
  } catch (caught) {
    errors.push(caught instanceof Error ? caught.message : "白模动画 manifest 无法读取。");
    return { ok: false, state: { ...createIdleLocalAnimationImportState(), status: "error", fileName: options.sourceLabel ?? null, errors, warnings } };
  }
}
