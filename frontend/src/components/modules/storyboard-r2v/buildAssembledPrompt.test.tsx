import { expect, it } from "vitest";

import { buildGenerationPrompt } from "./buildAssembledPrompt";
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
