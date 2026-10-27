import { describe, expect, it } from "vitest";

import { buildGenerationPrompt } from "./buildAssembledPrompt";
import { effectiveShotVisual, type ContinuityRow } from "./effectiveShotVisual";
import type { ShotNode } from "./ShotCard";

const field = (value: unknown, source_kind: string) => ({
    value, source_kind, source_id: "source", source_revision: 2, status: "confirmed",
});

function row(fields: ContinuityRow["fields"], scene_baseline: ContinuityRow["scene_baseline"] = {}): ContinuityRow {
    return { frame_id: "shot", shot_id: "shot", scene_id: "street", scene_name: "长街",
        place_continuity_id: "street", time_continuity_id: "dusk", continuity_status: "confirmed",
        scene_design_revision: 2, plan_revision: 1, style_hash: "style", model: "h3",
        visual_source_hash: "visual-source", fields, scene_baseline,
        asset_visual_context: "", asset_visual_issues: [],
        reference: null };
}

describe("effective shot visual", () => {
    it("uses confirmed scene style and light in the actual draft", () => {
        const visual = effectiveShotVisual(row({
            style: field("写实电影", "scene_design"),
            ambient_lighting: field("暮秋残阳", "scene_design"),
            key_source: field("西侧低角度日光", "plan_baseline"),
        }), "项目默认风格");
        const shot = { prompt: "商贩穿行", shotSize: "大远景", cameraAngle: "鸟瞰",
            cameraMovementStructured: { primary: "static", speed: "normal", description: "固定机位" },
            transitionHint: "硬切" } as ShotNode;
        const prompt = buildGenerationPrompt(shot, false, "uniart/minimax-h3-vip", visual.style, visual.lighting);
        expect(prompt).toContain("写实电影");
        expect(prompt).toContain("环境光：暮秋残阳");
        expect(prompt).toContain("主光：西侧低角度日光");
        expect(prompt).toContain("大远景，鸟瞰");
        expect(prompt).toContain("固定机位");
        expect(prompt).toContain("硬切");
    });

    it("uses an explicit shot light override instead of inherited local light", () => {
        const visual = effectiveShotVisual(row({
            style: field("realistic", "project"),
            ambient_lighting: field("暮秋残阳", "scene_design"),
            lighting_override: field("室内烛光", "frame"),
        }), "项目默认风格");
        expect(visual).toEqual({ style: "项目默认风格", lighting: "室内烛光", scene: "", assets: "" });
    });

    it("does not infer reference light when the image has no selected fields", () => {
        expect(effectiveShotVisual(row({ style: field("realistic", "project") }), "项目风格"))
            .toEqual({ style: "项目风格", lighting: "", scene: "", assets: "" });
    });

    it("sends confirmed scene geometry with the video draft but keeps accepted text intact", () => {
        const visual = effectiveShotVisual(row({
            style: field("写实", "scene_design"),
        }, {
            scene_identity: "长街中段粮铺", fixed_geometry: ["临街门廊", "木柜台"],
            fixed_landmarks: ["粮袋"], materials: ["旧木材"],
        }), "项目风格");
        const shot = { prompt: "老掌柜被踢后倒地。", tabMode: "t2i_i2v" } as ShotNode;
        const draft = buildGenerationPrompt(shot, false, "uniart/minimax-h3-vip",
            visual.style, visual.lighting, visual.scene);
        expect(draft).toContain("固定结构：临街门廊、木柜台");
        expect(draft).toContain("固定地标：粮袋");
        expect(draft).not.toContain("未确认阁楼");
        expect(buildGenerationPrompt({ ...shot, promptIsOptimized: true }, false,
            "uniart/minimax-h3-vip", visual.style, visual.lighting, visual.scene)).toBe(shot.prompt);
    });

    it("submits approved character and prop appearance with an unoptimized draft", () => {
        const visual = effectiveShotVisual({ ...row({}),
            asset_visual_context: "角色老掌柜：灰白发髻；深褐长衣\n道具粮袋：粗麻布袋",
        }, "项目风格");
        const shot = { prompt: "掌柜挡在粮铺前", tabMode: "direct_r2v" } as ShotNode;
        const draft = buildGenerationPrompt(shot, false, "uniart/minimax-h3-vip",
            visual.style, visual.lighting, visual.scene, visual.assets);
        expect(draft).toContain("角色老掌柜：灰白发髻；深褐长衣");
        expect(draft).toContain("道具粮袋：粗麻布袋");
        expect(buildGenerationPrompt({ ...shot, promptIsOptimized: true }, false,
            "uniart/minimax-h3-vip", visual.style, visual.lighting, visual.scene, visual.assets)).toBe(shot.prompt);
    });
});
