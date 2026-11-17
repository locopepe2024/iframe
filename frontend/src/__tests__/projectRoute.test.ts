import { describe, expect, it } from "vitest";
import { parseProjectRouteHash, projectRouteHash } from "@/lib/projectRoute";

describe("project route hashes", () => {
    it("keeps the project id separate from the selected pipeline step", () => {
        const hash = projectRouteHash("episode-12", "storyboard");

        expect(hash).toBe("#/project/episode-12?step=storyboard");
        expect(parseProjectRouteHash(hash)).toEqual({ projectId: "episode-12", step: "storyboard" });
    });

    it("accepts project ids that need URL encoding", () => {
        const hash = projectRouteHash("owner/episode 1", "assets");

        expect(parseProjectRouteHash(hash)).toEqual({ projectId: "owner/episode 1", step: "assets" });
    });

    it("ignores unsupported steps and old second-fragment routes", () => {
        expect(parseProjectRouteHash("#/project/episode-12?step=unknown"))
            .toEqual({ projectId: "episode-12", step: null });
        expect(parseProjectRouteHash("#/project/episode-12#storyboard")).toBeNull();
        expect(parseProjectRouteHash("#/project/episode%ZZ")).toBeNull();
    });
});
