import { expect, it } from "vitest";
import { buildGenerationPrompt } from "@/components/modules/storyboard-r2v/buildAssembledPrompt";
import { frameToShotNode } from "@/components/modules/storyboard-r2v/shotNodeHelpers";

it("routes confirmed shooting-plan direction into the final R2V prompt", () => {
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

    expect(shot.duration).toBe(8);
    expect(result).toContain("导演镜头约束");
    expect(result).toContain("青溪镇粮铺门前，黄昏");
    expect(result).toContain("苏砚刚从青石板长街转入粮铺门前");
    expect(result).toContain("苏砚听见后巷动静，转身追去");
    expect(result).toContain("先建立旁观者视角");
    expect(result).toContain("兵器接触后错身分开");
    expect(result).toContain("夕阳从画面右后方斜照");
    expect(result).toContain("远处人声与兵器碰撞声");
    expect(result).toContain("缓慢跟随");
    expect(result).toContain("远景，平视");
    expect(result).not.toContain("固定镜头");
    expect(result.match(/缓慢跟随/g)).toHaveLength(1);
    expect(result.match(/远处人声与兵器碰撞声/g)).toHaveLength(1);
});
