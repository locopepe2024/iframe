import type { DirectorPlanLighting, DirectorShootingPlan } from "./directorShootingPlan";

export type LightingConflict = {
    sceneIndex: number;
    beatIndex: number;
    shotIndex: number;
    sceneId: string;
    beatId: string;
    shotId: string;
    shotTitle: string;
    fields: (keyof DirectorPlanLighting)[];
};

// Keep this comparison aligned with confirmation validation in pipeline.py.
export function planLightingConflicts(plan: DirectorShootingPlan | null): LightingConflict[] {
    if (!plan) return [];
    const baselines = new Map((plan.lighting_baselines ?? []).map(item => [
        `${item.place_continuity_id}\u0000${item.time_continuity_id}`, item.lighting,
    ]));
    return plan.scenes.flatMap((scene, sceneIndex) => {
        if (!scene.place_continuity_id || !scene.time_continuity_id) return [];
        const baseline = baselines.get(`${scene.place_continuity_id}\u0000${scene.time_continuity_id}`);
        if (!baseline) return [];
        return scene.beats.flatMap((beat, beatIndex) => beat.shots.flatMap((shot, shotIndex) => {
            if (shot.lighting_override_reason?.trim()) return [];
            const fields: (keyof DirectorPlanLighting)[] = (["key_source", "color_tone", "contrast"] as const)
                .filter(field => shot.lighting[field].trim() && shot.lighting[field].trim() !== baseline[field].trim());
            if (shot.lighting.practical_sources.length &&
                JSON.stringify(shot.lighting.practical_sources) !== JSON.stringify(baseline.practical_sources)) {
                fields.push("practical_sources");
            }
            return fields.length ? [{
                sceneIndex, beatIndex, shotIndex, sceneId: scene.scene_id, beatId: beat.beat_id,
                shotId: shot.shot_id, shotTitle: shot.title, fields,
            }] : [];
        }));
    });
}
