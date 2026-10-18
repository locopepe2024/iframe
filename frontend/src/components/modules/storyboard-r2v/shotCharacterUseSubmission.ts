import type { EpisodeCharacterUse } from "@/lib/api";
import type { ResolvedReferenceGroup } from "./referenceAssets";

export function characterUseReferenceError(
    selectedUseIds: Record<string, string>,
    uses: EpisodeCharacterUse[],
    groups: ResolvedReferenceGroup[],
): string | null {
    for (const [projectCharacterId, useId] of Object.entries(selectedUseIds)) {
        const use = uses.find((item) => item.use_id === useId
            && item.project_character_id === projectCharacterId);
        if (!use) return "本镜头角色造型已失效，请重新选择。";
        const familyIds = new Set([
            projectCharacterId,
            ...uses.filter((item) => item.project_character_id === projectCharacterId)
                .map((item) => item.selected_asset_id),
        ]);
        const selectedGroup = groups.find((group) => group.assetId === use.selected_asset_id
            && group.variants.length === 1
            && group.variants[0].id === use.selected_variant_id);
        const conflictingGroup = groups.some((group) => group.kind === "character"
            && familyIds.has(group.assetId) && group.assetId !== use.selected_asset_id);
        if (!selectedGroup || conflictingGroup) {
            return `本镜头已选择“${use.label}”，请在提示词中只引用 ${use.selected_asset_id}/${use.selected_variant_id} 并核对参考图。`;
        }
    }
    return null;
}
