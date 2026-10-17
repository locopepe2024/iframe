import { expect, it } from "vitest";
import { buildGenerationPrompt, directorShotSuggestions } from "@/components/modules/storyboard-r2v/buildAssembledPrompt";
import { frameToShotNode } from "@/components/modules/storyboard-r2v/shotNodeHelpers";

it("offers confirmed shooting-plan direction without overriding the current shot prompt", () => {
    const shot = frameToShotNode({
        id: "frame-1",
        scene_id: "scene-asset",
        visual_description: "苏砚与江灼在街口交手，镜头缓慢跟随，远处人声与兵器碰撞声。",
        workbench_tab_mode: "direct_r2v",
        shot_size: null,
        camera_angle: null,
        director_shot_context: {
            scene: {
                location: "青溪镇粮铺门前", time_anchor: "黄昏", atmosphere: "街道被夕阳照亮",
                continuity_in: "苏砚刚从青石板长街转入粮铺门前",
                continuity_out: "苏砚听见后巷动静，转身追去",
            },
            shot: {
                visual_intent: "让探子从远处观察两人交手",
                director_effect: "先建立旁观者视角",
                performance_action: "苏砚和江灼保持交战距离",
                action_physics: "兵器接触后错身分开",
                composition: "两人位于远景中央，探子在前景遮挡中",
                camera_movement: "缓慢跟随",
                shot_size: "远景",
                camera_angle: "平视",
                duration_seconds: 8,
                ambient_sound: "远处人声与兵器碰撞声",
                lighting: {
                    key_source: "夕阳从画面右后方斜照",
                    color_tone: "暖红主调，冷灰阴影",
                    contrast: "高反差",
                    practical_sources: [],
                },
            },
        },
    }, []);

    const result = buildGenerationPrompt(shot, false, "wan2.7-i2v");
    const suggestions = directorShotSuggestions(shot).join("；");

    expect(shot.duration).toBe(8);
    expect(suggestions).toContain("青溪镇粮铺门前，黄昏");
    expect(suggestions).toContain("苏砚刚从青石板长街转入粮铺门前");
    expect(suggestions).toContain("苏砚听见后巷动静，转身追去");
    expect(suggestions).toContain("先建立旁观者视角");
    expect(suggestions).toContain("兵器接触后错身分开");
    expect(suggestions).toContain("夕阳从画面右后方斜照");
    expect(result).not.toContain("暖红主调");
    expect(result).not.toContain("苏砚听见后巷动静");
    expect(result).toContain("远处人声与兵器碰撞声");
    expect(result).toContain("缓慢跟随");
    expect(result).toContain("远景，平视");
    expect(result).not.toContain("固定镜头");
    expect(result.match(/缓慢跟随/g)).toHaveLength(1);
    expect(result.match(/远处人声与兵器碰撞声/g)).toHaveLength(1);
});

it("reloads an accepted optimized prompt instead of the older visual description", () => {
    const shot = frameToShotNode({
        id: "frame-2", visual_description: "旧描述", action_description: "已优化的完整提示词",
        workbench_prompt_is_optimized: true,
    }, []);
    expect(buildGenerationPrompt(shot, false, "wan2.7-i2v")).toBe("已优化的完整提示词");
});
