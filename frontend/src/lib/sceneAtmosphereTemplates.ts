import type { ScenePromptLayers } from "./scenePromptLayers";

/** Complete opt-in lighting recipes, kept separate from atomic dictionary fields. */
export const SCENE_ATMOSPHERE_TEMPLATES: {
    id: string; title: string; color: string; brightness: number; settings: ScenePromptLayers;
}[] = [
    { id: "golden-hour", title: "黄金时刻", color: "#f5c57a", brightness: 65, settings: { lighting: {
        source: "临近日落的太阳光", angles: { azimuth: 90, elevation: 12 }, quality: "柔和漫射光，阴影边缘柔和",
        fill: "以弱反射光轻微提亮暗部", contrast: "中等反差，亮部暗部均保留细节",
        color: "琥珀金色高光，保留物体固有色的辨识度", mood: "温暖舒缓的傍晚氛围",
    } } },
    { id: "cool-gray", title: "克制冷灰", color: "#c2cbd4", brightness: 40, settings: { lighting: {
        quality: "克制的定向光", contrast: "中等反差，亮部暗部均保留细节", shadow: "阴影干净，保留暗部层次",
        color: "冷灰光色，保留材质细节和物体固有色的辨识度", mood: "冷静克制的空间氛围",
    } } },
    { id: "mystic-shadow", title: "神秘暗调", color: "#e1e1dc", brightness: 30, settings: { lighting: {
        source: "窗户进入的自然光", quality: "硬质定向光，阴影边缘清晰", fill: "不额外补光，保留暗部",
        contrast: "高反差，亮暗区域分明", shadow: "光穿过已有窗格形成分割投影；不新增窗户",
        mood: "含蓄神秘的空间氛围，局部受光，背景照度克制",
    } } },
    { id: "neon", title: "霓虹光影", color: "#ed76bc", brightness: 55, settings: { lighting: {
        source: "霓虹灯照明", fill: "保留弱环境反射光", contrast: "高反差，亮暗区域分明",
        color: "局部粉色与青色光形成冷暖对照", rim: "以弱于主光的有色辅助光勾勒主体边缘",
        mood: "霓虹夜景氛围，保留清楚的场景结构",
    } } },
    { id: "blue-rim", title: "蓝色逆光", color: "#9dbcea", brightness: 40, settings: { lighting: {
        angles: { azimuth: 180, elevation: 20 }, fill: "以弱反射光使主体正面仍可辨识",
        rim: "蓝色逆光勾勒主体边缘", contrast: "中等反差，亮部暗部均保留细节",
    } } },
    { id: "film", title: "褪色胶片氛围", color: "#e1d0ad", brightness: 50, settings: { lighting: {
        mood: "怀旧胶片氛围，轻微暖黄褪色与偏色，高光轻微泛雾，场景结构保持清楚",
    } } },
    { id: "soft-space", title: "柔光空间", color: "#f3f0e8", brightness: 50, settings: { lighting: {
        quality: "柔和漫射主光", rim: "以弱于主光的辅助光轻微勾勒主体边缘",
        fill: "控制杂散补光，保留空间层次", contrast: "中等反差，亮部暗部均保留细节",
    } } },
    { id: "softbox", title: "柔光棚拍", color: "#f3f4f6", brightness: 65, settings: { lighting: {
        source: "通过柔光箱扩散的摄影灯光", quality: "柔和漫射光，阴影边缘柔和",
        fill: "补光使暗部细节清楚可辨", contrast: "低反差，明暗差异较小", mood: "干净均匀的棚拍氛围",
    } } },
];
