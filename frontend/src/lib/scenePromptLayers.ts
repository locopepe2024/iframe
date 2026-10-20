import { describeSceneDirection } from "./sceneDirection";

export interface ScenePromptLayers {
    version?: 1;
    lighting?: Partial<Record<"source" | "direction" | "quality" | "fill" | "contrast", string>> & { angles?: SceneLayerAngles | null };
    camera?: Partial<Record<"framing" | "viewpoint" | "focal_length" | "depth_of_field", string>> & { angles?: SceneLayerAngles | null; focus?: SceneFocusPoint | null };
    composition?: Partial<Record<"subject_position" | "spatial_layers" | "leading_relation", string>>;
}
export interface SceneFocusPoint { target?: string; x?: number | null; y?: number | null; radius?: number | null }
export interface SceneLayerAngles { azimuth: number; elevation: number }
export type SceneLayer = "lighting" | "camera" | "composition";
export interface SceneLayerField { key: string; label: string; options: readonly (readonly [string, string])[] }

// Original static-scene vocabulary. Each option describes only its own field.
export const SCENE_LAYER_FIELDS: Record<SceneLayer, readonly SceneLayerField[]> = {
    lighting: [
        { key: "source", label: "光源", options: [
            ["窗光", "窗户进入的自然光"], ["阴天天光", "阴天漫射天光"], ["直射日光", "太阳直射光"],
            ["月光", "月光"], ["烛火灯笼", "烛火或灯笼光"], ["室内灯具", "场景内实际灯具照明"], ["霓虹", "霓虹灯照明"],
        ] },
        { key: "direction", label: "方向", options: [
            ["正面", "正面来光"], ["左侧", "左侧来光"], ["右侧", "右侧来光"],
            ["背面", "背面来光"], ["顶部", "顶部来光"], ["底部", "底部来光"],
        ] },
        { key: "quality", label: "软硬", options: [
            ["柔光", "柔和漫射光，阴影边缘柔和"], ["硬光", "硬质定向光，阴影边缘清晰"], ["混合", "软硬光混合，分别保留各光源的阴影特征"],
        ] },
        { key: "fill", label: "补光", options: [
            ["无补光", "不额外补光，保留暗部"], ["弱反射补光", "以弱反射光轻微提亮暗部"], ["均匀补光", "补光使暗部细节清楚可辨"], ["负补光", "遮挡环境反射光，加深暗部"],
        ] },
        { key: "contrast", label: "反差", options: [
            ["低反差", "低反差，明暗差异较小"], ["中等反差", "中等反差，亮部暗部均保留细节"], ["高反差", "高反差，亮暗区域分明"],
        ] },
    ],
    camera: [
        { key: "framing", label: "景别", options: [
            ["大全景", "大全景，展示完整环境及周边空间"], ["全景", "全景，展示场景主体全貌"], ["中景", "中景，聚焦场景局部及其周边关系"], ["近景", "近景，突出局部结构"], ["细节特写", "特写，呈现材质或物件细节"],
        ] },
        { key: "viewpoint", label: "机位", options: [
            ["平视", "平视机位"], ["高机位", "高机位俯视"], ["低机位", "低机位仰视"], ["正俯视", "正上方垂直俯视"], ["侧视", "侧面机位"], ["背视", "背面机位"],
        ] },
        { key: "focal_length", label: "焦距观感", options: [
            ["广角", "广角观感，近大远小的透视关系明显，空间纵深展开"], ["标准", "标准焦距观感，空间比例自然"], ["长焦", "长焦观感，远近空间呈压缩感"],
        ] },
        { key: "depth_of_field", label: "景深", options: [
            ["深景深", "深景深，前中后景均清晰可辨"], ["中等景深", "中等景深，主体清楚，远处逐渐失焦"], ["浅景深", "浅景深，主体清楚，焦外区域失焦"],
        ] },
    ],
    composition: [
        { key: "subject_position", label: "主体位置", options: [
            ["居中", "场景主体位于画面中央"], ["左三分", "场景主体位于画面左侧三分线附近"], ["右三分", "场景主体位于画面右侧三分线附近"], ["对称", "主体居中，画面两侧形成对称关系"], ["留白", "主体偏置，另一侧保留清晰留白"],
        ] },
        { key: "spatial_layers", label: "空间层次", options: [
            ["前中后景", "前景、中景、后景有清楚的空间分层"], ["前景框景", "利用前景门窗或枝叶形成框景，呈现内部空间"], ["遮挡层次", "利用物体前后遮挡关系表达空间层次"], ["平面布局", "强调平面排列，减少前后层次"],
        ] },
        { key: "leading_relation", label: "引导关系", options: [
            ["道路引导", "道路或走廊线条引导视线至场景主体"], ["透视汇聚", "空间透视线向主要视觉焦点汇聚"], ["对角线", "主要形体沿对角线排列，引导视线穿过画面"], ["重复节奏", "利用重复的建筑或物件形成视觉节奏"], ["明暗引导", "利用明暗区域的分布引导视线至主体"],
        ] },
    ],
};

const titles: Record<SceneLayer, string> = { lighting: "光影", camera: "镜头", composition: "构图" };
export function compileScenePromptLayers(layers: ScenePromptLayers): string {
    return (Object.keys(SCENE_LAYER_FIELDS) as SceneLayer[]).flatMap(layer => {
        const values = layers[layer] as Record<string, unknown> | undefined;
        if (!values) return [];
        const angles = "angles" in values ? values.angles as SceneLayerAngles | null : null;
        const parts = SCENE_LAYER_FIELDS[layer].flatMap(field => {
            if (angles && field.key === (layer === "lighting" ? "direction" : "viewpoint")) {
                return [`${field.label}：${describeSceneDirection(angles.azimuth, angles.elevation)}（方位 ${angles.azimuth}°，仰角 ${angles.elevation}°；以场景前方 -Y、右方 +X、上方 +Z 为基准）`];
            }
            const value = values[field.key];
            return typeof value === "string" && value.trim() ? [`${field.label}：${value.trim()}`] : [];
        });
        if (layer === "camera" && layers.camera?.focus) {
            const focus = layers.camera.focus;
            if (focus.target?.trim()) parts.push(`对焦目标：${focus.target.trim()}`);
            if (typeof focus.x === "number" && typeof focus.y === "number") {
                parts.push(`对焦点：画面坐标 x=${focus.x}%、y=${focus.y}%（左上角为原点，向右为 X，向下为 Y）${typeof focus.radius === "number" ? `，清晰区域半径约 ${focus.radius}%` : ""}；保持该区域清晰`);
            }
        }
        return parts.length ? [`${titles[layer]}：${parts.join("；")}`] : [];
    }).join("\n");
}

// Existing prohibitions refer to the same scene coordinate frame as the sphere.
export function sceneLightDirectionConflict(layers: ScenePromptLayers, forbidden: string[]): boolean {
    const light = layers.lighting;
    if (!light) return false;
    let direction = "";
    if (light.angles) {
        const { azimuth: a, elevation: e } = light.angles;
        direction = e >= 60 ? "top" : e <= -60 ? "bottom" : Math.abs(a) <= 22.5 ? "front" : Math.abs(a) >= 157.5 ? "back" : "side";
    } else {
        direction = ({ "正面来光": "front", "背面来光": "back", "左侧来光": "side", "右侧来光": "side", "顶部来光": "top", "底部来光": "bottom" } as Record<string, string>)[light.direction || ""] || "";
    }
    return Boolean(direction && forbidden.includes(direction));
}
