import { describe, expect, it } from "vitest";
import { getAssetPlanEntries, getUnboundCharacterRequirements } from "../lib/episodeAssetPlan";
import type { EpisodeVisualContext } from "../lib/directorShootingPlan";

describe("episode asset plan context", () => {
    it("does not match a plan scene ID as a Scene asset ID", () => {
        const context = {
            scenes: [{ scene_id: "cinema", scene_asset_id: null, scene_ref: "电影院",
                location: "西安", time_anchor: "白天", atmosphere: "", prop_ids: [] }],
            characters: [], props: [], shots: [],
        } as unknown as EpisodeVisualContext;
        expect(getAssetPlanEntries(context, "scene", "cinema")).toEqual([]);
    });

    it("shows a Scene asset bound only to a later shot", () => {
        const context = {
            scenes: [{ scene_id: "plan-scene", scene_asset_id: null, scene_ref: "室内切换",
                location: "西安", time_anchor: "白天", atmosphere: "", prop_ids: [] }],
            characters: [], props: [],
            shots: [{ scene_id: "plan-scene", shot_id: "first", scene_asset_id: "cinema" },
                { scene_id: "plan-scene", shot_id: "second", scene_asset_id: "room" }],
        } as unknown as EpisodeVisualContext;
        expect(getAssetPlanEntries(context, "scene", "room")).toHaveLength(1);
        expect(getAssetPlanEntries(context, "scene", "plan-scene")).toEqual([]);
    });

    it("keeps internal plan IDs out of asset detail text", () => {
        const context = {
            scenes: [{ scene_id: "old-scene-id", scene_asset_id: "current-scene",
                scene_ref: "", location: "", time_anchor: "", atmosphere: "", prop_ids: [] }],
            characters: [{ person_id: "old-person-id", character_asset_ids: ["current-character"],
                era_variant_id: "old-era-id", scene_look_id: "old-look-id",
                continuity_state: {}, scene_ids: ["old-scene-id"], shot_ids: [] }],
            props: [], shots: [],
        } as unknown as EpisodeVisualContext;
        const scene = getAssetPlanEntries(context, "scene", "current-scene")[0];
        const character = getAssetPlanEntries(context, "character", "current-character")[0];
        expect(scene.sceneLabel).toBe("场景 1");
        expect(character.prompt).not.toContain("old-");
    });

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

    it("projects scene content and only the exactly matched lighting baseline separately", () => {
        const context = {
            scenes: [{ scene_id: "shop", scene_asset_id: "grain-shop", scene_ref: "粮铺劫掠",
                location: "青溪镇长街", time_anchor: "暮秋黄昏", atmosphere: "百姓退避",
                continuity_in: "匪寇围堵粮铺", continuity_out: "掌柜倒地",
                place_continuity_id: "street", time_continuity_id: "dusk", prop_ids: [] }],
            lighting_baselines: [
                { place_continuity_id: "street", time_continuity_id: "dusk", lighting: {
                    key_source: "街口斜阳", color_tone: "暖褐", contrast: "中高反差", practical_sources: [],
                }, shadow_direction: "向东", story_time: "黄昏", daylight_phase: "", weather: "" },
                { place_continuity_id: "street", time_continuity_id: "night", lighting: {
                    key_source: "灯笼", color_tone: "深蓝", contrast: "低反差", practical_sources: [],
                }, shadow_direction: "", story_time: "夜间", daylight_phase: "", weather: "" },
            ],
            characters: [], props: [], shots: [],
        } as unknown as EpisodeVisualContext;
        const entry = getAssetPlanEntries(context, "scene", "grain-shop")[0];
        expect(entry.visualDetails).toContainEqual({ label: "入场画面", text: "匪寇围堵粮铺" });
        expect(entry.visualDetails).toContainEqual({ label: "后续画面", text: "掌柜倒地" });
        expect(entry.continuityDetails).toContainEqual({ label: "色调", text: "暖褐" });
        expect(entry.continuityDetails).not.toContainEqual({ label: "色调", text: "深蓝" });
        expect(entry.continuityDetails).not.toContainEqual({ label: "入场画面", text: "匪寇围堵粮铺" });
    });
});

describe("unbound shooting plan characters", () => {
    it("shows unique people even when no character asset can be linked", () => {
        const context = { characters: [
            { person_id: "person-a", character_asset_ids: [], scene_ids: ["scene-1"], shot_ids: ["shot-1"] },
            { person_id: "person-a", character_asset_ids: [], scene_ids: ["scene-1", "scene-2"], shot_ids: ["shot-2"] },
            { person_id: "person-b", character_asset_ids: ["asset-b"], scene_ids: ["scene-1"], shot_ids: ["shot-3"] },
        ] } as unknown as EpisodeVisualContext;
        expect(getUnboundCharacterRequirements(context)).toEqual([{
            personId: "person-a", sceneIds: ["scene-1", "scene-2"], shotIds: ["shot-1", "shot-2"], lookCount: 2,
        }]);
    });
});
