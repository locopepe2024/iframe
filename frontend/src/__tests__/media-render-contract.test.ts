import { describe, expect, it } from "vitest";

import { buildMediaHostRenderRequest, validateMediaHostRenderResult } from "../components/director3d/state/media-render-contract";
import type { FullMotionBundle } from "../components/director3d/types";

const coordinates = { image_x: "blender_x" as const, image_y: "blender_z" as const, depth_z: "blender_y" as const };
const bundle: FullMotionBundle = { schema: "director-full-motion-bundle.v1", source_track_revision: "track-v1", rig_asset: "white-model-neutral-female-v1.blend", rig_mapping_revision: "map-v1", retarget_mode: "local_quaternion_v1", ik_enabled: false, cleanup_processors: [], frame_range: [1, 1], fps: 24, coordinate_system: coordinates, warnings: [], review_status: "needs_director_review", frames: [], ik_statuses: [] };

describe("media host render contract", () => {
  it("targets Blender on the media host and declares required artifacts", () => {
    const request = buildMediaHostRenderRequest(bundle, "render-001");
    expect(request.render.hostClass).toBe("media");
    expect(request.render.engine).toBe("blender");
    expect(request.outputs.whiteModelVideo).toBe("white_model_video.mp4");
  });
  it("rejects a result from another request", () => {
    expect(() => validateMediaHostRenderResult({ schema: "director-media-render-result.v1", requestId: "other", status: "queued", outputs: {} }, "render-001")).toThrow("requestId");
  });
});
