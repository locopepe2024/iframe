import { describe, expect, it } from "vitest";
import type { EpisodeCharacterUse } from "@/lib/api";
import { reviewedEpisodeLookImage } from "./episodeLookImage";

const use: EpisodeCharacterUse = {
    use_id: "injured", project_character_id: "hero", label: "受伤造型", condition: "肩伤",
    source_pack_id: "pack", source_pack_revision: 1, source_design_revision: 1,
    source_anchor_variant_id: "normal", selected_asset_id: "hero-injured",
    selected_asset_revision: 2, selected_variant_id: "injured-v",
    selected_source_scope: "episode", selected_source_container_id: "episode",
    status: "confirmed", confirmed_at: 1,
};

describe("storyboard reviewed episode look image", () => {
    it("uses the exact selected variant even when another image is selected on the asset", () => {
        expect(reviewedEpisodeLookImage("hero-injured", { hero: "injured" }, [use], [{
            id: "hero-injured", reference_sheet: { image_variants: [
                { id: "old", url: "old.webp" }, { id: "injured-v", url: "new.webp" },
            ] },
        }])).toEqual({ url: "new.webp", label: "受伤造型 · hero-injured/injured-v" });
    });

    it("stops when the confirmed image or frame binding is stale", () => {
        expect(() => reviewedEpisodeLookImage("hero-injured", { hero: "injured" }, [use], []))
            .toThrow("参考图不可用");
        expect(() => reviewedEpisodeLookImage("hero", { hero: "injured" }, [use], []))
            .toThrow("角色资产不一致");
    });
});
