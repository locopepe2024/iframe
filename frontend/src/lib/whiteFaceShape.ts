import { measureFaceTargets, faceMeasurementTargetText } from "./whiteFaceMeasurements";
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

export function faceShapeMeasurements(shape: FaceShape) {
    const value = normalizeFaceShape(shape);
    const baseline = value.calibration
        ? { ...DEFAULT_FACE_SHAPE, basePreset: value.basePreset, calibration: value.calibration }
        : faceBaseShape(value.basePreset);
    return measureFaceTargets(effectiveFaceShape(baseline), effectiveFaceShape(value));
}

export function faceShapePrompt(shape: FaceShape): string {
    const changes = faceShapeMeasurements(shape).filter(item => item.target !== item.baseline);
    return [
        changes.length ? "骨相测量目标：每项距离分别把参考图中的同一测量区间记为100；目标值表示该距离相对于参考图的比例。正面项目用正面视角，侧面项目用侧面视角测量。" : "骨相基准：沿用角色设定中的面部轮廓与五官关系。",
        ...changes.map(item => `${item.label}：${item.view}，${item.definition}；${faceMeasurementTargetText(item)}。`),
        changes.length ? "上述骨相要求优先于参考图中的原始轮廓比例；参考图用于保持目标角色身份、发型和肤色。" : "",
        FACE_SHAPE_REFERENCE_PROMPT,
    ].filter(Boolean).join("\n");
}

// The panel and AI paths must describe the same measured targets.
export const faceShapePanelPrompt = faceShapePrompt;
