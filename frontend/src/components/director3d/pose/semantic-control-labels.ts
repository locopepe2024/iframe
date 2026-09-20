import type { Axis } from "../types";
import type { SemanticControlDefinition } from "./semantic-controls";
import { CLAVICLE_AXIS_LABELS } from "./pose-direction-contract";

const AXIS_LABELS: Record<Axis, string> = { x: "前后屈伸", y: "侧向调整", z: "轴向旋转" };

function roleAxisLabel(role: string, axis: Axis): string {
  if (role === "root") return ({ x: "身体前后倾", y: "身体侧倾", z: "身体朝向" } as const)[axis];
  if (role === "pelvis") return ({ x: "骨盆前后倾", y: "骨盆侧倾", z: "骨盆扭转" } as const)[axis];
  if (role.startsWith("spine_")) return ({ x: "躯干前后弯", y: "躯干侧弯", z: "躯干扭转" } as const)[axis];
  if (role === "neck") return ({ x: "颈部俯仰", y: "颈部侧倾", z: "颈部转向" } as const)[axis];
  if (role === "head") return ({ x: "头部俯仰", y: "头部侧倾", z: "头部转向" } as const)[axis];
  if (role === "clavicle") return CLAVICLE_AXIS_LABELS[axis];
  if (role === "upper_arm") return ({ x: "上臂前后摆", y: "上臂内外转", z: "上臂抬放" } as const)[axis];
  if (role === "lower_arm") return ({ x: "肘部屈伸", y: "前臂侧向", z: "前臂旋转" } as const)[axis];
  if (role === "wrist") return ({ x: "手腕屈伸", y: "手腕侧偏", z: "手腕旋转" } as const)[axis];
  if (role === "hand") return ({ x: "手掌屈伸", y: "手掌侧偏", z: "手掌旋转" } as const)[axis];
  if (/^(thumb|index|middle|ring|little)_\d+$/.test(role)) return ({ x: "手指屈伸", y: "手指侧摆", z: "手指扭转" } as const)[axis];
  if (role === "upper_leg") return ({ x: "髋部屈伸", y: "髋部侧展", z: "髋部旋转" } as const)[axis];
  if (role === "lower_leg") return ({ x: "膝部屈伸", y: "膝部侧向", z: "膝部旋转" } as const)[axis];
  if (role === "ankle") return ({ x: "踝部屈伸", y: "踝部内外翻", z: "踝部侧摆" } as const)[axis];
  if (role === "foot") return ({ x: "足部屈伸", y: "足部内外翻", z: "足部侧摆" } as const)[axis];
  if (role === "toe") return ({ x: "脚趾屈伸", y: "脚趾侧摆", z: "脚趾旋转" } as const)[axis];
  return `${role} ${AXIS_LABELS[axis]}`;
}

export function semanticControlLabel(control: SemanticControlDefinition): string {
  const side = control.side === "left" ? "左侧" : control.side === "right" ? "右侧" : "中央";
  return `${side} · ${roleAxisLabel(control.semanticRole, control.targetAxis)}`;
}

export function hasProductSemanticLabel(role: string): boolean {
  return roleAxisLabel(role, "x") !== `${role} ${AXIS_LABELS.x}`;
}
