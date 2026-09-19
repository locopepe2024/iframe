import { expect, it } from "vitest";

import { buildGenerationPrompt, resolveNegativePrompt, resolveStylePrompt } from "./buildAssembledPrompt";
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
