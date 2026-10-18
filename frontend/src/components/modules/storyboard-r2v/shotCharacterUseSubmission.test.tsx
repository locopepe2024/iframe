import { describe, expect, it } from "vitest";
import type { EpisodeCharacterUse } from "@/lib/api";
import type { ResolvedReferenceGroup } from "./referenceAssets";
import { characterUseReferenceError } from "./shotCharacterUseSubmission";

const base = {
    use_id: "injured", project_character_id: "hero", label: "受伤造型", condition: "肩部受伤",
    source_pack_id: "pack-hero", source_pack_revision: 1, source_design_revision: 1,
    source_anchor_variant_id: "normal", selected_asset_id: "hero-injured",
    selected_asset_revision: 1, selected_variant_id: "injured",
    selected_source_scope: "episode", selected_source_container_id: "episode",
    status: "confirmed", confirmed_at: 1,
} satisfies EpisodeCharacterUse;
const group = (assetId: string, variantId: string): ResolvedReferenceGroup => ({
    slot: 1, assetId, name: assetId, kind: "character",
    variants: [{ id: variantId, url: `${variantId}.webp` }], pictureNumbers: [1],
});

describe("reviewed shot look submission", () => {
    it("accepts only the chosen image for this character", () => {
        expect(characterUseReferenceError({ hero: "injured" }, [base], [group("hero-injured", "injured")])).toBeNull();
        expect(characterUseReferenceError({ hero: "injured" }, [base], [group("hero", "normal")])).toContain("只引用");
        expect(characterUseReferenceError({ hero: "injured" }, [base], [
            group("hero-injured", "injured"), group("hero", "normal"),
        ])).toContain("只引用");
    });

    it("rejects a removed use instead of sending stale references", () => {
        expect(characterUseReferenceError({ hero: "missing" }, [base], [])).toContain("失效");
    });
});
