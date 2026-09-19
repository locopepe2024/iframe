import type { RigProfile } from "../types";
import { enumerateSemanticControls, SEMANTIC_CONTROL_POLICY_VERSION } from "./semantic-controls";

export const REQUIRED_PRODUCT_JOINT_IDS = [
  "root", "pelvis", "spine_lower", "spine_mid", "spine_chest", "neck", "head",
  "clavicle_l", "upper_arm_l", "lower_arm_l", "wrist_l", "hand_l",
  "index_01_l", "index_02_l", "index_03_l", "middle_01_l", "middle_02_l", "middle_03_l",
  "little_01_l", "little_02_l", "little_03_l", "ring_01_l", "ring_02_l", "ring_03_l",
  "thumb_01_l", "thumb_02_l", "thumb_03_l",
  "clavicle_r", "upper_arm_r", "lower_arm_r", "wrist_r", "hand_r",
  "index_01_r", "index_02_r", "index_03_r", "middle_01_r", "middle_02_r", "middle_03_r",
  "little_01_r", "little_02_r", "little_03_r", "ring_01_r", "ring_02_r", "ring_03_r",
  "thumb_01_r", "thumb_02_r", "thumb_03_r",
  "upper_leg_l", "lower_leg_l", "ankle_l", "foot_l", "toe_l",
  "upper_leg_r", "lower_leg_r", "ankle_r", "foot_r", "toe_r",
] as const;

const REQUIRED_JOINT_VOCABULARY_VERSION = "director-humanoid-product-joints.v1";
const REQUIRED_MAPPING_VERSION = "director-humanoid-product-joints.v1";
const REQUIRED_LIMIT_POLICY_VERSION = "director-humanoid-joint-limits.v1";

export type RigAdmissionCode =
  | "duplicate_joint_id"
  | "missing_product_joint"
  | "misclassified_product_joint"
  | "non_editable_product_joint"
  | "internal_bone_directly_editable"
  | "missing_parent_joint"
  | "missing_mirror_joint"
  | "mirror_relationship_mismatch"
  | "unsupported_joint_vocabulary"
  | "unsupported_mapping_version"
  | "unsupported_limit_policy"
  | "unsupported_semantic_control_policy"
  | "invalid_semantic_control_range"
  | "runtime_bone_missing";

export interface RigAdmissionIssue {
  code: RigAdmissionCode;
  jointId: string;
  message: string;
}

export function validateRigAdmission(profile: RigProfile, runtimeBoneIds?: ReadonlySet<string>): RigAdmissionIssue[] {
  const issues: RigAdmissionIssue[] = [];
  const byId = new Map<string, RigProfile["joints"][number]>();
  const duplicateIds = new Set<string>();
  for (const joint of profile.joints) {
    if (byId.has(joint.joint_id)) duplicateIds.add(joint.joint_id);
    else byId.set(joint.joint_id, joint);
  }
  duplicateIds.forEach((jointId) => issues.push({ code: "duplicate_joint_id", jointId, message: `关节 ${jointId} 在 rig profile 中重复。` }));

  if (profile.joint_vocabulary_version !== REQUIRED_JOINT_VOCABULARY_VERSION) {
    issues.push({ code: "unsupported_joint_vocabulary", jointId: profile.rig_profile_id, message: `不支持关节词汇 ${profile.joint_vocabulary_version}。` });
  }
  if (profile.mapping_version !== REQUIRED_MAPPING_VERSION) {
    issues.push({ code: "unsupported_mapping_version", jointId: profile.rig_profile_id, message: `不支持浏览器/Blender 映射 ${profile.mapping_version}。` });
  }
  if (profile.limit_policy_version !== REQUIRED_LIMIT_POLICY_VERSION) {
    issues.push({ code: "unsupported_limit_policy", jointId: profile.rig_profile_id, message: `不支持关节限制策略 ${profile.limit_policy_version}。` });
  }

  if (profile.semantic_control_policy?.version !== SEMANTIC_CONTROL_POLICY_VERSION) {
    issues.push({ code: "unsupported_semantic_control_policy", jointId: profile.rig_profile_id, message: `Rig ${profile.rig_profile_id} 缺少受支持的语义控制策略。` });
  } else {
    try {
      enumerateSemanticControls(profile);
    } catch (error) {
      issues.push({ code: error instanceof Error && error.message === "unsupported_semantic_control_policy" ? "unsupported_semantic_control_policy" : "invalid_semantic_control_range", jointId: profile.rig_profile_id, message: `Rig ${profile.rig_profile_id} 的语义控制范围无效。` });
    }
  }

  for (const jointId of REQUIRED_PRODUCT_JOINT_IDS) {
    const joint = byId.get(jointId);
    if (!joint) {
      issues.push({ code: "missing_product_joint", jointId, message: `缺少必需产品关节 ${jointId}。` });
      continue;
    }
    if (joint.control_class !== "product_joint") {
      issues.push({ code: "misclassified_product_joint", jointId, message: `必需关节 ${jointId} 被分类为 ${joint.control_class}。` });
    } else if (joint.edit_policy !== "direct") {
      issues.push({ code: "non_editable_product_joint", jointId, message: `产品关节 ${jointId} 不是 direct 可编辑策略。` });
    }
  }

  for (const joint of profile.joints) {
    if (joint.control_class !== "product_joint" && joint.edit_policy === "direct") {
      issues.push({ code: "internal_bone_directly_editable", jointId: joint.joint_id, message: `内部骨骼 ${joint.joint_id} 不得声明为直接编辑。` });
    }
    if (joint.parent_joint_id && !byId.has(joint.parent_joint_id)) {
      issues.push({ code: "missing_parent_joint", jointId: joint.joint_id, message: `关节 ${joint.joint_id} 的父级 ${joint.parent_joint_id} 不存在。` });
    }
    if (joint.mirror_joint_id) {
      const mirror = byId.get(joint.mirror_joint_id);
      if (!mirror) {
        issues.push({ code: "missing_mirror_joint", jointId: joint.joint_id, message: `关节 ${joint.joint_id} 的镜像关节 ${joint.mirror_joint_id} 不存在。` });
      } else if (mirror.mirror_joint_id !== joint.joint_id) {
        issues.push({ code: "mirror_relationship_mismatch", jointId: joint.joint_id, message: `关节 ${joint.joint_id} 与 ${joint.mirror_joint_id} 的镜像关系不互反。` });
      }
    }
    if (runtimeBoneIds && !runtimeBoneIds.has(joint.joint_id)) {
      issues.push({ code: "runtime_bone_missing", jointId: joint.joint_id, message: `浏览器 GLB 中找不到映射骨骼 ${joint.joint_id}。` });
    }
  }
  return issues;
}
