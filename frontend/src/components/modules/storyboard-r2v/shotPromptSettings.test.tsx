import { expect, it } from "vitest";
import { editShotSettings } from "./shotPromptSettings";
import { buildGenerationPrompt } from "./buildAssembledPrompt";
import { frameToShotNode } from "./shotNodeHelpers";

it("edits adopted H3 visual text without changing its audio or appending at submit", () => {
    const shot = { id: "frame", tabMode: "direct_r2v" as const, promptIsOptimized: true, lightingOverride: "old light",
        prompt: "subject_definitions: Qin\ndetailed_description: old light; user action; <d>old light</d>\noverall_soundscape: old light is spoken\nnon_diegetic_music: N/A" };
    const next = editShotSettings(shot, "lightingOverride", "new light");
    expect(next.prompt).toContain("new light");
    expect(next.prompt).not.toContain("old light; user action");
    expect(next.prompt).toContain("<d>old light</d>");
    expect(next.prompt).toContain("overall_soundscape: old light is spoken\nnon_diegetic_music: N/A");
    expect(next.prompt).toContain("user action");
    expect(next.promptIsOptimized).toBe(true);
    expect(buildGenerationPrompt(next, true, "uniart/minimax-h3-vip")).toBe(next.prompt);
    expect(buildGenerationPrompt(next, false, "wan3.0")).toBe(next.prompt);
    const again = editShotSettings(next, "lightingOverride", "latest light");
    expect(again.prompt.match(/【当前镜头设定】/g)).toHaveLength(1);
    expect(again.prompt).not.toContain("new light");
    expect(again.prompt).toContain("latest light");
});

it("keeps unpolished drafts editable and resolves explicit lighting before plan lighting", () => {
    const next = editShotSettings({ id: "f", tabMode: "t2i_i2v", prompt: "user action", directorShotContext: { shot: { lighting: { key_source: "old plan light" } } } }, "lightingOverride", "new light");
    expect(next.prompt).toBe("user action");
    const submitted = buildGenerationPrompt(next, false, "wan3.0");
    expect(submitted).toContain("new light");
    expect(submitted).not.toContain("old plan light");
});

it("reloads the saved adopted body and optimization flag", () => {
    const next = editShotSettings({ id: "f", tabMode: "t2i_i2v", prompt: "body", promptIsOptimized: true }, "lightingOverride", "new light");
    const restored = frameToShotNode({ id: "f", scene_id: "room", visual_description: "older", action_description: next.prompt,
        workbench_prompt_is_optimized: true, lighting_override: next.lightingOverride } as any, [], "t2i_i2v");
    expect(buildGenerationPrompt(restored, false, "wan3.0")).toBe(next.prompt);
});

it("restores inherited lighting on clear and keeps ordinary user text on later edits", () => {
    const next = editShotSettings({ id: "f", tabMode: "t2i_i2v", prompt: "detailed_description: old light; my action\noverall_soundscape: N/A",
        promptIsOptimized: true, lightingOverride: "old light", directorShotContext: { shot: { lighting: { key_source: "window light" } } } }, "lightingOverride", "");
    expect(next.prompt).toContain("window light");
    expect(next.prompt).not.toContain("old light");
    const manual = { ...next, prompt: next.prompt + "\nmy manual addition" };
    const latest = editShotSettings(manual, "stylePromptOverride", "film grain");
    expect(latest.prompt).toContain("my manual addition");
    expect(latest.prompt).toContain("my action");
    expect(latest.prompt.match(/【当前镜头设定】/g)).toHaveLength(1);
});
