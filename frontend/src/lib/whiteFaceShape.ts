export type FaceShape = {
    faceLength: number;
    faceWidth: number;
    cheekWidth: number;
    jawWidth: number;
    eyeSpacing: number;
    noseProjection: number;
};

export const DEFAULT_FACE_SHAPE: FaceShape = {
    faceLength: 100, faceWidth: 100, cheekWidth: 100,
    jawWidth: 100, eyeSpacing: 100, noseProjection: 100,
};

export const FACE_SHAPE_REFERENCE_PROMPT = "白模正面和侧面是同一人的两种视角，仅约束骨相和轮廓，不作为肤色、面容身份或材质参考。";

export function faceShapePrompt(shape: FaceShape): string {
    return `${FACE_SHAPE_REFERENCE_PROMPT} 脸长 ${shape.faceLength}%，脸宽 ${shape.faceWidth}%，颧部宽 ${shape.cheekWidth}%，下颌宽 ${shape.jawWidth}%，眼距 ${shape.eyeSpacing}%，鼻部突出度 ${shape.noseProjection}%；100% 为中性基准。`;
}
