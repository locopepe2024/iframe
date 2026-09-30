import { describe, expect, it } from "vitest";

import { buildFullMotionBundle, serializeFullMotionBundle } from "../components/director3d/state/motion-bundle";
import { createRigMappingManifest } from "../components/director3d/state/motion-retarget";
import type { MotionRetargetResult } from "../components/director3d/types";

const coordinateSystem = { image_x: "blender_x" as const, image_y: "blender_z" as const, depth_z: "blender_y" as const };
const retarget: MotionRetargetResult = { mappingRevision: "map-v1", mode: "local_quaternion_v1", frames: [{ frame: 1, rootPosition: [0, 0, 0], pelvisQuaternion: null, localQuaternions: {}, warnings: [] }], warnings: ["source warning"] };
const input = { sourceTrackRevision: "track-v1", rigAsset: "white-model-neutral-female-v1.blend", rigMapping: createRigMappingManifest("rig-v1", coordinateSystem), retarget, frameRange: [1, 1] as [number, number], fps: 24, coordinateSystem, ikEnabled: false };

describe("full motion bundle", () => {
  it("preserves review state and explicit IK capability", () => {
    const bundle = buildFullMotionBundle(input);
    expect(bundle.schema).toBe("director-full-motion-bundle.v1");
    expect(bundle.ik_enabled).toBe(false);
    expect(bundle.review_status).toBe("needs_director_review");
    expect(bundle.warnings).toContain("IK 未启用；foot contact candidates 仍需导演审核。");
  });
  it("serializes valid JSON", () => {
    expect(() => JSON.parse(serializeFullMotionBundle(input))).not.toThrow();
  });
});
