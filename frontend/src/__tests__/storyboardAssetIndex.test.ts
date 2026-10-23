import { expect, it } from "vitest";
import type { AssetReferenceIndexEntry } from "@/lib/api";
import { storyboardAssetIndex } from "@/lib/storyboardAssetIndex";
import { legacyAssetsToReferenceIndex } from "@/lib/assetReferenceIndex";

const entry = (id: string, name: string, scope: "episode" | "series" | "global") => ({
    asset_type: "prop", asset_id: id, name, source_scope: scope, variants: [],
}) as AssetReferenceIndexEntry;

it("excludes unrelated shared assets from storyboard choices", () => {
    const assets = [
        entry("local", "本集长剑", "episode"),
        entry("series-bag", "女士背包", "series"),
        entry("global-bag", "旧旅行包", "global"),
        entry("bound", "本集使用的共享道具", "series"),
    ];
    const result = storyboardAssetIndex(assets, {
        frames: [{ scene_id: "street", prop_ids: ["bound"] }],
    });
    expect(result.map((asset) => asset.asset_id)).toEqual(["local", "bound"]);
});

it("keeps shared assets already used by a frame or confirmed episode binding", () => {
    const assets = [
        entry("referenced", "旧道具", "global"),
        { ...entry("same-name-character", "旧道具", "global"), asset_type: "character" as const },
        entry("person", "共享角色", "series"),
        entry("plan-scene", "共享场景", "global"),
        entry("stale", "过期共享道具", "series"),
    ];
    const result = storyboardAssetIndex(assets, {
        frames: [{ visual_description: "[prop:旧道具]" }],
        episode_person_asset_bindings: { lead: "person" },
        episode_plan_scene_asset_bindings: { scene: "plan-scene" },
        episode_asset_bindings: [{ asset_id: "stale", status: "stale" }],
    });
    expect(result.map((asset) => asset.asset_id)).toEqual(["referenced", "person", "plan-scene"]);
});

it("does not relabel series assets as episode assets while the index loads", () => {
    const fallback = legacyAssetsToReferenceIndex([], [], [
        { id: "local", name: "本集道具", source: "episode" },
        { id: "bag", name: "女士背包", source: "series" },
        { id: "pants", name: "瑜伽裤", source: "series" },
    ]);
    expect(storyboardAssetIndex(fallback, { frames: [] }).map((asset) => asset.name))
        .toEqual(["本集道具"]);
});


it("uses the character cover as the default reference across image categories", () => {
  const [entry] = legacyAssetsToReferenceIndex([{
    id: "actor", name: "Actor", cover_variant_id: "portrait",
    reference_sheet: { selected_image_id: "body", image_variants: [{ id: "body", url: "body.png" }] },
    headshot_asset: { selected_id: "portrait", variants: [{ id: "portrait", url: "portrait.png" }] },
  }], [], []);
  expect(entry.selected_variant_id).toBe("portrait");
  expect(entry.cover_variant_id).toBe("portrait");
  expect(entry.variants.map(variant => variant.id)).toEqual(["body", "portrait"]);
});
