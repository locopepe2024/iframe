import { describe, expect, it } from "vitest";
import { bindH3MultiReferencePrompt, resolveReferenceSubmission } from "./referenceAssets";

const assets = [
    {
        id: "host",
        name: "女主播",
        kind: "character" as const,
        selectedId: "host-front",
        variants: [{ id: "host-front", url: "host.jpg" }],
    },
    {
        id: "product",
        name: "穿心莲",
        kind: "prop" as const,
        selectedId: "product-front",
        variants: [
            { id: "product-front", url: "front.jpg", reference_view_role: "front" },
            { id: "product-right", url: "right.jpg", reference_view_role: "right" },
            { id: "product-detail", url: "detail.jpg", reference_distance: "macro" },
        ],
    },
];

describe("storyboard multi-reference assets", () => {
    it("uses one primary image for assets without an explicit shot selection", () => {
        const result = resolveReferenceSubmission(
            "[character:女主播] holds [prop:穿心莲]",
            assets,
        );
        expect(result.urls).toEqual(["host.jpg", "front.jpg"]);
    });

    it("combines explicit slots and semantic asset tags without collisions", () => {
        const result = resolveReferenceSubmission(
            "[character2:女主播] holds [prop:穿心莲] and [prop:穿心莲]",
            assets,
        );
        expect(result.groups.map((group) => [group.slot, group.name])).toEqual([
            [1, "穿心莲"],
            [2, "女主播"],
        ]);
        expect(result.urls).toEqual(["front.jpg", "host.jpg"]);
    });

    it("expands only the explicitly selected product views in stable order", () => {
        const result = resolveReferenceSubmission(
            "[character1:女主播] holds [character2:穿心莲]",
            assets,
            { product: ["product-front", "product-right", "product-detail"] },
        );
        expect(result.urls).toEqual(["host.jpg", "front.jpg", "right.jpg", "detail.jpg"]);
        expect(result.groups[1].pictureNumbers).toEqual([2, 3, 4]);
    });

    it("binds all selected product pictures to one H3 subject and shifts later slots", () => {
        const result = resolveReferenceSubmission(
            "subject_definitions:\nold\n[character1:穿心莲] beside [character2:女主播] <Picture 2>",
            assets,
            { product: ["product-front", "product-right", "product-detail"] },
        );
        // Prompt slot order is product then host, even though asset storage order differs.
        expect(result.urls).toEqual(["front.jpg", "right.jpg", "detail.jpg", "host.jpg"]);
        const prompt = bindH3MultiReferencePrompt(
            "subject_definitions:\nold\n[character1:穿心莲] beside [character2:女主播] <Picture 2>",
            result.groups,
        );
        expect(prompt).toContain("<Subject 1> is 穿心莲");
        expect(prompt).toContain("<Picture 1> (front), <Picture 2> (right), <Picture 3> (macro)");
        expect(prompt).toContain("<Subject 2> is 女主播, the same physical character shown in <Picture 4>");
        expect(prompt).toContain("<Subject 1> 穿心莲 beside <Subject 2> 女主播 <Picture 4>");
    });
});
