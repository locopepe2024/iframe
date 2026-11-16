import { describe, expect, it } from "vitest";
import { compileScenePromptLayers, sceneCameraCompatibilityNotes, sceneLightDirectionConflict, SCENE_LAYER_FIELDS } from "@/lib/scenePromptLayers";

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
    it("compiles opt-in capture device and focal length without a film-texture default", () => {
        expect(compileScenePromptLayers({ camera: {
            capture_device: "手机多摄系统观感；焦段按全画幅等效视角描述",
            focal_length: "85mm 全画幅等效人像焦段，透视压缩适中",
        } })).toBe("镜头：焦距观感：85mm 全画幅等效人像焦段，透视压缩适中；拍摄设备：手机多摄系统观感；焦段按全画幅等效视角描述");
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

it("advises on plausible shot and lens mismatches without forbidding intentional combinations", () => {
    expect(sceneCameraCompatibilityNotes({ camera: {
        framing: "特写，呈现材质或物件细节", focal_length: "14mm 全画幅等效超广角，近大远小的透视关系明显",
    } })).toEqual(expect.arrayContaining([expect.stringContaining("广角或鱼眼靠近主体")]));
    expect(sceneCameraCompatibilityNotes({ camera: {
        framing: "大全景，展示完整环境及周边空间", focal_length: "200mm 全画幅等效超长焦，视角狭窄、空间压缩明显",
    } })[0]).toContain("需要较远机位");
    expect(sceneCameraCompatibilityNotes({ camera: {
        capture_device: "手机多摄系统观感；焦段按全画幅等效视角描述",
        focal_length: "85mm 全画幅等效人像焦段，透视压缩适中",
    } })[0]).toContain("全画幅等效视角");
    expect(sceneCameraCompatibilityNotes({ camera: {
        viewpoint: "低机位仰视", focal_length: "14mm 全画幅等效超广角，近大远小的透视关系明显",
    } })).toEqual(expect.arrayContaining([expect.stringContaining("垂直线汇聚")]));
    expect(sceneCameraCompatibilityNotes({ camera: {
        capture_device: "运动相机观感，通常使用超广视角", depth_of_field: "浅景深，主体清楚，焦外区域失焦",
    } })[0]).toContain("小型运动相机偏深景深");
    expect(sceneCameraCompatibilityNotes({ camera: {
        framing: "细节特写", focal_length: "200mm 全画幅等效超长焦，视角狭窄、空间压缩明显",
    } })).toEqual(expect.arrayContaining([expect.stringContaining("最近对焦距离")]));
    expect(sceneCameraCompatibilityNotes({ camera: {
        viewpoint: "背视", framing: "近景，突出局部结构",
    } })).toEqual(expect.arrayContaining([expect.stringContaining("遮住主体正面特征")]));
    expect(sceneCameraCompatibilityNotes({ camera: {
        framing: "特写，呈现材质或物件细节", focal_length: "50mm 全画幅等效标准焦段，空间比例自然",
    } })).toEqual([]);
});

it("compiles explicit focus targets and image-relative coordinates without implying world distance", () => {
    expect(compileScenePromptLayers({ camera: { focus: { target: "门口石狮", x: 30, y: 65, radius: 18 } } }))
        .toBe("镜头：对焦目标：门口石狮；对焦点：画面坐标 x=30%、y=65%（左上角为原点，向右为 X，向下为 Y），清晰区域半径约 18%；保持该区域清晰");
    expect(compileScenePromptLayers({ camera: { focus: { target: "远处山门" } } })).toBe("镜头：对焦目标：远处山门");
    expect(compileScenePromptLayers({ camera: { focus: null } })).toBe("");
});

it("keeps atmosphere, air and light color independent from the source and optical settings", () => {
    const fields = SCENE_LAYER_FIELDS.lighting;
    const oilLamp = fields.find(f => f.key === "source")!.options.find(o => o[0] === "油灯")![1];
    expect(compileScenePromptLayers({ lighting: { source: oilLamp } })).toBe("光影：光源：传统油灯照明");
    expect(compileScenePromptLayers({ lighting: { mood: "宁静平和", air: "稀薄雾气", color: "暖光" } }))
        .toBe("光影：氛围：宁静平和；空气介质：稀薄雾气；光色关系：暖光");
    expect(compileScenePromptLayers({ lighting: { mood: "", air: "", color: "" } })).toBe("");
    for (const field of fields.filter(f => ["mood", "air", "color"].includes(f.key))) {
        for (const [, text] of field.options) expect(text).not.toMatch(/磨皮|柔肤|奶油|ARRI|Alexa|焦距|景深|运镜|剪辑/);
    }
});

it("adds shadows and rim lighting only when explicitly chosen", () => {
    expect(compileScenePromptLayers({ lighting: { source: "月光" } })).toBe("光影：光源：月光");
    expect(compileScenePromptLayers({ lighting: { shadow: "自然接触阴影", rim: "微弱轮廓光" } }))
        .toBe("光影：阴影：自然接触阴影；轮廓光：微弱轮廓光");
});


it("composes autumn evening skylight without injecting a golden hour recipe", () => {
    const pick = (key: string, label: string) => SCENE_LAYER_FIELDS.lighting.find(f => f.key === key)!.options.find(o => o[0] === label)![1];
    expect(compileScenePromptLayers({ lighting: {
        season: pick("season", "秋天"), time_of_day: pick("time_of_day", "傍晚"),
        source: pick("source", "天空环境光"), color: pick("color", "冷蓝色"),
    } })).toBe("光影：季节：秋天；时段：傍晚；光源：来自天空的环境光照明；光色关系：冷蓝色照明，保留物体固有色的辨识度");
    expect(compileScenePromptLayers({ lighting: { time_of_day: pick("time_of_day", "傍晚") } })).toBe("光影：时段：傍晚");
});


it("classifies oblique light directions in the same scene coordinate frame", () => {
    expect(sceneLightDirectionConflict({ lighting: { direction: "左后侧来光" } }, ["side"])).toBe(true);
    expect(sceneLightDirectionConflict({ lighting: { direction: "左后侧来光" } }, ["front"])).toBe(false);
});
