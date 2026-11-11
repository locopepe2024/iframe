import { describe, expect, it } from "vitest";
import { bindH3MultiReferencePrompt, buildReferenceAssets, resolveReferenceSubmission, refreshReferenceSubmission, selectReferenceAsset } from "./referenceAssets";

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
    it("resolves typed project tags by kind when a character and scene share a name", () => {
        const sameName = [
            { id: "person", name: "长街", kind: "character" as const, variants: [{ id: "face", url: "person.jpg" }] },
            { id: "place", name: "长街", kind: "scene" as const, variants: [{ id: "street", url: "street.jpg" }] },
        ];
        const result = resolveReferenceSubmission("[scene:长街] [character:长街]", sameName);
        expect(result.urls).toEqual(["street.jpg", "person.jpg"]);
        expect(result.groups.map((group) => group.kind)).toEqual(["scene", "character"]);
        const prompt = bindH3MultiReferencePrompt("[scene:长街] [character:长街]", result.groups);
        expect(prompt).toContain("长街 (reference asset 1) 长街 (reference asset 2)");
    });

    it("does not bind a typed scene tag to a same-named character", () => {
        const result = resolveReferenceSubmission("[scene:女主播]", assets);
        expect(result.urls).toEqual([]);
        expect(result.unresolvedNames).toEqual(["女主播"]);
    });

    it("requires disambiguation when two project assets have the same type and name", () => {
        const repeated = [assets[0], { ...assets[0], id: "host-copy", variants: [{ id: "other", url: "wrong.jpg" }] }];
        const result = resolveReferenceSubmission("[character:女主播]", repeated);
        expect(result.urls).toEqual([]);
        expect(result.unresolvedNames).toEqual([]);
        expect(result.ambiguousNames).toEqual(["女主播"]);
    });

    const kentRoles = ["男主", "柳如烟"].flatMap((name, index) => [
        { id: `project-${index}`, name, kind: "character" as const, variants: [{ id: `project-image-${index}`, url: `project-${index}.jpg` }] },
        { id: `library-${index}`, name, kind: "character" as const, variants: [{ id: `library-image-${index}`, url: `library-${index}.jpg` }] },
    ]);

    it("uses each frame's bound identities for duplicate characters with usable images", () => {
        const result = resolveReferenceSubmission("[character1:男主] [character2:柳如烟]", kentRoles, {}, {
            character_ids: ["library-0", "project-1"],
        });
        expect(result.urls).toEqual(["library-0.jpg", "project-1.jpg"]);
        expect(result.assetInputs.map((item) => item.asset_id)).toEqual(["library-0", "project-1"]);
        expect(result.unresolvedNames).toEqual([]);
        expect(result.ambiguousNames).toEqual([]);
    });

    it("lets an explicit same-name selection override the original frame binding", () => {
        const result = resolveReferenceSubmission("[character:男主]", kentRoles,
            { "library-0": ["library-image-0"] }, { character_ids: ["project-0"] });
        expect(result.urls).toEqual(["library-0.jpg"]);
    });

    it("does not choose another duplicate when the selected version has lost its image", () => {
        const result = resolveReferenceSubmission("[character:男主]", kentRoles,
            { "library-0": ["deleted-image"] }, { character_ids: ["project-0"] });
        expect(result.urls).toEqual([]);
        expect(result.invalidVariantIds).toEqual(["deleted-image"]);
        expect(result.unresolvedNames).toEqual(["男主"]);
    });

    it("keeps conflicting frame bindings or explicit selections ambiguous", () => {
        for (const result of [
            resolveReferenceSubmission("[character:男主]", kentRoles, {}, { character_ids: ["project-0", "library-0"] }),
            resolveReferenceSubmission("[character:男主]", kentRoles,
                { "project-0": ["project-image-0"], "library-0": ["library-image-0"] }, { character_ids: ["project-0"] }),
        ]) {
            expect(result.urls).toEqual([]);
            expect(result.ambiguousNames).toEqual(["男主"]);
        }
    });

    it("does not substitute a same-name image for a removed frame-bound character", () => {
        const remaining = kentRoles.filter((asset) => asset.id !== "library-0");
        const result = resolveReferenceSubmission("[character:男主]", remaining, {}, { character_ids: ["library-0"] });
        expect(result.urls).toEqual([]);
        expect(result.unresolvedNames).toEqual(["男主"]);
        const replacement = resolveReferenceSubmission("[character:男主]", remaining,
            { "project-0": ["project-image-0"] }, { character_ids: ["library-0"] });
        expect(replacement.urls).toEqual(["project-0.jpg"]);
    });

    it("preserves the selected product views when re-inserting the same reference", () => {
        expect(selectReferenceAsset(assets, { product: ["product-right", "product-detail"] }, "product"))
            .toEqual({ product: ["product-right", "product-detail"] });
    });

    it("does not guess across kinds for an unbound legacy slot", () => {
        const repeated = [kentRoles[0], { ...kentRoles[0], id: "scene", kind: "scene" as const }];
        expect(resolveReferenceSubmission("[character1:男主]", repeated).ambiguousNames).toEqual(["男主"]);
        expect(resolveReferenceSubmission("[character:男主]", repeated).urls).toEqual(["project-0.jpg"]);
    });

    it("persists a specific duplicate choice while retaining unrelated asset selections", () => {
        const selected = selectReferenceAsset(kentRoles, {
            "project-0": ["project-image-0"], "library-1": ["library-image-1"],
        }, "library-0");
        expect(selected).toEqual({ "library-0": ["library-image-0"], "library-1": ["library-image-1"] });
        expect(resolveReferenceSubmission("[character:男主] [character:柳如烟]", kentRoles, selected).urls)
            .toEqual(["library-0.jpg", "library-1.jpg"]);
    });

    it("passes frame bindings through the authoritative preflight refresh", async () => {
        const index = kentRoles.map((asset) => ({ asset_id: asset.id, asset_type: asset.kind,
            name: asset.name, variants: asset.variants, source_scope: "episode" as const }));
        const fresh = await refreshReferenceSubmission("kent-project", "[character:男主]", {},
            async () => ({ assets: index }), { character_ids: ["library-0"] });
        expect(fresh.submission.assetInputs[0].asset_id).toBe("library-0");
        const removed = await refreshReferenceSubmission("kent-project", "[character:男主]", {},
            async () => ({ assets: [] }), { character_ids: ["library-0"] });
        expect(removed.submission.urls).toEqual([]);
        expect(removed.submission.unresolvedNames).toEqual(["男主"]);
    });

    it("uses one primary image for assets without an explicit shot selection", () => {
        const result = resolveReferenceSubmission(
            "[character:女主播] holds [prop:穿心莲]",
            assets,
        );
        expect(result.urls).toEqual(["host.jpg", "front.jpg"]);
        expect(result.assetInputs.map((item) => [item.asset_type, item.asset_id, item.variant_id])).toEqual([
            ["character", "host", "host-front"], ["prop", "product", "product-front"],
        ]);
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

    it("uses only the selected image for a character despite historical variants", () => {
        const characterWithHistory = {
            ...assets[0],
            selectedId: "host-front",
            variants: [
                { id: "host-front", url: "host-front.jpg" },
                { id: "host-old-1", url: "host-old-1.jpg" },
                { id: "host-old-2", url: "host-old-2.jpg" },
                { id: "host-old-3", url: "host-old-3.jpg" },
                { id: "host-old-4", url: "host-old-4.jpg" },
            ],
        };

        const result = resolveReferenceSubmission(
            "[character:女主播]",
            [characterWithHistory],
            { host: ["host-old-1", "host-old-2"] },
        );

        expect(result.urls).toEqual(["host-front.jpg"]);
        expect(result.groups[0].variants.map((variant) => variant.id)).toEqual(["host-front"]);
    });

    it("uses an explicitly reviewed single character look instead of the asset default", () => {
        const character = {
            ...assets[0],
            variants: [
                { id: "host-front", url: "host-front.jpg" },
                { id: "host-injured", url: "host-injured.jpg" },
            ],
        };
        const result = resolveReferenceSubmission(
            "[character:女主播]", [character], { host: ["host-injured"] },
        );
        expect(result.urls).toEqual(["host-injured.jpg"]);
        expect(result.groups[0].variants.map((variant) => variant.id)).toEqual(["host-injured"]);
    });

    it("binds all selected product pictures without mixing Subject and Picture syntax", () => {
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
        expect(prompt).toContain("Reference asset 1 is 穿心莲");
        expect(prompt).toContain("<Picture 1> (front), <Picture 2> (right), <Picture 3> (macro)");
        expect(prompt).toContain("Reference asset 2 is 女主播, the same physical character shown in <Picture 4>");
        expect(prompt).toContain("穿心莲 (reference asset 1) beside 女主播 (reference asset 2) <Picture 4>");
        expect(prompt).not.toMatch(/<Subject\s+\d+>/);
    });
});

const uploaded = {
    asset_type: "character" as const, asset_id: "imported-upload", name: "样片-血狼-天台",
    source_scope: "episode" as const, selected_variant_id: "latest",
    variants: [{ id: "old", url: "old.jpg" }, { id: "latest", url: "uploaded.jpg" }],
};
it("uses an imported project upload from the normalized index", () => {
    const references = buildReferenceAssets([uploaded], [], [], []);
    const result = resolveReferenceSubmission("[character:样片-血狼-天台] [character:样片-血狼-天台]", references);
    expect(result.urls).toEqual(["uploaded.jpg"]);
    expect(result.unresolvedNames).toEqual([]);
});
it("treats an empty live index as authoritative and preserves absent-index legacy reads", () => {
    const scene = { id: "room", name: "Room", image_asset: { variants: [{ id: "v", url: "room.jpg" }] } };
    expect(buildReferenceAssets([], [], [scene], [])).toEqual([]);
    expect(resolveReferenceSubmission("[scene:Room]", buildReferenceAssets(undefined, [], [scene], [])).urls).toEqual(["room.jpg"]);
});
it("reports missing references once even when some other references resolve", () => {
    const result = resolveReferenceSubmission("[character:女主播] [scene:Missing] [scene:Missing]", assets);
    expect(result.urls).toEqual(["host.jpg"]);
    expect(result.unresolvedNames).toEqual(["Missing"]);
});
it("refreshes the selected upload before submission and never uses a deleted cached entry", async () => {
    const fetchIndex = async (projectId: string) => {
        expect(projectId).toBe("project-a");
        return { assets: [uploaded] };
    };
    const fresh = await refreshReferenceSubmission("project-a", "[character:样片-血狼-天台]", {}, fetchIndex);
    expect(fresh.submission.urls).toEqual(["uploaded.jpg"]);
    const deleted = await refreshReferenceSubmission("project-a", "[character:样片-血狼-天台]", {}, async () => ({ assets: [] }));
    expect(deleted.submission.urls).toEqual([]);
    expect(deleted.submission.unresolvedNames).toEqual(["样片-血狼-天台"]);
});
it("fails a reference refresh without returning stale references", async () => {
    await expect(refreshReferenceSubmission("project-a", "[character:样片-血狼-天台]", {}, async () => { throw new Error("index offline"); }))
        .rejects.toThrow("index offline");
});

it("does not use an unimported global upload even when its name matches a tag", () => {
    const references = buildReferenceAssets([{ ...uploaded, source_scope: "global" }], [], [], []);
    const result = resolveReferenceSubmission("[character:样片-血狼-天台]", references);
    expect(result.urls).toEqual([]);
    expect(result.unresolvedNames).toEqual(["样片-血狼-天台"]);
});
it("does not let a same-name global candidate override a project asset", () => {
    const references = buildReferenceAssets([
        uploaded,
        { ...uploaded, asset_id: "unimported", source_scope: "global", variants: [{ id: "latest", url: "wrong.jpg" }] },
    ], [], [], []);
    expect(resolveReferenceSubmission("[character:样片-血狼-天台]", references).urls).toEqual(["uploaded.jpg"]);
});
