import { describe, expect, it } from "vitest";
import { imageEditModeFromSceneTool } from "@/lib/imageEditing";

describe("image edit mode projection", () => {
    it("maps structured scene tools to explicit modes", () => {
        expect(imageEditModeFromSceneTool({ kind: "lighting" })).toBe("scene_lighting");
        expect(imageEditModeFromSceneTool({ kind: "camera" })).toBe("scene_camera");
        expect(imageEditModeFromSceneTool(null)).toBe("freeform");
    });
});
