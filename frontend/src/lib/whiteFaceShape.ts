export type FaceShape = {
    basePreset: FaceBasePreset;
    faceLength: number;
    faceWidth: number;
    cheekWidth: number;
    jawWidth: number;
    eyeSpacing: number;
    noseProjection: number;
    foreheadWidth: number;
    chinWidth: number;
    chinProjection: number;
    noseBridgeHeight: number;
    noseBridgeWidth: number;
    noseTipWidth: number;
    nostrilWidth: number;
    eyeSize: number;
    eyeDepth: number;
    eyeTilt: number;
    browEyeDistance: number;
    mouthWidth: number;
    upperLipThickness: number;
    lowerLipThickness: number;
    philtrumLength: number;
    mouthCornerTilt: number;
};

export type FaceBasePreset = "neutral_young" | "older" | "child" | "masculine_young" | "feminine_young" | "middle_aged";

export const SELECTABLE_FACE_PRESETS: FaceBasePreset[] = [
    "neutral_young", "older", "child", "masculine_young", "feminine_young",
];

export const FACE_BASE_PRESETS: Record<FaceBasePreset, { label: string; values: Partial<FaceShape> }> = {
    neutral_young: { label: "中性青年", values: {} },
    older: { label: "老年", values: { faceLength: 104, faceWidth: 106, foreheadWidth: 96, cheekWidth: 102, jawWidth: 98, chinWidth: 94, eyeSize: 92, eyeDepth: 112, browEyeDistance: 108, mouthCornerTilt: 96, philtrumLength: 110 } },
    child: { label: "儿童", values: { faceLength: 88, faceWidth: 104, foreheadWidth: 108, cheekWidth: 102, jawWidth: 84, chinWidth: 86, chinProjection: 90, noseBridgeHeight: 88, noseBridgeWidth: 94, noseProjection: 86, noseTipWidth: 92, eyeSize: 112, browEyeDistance: 104, mouthWidth: 92, philtrumLength: 90 } },
    masculine_young: { label: "男性", values: { faceWidth: 106, cheekWidth: 108, jawWidth: 112, chinWidth: 106, noseBridgeWidth: 106, noseProjection: 106, browEyeDistance: 96 } },
    feminine_young: { label: "女性", values: { faceLength: 98, faceWidth: 96, foreheadWidth: 104, cheekWidth: 96, jawWidth: 88, chinWidth: 92, eyeSize: 106, noseProjection: 94, mouthWidth: 96 } },
    middle_aged: { label: "中年", values: { faceLength: 102, faceWidth: 104, jawWidth: 104, chinProjection: 104, eyeSize: 96, eyeDepth: 108, browEyeDistance: 104, philtrumLength: 106 } },
};

export const DEFAULT_FACE_SHAPE: FaceShape = {
    basePreset: "neutral_young",
    faceLength: 100, faceWidth: 100, cheekWidth: 100,
    jawWidth: 100, eyeSpacing: 100, noseProjection: 100,
    foreheadWidth: 100, chinWidth: 100, chinProjection: 100,
    noseBridgeHeight: 100, noseBridgeWidth: 100, noseTipWidth: 100, nostrilWidth: 100,
    eyeSize: 100, eyeDepth: 100, eyeTilt: 100, browEyeDistance: 100,
    mouthWidth: 100, upperLipThickness: 100, lowerLipThickness: 100,
    philtrumLength: 100, mouthCornerTilt: 100,
};

export const FACE_SHAPE_REFERENCE_PROMPT = "面部比例参数仅约束目标角色的骨相和轮廓，不作为肤色、面容身份或材质参考；最终画面只呈现目标角色，不呈现白模、参考图或对照视图。";

export function normalizeFaceShape(shape?: Partial<FaceShape> | null): FaceShape {
    const merged = { ...DEFAULT_FACE_SHAPE, ...(shape || {}) };
    if (!FACE_BASE_PRESETS[merged.basePreset]) merged.basePreset = DEFAULT_FACE_SHAPE.basePreset;
    return merged;
}

export function faceBaseShape(preset: FaceBasePreset): FaceShape {
    return { ...DEFAULT_FACE_SHAPE, ...FACE_BASE_PRESETS[preset].values, basePreset: preset };
}

export function faceShapePrompt(shape: FaceShape): string {
    const value = normalizeFaceShape(shape);
    return `${FACE_SHAPE_REFERENCE_PROMPT} 基础脸型：${FACE_BASE_PRESETS[value.basePreset]?.label || FACE_BASE_PRESETS.neutral_young.label}；头部轮廓：脸长 ${value.faceLength}%，脸宽 ${value.faceWidth}%，额头宽 ${value.foreheadWidth}%，颧部宽 ${value.cheekWidth}%，下颌宽 ${value.jawWidth}%，下巴宽 ${value.chinWidth}%，下巴前突 ${value.chinProjection}%；鼻部：鼻梁高度 ${value.noseBridgeHeight}%，鼻梁宽度 ${value.noseBridgeWidth}%，鼻尖突出度 ${value.noseProjection}%，鼻尖宽度 ${value.noseTipWidth}%，鼻翼宽度 ${value.nostrilWidth}%；眼眉：眼距 ${value.eyeSpacing}%，眼睛大小 ${value.eyeSize}%，眼窝深度 ${value.eyeDepth}%，眼尾倾斜 ${value.eyeTilt}%，眉眼距离 ${value.browEyeDistance}%；嘴唇：嘴宽 ${value.mouthWidth}%，上唇厚度 ${value.upperLipThickness}%，下唇厚度 ${value.lowerLipThickness}%，人中长度 ${value.philtrumLength}%，嘴角倾斜 ${value.mouthCornerTilt}%；100% 为中性基准。`;
}

export function faceShapePanelPrompt(shape: FaceShape): string {
    const value = normalizeFaceShape(shape);
    const details: Array<[keyof FaceShape, string]> = [
        ["foreheadWidth", "额头宽"], ["chinWidth", "下巴宽"], ["chinProjection", "下巴前突"],
        ["noseBridgeHeight", "鼻梁高度"], ["noseBridgeWidth", "鼻梁宽度"],
        ["noseTipWidth", "鼻尖宽度"], ["nostrilWidth", "鼻翼宽度"],
        ["eyeSize", "眼睛大小"], ["eyeDepth", "眼窝深度"], ["eyeTilt", "眼尾倾斜"],
        ["browEyeDistance", "眉眼距离"], ["mouthWidth", "嘴宽"],
        ["upperLipThickness", "上唇厚度"], ["lowerLipThickness", "下唇厚度"],
        ["philtrumLength", "人中长度"], ["mouthCornerTilt", "嘴角倾斜"],
    ];
    const changed = details.filter(([key]) => value[key] !== 100)
        .map(([key, label]) => `${label} ${value[key]}%`);
    return [FACE_SHAPE_REFERENCE_PROMPT, changed.length ? `补充骨相参数：${changed.join("，")}；100% 为中性基准。` : ""].filter(Boolean).join(" ");
}
