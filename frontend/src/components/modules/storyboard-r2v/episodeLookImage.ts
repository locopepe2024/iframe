import type { EpisodeCharacterUse } from "@/lib/api";

type ImageVariant = { id: string; url?: string; storage_key?: string };
type CharacterImage = {
    id: string;
    reference_sheet?: { image_variants?: ImageVariant[] };
    full_body_asset?: { variants?: ImageVariant[] };
    three_view_asset?: { variants?: ImageVariant[] };
    headshot_asset?: { variants?: ImageVariant[] };
};

export function reviewedEpisodeLookImage(
    characterId: string,
    useIds: Record<string, string> | undefined,
    uses: EpisodeCharacterUse[],
    characters: CharacterImage[],
): { url: string; label: string } | null {
    const active = Object.entries(useIds || {}).find(([projectId, useId]) =>
        projectId === characterId || uses.some((item) => item.use_id === useId
            && item.project_character_id === projectId && item.selected_asset_id === characterId));
    if (!active) return null;
    const use = uses.find((item) => item.project_character_id === active[0]
        && item.use_id === active[1] && item.selected_asset_id === characterId);
    if (!use) throw new Error("本镜头角色造型与角色资产不一致，请重新选择造型。");
    const character = characters.find((item) => item.id === use.selected_asset_id);
    const variant = [
        character?.reference_sheet?.image_variants,
        character?.full_body_asset?.variants,
        character?.three_view_asset?.variants,
        character?.headshot_asset?.variants,
    ].flat().find((item) => item?.id === use.selected_variant_id);
    const url = variant?.storage_key || variant?.url;
    if (!url) throw new Error(`本镜头造型“${use.label}”的参考图不可用，请重新选择造型。`);
    return { url, label: `${use.label} · ${use.selected_asset_id}/${use.selected_variant_id}` };
}
