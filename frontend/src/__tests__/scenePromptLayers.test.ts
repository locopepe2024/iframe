import { describe, expect, it } from "vitest";
import { compileScenePromptLayers, sceneLightDirectionConflict, SCENE_LAYER_FIELDS } from "@/lib/scenePromptLayers";

describe("static scene prompt layers", () => {
    it("emits no implicit defaults or bundled aesthetics", () => {
        expect(compileScenePromptLayers({})).toBe("");
        expect(compileScenePromptLayers({ lighting: {}, camera: {}, composition: {} })).toBe("");
        const catalog = JSON.stringify(SCENE_LAYER_FIELDS);
        expect(catalog).not.toMatch(/ARRI|Alexa|Canon|Sony|奶油|磨皮|柔肤|180°|30°|轴线|剪辑|连续性/);
        const longLens = SCENE_LAYER_FIELDS.camera.find(f => f.key === "focal_length")!.options.find(o => o[0] === "长焦")![1];
        expect(compileScenePromptLayers({ camera: { focal_length: longLens } })).toBe(`镜头：焦距观感：${longLens}`);
        expect(longLens).not.toMatch(/景深|虚化|柔化/);
    });
    it("keeps the three layers separate and compiles only selected fields", () => {
        expect(compileScenePromptLayers({
            lighting: { source: "月光", fill: "不额外补光，保留暗部" },
            camera: { framing: "大全景", depth_of_field: "深景深" },
            composition: { spatial_layers: "前景、中景、后景" },
        })).toBe("光影：光源：月光；补光：不额外补光，保留暗部\n镜头：景别：大全景；景深：深景深\n构图：空间层次：前景、中景、后景");
    });
    it("uses independent scene-relative light and camera angles", () => {
        const prompt = compileScenePromptLayers({ lighting: { angles: { azimuth: 90, elevation: 30 } }, camera: { angles: { azimuth: -90, elevation: 0 } } });
        expect(prompt).toContain("光影：方向：");
        expect(prompt).toContain("方位 90°，仰角 30°");
        expect(prompt).toContain("镜头：机位：");
        expect(prompt).toContain("方位 -90°，仰角 0°");
        expect(prompt).not.toContain("景深");
        expect(sceneLightDirectionConflict({ lighting: { angles: { azimuth: 90, elevation: 90 } } }, ["top"])).toBe(true);
        expect(sceneLightDirectionConflict({ lighting: { direction: "背面来光" } }, ["front"])).toBe(false);
        expect(sceneLightDirectionConflict({ lighting: { direction: "背面来光" } }, ["back"])).toBe(true);
    });
});

it("compiles explicit focus targets and image-relative coordinates without implying world distance", () => {
    expect(compileScenePromptLayers({ camera: { focus: { target: "门口石狮", x: 30, y: 65, radius: 18 } } }))
        .toBe("镜头：对焦目标：门口石狮；对焦点：画面坐标 x=30%、y=65%（左上角为原点，向右为 X，向下为 Y），清晰区域半径约 18%；保持该区域清晰");
    expect(compileScenePromptLayers({ camera: { focus: { target: "远处山门" } } })).toBe("镜头：对焦目标：远处山门");
    expect(compileScenePromptLayers({ camera: { focus: null } })).toBe("");
});
