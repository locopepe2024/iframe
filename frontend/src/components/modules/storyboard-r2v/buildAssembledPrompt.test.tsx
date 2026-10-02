import { expect, it } from "vitest";

import { buildGenerationPrompt, resolveNegativePrompt, resolveStylePrompt } from "./buildAssembledPrompt";
import { resolveStoryboardStyle, resolveStoryboardStyleForRender } from "@/lib/storyboardStyle";
import type { ShotNode } from "./ShotCard";

const shot: ShotNode = {
    id: "shot-1",
    prompt: "主播举起药盒。",
    tabMode: "direct_r2v",
    dialogueStructured: {
        speaker: "女主播",
        line: "今天这款穿心莲分散片，我们决定给大家随机立减！",
    },
};

it("adds exact H3 dialogue when generated audio is enabled", () => {
    expect(buildGenerationPrompt(shot, true, "uniart/minimax-h3-vip")).toContain(
        "女主播 says: <d>[Mandarin] 今天这款穿心莲分散片，我们决定给大家随机立减！</d>",
    );
});

it("does not add dialogue when generated audio is disabled", () => {
    expect(buildGenerationPrompt(shot, false, "uniart/minimax-h3-vip")).not.toContain("随机立减");
});

it("does not duplicate dialogue already present in the prompt", () => {
    const withDialogue = { ...shot, prompt: `${shot.prompt} ${shot.dialogueStructured!.line}` };
    const result = buildGenerationPrompt(withDialogue, true, "uniart/minimax-h3-vip");
    expect(result.match(/随机立减/g)).toHaveLength(1);
    expect(result).toContain("<d>[Mandarin]");
});

it("removes a stale no-dialogue conclusion before adding explicit dialogue", () => {
    const stale = { ...shot, prompt: `${shot.prompt} 未提供明确台词，因此不生成可辨识对白。` };
    const result = buildGenerationPrompt(stale, true, "uniart/minimax-h3-vip");
    expect(result).not.toContain("未提供明确台词");
    expect(result).toContain(`<d>[Mandarin] ${shot.dialogueStructured!.line}</d>`);
});

it("uses a per-shot style override and scene lighting without the global daylight bias", () => {
    const result = buildGenerationPrompt(
        { ...shot, stylePromptOverride: "Japanese live-action film look, quiet night cinema", lightingOverride: "nighttime practical street lighting" },
        false,
        "wan2.7-i2v",
        "Japanese live-action film look, soft naturalistic lighting adapted to the scene, overcast daylight when appropriate",
    );
    expect(result).toContain("quiet night cinema");
    expect(result).toContain("nighttime practical street lighting");
    expect(result).not.toContain("overcast daylight when appropriate");
});

it("lets a shot replace inherited negative constraints", () => {
    expect(resolveNegativePrompt("global negative", "model negative", "bright daylight")).toBe("bright daylight");
    expect(resolveNegativePrompt("global negative", "model negative")).toBe("global negative, model negative");
    expect(resolveStylePrompt("global style", undefined, "night light")).toBe("global style, night light");
});

it("resolves a series art direction for storyboard frames when the project inherits it", () => {
    expect(resolveStoryboardStyle(
        { series_id: "series-1" },
        {
            id: "series-1",
            art_direction: { style_config: { positive_prompt: "全片胶片质感", negative_prompt: "过饱和" } },
        },
    )).toEqual({ positivePrompt: "全片胶片质感", negativePrompt: "过饱和" });

    expect(resolveStoryboardStyle(
        { series_id: "series-2", style_prompt: "项目旧版风格" },
        { id: "series-1", art_direction: { style_config: { positive_prompt: "不可串用的系列风格" } } },
    )).toEqual({ positivePrompt: "项目旧版风格", negativePrompt: "" });
});

it("keeps project art direction above the series and uses legacy style when neither exists", () => {
    expect(resolveStoryboardStyle(
        {
            series_id: "series-1",
            art_direction: { style_config: { positive_prompt: "项目风格", negative_prompt: "项目负向" } },
        },
        { id: "series-1", art_direction: { style_config: { positive_prompt: "系列风格" } } },
    )).toEqual({ positivePrompt: "项目风格", negativePrompt: "项目负向" });
    expect(resolveStoryboardStyle({ style_prompt: "手绘水彩", style_preset: "realistic" })).toEqual({
        positivePrompt: "realistic style, 手绘水彩",
        negativePrompt: "",
    });
});

it("loads a missing inherited series style before rendering", async () => {
    const loadSeries = async (id: string) => ({
        id,
        art_direction: { style_config: { positive_prompt: "系列统一风格", negative_prompt: "" } },
    });
    await expect(resolveStoryboardStyleForRender({ series_id: "series-1" }, null, loadSeries)).resolves.toEqual({
        positivePrompt: "系列统一风格",
        negativePrompt: "",
    });
});
