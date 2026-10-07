import { rigProfile } from "../data/humanoid";
import { posePresetById, type PosePresetId } from "../pose/pose-presets";
import type { Rotation, TimelineInterpolation } from "../types";

export type ActionPhaseRole = "setup" | "transfer" | "strike" | "contact" | "recovery" | "end";

export interface ActionPhase {
  phaseId: string;
  label: string;
  role: ActionPhaseRole;
  startFraction: number;
  endFraction: number;
  posePresetId: PosePresetId;
  jointOverrides?: Record<string, Rotation>;
  rootDisplacementM?: [number, number, number];
  interpolation: TimelineInterpolation;
}

export interface ActionStructure {
  actionId: string;
  catalogVersion: string;
  label: string;
  aliases: string[];
  locale: string;
  category: "martial_blocking";
  reviewState: "curated" | "draft" | "needs_review";
  intent: { description: string; derivation: "illustrative" | "reference_derived" | "solver_derived" };
  durationRangeSeconds: [number, number];
  defaultDurationSeconds: number;
  defaultFps: number;
  phases: ActionPhase[];
  roles: { primary: "required"; opponent: "optional" };
  contacts: { phaseId: string; sourceJointId: string; targetRole: "opponent"; targetRegion: string; mode: "touch_candidate"; limitation: "reference_constraint_not_physics" }[];
  cameraHints: string[];
  source: string;
  confidence: number;
  limitations: string[];
  checksum: string;
}

type ActionStructureContent = Omit<ActionStructure, "checksum">;
const r = (x = 0, y = 0, z = 0): Rotation => ({ x, y, z });

const HEXINGQUAN_CONTENT: ActionStructureContent = {
  actionId: "martial.hexingquan.blocking.v1",
  catalogVersion: "director-action-structures.v1",
  label: "鹤形拳（示意动作结构）",
  aliases: ["鹤形拳", "鹤拳"],
  locale: "zh-CN",
  category: "martial_blocking",
  reviewState: "curated",
  intent: { description: "五段式单人鹤形拳白模起势、展翼、探手、回收与收势。", derivation: "illustrative" },
  durationRangeSeconds: [5, 30],
  defaultDurationSeconds: 15,
  defaultFps: 24,
  phases: [
    { phaseId: "prepare", label: "预备", role: "setup", startFraction: 0, endFraction: 0.2, posePresetId: "action.guard", interpolation: "linear" },
    { phaseId: "lift", label: "提膝展翼", role: "transfer", startFraction: 0.2, endFraction: 0.4, posePresetId: "action.kick", jointOverrides: { upper_arm_l: { x: 0, y: 0, z: 75 }, upper_arm_r: { x: 0, y: 0, z: -75 }, upper_leg_r: { x: -55, y: 0, z: 0 } }, rootDisplacementM: [0, 0, 0.1], interpolation: "bezier" },
    { phaseId: "probe", label: "探手", role: "strike", startFraction: 0.4, endFraction: 0.6, posePresetId: "interaction.push", rootDisplacementM: [0.2, 0, 0], interpolation: "linear" },
    { phaseId: "contact-recoil", label: "触点与回收", role: "contact", startFraction: 0.6, endFraction: 0.8, posePresetId: "action.guard", rootDisplacementM: [0.08, 0, 0], interpolation: "linear" },
    { phaseId: "recover", label: "收势", role: "end", startFraction: 0.8, endFraction: 1, posePresetId: "standing.relaxed", interpolation: "linear" },
  ],
  roles: { primary: "required", opponent: "optional" },
  contacts: [{ phaseId: "contact-recoil", sourceJointId: "wrist_r", targetRole: "opponent", targetRegion: "upper_body", mode: "touch_candidate", limitation: "reference_constraint_not_physics" }],
  cameraHints: [],
  source: "iFrame Director curated illustrative blocking",
  confidence: 0.65,
  limitations: ["仅白模示意动作结构；不代表特定门派拳谱或表演者动作。", "平衡、足底接触与触点需要人工校正；不含物理或 IK 求解。"],
};

const FIGHT_COMBO_CONTENT: ActionStructureContent = {
  actionId: "martial.jab_cross.blocking.v1", catalogVersion: "director-action-structures.v1",
  label: "直拳组合", aliases: ["直拳组合", "刺拳接后手直拳"], locale: "zh-CN",
  category: "martial_blocking", reviewState: "curated",
  intent: { description: "防守、前手刺拳、后手直拳与回防的白模分段。", derivation: "illustrative" },
  durationRangeSeconds: [2, 12], defaultDurationSeconds: 4, defaultFps: 24,
  phases: [
    { phaseId: "guard", label: "防守站位", role: "setup", startFraction: 0, endFraction: 0.25, posePresetId: "action.guard", interpolation: "linear" },
    { phaseId: "jab", label: "前手刺拳", role: "strike", startFraction: 0.25, endFraction: 0.45, posePresetId: "action.guard", jointOverrides: { upper_arm_l: r(-52, -22, 15), lower_arm_l: r(8, 0, 0), spine_chest: r(0, -12, 0) }, rootDisplacementM: [0, 0.12, 0], interpolation: "linear" },
    { phaseId: "cross", label: "后手直拳", role: "contact", startFraction: 0.45, endFraction: 0.7, posePresetId: "action.guard", jointOverrides: { upper_arm_r: r(-62, 24, -12), lower_arm_r: r(10, 0, 0), pelvis: r(0, 18, 0), spine_chest: r(0, 20, 0) }, rootDisplacementM: [0, 0.24, 0], interpolation: "linear" },
    { phaseId: "recover", label: "回防", role: "recovery", startFraction: 0.7, endFraction: 1, posePresetId: "action.guard", rootDisplacementM: [0, 0.18, 0], interpolation: "linear" },
  ],
  roles: { primary: "required", opponent: "optional" },
  contacts: [{ phaseId: "cross", sourceJointId: "wrist_r", targetRole: "opponent", targetRegion: "upper_body", mode: "touch_candidate", limitation: "reference_constraint_not_physics" }],
  cameraHints: ["中景侧前方"], source: "iFrame Director illustrative blocking", confidence: 0.6,
  limitations: ["拳距与接触时间仅为参考。", "重心、脚步与命中位置需要人工复核。"],
};

const DODGE_COUNTER_CONTENT: ActionStructureContent = {
  actionId: "martial.dodge_counter.blocking.v1", catalogVersion: "director-action-structures.v1",
  label: "侧闪反击", aliases: ["侧闪反击", "闪避反击"], locale: "zh-CN",
  category: "martial_blocking", reviewState: "curated",
  intent: { description: "侧向闪避、调整站位和反击的白模动作参考。", derivation: "illustrative" },
  durationRangeSeconds: [2, 12], defaultDurationSeconds: 4, defaultFps: 24,
  phases: [
    { phaseId: "ready", label: "警戒", role: "setup", startFraction: 0, endFraction: 0.25, posePresetId: "action.guard", interpolation: "linear" },
    { phaseId: "dodge", label: "侧闪", role: "transfer", startFraction: 0.25, endFraction: 0.5, posePresetId: "standing.lean", rootDisplacementM: [0.45, 0, 0], interpolation: "bezier" },
    { phaseId: "counter", label: "反击", role: "contact", startFraction: 0.5, endFraction: 0.75, posePresetId: "interaction.push", jointOverrides: { upper_arm_r: r(-60, 18, -18), lower_arm_r: r(12, 0, 0) }, rootDisplacementM: [0.45, 0.18, 0], interpolation: "linear" },
    { phaseId: "reset", label: "回收", role: "recovery", startFraction: 0.75, endFraction: 1, posePresetId: "action.guard", rootDisplacementM: [0.45, 0.1, 0], interpolation: "linear" },
  ],
  roles: { primary: "required", opponent: "optional" },
  contacts: [{ phaseId: "counter", sourceJointId: "wrist_r", targetRole: "opponent", targetRegion: "upper_body", mode: "touch_candidate", limitation: "reference_constraint_not_physics" }],
  cameraHints: ["侧面全身"], source: "iFrame Director illustrative blocking", confidence: 0.55,
  limitations: ["侧闪距离未按对手攻击轨迹求解。", "接触、平衡和足底需人工校正。"],
};

const FRONT_KICK_CONTENT: ActionStructureContent = {
  actionId: "martial.front_kick.blocking.v1", catalogVersion: "director-action-structures.v1",
  label: "前踢回防", aliases: ["前踢回防", "前踢"], locale: "zh-CN",
  category: "martial_blocking", reviewState: "curated",
  intent: { description: "提膝、前踢、落脚与回防的白模分段。", derivation: "illustrative" },
  durationRangeSeconds: [2, 12], defaultDurationSeconds: 4, defaultFps: 24,
  phases: [
    { phaseId: "guard", label: "防守", role: "setup", startFraction: 0, endFraction: 0.25, posePresetId: "action.guard", interpolation: "linear" },
    { phaseId: "chamber", label: "提膝", role: "transfer", startFraction: 0.25, endFraction: 0.45, posePresetId: "action.kick", jointOverrides: { upper_leg_l: r(64, 0, 4), lower_leg_l: r(65, 0, 0) }, interpolation: "linear" },
    { phaseId: "kick", label: "踢出", role: "contact", startFraction: 0.45, endFraction: 0.7, posePresetId: "action.kick", rootDisplacementM: [0, 0.12, 0], interpolation: "linear" },
    { phaseId: "recover", label: "落脚回防", role: "recovery", startFraction: 0.7, endFraction: 1, posePresetId: "action.guard", rootDisplacementM: [0, 0.12, 0], interpolation: "linear" },
  ],
  roles: { primary: "required", opponent: "optional" },
  contacts: [{ phaseId: "kick", sourceJointId: "foot_l", targetRole: "opponent", targetRegion: "lower_body", mode: "touch_candidate", limitation: "reference_constraint_not_physics" }],
  cameraHints: ["三分之二侧面全身"], source: "iFrame Director illustrative blocking", confidence: 0.55,
  limitations: ["踢击高度与足底接触未经过 IK 验证。", "与对手距离需人工复核。"],
};

// FNV-1a over the canonical catalog content gives a stable local revision identity.
export function actionStructureChecksum(content: ActionStructureContent | ActionStructure): string {
  const { checksum: _checksum, ...canonical } = content as ActionStructure;
  let hash = 2166136261;
  for (const char of JSON.stringify(canonical)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const ACTION_STRUCTURES: readonly ActionStructure[] = [
  { ...HEXINGQUAN_CONTENT, checksum: actionStructureChecksum(HEXINGQUAN_CONTENT) },
  ...[FIGHT_COMBO_CONTENT, DODGE_COUNTER_CONTENT, FRONT_KICK_CONTENT].map((content) => ({ ...content, checksum: actionStructureChecksum(content) })),
];

export function validateActionStructure(action: ActionStructure): string[] {
  const errors: string[] = [];
  const { checksum, ...content } = action;
  if (!action.actionId || !action.catalogVersion || !action.label || !action.source || checksum !== actionStructureChecksum(content)) errors.push("identity");
  if (!["curated", "draft", "needs_review"].includes(action.reviewState) || !["illustrative", "reference_derived", "solver_derived"].includes(action.intent.derivation)) errors.push("review");
  if (!action.aliases.length || action.aliases.some((alias) => !alias.trim())) errors.push("aliases");
  if (action.roles.primary !== "required" || action.roles.opponent !== "optional") errors.push("roles");
  const [minimum, maximum] = action.durationRangeSeconds;
  if (!(minimum > 0 && maximum >= minimum && action.defaultDurationSeconds >= minimum && action.defaultDurationSeconds <= maximum && Number.isInteger(action.defaultFps) && action.defaultFps > 0)) errors.push("duration");
  if (!Number.isFinite(action.confidence) || action.confidence < 0 || action.confidence > 1 || !action.limitations.length) errors.push("evidence");
  const joints = new Set(rigProfile.joints.map((joint) => joint.joint_id));
  const phaseIds = new Set<string>();
  let end = 0;
  for (const phase of action.phases) {
    if (!phase.phaseId || phaseIds.has(phase.phaseId) || phase.startFraction !== end || !Number.isFinite(phase.endFraction) || phase.endFraction <= end || phase.endFraction > 1) errors.push(`phase:${phase.phaseId}`);
    if (!["setup", "transfer", "strike", "contact", "recovery", "end"].includes(phase.role) || !["step", "linear", "bezier"].includes(phase.interpolation)) errors.push(`phaseContract:${phase.phaseId}`);
    if (!posePresetById.has(phase.posePresetId)) errors.push(`pose:${phase.phaseId}`);
    if (phase.jointOverrides && Object.entries(phase.jointOverrides).some(([jointId, rotation]) => !joints.has(jointId) || ![rotation.x, rotation.y, rotation.z].every(Number.isFinite))) errors.push(`joints:${phase.phaseId}`);
    if (phase.rootDisplacementM && (phase.rootDisplacementM.length !== 3 || !phase.rootDisplacementM.every(Number.isFinite))) errors.push(`root:${phase.phaseId}`);
    phaseIds.add(phase.phaseId);
    end = phase.endFraction;
  }
  if (!action.phases.length || end !== 1) errors.push("phaseCoverage");
  for (const contact of action.contacts) {
    if (!phaseIds.has(contact.phaseId) || !joints.has(contact.sourceJointId) || contact.targetRole !== "opponent" || !contact.targetRegion || contact.mode !== "touch_candidate" || contact.limitation !== "reference_constraint_not_physics") errors.push(`contact:${contact.phaseId}`);
  }
  return errors;
}
