import type { EpisodeVisualContext } from "./directorShootingPlan";

export interface AssetPlanEntry {
    key: string;
    sceneLabel: string;
    details: string[];
    prompt: string;
    visualDetails?: Array<{ label: string; text: string }>;
    continuityDetails?: Array<{ label: string; text: string }>;
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

export function getAssetPlanEntries(
    context: EpisodeVisualContext | null,
    assetType: "character" | "scene" | "prop",
    assetId: string,
): AssetPlanEntry[] {
    if (!context) return [];
    const entries: AssetPlanEntry[] = [];
    for (let sceneIndex = 0; sceneIndex < context.scenes.length; sceneIndex++) {
        const scene = context.scenes[sceneIndex];
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
                if (scene.continuity_in) details.push(`入场状态：${scene.continuity_in}`);
                if (scene.continuity_out) details.push(`出场状态：${scene.continuity_out}`);
            } else if (assetType === "character" && "continuity_state" in match) {
                for (const [key, value] of Object.entries(match.continuity_state)) {
                    if (value !== null && value !== "") details.push(`${key}：${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
                }
            } else if (assetType === "prop" && "state" in match) {
                details.push(`道具状态：${match.state}`);
            }
            const sceneLabel = scene.scene_ref || scene.location || `场景 ${sceneIndex + 1}`;
            const visualDetails = assetType === "scene" ? [
                { label: "剧情时段", text: scene.time_anchor },
                { label: "环境与画面", text: scene.atmosphere },
                { label: "入场画面", text: scene.continuity_in || "" },
                { label: "后续画面", text: scene.continuity_out || "" },
            ].filter(item => item.text?.trim()) : [];
            const baseline = assetType === "scene" && scene.place_continuity_id && scene.time_continuity_id
                ? context.lighting_baselines?.find(item =>
                    item.place_continuity_id === scene.place_continuity_id
                    && item.time_continuity_id === scene.time_continuity_id)
                : undefined;
            const continuityDetails = baseline ? [
                { label: "剧情时间基线", text: baseline.story_time },
                { label: "日光阶段", text: baseline.daylight_phase },
                { label: "天气", text: baseline.weather },
                { label: "光源方向", text: baseline.lighting.key_source },
                { label: "色调", text: baseline.lighting.color_tone },
                { label: "明暗反差", text: baseline.lighting.contrast },
                { label: "影子方向", text: baseline.shadow_direction },
                { label: "实景光源", text: baseline.lighting.practical_sources.join("、") },
            ].filter(item => item.text?.trim()) : [];
            if (assetType === "scene") {
                for (const character of context.characters.filter(item => item.scene_ids.includes(scene.scene_id))) {
                    const state = Object.entries(character.continuity_state || {})
                        .filter(([, value]) => value !== null && value !== undefined && value !== "")
                        .map(([key, value]) => `${key}：${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
                    if (state.length) continuityDetails.push({
                        label: character.person_label ? `${character.person_label}的人物状态` : "人物状态",
                        text: state.join("；"),
                    });
                }
            }
            entries.push({
                key: `${scene.scene_id}:${assetType}:${index}`,
                sceneLabel,
                details,
                prompt: `拍摄计划场景「${sceneLabel}」：${details.join("；")}`,
                visualDetails,
                continuityDetails,
            });
        });
    }
    return entries;
}
