import { expect, it } from "vitest";

import { buildGenerationPrompt, directorShotSuggestions, resolveNegativePrompt, resolveStylePrompt } from "./buildAssembledPrompt";

it("adds only accepted micro-expression timing to video prompt", () => {
    const shot = { id: "frame", prompt: "街头等待", tabMode: "t2i_i2v" as const,
        microExpressionTiming: [{ character_id: "hero", character_name: "玄宸", timing: [
            { phase: "trigger", relative_start: 0, relative_end: 0.2, visible_change: "视线停住" },
            { phase: "release", relative_start: 0.8, relative_end: 1, visible_change: "恢复平静" },
        ] }] };
    const result = buildGenerationPrompt(shot, false, "uniart/seedance-2.5-vip");
    expect(result).toContain("玄宸表情时序");
    expect(result).toContain("release(0.80-1.00) 恢复平静");
    expect(result).not.toContain("前镜对白");
    const optimized = { ...shot, prompt: "街头等待，警觉地看向身后", promptIsOptimized: true };
    expect(buildGenerationPrompt(optimized, false, "uniart/seedance-2.5-vip")).toContain("玄宸表情时序");
});

it("compiles the selected character move into a generation prompt", () => {
    const shot = {
        id: "shot-15",
        prompt: "苏砚从人群中央掠入，拔剑扫开匪寇兵刃。",
        tabMode: "direct_r2v" as const,
        moveRef: "suyan.sword.disarm_sweep.v1",
        moveVariant: "面对数名匪寇的连续拨械",
    };
    const result = buildGenerationPrompt(shot, false, "uniart/minimax-h3-vip");
    expect(result).toContain("连贯剑势·拨械");
    expect(result).toContain("动作词：拍刃、抽击、剑鞭");
    expect(result).toContain("面对数名匪寇的连续拨械");
    expect(result).toContain("只针对持械手或刀剑");
    expect(result).toContain("不以锋刃切割");
    expect(result).toContain("钝器式拍击");
    expect(result).toContain("竹鞭般的弹性抽击");
    expect(result).toContain("手腕短促抖动发力");
    expect(result).not.toContain("剑身横向扫过");
    expect(result).toContain("刀剑沿受力方向翻飞");
});

it("removes the move text when an optimized prompt has no selected move", () => {
    const shot = {
        id: "shot-15",
        prompt: "integrated_multimodal_description: one continuous sword action",
        tabMode: "direct_r2v" as const,
        promptIsOptimized: true,
    };
    expect(buildGenerationPrompt(shot, false, "uniart/minimax-h3-vip"))
        .not.toContain("连贯剑势·拨械");
});
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

it("submits an accepted optimized prompt unchanged for H3 and other video models", () => {
    const optimized = {
        ...shot,
        prompt: "integrated_multimodal_description: one continuous action\noverall_soundscape: street noise",
        promptIsOptimized: true,
        directorShotContext: { scene: { location: "粮铺门前" } },
        shotSize: "远景",
    };
    expect(buildGenerationPrompt(optimized, true, "uniart/minimax-h3-vip", "cinematic style"))
        .toBe(optimized.prompt);
    expect(buildGenerationPrompt(optimized, true, "wan2.7-i2v", "cinematic style"))
        .toBe(optimized.prompt);
});

it("keeps shooting-plan prose as an explicit suggestion instead of appending it", () => {
    const withPlan: ShotNode = {
        ...shot,
        directorShotContext: { scene: { atmosphere: "残阳如血" } },
    };
    expect(directorShotSuggestions(withPlan)).toContain("环境氛围：残阳如血");
    expect(buildGenerationPrompt(withPlan, false, "wan2.7-i2v")).not.toContain("残阳如血");
});

it("submits accepted composition instead of suggesting the old plan composition", () => {
    const framed: ShotNode = {
        ...shot,
        composition: "主体位于画面左侧",
        directorShotContext: { shot: { composition: "旧计划主体居中" } },
    };
    expect(buildGenerationPrompt(framed, false, "uniart/minimax-h3-vip"))
        .toContain("构图：主体位于画面左侧");
    expect(directorShotSuggestions(framed)).not.toContain("构图：旧计划主体居中");
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
