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
