import type { AssetReferenceIndexEntry } from "@/lib/api";

type EpisodeAssetReferences = {
    frames?: Array<{
        scene_id?: string | null;
        character_ids?: string[];
        prop_ids?: string[];
        image_prompt?: string | null;
        visual_description?: string | null;
        action_description?: string | null;
        workbench_reference_variant_ids?: Record<string, string[]>;
        reference_package?: { asset_revision_pins?: Array<{ asset_id: string }> };
    }>;
    episode_person_asset_bindings?: Record<string, string>;
    episode_plan_scene_asset_bindings?: Record<string, string>;
    episode_asset_bindings?: Array<{ asset_id?: string; status?: string }>;
};

/** The general asset index is a library browser. Storyboard choices are episode-scoped. */
export function storyboardAssetIndex(
    index: AssetReferenceIndexEntry[],
    episode: EpisodeAssetReferences,
): AssetReferenceIndexEntry[] {
    const referencedIds = new Set<string>();
    const referencedNames = new Set<string>();
    for (const frame of episode.frames ?? []) {
        if (frame.scene_id) referencedIds.add(frame.scene_id);
        for (const id of [...(frame.character_ids ?? []), ...(frame.prop_ids ?? [])]) referencedIds.add(id);
        for (const pin of frame.reference_package?.asset_revision_pins ?? []) referencedIds.add(pin.asset_id);
        for (const id of Object.keys(frame.workbench_reference_variant_ids ?? {})) referencedIds.add(id);
        const prompt = [frame.image_prompt, frame.visual_description, frame.action_description].filter(Boolean).join("\n");
        const matches = Array.from(prompt.matchAll(/\[(?:character\d*|scene|prop):([^\]]+)\]/g));
        for (const match of matches) {
            const type = match[0].startsWith("[character") ? "character" : match[0].startsWith("[scene") ? "scene" : "prop";
            referencedNames.add(`${type}:${match[1]}`);
        }
    }
    for (const id of Object.values(episode.episode_person_asset_bindings ?? {})) referencedIds.add(id);
    for (const id of Object.values(episode.episode_plan_scene_asset_bindings ?? {})) referencedIds.add(id);
    for (const binding of episode.episode_asset_bindings ?? []) {
        if (binding.asset_id && binding.status !== "stale") referencedIds.add(binding.asset_id);
    }
    return index.filter((asset) => asset.source_scope === "episode"
        || referencedIds.has(asset.asset_id)
        || referencedNames.has(`${asset.asset_type}:${asset.name}`));
}
