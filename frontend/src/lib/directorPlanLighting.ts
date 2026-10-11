import type { DirectorShootingPlan } from "./directorShootingPlan";

function lightingOverridesByShot(plan: DirectorShootingPlan | null): Map<string, string> {
    const overrides = new Map<string, string>();
    if (!plan) return overrides;
    for (const scene of plan.scenes) {
        for (const beat of scene.beats) {
            for (const shot of beat.shots) {
                const reason = shot.lighting_override_reason?.trim() ?? "";
                if (!shot.lighting_override_selected || !reason) continue;
                overrides.set(shot.shot_id, JSON.stringify({ reason, lighting: shot.lighting }));
            }
        }
    }
    return overrides;
}

/** Count new or changed authored overrides, ignoring removed overrides. */
export function changedLightingOverrideCount(
    savedPlan: DirectorShootingPlan | null,
    currentPlan: DirectorShootingPlan | null,
): number {
    const saved = lightingOverridesByShot(savedPlan);
    const current = lightingOverridesByShot(currentPlan);
    return Array.from(current.entries()).filter(([shotId, fingerprint]) => saved.get(shotId) !== fingerprint).length;
}
