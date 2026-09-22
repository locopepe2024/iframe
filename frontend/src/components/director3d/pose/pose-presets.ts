import type { Rotation } from "../types";

export const POSE_PRESET_TAXONOMY_VERSION = "director-pose-presets.v1";

export const POSE_PRESET_FAMILIES = [
  { familyId: "neutral", label: "中性与校准" },
  { familyId: "standing", label: "站立" },
  { familyId: "locomotion", label: "行走与跑动" },
  { familyId: "seated_kneeling", label: "坐姿与跪姿" },
  { familyId: "interaction", label: "交互" },
  { familyId: "action", label: "动作" },
  { familyId: "gesture", label: "手势" },
] as const;

export type PosePresetFamilyId = (typeof POSE_PRESET_FAMILIES)[number]["familyId"];

export type PosePresetId =
  | "pose.neutral"
  | "pose.t_pose"
  | "standing.relaxed"
  | "standing.contrapposto"
  | "standing.hands_on_hips"
  | "standing.lean"
  | "standing.bow"
  | "locomotion.walk_contact"
  | "locomotion.run_stride"
  | "seated.sit"
  | "seated.squat"
  | "kneeling.single_knee"
  | "interaction.push"
  | "interaction.phone_use"
  | "action.guard"
  | "action.kick"
  | "action.throw"
  | "gesture.wave"
  | "gesture.reach"
  | "gesture.arms_crossed"
  | "gesture.thinking";

export interface PosePreset {
  presetId: PosePresetId;
  familyId: PosePresetFamilyId;
  label: string;
  description: string;
  rootOffsetM?: [number, number, number];
  contactHint?: string;
  rotations: Record<string, Rotation>;
}

const r = (x = 0, y = 0, z = 0): Rotation => ({ x, y, z });

export const POSE_PRESETS: PosePreset[] = [
  {
    presetId: "pose.neutral",
    familyId: "neutral",
    label: "自然中性位",
    description: "清除全部标准化关节增量，回到可继续编排的中性位。",
    rotations: {},
  },
  {
    presetId: "pose.t_pose",
    familyId: "neutral",
    label: "T 形校准位",
    description: "双臂水平展开的校准参考位，不代表最终表演姿势。",
    rotations: {
      upper_arm_l: r(0, 0, 90),
      upper_arm_r: r(0, 0, -90),
    },
  },
  {
    presetId: "standing.relaxed",
    familyId: "standing",
    label: "放松站立",
    description: "轻微重心偏移和自然垂臂的站立构图起点。",
    rotations: {
      pelvis: r(0, 0, -3),
      spine_chest: r(0, 0, 2),
      upper_arm_l: r(2, 0, 7),
      upper_arm_r: r(2, 0, -5),
      lower_arm_l: r(4, 0, 2),
      lower_arm_r: r(5, 0, -2),
      upper_leg_l: r(0, 0, 3),
      upper_leg_r: r(0, 0, -2),
    },
  },
  {
    presetId: "standing.contrapposto",
    familyId: "standing",
    label: "对立式站姿",
    description: "髋肩反向倾斜的非对称站姿，用于检查轮廓和重心。",
    rotations: {
      pelvis: r(0, 0, 9),
      spine_lower: r(0, 0, -6),
      spine_chest: r(0, 0, -5),
      head: r(0, 0, 3),
      upper_arm_l: r(2, 0, 12),
      upper_arm_r: r(2, 0, -7),
      upper_leg_l: r(-4, 0, -5),
      upper_leg_r: r(3, 0, -8),
      lower_leg_r: r(8, 0, 0),
    },
  },
  {
    presetId: "standing.hands_on_hips",
    familyId: "standing",
    label: "双手叉腰",
    description: "双肘外展、双手靠近髋部的站立姿势。",
    rotations: {
      clavicle_l: r(0, 0, 8),
      clavicle_r: r(0, 0, -8),
      upper_arm_l: r(12, 0, 48),
      upper_arm_r: r(12, 0, -48),
      lower_arm_l: r(0, 0, 82),
      lower_arm_r: r(0, 0, -82),
      wrist_l: r(10, 0, -15),
      wrist_r: r(10, 0, 15),
    },
  },
  {
    presetId: "standing.lean",
    familyId: "standing",
    label: "侧身倚靠",
    description: "躯干和髋部侧向偏移的倚靠构图起点。",
    rotations: {
      root: r(0, 0, 8),
      pelvis: r(0, 0, -12),
      spine_lower: r(0, 0, 8),
      spine_chest: r(0, 0, 7),
      head: r(0, 0, -5),
      upper_arm_l: r(0, 0, 18),
      lower_arm_l: r(0, 0, 20),
      upper_leg_r: r(0, 0, -10),
    },
  },
  {
    presetId: "standing.bow",
    familyId: "standing",
    label: "前倾鞠躬",
    description: "髋部与躯干前倾的礼貌动作关键姿势。",
    rotations: {
      pelvis: r(18, 0, 0),
      spine_lower: r(16, 0, 0),
      spine_mid: r(10, 0, 0),
      spine_chest: r(6, 0, 0),
      neck: r(-10, 0, 0),
      upper_arm_l: r(8, 0, 5),
      upper_arm_r: r(8, 0, -5),
    },
  },
  {
    presetId: "locomotion.walk_contact",
    familyId: "locomotion",
    label: "行走接触帧",
    description: "手脚反向摆动的行走接触关键帧，需结合轨迹继续校正接地。",
    rotations: {
      pelvis: r(0, 5, 2),
      spine_chest: r(0, -5, -2),
      upper_arm_l: r(-24, 0, 5),
      upper_arm_r: r(24, 0, -5),
      lower_arm_l: r(20, 0, 0),
      lower_arm_r: r(12, 0, 0),
      upper_leg_l: r(28, 0, 0),
      upper_leg_r: r(-24, 0, 0),
      lower_leg_r: r(18, 0, 0),
      ankle_l: r(-8, 0, 0),
      ankle_r: r(10, 0, 0),
    },
  },
  {
    presetId: "locomotion.run_stride",
    familyId: "locomotion",
    label: "跑步跨步帧",
    description: "躯干前倾、手臂屈曲和双腿跨步的跑动关键帧。",
    rotations: {
      root: r(8, 0, 0),
      spine_chest: r(8, 0, 0),
      upper_arm_l: r(-42, 0, 8),
      upper_arm_r: r(48, 0, -8),
      lower_arm_l: r(65, 0, 0),
      lower_arm_r: r(72, 0, 0),
      upper_leg_l: r(48, 0, 0),
      upper_leg_r: r(-42, 0, 0),
      lower_leg_l: r(28, 0, 0),
      lower_leg_r: r(72, 0, 0),
      ankle_l: r(-12, 0, 0),
      ankle_r: r(18, 0, 0),
    },
  },
  {
    presetId: "seated.sit",
    familyId: "seated_kneeling",
    label: "坐姿",
    description: "髋膝屈曲的通用坐姿关键位，姿势高度可继续匹配具体椅面。",
    rootOffsetM: [0, 0, -0.42],
    contactHint: "双脚接地起点；骨盆高度约 0.51 m，需按椅面继续调整。",
    rotations: {
      pelvis: r(-8, 0, 0),
      spine_lower: r(8, 0, 0),
      upper_leg_l: r(-78, 0, 0),
      upper_leg_r: r(-78, 0, 0),
      lower_leg_l: r(88, 0, 0),
      lower_leg_r: r(88, 0, 0),
      ankle_l: r(10, 0, 0),
      ankle_r: r(10, 0, 0),
      upper_arm_l: r(12, 0, 8),
      upper_arm_r: r(12, 0, -8),
      lower_arm_l: r(38, 0, 0),
      lower_arm_r: r(38, 0, 0),
    },
  },
  {
    presetId: "seated.squat",
    familyId: "seated_kneeling",
    label: "深蹲",
    description: "髋膝踝共同屈曲的低位构图起点，需在视口确认接地。",
    rootOffsetM: [0, 0, -0.46],
    contactHint: "双脚接地起点；未提供自动平衡或足底 IK。",
    rotations: {
      root: r(10, 0, 0),
      pelvis: r(-18, 0, 0),
      spine_lower: r(15, 0, 0),
      upper_leg_l: r(-78, 0, 8),
      upper_leg_r: r(-78, 0, -8),
      lower_leg_l: r(112, 0, 0),
      lower_leg_r: r(112, 0, 0),
      ankle_l: r(28, 0, 0),
      ankle_r: r(28, 0, 0),
      upper_arm_l: r(28, 0, 20),
      upper_arm_r: r(28, 0, -20),
      lower_arm_l: r(45, 0, 0),
      lower_arm_r: r(45, 0, 0),
    },
  },
  {
    presetId: "kneeling.single_knee",
    familyId: "seated_kneeling",
    label: "单膝跪地",
    description: "一侧支撑、另一侧跪地的非对称关键位，需结合地面高度细调。",
    rootOffsetM: [0, 0, -0.52],
    contactHint: "左脚与右膝接地起点；脚背、重心和膝盖接触仍需视觉确认。",
    rotations: {
      pelvis: r(-6, 0, 4),
      spine_lower: r(6, 0, -2),
      upper_leg_l: r(-80, 0, 4),
      lower_leg_l: r(120, 0, 0),
      ankle_l: r(18, 0, 0),
      upper_leg_r: r(-1, 0, -4),
      lower_leg_r: r(118, 0, 0),
      ankle_r: r(-25, 0, 0),
      upper_arm_l: r(10, 0, 10),
      upper_arm_r: r(10, 0, -10),
    },
  },
  {
    presetId: "interaction.push",
    familyId: "interaction",
    label: "双手推物",
    description: "身体前倾、双臂向前的接触准备位，不自动建立物体接触约束。",
    rotations: {
      root: r(8, 0, 0),
      spine_chest: r(8, 0, 0),
      clavicle_l: r(0, 0, 8),
      clavicle_r: r(0, 0, -8),
      upper_arm_l: r(-18, -55, 42),
      upper_arm_r: r(-18, 55, -42),
      lower_arm_l: r(8, 0, 18),
      lower_arm_r: r(8, 0, -18),
      wrist_l: r(0, -12, 0),
      wrist_r: r(0, 12, 0),
      upper_leg_l: r(12, 0, 0),
      upper_leg_r: r(-10, 0, 0),
    },
  },
  {
    presetId: "interaction.phone_use",
    familyId: "interaction",
    label: "查看手机",
    description: "一手托持、一手靠近屏幕的手机交互构图起点。",
    rotations: {
      spine_chest: r(8, 0, 0),
      neck: r(18, 0, 0),
      head: r(12, 0, 0),
      upper_arm_l: r(22, -18, 28),
      lower_arm_l: r(82, 0, 20),
      wrist_l: r(-12, 0, -8),
      upper_arm_r: r(28, 22, -20),
      lower_arm_r: r(96, 0, -22),
      wrist_r: r(8, 0, 10),
      index_01_r: r(20, 0, 0),
      index_02_r: r(14, 0, 0),
    },
  },
  {
    presetId: "action.guard",
    familyId: "action",
    label: "双手防守",
    description: "双臂抬起的对称防守基础位，可继续调整手腕、手指和脚步。",
    rotations: {
      upper_arm_l: r(12, -10, 42),
      lower_arm_l: r(72, 0, 48),
      wrist_l: r(-8, 0, -6),
      upper_arm_r: r(12, 10, -42),
      lower_arm_r: r(72, 0, -48),
      wrist_r: r(-8, 0, 6),
      upper_leg_l: r(8, 0, 8),
      upper_leg_r: r(-5, 0, -8),
    },
  },
  {
    presetId: "action.kick",
    familyId: "action",
    label: "前踢关键位",
    description: "单腿抬起前踢的动作关键位，仅提供构图参考而非动力学结果。",
    rotations: {
      pelvis: r(-8, 0, -6),
      spine_chest: r(6, 0, 5),
      upper_leg_l: r(76, 0, 4),
      lower_leg_l: r(-18, 0, 0),
      ankle_l: r(-12, 0, 0),
      upper_leg_r: r(-8, 0, -4),
      lower_leg_r: r(12, 0, 0),
      upper_arm_l: r(-18, 0, 28),
      upper_arm_r: r(20, 0, -32),
      lower_arm_l: r(42, 0, 0),
      lower_arm_r: r(48, 0, 0),
    },
  },
  {
    presetId: "action.throw",
    familyId: "action",
    label: "投掷蓄力",
    description: "躯干扭转、持物臂后引的投掷蓄力关键位。",
    rotations: {
      pelvis: r(0, -18, 0),
      spine_lower: r(0, 12, 0),
      spine_chest: r(0, 24, 0),
      head: r(0, -18, 0),
      upper_arm_l: r(-20, 12, 24),
      lower_arm_l: r(38, 0, 8),
      upper_arm_r: r(-62, -35, -68),
      lower_arm_r: r(95, 0, -25),
      wrist_r: r(15, 0, 12),
      upper_leg_l: r(12, 0, 5),
      upper_leg_r: r(-12, 0, -5),
    },
  },
  {
    presetId: "gesture.wave",
    familyId: "gesture",
    label: "挥手",
    description: "右臂抬起、手掌靠近头侧的招手关键位。",
    rotations: {
      clavicle_r: r(0, 0, -8),
      upper_arm_r: r(-18, 0, -72),
      lower_arm_r: r(82, 0, -35),
      wrist_r: r(0, 0, 18),
      head: r(0, 0, 5),
    },
  },
  {
    presetId: "gesture.reach",
    familyId: "gesture",
    label: "右手伸出",
    description: "右肩、手臂和手腕形成可继续细调的基础伸手姿势。",
    rotations: {
      clavicle_r: r(0, 0, -8),
      upper_arm_r: r(0, -35, -58),
      lower_arm_r: r(0, 0, -22),
      wrist_r: r(8, 0, 0),
    },
  },
  {
    presetId: "gesture.arms_crossed",
    familyId: "gesture",
    label: "双臂交叉",
    description: "双前臂在胸前交叠的封闭式肢体语言起点。",
    rotations: {
      upper_arm_l: r(18, -28, 28),
      lower_arm_l: r(88, 0, 48),
      wrist_l: r(0, 0, -12),
      upper_arm_r: r(18, 28, -28),
      lower_arm_r: r(88, 0, -48),
      wrist_r: r(0, 0, 12),
    },
  },
  {
    presetId: "gesture.thinking",
    familyId: "gesture",
    label: "思考",
    description: "一手托肘、一手靠近下巴的思考肢体语言起点。",
    rotations: {
      head: r(4, 0, -5),
      upper_arm_l: r(18, -18, 22),
      lower_arm_l: r(68, 0, 38),
      wrist_l: r(0, 0, -10),
      upper_arm_r: r(28, 18, -32),
      lower_arm_r: r(105, 0, -28),
      wrist_r: r(-10, 0, 8),
    },
  },
];

export const posePresetById = new Map(POSE_PRESETS.map((preset) => [preset.presetId, preset]));

export const posePresetsByFamily = new Map(
  POSE_PRESET_FAMILIES.map((family) => [
    family.familyId,
    POSE_PRESETS.filter((preset) => preset.familyId === family.familyId),
  ]),
);

export function mirrorRotation(rotation: Rotation): Rotation {
  return { x: rotation.x, y: -rotation.y, z: -rotation.z };
}
