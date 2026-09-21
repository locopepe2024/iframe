import type { Axis } from "../types";

export const HUMANOID_SOURCE_AXIS_CALIBRATION_VERSION =
  "white-model-neutral-female-v1.source-axis-calibration.v1";

export const CLAVICLE_AXIS_LABELS: Record<Axis, string> = {
  x: "肩带抬落",
  y: "肩带轴向调整",
  z: "肩带前后",
};

export const LOWER_BODY_FLEXION_DIRECTION = {
  upperLegX: "negative",
  lowerLegX: "positive",
} as const;
