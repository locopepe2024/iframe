import type { EpisodeVisualContext } from "./directorShootingPlan";

export interface AssetPlanEntry {
    key: string;
    sceneLabel: string;
    details: string[];
    prompt: string;
}

export interface UnboundCharacterRequirement {
    personId: string;
    sceneIds: string[];
    shotIds: string[];
    lookCount: number;
}

export function getUnboundCharacterRequirements(context: EpisodeVisualContext | null): UnboundCharacterRequirement[] {
    const people = new Map<string, UnboundCharacterRequirement>();
    for (const character of context?.characters ?? []) {
        if (character.character_asset_ids.length) continue;
        const item = people.get(character.person_id) ?? {
            personId: character.person_id, sceneIds: [], shotIds: [], lookCount: 0,
        };
        item.sceneIds = Array.from(new Set([...item.sceneIds, ...character.scene_ids]));
        item.shotIds = Array.from(new Set([...item.shotIds, ...character.shot_ids]));
        item.lookCount += 1;
        people.set(character.person_id, item);
    }
    return Array.from(people.values());
}

function isReadableLabel(value: string): boolean {
    return !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

export function getAssetPlanEntries(
    context: EpisodeVisualContext | null,
    assetType: "character" | "scene" | "prop",
    assetId: string,
): AssetPlanEntry[] {
    if (!context) return [];
    const entries: AssetPlanEntry[] = [];
    for (const scene of context.scenes) {
        const matches = assetType === "character"
            ? context.characters.filter(item => item.character_asset_ids.includes(assetId) && item.scene_ids.includes(scene.scene_id))
            : assetType === "prop"
                ? context.props.filter(item => item.prop_id === assetId && item.scene_ids.includes(scene.scene_id))
                : scene.scene_asset_id === assetId || context.shots.some(
                    shot => shot.scene_id === scene.scene_id && shot.scene_asset_id === assetId
                ) ? [scene] : [];
        matches.forEach((match, index) => {
            const details = [
                scene.location,
                scene.time_anchor,
                scene.interior_exterior === "interior" ? "室内" : scene.interior_exterior === "exterior" ? "室外" : scene.interior_exterior === "mixed" ? "室内/室外" : "",
                scene.time_of_day,
                scene.season,
                scene.weather,
            ].filter((value): value is string => Boolean(value));
            if (assetType === "scene") {
                if (scene.atmosphere) details.push(scene.atmosphere);
            } else if (assetType === "character" && "continuity_state" in match) {
                if (match.era_variant_id && isReadableLabel(match.era_variant_id)) details.push(`人物阶段：${match.era_variant_id}`);
                if (match.scene_look_id && isReadableLabel(match.scene_look_id)) details.push(`场景造型：${match.scene_look_id}`);
                for (const [key, value] of Object.entries(match.continuity_state)) {
                    if (value !== null && value !== "") details.push(`${key}：${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
                }
            } else if (assetType === "prop" && "state" in match) {
                details.push(`道具状态：${match.state}`);
            }
            const sceneLabel = scene.scene_ref || scene.location || `场景 ${scene.scene_id}`;
            entries.push({
                key: `${scene.scene_id}:${assetType}:${index}`,
                sceneLabel,
                details,
                prompt: `拍摄计划场景「${sceneLabel}」：${details.join("；")}`,
            });
        });
    }
    return entries;
}
