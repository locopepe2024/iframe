export type FaceShape = {
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

export const DEFAULT_FACE_SHAPE: FaceShape = {
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
    return { ...DEFAULT_FACE_SHAPE, ...(shape || {}) };
}

export function faceShapePrompt(shape: FaceShape): string {
    const value = normalizeFaceShape(shape);
    return `${FACE_SHAPE_REFERENCE_PROMPT} 头部轮廓：脸长 ${value.faceLength}%，脸宽 ${value.faceWidth}%，额头宽 ${value.foreheadWidth}%，颧部宽 ${value.cheekWidth}%，下颌宽 ${value.jawWidth}%，下巴宽 ${value.chinWidth}%，下巴前突 ${value.chinProjection}%；鼻部：鼻梁高度 ${value.noseBridgeHeight}%，鼻梁宽度 ${value.noseBridgeWidth}%，鼻尖突出度 ${value.noseProjection}%，鼻尖宽度 ${value.noseTipWidth}%，鼻翼宽度 ${value.nostrilWidth}%；眼眉：眼距 ${value.eyeSpacing}%，眼睛大小 ${value.eyeSize}%，眼窝深度 ${value.eyeDepth}%，眼尾倾斜 ${value.eyeTilt}%，眉眼距离 ${value.browEyeDistance}%；嘴唇：嘴宽 ${value.mouthWidth}%，上唇厚度 ${value.upperLipThickness}%，下唇厚度 ${value.lowerLipThickness}%，人中长度 ${value.philtrumLength}%，嘴角倾斜 ${value.mouthCornerTilt}%；100% 为中性基准。`;
}
