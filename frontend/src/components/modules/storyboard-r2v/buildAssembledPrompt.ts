import type { ShotNode } from "./ShotCard";

/** Resolve the art-direction layer for one shot.
 *
 * A non-empty style override intentionally replaces the project-level
 * positive style prompt. Lighting remains a separate field so a night,
 * interior, rain, or wedding-lighting shot can change illumination without
 * having to copy the whole project style. Empty values inherit the global
 * style configuration.
 */
export function resolveStylePrompt(
    globalStylePrompt = "",
    stylePromptOverride?: string | null,
    lightingOverride?: string | null,
): string {
    const style = stylePromptOverride?.trim() || globalStylePrompt.trim();
    const lighting = lightingOverride?.trim();
    return [style, lighting].filter(Boolean).join(", ");
}

/** Combine global style negatives with model-level negatives unless a shot
 * explicitly supplies its own negative prompt. */
export function resolveNegativePrompt(
    globalStyleNegative = "",
    modelNegative = "",
    negativePromptOverride?: string | null,
): string {
    const override = negativePromptOverride?.trim();
    if (override) return override;
    return [globalStyleNegative.trim(), modelNegative.trim()].filter(Boolean).join(", ");
}

function normalizedPromptText(value: string): string {
    return value.replace(/[\s，。；：、,.!?！？:;]+/g, "").toLocaleLowerCase();
}

function directorShotConstraint(shot: ShotNode): string {
    const context = shot.directorShotContext;
    if (!context) return "";
    const values: Array<[string, string | undefined]> = [
        ["地点与时段", [context.scene?.location, context.scene?.time_anchor].filter(Boolean).join("，")],
        ["场景入场连续性", context.scene?.continuity_in],
        ["场景出场连续性", context.scene?.continuity_out],
        ["环境氛围", context.scene?.atmosphere],
        ["镜头意图", context.shot?.visual_intent],
        ["导演效果", context.shot?.director_effect],
        ["角色表演", context.shot?.performance_action],
        ["动作物理", context.shot?.action_physics],
        ["运镜", context.shot?.camera_movement],
        ["构图", context.shot?.composition],
        ["环境音", context.shot?.ambient_sound],
    ];
    const lighting = context.shot?.lighting;
    if (lighting && !shot.lightingOverride?.trim()) {
        const parts = [
            lighting.key_source && `主光${lighting.key_source}`,
            lighting.color_tone && `色调${lighting.color_tone}`,
            lighting.contrast && `明暗${lighting.contrast}`,
            lighting.practical_sources?.length && `画内光源${lighting.practical_sources.join("、")}`,
        ].filter((value): value is string => Boolean(value));
        if (parts.length) values.push(["光影", parts.join("；")]);
    }
    const existingFields = [
        shot.prompt || "",
        shot.cameraMovementStructured?.description || shot.cameraMovementStructured?.primary || "",
        shot.shotSize || "",
        shot.cameraAngle || "",
        shot.transitionHint || "",
    ].map(normalizedPromptText).filter(Boolean);
    const clauses = values.flatMap(([label, raw]) => {
        const value = raw?.trim();
        const normalizedValue = value ? normalizedPromptText(value) : "";
        if (!normalizedValue || existingFields.some(existing => existing.includes(normalizedValue))) return [];
        existingFields.push(normalizedValue);
        return [`${label}：${value}`];
    });
    return clauses.length ? `导演镜头约束：${clauses.join("；")}` : "";
}

/**
 * Real-time compute the final assembled prompt from the user's textarea
 * (visual narrative) + structured fields (camera language metadata).
 *
 * Rules (grill-me 2026-05-28, corrected):
 * - duration → NOT in prompt (唯一的特殊字段，走 API `duration` 参数)
 * - shot_size + camera_angle → appended to prompt tail
 * - camera_movement → appended to prompt tail (自然语言描述，含速度)
 * - transition_hint → appended to prompt tail (可选，多分镜视频内转场)
 *
 * Final = style/lighting layer + textarea visual narrative + 运镜 + 景别/机位 + 转场
 */
export function buildAssembledPrompt(
    shot: ShotNode,
    preserveReferences = false,
    globalStylePrompt = "",
): string {
    let base = (shot.prompt || "").trim();

    // Strip existing reference tags from the display — they're handled
    // separately as reference_image URLs in the API call
    if (!preserveReferences) {
        base = base
            .replace(/\[(?:character\d+|character|scene|prop):[^\]]+\]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    const prefix = resolveStylePrompt(
        globalStylePrompt,
        shot.stylePromptOverride,
        shot.lightingOverride,
    );
    const suffixes: string[] = [];

    const directorConstraint = directorShotConstraint(shot);
    if (directorConstraint) suffixes.push(directorConstraint);

    // Camera movement (natural language, speed naturally embedded)
    if (shot.cameraMovementStructured) {
        const desc = shot.cameraMovementStructured.description || shot.cameraMovementStructured.primary;
        if (desc) suffixes.push(desc);
    }

    // Shot size + camera angle (grouped)
    const framingParts: string[] = [];
    if (shot.shotSize) framingParts.push(shot.shotSize);
    if (shot.cameraAngle) framingParts.push(shot.cameraAngle);
    if (framingParts.length > 0) {
        suffixes.push(framingParts.join("，"));
    }

    // Transition hint (optional, for multi-shot internal transitions)
    if (shot.transitionHint) {
        suffixes.push(shot.transitionHint);
    }

    if (suffixes.length === 0) return [prefix, base].filter(Boolean).join(" . ");

    const separator = base.endsWith("。") || base.endsWith(".") || base.endsWith("，") || base.endsWith(",")
        ? ""
        : "，";
    const assembled = base + separator + suffixes.join("，");
    return [prefix, assembled].filter(Boolean).join(" . ");
}

export function buildGenerationPrompt(
    shot: ShotNode,
    generateAudio: boolean,
    modelId: string,
    globalStylePrompt = "",
): string {
    if (shot.promptIsOptimized) return shot.prompt.trim();
    // An accepted optimizer result is already a complete provider prompt.
    let prompt = buildAssembledPrompt(shot, true, globalStylePrompt);
    const line = shot.dialogueStructured?.line?.trim();
    if (!generateAudio || !line) return prompt;
    const speaker = shot.dialogueStructured?.speaker?.trim() || "Speaker";
    const isH3 = modelId.toLowerCase().includes("h3");
    if (!isH3 && prompt.includes(line)) return prompt;
    if (isH3 && prompt.includes("<d>") && prompt.includes(line)) return prompt;
    // Remove the known stale conclusion produced when the earlier polish call
    // did not receive the frame's structured dialogue.
    prompt = prompt
        .replace(/未提供明确台词，因此不生成可辨识对白。?/g, "")
        .replace(/No explicit dialogue (?:was )?provided[^.]*\.?/gi, "")
        .trim();
    if (isH3 && prompt.includes(line)) {
        prompt = prompt.replace(line, `<d>[Mandarin] ${line}</d>`);
        return prompt;
    }
    const language = /[\u3400-\u9fff]/.test(line) ? "Mandarin" : "English";
    const dialogue = isH3
        ? `${speaker} says: <d>[${language}] ${line}</d>`
        : `${speaker} says: "${line}"`;
    return `${prompt}${prompt ? "\n" : ""}${dialogue}`;
}
