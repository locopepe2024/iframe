import { faceShellGeometry, type WhiteFaceMeshData } from "./whiteFaceMesh";
import { faceBaseShape, type FaceBasePreset, type FaceShape, type FaceShapeNumbers } from "./whiteFaceShape";

export const FACE_FIT_MARKS = [
    ["frontLeftCheek", "正面画面左颧部"], ["frontRightCheek", "正面画面右颧部"],
    ["frontLeftJaw", "正面画面左下颌"], ["frontRightJaw", "正面画面右下颌"],
    ["frontLeftEye", "正面画面左眼中心"], ["frontRightEye", "正面画面右眼中心"],
    ["frontChin", "正面下巴最低点"], ["sideEye", "侧面眼中心"],
    ["sideNose", "侧面鼻尖"], ["sideChin", "侧面下巴前端"],
] as const;

export type FaceFitMark = typeof FACE_FIT_MARKS[number][0];
export type FaceFitPoint = { x: number; y: number };
export type FaceFitLandmarks = Record<FaceFitMark, FaceFitPoint>;
type FitMetric = "cheekAspect" | "jawRatio" | "eyeRatio" | "noseProjection" | "chinProjection";
type Metrics = Record<FitMetric, number>;

const FIT_CONTROLS: Array<[keyof FaceShapeNumbers, number, number]> = [
    ["cheekWidth", 80, 120], ["jawWidth", 75, 125],
    ["eyeSpacing", 80, 120], ["noseProjection", 75, 125], ["chinProjection", 75, 125],
];

export function imageFaceMetrics(points: FaceFitLandmarks, imageAspect = 1): Metrics {
    if (!Number.isFinite(imageAspect) || imageAspect <= 0) throw new Error("参考图尺寸无效");
    for (const [key] of FACE_FIT_MARKS) {
        const point = points[key];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
            || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
            throw new Error(`面部标记点无效：${key}`);
        }
    }
    const eyeY = (points.frontLeftEye.y + points.frontRightEye.y) / 2;
    const faceHeight = points.frontChin.y - eyeY;
    const sideHeight = points.sideChin.y - points.sideEye.y;
    const cheek = points.frontRightCheek.x - points.frontLeftCheek.x;
    const jaw = points.frontRightJaw.x - points.frontLeftJaw.x;
    const eyes = points.frontRightEye.x - points.frontLeftEye.x;
    if (faceHeight <= 0.015 || sideHeight <= 0.015 || cheek <= 0.015 || jaw <= 0 || eyes <= 0) {
        throw new Error("标记点的左右或上下顺序不正确");
    }
    return {
        cheekAspect: cheek * imageAspect / faceHeight,
        jawRatio: jaw / cheek,
        eyeRatio: eyes / cheek,
        noseProjection: Math.abs(points.sideNose.x - points.sideEye.x) * imageAspect / sideHeight,
        chinProjection: Math.abs(points.sideChin.x - points.sideEye.x) * imageAspect / sideHeight,
    };
}

function meshFaceMetrics(shape: FaceShape, data: WhiteFaceMeshData): Metrics {
    const geometry = faceShellGeometry(shape, data);
    const positions = geometry.getAttribute("position");
    let cheek = 0, jaw = 0, eyeX = 0, eyeDistance = Infinity;
    let eyeZ = 0, noseZ = -Infinity, chinZ = -Infinity, chinY = Infinity;
    for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
        if (z > 0.05 && y > -0.32 && y < -0.12) cheek = Math.max(cheek, Math.abs(x));
        if (z > 0.05 && y > -0.65 && y < -0.47) jaw = Math.max(jaw, Math.abs(x));
        if (z > 0.1 && x > 0 && Math.abs(y + 0.02) < 0.09) {
            const distance = Math.abs(x - 0.28) + Math.abs(y + 0.02) + Math.max(0, 0.45 - z);
            if (distance < eyeDistance) { eyeDistance = distance; eyeX = x; eyeZ = z; }
        }
        if (Math.abs(x) < 0.14 && y > -0.4 && y < -0.18) noseZ = Math.max(noseZ, z);
        if (Math.abs(x) < 0.16 && y > -0.84 && y < -0.67) {
            chinZ = Math.max(chinZ, z);
            chinY = Math.min(chinY, y);
        }
    }
    geometry.dispose();
    const eyeChinHeight = -0.02 - chinY;
    if (!cheek || !jaw || !eyeX || !Number.isFinite(noseZ) || !Number.isFinite(chinZ) || eyeChinHeight <= 0) {
        throw new Error("白模缺少拟合所需的面部区域");
    }
    return {
        cheekAspect: 2 * cheek / eyeChinHeight,
        jawRatio: jaw / cheek,
        eyeRatio: eyeX / cheek,
        noseProjection: Math.abs(noseZ - eyeZ) / eyeChinHeight,
        chinProjection: Math.abs(chinZ - eyeZ) / eyeChinHeight,
    };
}

function fitError(predicted: Metrics, target: Metrics): number {
    return (Object.keys(target) as FitMetric[]).reduce((sum, key) => {
        const difference = Math.log(Math.max(predicted[key], 0.001) / Math.max(target[key], 0.001));
        return sum + difference * difference;
    }, 0);
}

export function fitFaceToLandmarks(points: FaceFitLandmarks, data: WhiteFaceMeshData, preset: FaceBasePreset, imageAspect = 1): {
    shape: FaceShape; residual: number;
} {
    const target = imageFaceMetrics(points, imageAspect);
    const original = faceBaseShape(preset);
    const shape = { ...original };
    const score = () => fitError(meshFaceMetrics(shape, data), target);
    let best = score();
    for (const step of [16, 8, 4, 2, 1]) {
        for (let pass = 0; pass < 3; pass++) {
            let improved = false;
            for (const [key, minimum, maximum] of FIT_CONTROLS) {
                const previous = shape[key];
                let candidateValue = previous;
                for (const direction of [-1, 1]) {
                    const next = Math.max(minimum, Math.min(maximum, previous + direction * step));
                    if (next === previous) continue;
                    shape[key] = next;
                    const candidate = score();
                    if (candidate < best) { best = candidate; candidateValue = next; improved = true; }
                }
                shape[key] = candidateValue;
            }
            if (!improved) break;
        }
    }
    return { shape, residual: Math.sqrt(best / 5) };
}
