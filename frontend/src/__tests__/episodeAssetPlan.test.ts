import { describe, expect, it } from "vitest";
import { getAssetPlanEntries } from "../lib/episodeAssetPlan";
import type { EpisodeVisualContext } from "../lib/directorShootingPlan";

describe("episode asset plan context", () => {
    it("keeps indoor and outdoor looks separate for the same character asset", () => {
        const context = {
            scenes: [
                { scene_id: "outside", scene_asset_id: "cinema", scene_ref: "电影院外", location: "西安", time_anchor: "冬季白天", interior_exterior: "exterior", season: "冬季", weather: "阴天", atmosphere: "", prop_ids: [] },
                { scene_id: "inside", scene_asset_id: "cinema", scene_ref: "电影院内", location: "西安", time_anchor: "冬季白天", interior_exterior: "interior", season: "冬季", weather: "", atmosphere: "暖光", prop_ids: [] },
            ],
            characters: [
                { person_id: "shen", character_asset_ids: ["shen-campus"], scene_look_id: "coat", continuity_state: { coat: "white jacket" }, scene_ids: ["outside"], shot_ids: ["shot-1"] },
                { person_id: "shen", character_asset_ids: ["shen-campus"], scene_look_id: "knitwear", continuity_state: { coat: "removed" }, scene_ids: ["inside"], shot_ids: ["shot-2"] },
            ],
            props: [], shots: [],
        } as unknown as EpisodeVisualContext;
        const entries = getAssetPlanEntries(context, "character", "shen-campus");
        expect(entries).toHaveLength(2);
        expect(entries[0].prompt).toContain("white jacket");
        expect(entries[0].prompt).toContain("室外");
        expect(entries[1].prompt).toContain("removed");
        expect(entries[1].prompt).toContain("室内");
        expect(getAssetPlanEntries(context, "character", "other")).toEqual([]);
    });

    it("resolves a location asset ID to a readable name before building the prompt", () => {
        const context = {
            scenes: [{ scene_id: "shot-scene", scene_asset_id: "asset-1", scene_ref: "29、街上 日 外", location: "4b54432f-6f02-42cb-b3cd-95884a4aff96", time_anchor: "2020年秋天", atmosphere: "", prop_ids: [] }],
            characters: [], props: [], shots: [],
        } as unknown as EpisodeVisualContext;
        const entries = getAssetPlanEntries(context, "scene", "asset-1", { "4b54432f-6f02-42cb-b3cd-95884a4aff96": "北京街道" });
        expect(entries[0].sceneId).toBe("shot-scene");
        expect(entries[0].prompt).toContain("北京街道");
        expect(entries[0].prompt).not.toContain("4b54432f");
    });
});
