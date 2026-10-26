import type { api } from "@/lib/api";

type Sheet = Awaited<ReturnType<typeof api.getStoryboardContinuitySheet>>;
export type ContinuityRow = Sheet["rows"][number];

const lightLabels: Record<string, string> = {
    story_time: "叙事时间", daylight_phase: "日光阶段", weather: "天气",
    shadow_direction: "阴影方向", key_source: "主光", ambient_lighting: "环境光",
    color_tone: "色调", contrast: "对比", practical_sources: "画内光源",
    direction: "光线方向", quality: "光线质感", color_temp: "色温",
};

function text(value: unknown): string {
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
    return value == null ? "" : String(value).trim();
}

export function effectiveShotVisual(row: ContinuityRow | undefined, globalStylePrompt: string): {
    style: string;
    lighting: string;
    scene: string;
    assets: string;
} {
    if (!row) return { style: globalStylePrompt, lighting: "", scene: "", assets: "" };
    const styleField = row.fields.style;
    const style = styleField?.source_kind === "scene_design" || styleField?.source_kind === "frame"
        ? text(styleField.value) : globalStylePrompt;
    const explicitLighting = text(row.fields.lighting_override?.value);
    const lighting = explicitLighting || Object.entries(lightLabels).flatMap(([key, label]) => {
        const value = text(row.fields[key]?.value);
        return value ? [`${label}：${value}`] : [];
    }).join("；");
    const baseline = row.scene_baseline ?? {};
    const scene = ([
        ["scene_identity", "场景"], ["location_type", "地点类型"],
        ["fixed_geometry", "固定结构"], ["fixed_landmarks", "固定地标"],
        ["materials", "材质"], ["environment", "环境"],
        ["reusable_constraints", "复用约束"],
    ] as const).flatMap(([key, label]) => {
        const value = text(baseline[key]);
        return value ? [`${label}：${value}`] : [];
    }).join("；");
    return { style: style || globalStylePrompt, lighting, scene,
        assets: row.asset_visual_context ?? "" };
}
