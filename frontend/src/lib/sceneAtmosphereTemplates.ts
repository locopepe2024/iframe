import type { ScenePromptLayers } from "./scenePromptLayers";

/** Complete opt-in lighting recipes, kept separate from atomic dictionary fields. */
export const SCENE_ATMOSPHERE_TEMPLATES: {
    id: string; title: string; keywords?: string; color: string; brightness: number; settings: ScenePromptLayers;
}[] = [
    { id: "high-key", title: "高调光", keywords: "High key lighting 明亮 亮调", color: "#f1f2ee", brightness: 70, settings: { lighting: {
        mood: "整体明亮，亮调区域占主导，保留材质与空间层次", shadow: "暗部适度提亮，保留接触阴影与立体感，高光不过曝",
    } } },
    { id: "low-key", title: "低调光", keywords: "Low key lighting 暗调 深沉", color: "#deded8", brightness: 30, settings: { lighting: {
        mood: "暗调区域占主导，亮部有限而集中", shadow: "保留深沉阴影及必要的暗部细节",
    } } },
    { id: "chiaroscuro", title: "明暗对照", keywords: "Chiaroscuro 戏剧性 集中光 深邃阴影", color: "#e2d5bd", brightness: 45, settings: { lighting: {
        contrast: "集中亮部与深沉暗部形成强烈明暗对照", shadow: "以清楚的明暗交界塑造主体体积，保留受光面的材质细节",
    } } },
    { id: "blue-orange-mist", title: "蓝橙暮光·薄雾", keywords: "黄昏 蓝调时刻 冰冷 蓝色 大气光 地平线 橙色余晖 薄雾 低饱和 写实", color: "#8faed1", brightness: 35, settings: { lighting: {
        time_of_day: "太阳落至地平线以下后的暮光时段", source: "来自天空的环境光照明",
        color: "冰冷的蓝色天空环境光与地平线上微弱的橙色余晖交融，整体低饱和",
        air: "空气中有柔和薄雾，远处轮廓仍可辨", shadow: "保留丰富的暗部阴影层次",
        mood: "逼真写实的黄昏氛围",
    } } },
    { id: "clear-cold", title: "通透冷光", keywords: "Transparent lighting Crystal clear air 通透 冷蓝 清澈", color: "#a8c7df", brightness: 45, settings: { lighting: {
        color: "冷蓝色照明，保留物体固有色的辨识度", air: "空气通透，无额外雾气、烟尘",
    } } },
    { id: "misty-cold-beams", title: "丁达尔冷光束", keywords: "Tyndall effect misty cold light beams 丁达尔 迷雾 冷光束 烟雾", color: "#a8c7df", brightness: 45, settings: { lighting: {
        quality: "定向光穿过已有开口或遮挡间隙，形成可辨识的光束；不新增门窗",
        color: "冷蓝色照明，保留物体固有色的辨识度", air: "薄雾中的散射使冷光束路径可见",
    } } },
    { id: "blue-hour", title: "蓝调时刻", keywords: "Blue hour lighting Twilight lighting 秋天 傍晚 天空 冷蓝色 暮光 蓝色时刻", color: "#8faed1", brightness: 35, settings: { lighting: {
        time_of_day: "太阳落至地平线以下后的暮光时段", source: "来自天空的环境光照明",
        color: "冷蓝色照明，保留物体固有色的辨识度",
    } } },
    { id: "cool-dawn", title: "清晨冷光", keywords: "Crisp dawn light Early morning cool light 黎明 天空", color: "#b2c8db", brightness: 40, settings: { lighting: {
        time_of_day: "清晨", source: "来自天空的环境光照明", color: "偏冷的清晨光色，保留物体固有色的辨识度",
    } } },
    { id: "chilly", title: "冰冷低饱和", keywords: "Chilly atmosphere Frosty tone Cold low-saturation color palette 冷色调", color: "#b5c4d1", brightness: 40, settings: { lighting: {
        mood: "冰冷疏离的空间氛围", color: "低饱和冷色调，保留材质和物体固有色的辨识度",
    } } },
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
