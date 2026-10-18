import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EpisodeCharacterUse } from "@/lib/api";
import ShotCharacterUsePicker, { relevantCharacterUses } from "./ShotCharacterUsePicker";

const normal: EpisodeCharacterUse = {
    use_id: "normal", project_character_id: "hero", label: "正常造型", condition: "",
    source_pack_id: "pack-hero", source_pack_revision: 1, source_design_revision: 1,
    source_anchor_variant_id: "normal-image", selected_asset_id: "hero",
    selected_asset_revision: 2, selected_variant_id: "normal-image",
    selected_source_scope: "series", selected_source_container_id: "series",
    status: "confirmed", confirmed_at: 1,
};
const injured: EpisodeCharacterUse = {
    ...normal, use_id: "injured", label: "受伤造型", condition: "肩部受伤",
    selected_asset_id: "hero-injured", selected_variant_id: "injured-image",
    selected_source_scope: "episode", selected_source_container_id: "episode",
};

describe("shot character use picker", () => {
    it("shows both reviewed looks for the character present in this shot", () => {
        const frame = { id: "frame", character_ids: ["hero"], character_use_ids: {} };
        expect(relevantCharacterUses(frame, [normal, injured])).toHaveLength(2);
        const onSelect = vi.fn();
        render(<ShotCharacterUsePicker frame={frame} uses={[normal, injured]}
            busy={false} onSelect={onSelect} onInsertReference={vi.fn()} />);
        fireEvent.change(screen.getByRole("combobox", { name: "hero 镜头造型" }), { target: { value: "injured" } });
        expect(onSelect).toHaveBeenCalledWith(injured);
    });

    it("does not infer a look for an unrelated shot", () => {
        expect(relevantCharacterUses({ id: "other", character_ids: ["other"] }, [normal, injured])).toEqual([]);
    });
});
