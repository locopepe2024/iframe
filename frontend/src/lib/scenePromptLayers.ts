import { describeSceneDirection } from "./sceneDirection";

export interface ScenePromptLayers {
    version?: 1;
    lighting?: Partial<Record<"season" | "time_of_day" | "source" | "direction" | "quality" | "fill" | "contrast" | "mood" | "air" | "color" | "shadow" | "rim", string>> & { angles?: SceneLayerAngles | null };
    camera?: Partial<Record<"framing" | "viewpoint" | "focal_length" | "depth_of_field" | "capture_device", string>> & { angles?: SceneLayerAngles | null; focus?: SceneFocusPoint | null };
    composition?: Partial<Record<"subject_position" | "spatial_layers" | "leading_relation" | "frame_orientation", string>>;
}
export interface SceneFocusPoint { target?: string; x?: number | null; y?: number | null; radius?: number | null }
export interface SceneLayerAngles { azimuth: number; elevation: number }
export type SceneLayer = "lighting" | "camera" | "composition";
export interface SceneLayerField { key: string; label: string; options: readonly (readonly [string, string])[] }

// Original static-scene vocabulary. Each option describes only its own field.
export const SCENE_LAYER_FIELDS: Record<SceneLayer, readonly SceneLayerField[]> = {
    lighting: [
        { key: "season", label: "季节", options: [
            ["春天", "春天"], ["夏天", "夏天"], ["秋天", "秋天"], ["冬天", "冬天"],
        ] },
        { key: "time_of_day", label: "时段", options: [
            ["黎明前", "日出前的黎明时段"], ["清晨", "清晨"], ["上午", "上午"], ["正午", "正午"],
            ["下午", "下午"], ["傍晚", "傍晚"], ["日落后暮光", "太阳落至地平线以下后的暮光时段"], ["夜间", "夜间"],
        ] },
        { key: "source", label: "光源", options: [
            ["天空环境光", "来自天空的环境光照明"], ["窗光", "窗户进入的自然光"], ["阴天天光", "阴天漫射天光"], ["直射日光", "太阳直射光"],
            ["月光", "月光"], ["烛火灯笼", "烛火或灯笼光"], ["室内灯具", "场景内实际灯具照明"], ["霓虹", "霓虹灯照明"],
            ["晨间日光", "清晨太阳光"], ["夕阳", "临近日落的太阳光"], ["曙暮天光", "日出前或日落后的天空环境光"],
            ["天井采光", "由天井或屋顶开口进入的自然光"], ["林间透光", "穿过树冠间隙的自然光"], ["雪地反射", "雪地反射的环境光"],
            ["烛光", "蜡烛火焰照明"], ["油灯", "传统油灯照明"], ["纸灯笼", "纸灯笼内的灯火照明"],
            ["火把", "火把火焰照明"], ["篝火", "篝火照明"], ["炉火", "壁炉或灶炉火光照明"],
            ["白炽灯", "白炽灯照明"], ["荧光灯", "荧光灯管照明"], ["LED灯具", "LED灯具照明"],
            ["路灯", "街道路灯照明"], ["招牌灯箱", "招牌灯箱发出的光"], ["屏幕光", "显示屏发出的光"],
            ["聚光灯", "聚光灯定向照明"], ["摄影闪光", "摄影闪光灯照明"], ["柔光箱", "通过柔光箱扩散的摄影灯光"],
        ] },
        { key: "direction", label: "方向", options: [
            ["正面", "正面来光"], ["左侧", "左侧来光"], ["右侧", "右侧来光"],
            ["左前侧", "左前侧来光"], ["右前侧", "右前侧来光"], ["左后侧", "左后侧来光"], ["右后侧", "右后侧来光"],
            ["背面", "背面来光"], ["顶部", "顶部来光"], ["底部", "底部来光"],
        ] },
        { key: "quality", label: "软硬", options: [
            ["柔光", "柔和漫射光，阴影边缘柔和"], ["硬光", "硬质定向光，阴影边缘清晰"], ["混合", "软硬光混合，分别保留各光源的阴影特征"],
        ] },
        { key: "fill", label: "补光", options: [
            ["无补光", "不额外补光，保留暗部"], ["弱反射补光", "以弱反射光轻微提亮暗部"], ["均匀补光", "补光使暗部细节清楚可辨"], ["负补光", "遮挡环境反射光，加深暗部"],
            ["下方反射补光", "以下方反射光轻微提亮主体底部暗面，亮度弱于主光"], ["地面反射", "以地面反射光轻微提亮暗部，亮度弱于主光"], ["墙面反射", "以墙面反射光轻微提亮暗部，亮度弱于主光"],
        ] },
        { key: "contrast", label: "反差", options: [
            ["低反差", "低反差，明暗差异较小"], ["中等反差", "中等反差，亮部暗部均保留细节"], ["高反差", "高反差，亮暗区域分明"],
        ] },
        { key: "shadow", label: "阴影", options: [
            ["清晰投影", "投射阴影边缘清晰，方向与实际光源和遮挡关系一致"], ["柔和投影", "投射阴影边缘柔和，方向与实际光源和遮挡关系一致"],
            ["窗格投影", "光穿过已有窗格，在受光表面形成分割投影；不新增窗户"], ["接触阴影", "保留物体与地面、相邻表面接触处的自然阴影"], ["暗部层次", "保留暗部明暗层次，避免统一提亮成灰色"],
        ] },
        { key: "rim", label: "轮廓光", options: [
            ["无额外轮廓光", "不额外添加轮廓光"], ["微弱轮廓光", "以弱于主光的辅助光勾勒主体边缘"],
            ["蓝色轮廓光", "以弱于主光的蓝色辅助光勾勒主体边缘"], ["左缘轮廓光", "以弱于主光的辅助光勾勒主体左侧边缘"], ["右缘轮廓光", "以弱于主光的辅助光勾勒主体右侧边缘"],
        ] },
        { key: "mood", label: "氛围", options: [
            ["宁静", "宁静平和的空间氛围，视觉节奏舒缓"], ["温馨", "温馨亲切的空间氛围"], ["清冷", "清冷疏离的空间氛围"],
            ["冰冷", "冰冷疏离的空间氛围"], ["庄严", "庄严肃穆的空间氛围"], ["神秘", "含蓄神秘的空间氛围，保留未完全揭示的细节"], ["紧张", "紧张压迫的空间氛围"],
            ["荒凉", "荒凉萧瑟的空间氛围"], ["怀旧", "朴素怀旧的空间氛围"], ["浪漫", "含蓄浪漫的空间氛围"],
            ["梦幻", "梦幻空灵的空间氛围"], ["诡异", "不安诡异的空间氛围"], ["明快", "轻盈明快的空间氛围"],
        ] },
        { key: "air", label: "空气介质", options: [
            ["通透", "空气通透，无额外雾气、烟尘"], ["薄雾", "空气中有稀薄雾气，远处轮廓仍可辨"], ["浓雾", "浓雾降低远处可见度"],
            ["轻尘", "空气中悬浮少量细小尘粒"], ["轻烟", "空气中有少量轻烟"], ["潮湿水汽", "空气中有细微潮湿水汽"],
        ] },
        { key: "color", label: "光色关系", options: [
            ["中性光色", "中性光色，保留物体固有色的辨识度"], ["暖光", "照明偏暖，保留物体固有色的辨识度"], ["冷光", "照明偏冷，保留物体固有色的辨识度"],
            ["冷蓝色", "冷蓝色照明，保留物体固有色的辨识度"], ["蓝灰色", "蓝灰色照明，保留物体固有色的辨识度"],
            ["冷蓝微暖高光", "冷蓝色环境光与微弱暖色高光形成对照，保留物体固有色的辨识度"],
            ["冷暖对照", "不同光照区域形成冷暖对照，保留物体固有色的辨识度"], ["局部彩光", "局部区域受有色光照明，其余区域保留物体固有色"],
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
            ["14mm 超广角", "14mm 全画幅等效超广角，近大远小的透视关系明显"], ["24mm 广角", "24mm 全画幅等效广角，空间纵深展开"],
            ["35mm 纪实", "35mm 全画幅等效焦段，呈现自然环境关系"], ["50mm 标准", "50mm 全画幅等效标准焦段，空间比例自然"],
            ["85mm 人像", "85mm 全画幅等效人像焦段，透视压缩适中"], ["135mm 长焦", "135mm 全画幅等效长焦，远近空间压缩明显"],
            ["200mm 超长焦", "200mm 全画幅等效超长焦，视角狭窄、空间压缩明显"], ["广角", "广角观感，近大远小的透视关系明显，空间纵深展开"],
            ["标准", "标准焦距观感，空间比例自然"], ["长焦", "长焦观感，远近空间呈压缩感"], ["鱼眼", "鱼眼镜头观感，边缘呈明显桶形弯曲"],
        ] },
        { key: "capture_device", label: "拍摄设备", options: [
            ["Super 35 数字电影摄影机", "Super 35 数字电影摄影机观感"], ["大画幅数字电影摄影机", "大画幅数字电影摄影机观感"],
            ["35mm 胶片电影摄影机", "35mm 胶片电影摄影机"], ["16mm 胶片摄影机", "16mm 胶片摄影机"],
            ["手机多摄系统", "手机多摄系统观感；焦段按全画幅等效视角描述"], ["运动相机", "运动相机观感，通常使用超广视角"],
            ["监控摄像机", "固定机位监控摄像机观感"],
        ] },
        { key: "depth_of_field", label: "景深", options: [
            ["深景深", "深景深，前中后景均清晰可辨"], ["中等景深", "中等景深，主体清楚，远处逐渐失焦"], ["浅景深", "浅景深，主体清楚，焦外区域失焦"],
        ] },
    ],
    composition: [
        { key: "frame_orientation", label: "画面倾斜", options: [
            ["水平画面", "画面水平线保持水平"], ["倾斜画面", "画面水平线倾斜，形成倾斜构图"],
        ] },
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

export function sceneCameraCompatibilityNotes(layers: ScenePromptLayers): string[] {
    const camera = layers.camera;
    if (!camera) return [];
    const notes: string[] = [];
    const focal = camera.focal_length || "";
    const framing = camera.framing || "";
    const viewpoint = camera.viewpoint || "";
    const device = camera.capture_device || "";
    const elevation = camera.angles?.elevation;
    if (/14mm|24mm|广角|鱼眼/.test(focal) && /近景|特写|细节/.test(framing)) {
        notes.push("广角或鱼眼靠近主体会强化近大远小和边缘变形；若要自然人脸比例，可退远拍摄再裁切。若要夸张透视，这种组合可以保留。");
    }
    if (/135mm|200mm|长焦/.test(focal) && /大全景|全景/.test(framing)) {
        notes.push("长焦拍大全景或全景需要较远机位与足够空间；检查场地距离，或改用较短焦段保留环境范围。");
    }
    if (/135mm|200mm|长焦/.test(focal) && /特写|细节/.test(framing)) {
        notes.push("长焦细节特写需留意最近对焦距离、机位空间和稳定性；若无法后退或需要更近对焦，考虑微距镜头或较短焦段。长焦压缩可按创作意图保留。");
    }
    if (/高机位|俯视|正俯视/.test(viewpoint) && /近景|特写|细节/.test(framing)) {
        notes.push("俯视近景会改变面部与物体的可见比例；若身份或形状辨识优先，确认俯角仍能呈现关键特征。俯拍特写本身可以是有意选择。");
    }
    if (typeof elevation === "number" && elevation >= 45 && /近景|特写|细节/.test(framing)) {
        notes.push("明显高机位近景会改变面部与物体的可见比例；若身份或形状辨识优先，确认俯角仍能呈现关键特征。俯拍特写本身可以是有意选择。");
    }
    if (/低机位|仰视/.test(viewpoint) && /14mm|24mm|广角/.test(focal)) {
        notes.push("低机位广角会加强垂直线汇聚和近处透视夸张；若建筑线条需保持端正，可改高机位/标准焦段，或明确要求透视校正。");
    }
    if (typeof elevation === "number" && elevation <= -30 && /14mm|24mm|广角/.test(focal)) {
        notes.push("明显低机位广角会加强垂直线汇聚和近处透视夸张；若建筑线条需保持端正，可明确要求透视校正。刻意夸张的透视可以保留。");
    }
    if (/背视|背面机位/.test(viewpoint) && /近景|特写|细节/.test(framing)) {
        notes.push("背视近景会遮住主体正面特征；若本镜需要确认面部身份或表情，改为侧前方机位或明确只拍后脑/背部细节。");
    }
    if (/手机/.test(device) && /85mm|135mm|200mm/.test(focal)) {
        notes.push("手机的长焦视角通常由独立长焦模组或裁切实现；这里的焦段是全画幅等效视角，不代表手机镜头的实际焦距。");
    }
    if (/运动相机/.test(device) && /85mm|135mm|200mm/.test(focal)) {
        notes.push("常见运动相机使用固定超广角；长焦要求与其默认视角不一致。若是可换镜头机型或后期裁切，请在描述中注明。");
    }
    if (/监控摄像机/.test(device) && /浅景深/.test(camera.depth_of_field || "")) {
        notes.push("固定机位监控画面通常呈现较深景深；若要浅景深效果，可注明这是刻意的电影化处理。");
    }
    if (/运动相机/.test(device) && /浅景深/.test(camera.depth_of_field || "")) {
        notes.push("常见小型运动相机偏深景深；若保留浅景深，说明使用大传感器/可换镜头机型或后期模拟。");
    }
    if (/手机/.test(device) && /浅景深/.test(camera.depth_of_field || "")) {
        notes.push("手机浅景深可能来自长焦模组或计算虚化；若需要自然遮挡边缘，可注明光学虚化优先于人像抠图效果。");
    }
    return notes;
}

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
        direction = ({ "正面来光": "front", "背面来光": "back", "左侧来光": "side", "右侧来光": "side", "左前侧来光": "side", "右前侧来光": "side", "左后侧来光": "side", "右后侧来光": "side", "顶部来光": "top", "底部来光": "bottom" } as Record<string, string>)[light.direction || ""] || "";
    }
    return Boolean(direction && forbidden.includes(direction));
}
