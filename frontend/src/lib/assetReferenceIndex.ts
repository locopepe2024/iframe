import type { AssetReferenceIndexEntry } from "@/lib/api";

export function legacyAssetsToReferenceIndex(
  characters: any[],
  scenes: any[],
  props: any[],
): AssetReferenceIndexEntry[] {
  const convert = (item: any, assetType: "character" | "scene" | "prop"): AssetReferenceIndexEntry => {
    const container = assetType === "character"
      ? (item.reference_sheet?.image_variants?.length ? item.reference_sheet : item.full_body_asset)
      : item.image_asset;
    const pools = assetType === "character"
      ? [item.reference_sheet?.image_variants, item.full_body_asset?.variants, item.three_view_asset?.variants, item.headshot_asset?.variants]
      : [container?.variants];
    const variants = pools.flatMap(pool => pool || []).filter((variant, index, all) =>
      all.findIndex(candidate => candidate.id === variant.id) === index);
    const cover = item.cover_variant_id && variants.some(variant => variant.id === item.cover_variant_id)
      ? item.cover_variant_id : null;
    const selected = (assetType === "character" ? cover : null)
      ?? container?.selected_image_id ?? container?.selected_id ?? variants[0]?.id ?? null;
    return {
      asset_type: assetType,
      asset_id: item.id,
      name: item.name,
      description: item.description,
      starred: item.starred,
      source_scope: item.source === "series" || item.source === "global" ? item.source : "episode",
      selected_variant_id: selected,
      cover_variant_id: cover,
      variants,
    };
  };
  return [
    ...characters.map((item) => convert(item, "character")),
    ...scenes.map((item) => convert(item, "scene")),
    ...props.map((item) => convert(item, "prop")),
  ];
}

export function effectiveReferenceIndex(
  index: AssetReferenceIndexEntry[] | undefined,
  characters: any[],
  scenes: any[],
  props: any[],
): AssetReferenceIndexEntry[] {
  // Crowd entries are legacy roster metadata. Once a fixed crowd entry has a
  // linked visual character, expose that character in the same reference
  // namespace as every other role; unresolved templates remain metadata only.
  return (index ?? legacyAssetsToReferenceIndex(characters, scenes, props))
    .flatMap((entry) => {
      if (entry.asset_type !== "crowd") return [entry];
      if (!entry.linked_visual_asset_id) return [];
      return [{ ...entry, asset_type: "character" as const, asset_id: entry.linked_visual_asset_id }];
    });
}

/** Shot pickers consume membership, never the entire reusable candidate pool. */
export function projectReferenceIndex(
  index: AssetReferenceIndexEntry[] | undefined,
  characters: any[], scenes: any[], props: any[],
): AssetReferenceIndexEntry[] {
  const localOnly = (items: any[]) => items.filter((item) => item.source !== "global");
  return effectiveReferenceIndex(index, localOnly(characters), localOnly(scenes), localOnly(props))
    .filter((entry) => entry.source_scope !== "global");
}
