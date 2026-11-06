import type { FaceFitDiagnostics } from "./whiteFaceFit";
import type { FaceImagePreparation, FrontFaceReference } from "./whiteFaceImage";

export type FaceHeightControls = {
    cheekHeight: number;
    jawHeight: number;
    noseTipHeight: number;
};

export type FaceShapeNumbers = FaceHeightControls & {
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

export type FaceShapeCalibration = {
    schema: "iframe.white-face-fit.v1";
    source: { asset_type: "character"; asset_id: string; variant_id: string; source_scope?: "series" | "project"; source_container_id?: string };
    baseline: Omit<FaceShapeNumbers, keyof FaceHeightControls> & Partial<FaceHeightControls>;
    landmarks: Record<string, { x: number; y: number }>;
    residual: number;
    reviewed?: boolean;
    landmarkConvention?: "eye-center-chin-front.v2";
    fitObjective?: "ratios-and-heights.v1";
    fitDiagnostics?: FaceFitDiagnostics;
    imagePreparation?: FaceImagePreparation;
    frontReference?: FrontFaceReference;
};

export type FaceShape = FaceShapeNumbers & {
    basePreset: FaceBasePreset;
    calibration?: FaceShapeCalibration;
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
    cheekHeight: 100, jawHeight: 100, noseTipHeight: 100,
    faceLength: 100, faceWidth: 100, cheekWidth: 100,
    jawWidth: 100, eyeSpacing: 100, noseProjection: 100,
    foreheadWidth: 100, chinWidth: 100, chinProjection: 100,
    noseBridgeHeight: 100, noseBridgeWidth: 100, noseTipWidth: 100, nostrilWidth: 100,
    eyeSize: 100, eyeDepth: 100, eyeTilt: 100, browEyeDistance: 100,
    mouthWidth: 100, upperLipThickness: 100, lowerLipThickness: 100,
    philtrumLength: 100, mouthCornerTilt: 100,
};

export const FACE_SHAPE_REFERENCE_PROMPT = "画面限制：最终画面只呈现目标角色，不呈现白模、参考图或对照视图。";

export function normalizeFaceShape(shape?: Partial<FaceShape> | null): FaceShape {
    const merged = { ...DEFAULT_FACE_SHAPE, ...(shape || {}) };
    if (!FACE_BASE_PRESETS[merged.basePreset]) merged.basePreset = DEFAULT_FACE_SHAPE.basePreset;
    return merged;
}

export function effectiveFaceShape(shape: FaceShape): FaceShape {
    const value = normalizeFaceShape(shape);
    if (!value.calibration) return value;
    const effective = { ...value };
    // Baselines saved before height controls were introduced retain neutral y deformation.
    const baseline = { cheekHeight: 100, jawHeight: 100, noseTipHeight: 100, ...value.calibration.baseline };
    for (const key of Object.keys(DEFAULT_FACE_SHAPE) as Array<keyof FaceShape>) {
        if (key === "basePreset" || key === "calibration") continue;
        const numericKey = key as keyof FaceShapeNumbers;
        effective[numericKey] = baseline[numericKey] * value[numericKey] / 100;
    }
    delete effective.calibration;
    return effective;
}

export function faceBaseShape(preset: FaceBasePreset): FaceShape {
    return { ...DEFAULT_FACE_SHAPE, ...FACE_BASE_PRESETS[preset].values, basePreset: preset };
}

const FACE_PROMPT_CONTROLS: Array<[keyof FaceShapeNumbers, string, string, string]> = [
    ["faceLength", "脸部长度", "脸部纵向轮廓拉长", "脸部纵向轮廓缩短"],
    ["faceWidth", "脸部宽度", "面部横向宽度加宽", "面部横向宽度收窄"],
    ["foreheadWidth", "额头宽度", "额头横向加宽", "额头横向收窄"],
    ["cheekWidth", "颧部宽度", "颧部横向加宽", "颧部横向收窄"],
    ["cheekHeight", "颧部高度", "颧部位置上移", "颧部位置下移"],
    ["jawWidth", "下颌宽度", "下颌横向加宽", "下颌横向收窄"],
    ["jawHeight", "下颌高度", "下颌位置上移", "下颌位置下移"],
    ["chinWidth", "下巴宽度", "下巴加宽", "下巴收窄"],
    ["chinProjection", "下巴前突", "下巴前突增强", "下巴前突减弱"],
    ["noseBridgeHeight", "鼻梁高度", "鼻梁向前隆起增加", "鼻梁向前隆起减少"],
    ["noseBridgeWidth", "鼻梁宽度", "鼻梁加宽", "鼻梁收窄"],
    ["noseProjection", "鼻尖突出度", "鼻尖突出度增强", "鼻尖突出度减弱"],
    ["noseTipHeight", "鼻尖高度", "鼻尖位置上移", "鼻尖位置下移"],
    ["noseTipWidth", "鼻尖宽度", "鼻尖加宽", "鼻尖收窄"],
    ["nostrilWidth", "鼻翼宽度", "鼻翼加宽", "鼻翼收窄"],
    ["eyeSpacing", "眼距", "眼距加宽", "眼距收窄"],
    ["eyeSize", "眼睛大小", "眼睛增大", "眼睛缩小"],
    ["eyeDepth", "眼窝深度", "眼窝加深", "眼窝变浅"],
    ["eyeTilt", "眼尾倾斜", "眼尾倾斜程度增加", "眼尾倾斜程度减少"],
    ["browEyeDistance", "眉眼距离", "眉眼距离增加", "眉眼距离减少"],
    ["mouthWidth", "嘴宽", "嘴部横向加宽", "嘴部横向收窄"],
    ["upperLipThickness", "上唇厚度", "上唇增厚", "上唇变薄"],
    ["lowerLipThickness", "下唇厚度", "下唇增厚", "下唇变薄"],
    ["philtrumLength", "人中长度", "人中拉长", "人中缩短"],
    ["mouthCornerTilt", "嘴角倾斜", "嘴角上提", "嘴角下移"],
];

export function faceShapePrompt(shape: FaceShape): string {
    const value = normalizeFaceShape(shape);
    const changes = FACE_PROMPT_CONTROLS.filter(([key]) => value[key] !== 100)
        .map(([key, label, more, less]) => `${value[key] > 100 ? more : less}（${label}调节值${value[key]}%）`);
    const baseline = value.calibration ? "拟合基准100%" : "中性基准100%";
    return [
        changes.length ? `骨相调整：\n${changes.join("；\n")}。` : "",
        !changes.length ? "骨相基准：沿用角色设定中的面部轮廓与五官关系。" : "",
        changes.length ? `调节基准：${baseline}；数值是白模变形控制值，不是参考图实际面部尺寸的百分比。` : "",
        changes.length ? "上述骨相要求优先于参考图中的原始轮廓比例；参考图用于保持目标角色身份、发型和肤色。" : "",
        FACE_SHAPE_REFERENCE_PROMPT,
    ].filter(Boolean).join("\n");
}

// The panel and AI paths must describe the same geometry without relying on legacy identity fields.
export const faceShapePanelPrompt = faceShapePrompt;
