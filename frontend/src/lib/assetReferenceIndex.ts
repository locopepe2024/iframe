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
    const variants = container?.image_variants ?? container?.variants ?? [];
    const selected = container?.selected_image_id ?? container?.selected_id ?? variants[0]?.id ?? null;
    return {
      asset_type: assetType,
      asset_id: item.id,
      name: item.name,
      description: item.description,
      starred: item.starred,
      source_scope: "episode",
      selected_variant_id: selected,
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
  return index ?? legacyAssetsToReferenceIndex(characters, scenes, props);
}
