import type { Axis, RigProfile } from "../types";

export const SEMANTIC_CONTROL_POLICY_VERSION = "director-humanoid-semantic-controls.v1";

export interface SemanticControlDefinition {
  controlId: string;
  targetJointId: string;
  targetAxis: Axis;
  semanticRole: string;
  side: "left" | "right" | "center";
  inputRange: [-1, 1];
  outputRangeDeg: [number, number];
  mirrorControlId: string | null;
  mirrorValueScale: number;
}

export function enumerateSemanticControls(profile: RigProfile): SemanticControlDefinition[] {
  const policy = profile.semantic_control_policy;
  if (policy.version !== SEMANTIC_CONTROL_POLICY_VERSION
    || policy.control_id_template !== "joint.{joint_id}.{axis}"
    || policy.mapping_curve !== "piecewise_linear_neutral"
    || policy.output_range_source !== "joint.rotation_limits_deg"
    || policy.admission !== "every_direct_product_joint_axis"
    || policy.input_range[0] !== -1
    || policy.input_range[1] !== 1
    || policy.neutral_value !== 0) {
    throw new Error("unsupported_semantic_control_policy");
  }
  const jointsById = new Map(profile.joints.map((joint) => [joint.joint_id, joint]));
  const controls: SemanticControlDefinition[] = [];
  for (const joint of profile.joints) {
    if (joint.control_class !== "product_joint" || joint.edit_policy !== "direct") continue;
    for (const axis of joint.supported_axes) {
      const outputRangeDeg = joint.rotation_limits_deg[axis];
      if (!outputRangeDeg || outputRangeDeg[0] >= outputRangeDeg[1] || outputRangeDeg[0] > 0 || outputRangeDeg[1] < 0) {
        throw new Error(`invalid_semantic_control_range:${joint.joint_id}:${axis}`);
      }
      const mirrorJoint = joint.mirror_joint_id ? jointsById.get(joint.mirror_joint_id) : undefined;
      controls.push({
        controlId: `joint.${joint.joint_id}.${axis}`,
        targetJointId: joint.joint_id,
        targetAxis: axis,
        semanticRole: joint.semantic_role,
        side: joint.side,
        inputRange: [-1, 1],
        outputRangeDeg,
        mirrorControlId: mirrorJoint?.supported_axes.includes(axis) ? `joint.${mirrorJoint.joint_id}.${axis}` : null,
        mirrorValueScale: policy.mirror_axis_value_scale[axis],
      });
    }
  }
  return controls;
}

export function semanticValueToDegrees(control: SemanticControlDefinition, value: number): number {
  const bounded = Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));
  return bounded < 0 ? -bounded * control.outputRangeDeg[0] : bounded * control.outputRangeDeg[1];
}

export function degreesToSemanticValue(control: SemanticControlDefinition, degrees: number): number {
  const bounded = Math.min(control.outputRangeDeg[1], Math.max(control.outputRangeDeg[0], Number.isFinite(degrees) ? degrees : 0));
  if (bounded < 0) return bounded / Math.abs(control.outputRangeDeg[0]);
  if (bounded > 0) return bounded / control.outputRangeDeg[1];
  return 0;
}
