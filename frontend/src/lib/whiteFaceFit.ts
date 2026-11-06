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
export const FACE_FIT_LANDMARK_CONVENTION = "eye-center-chin-front.v2";
export type FitMetric = "cheekAspect" | "jawRatio" | "eyeRatio" | "noseProjection" | "chinProjection";
type Metrics = Record<FitMetric, number>;
export const FIT_METRIC_LABELS: Record<FitMetric, string> = {
    cheekAspect: "脸宽比例", jawRatio: "下颌比例", eyeRatio: "眼距比例",
    noseProjection: "鼻尖突出比例", chinProjection: "下巴前突比例",
};
export type FaceFitDiagnostics = {
    metrics: Array<{ key: FitMetric; target: number; actual: number; error: number }>;
    atLimits: Array<keyof FaceShapeNumbers>;
};

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
    return landmarkMetrics(points, imageAspect);
}

function landmarkMetrics(points: FaceFitLandmarks, imageAspect: number): Metrics {
    const eyeY = (points.frontLeftEye.y + points.frontRightEye.y) / 2;
    const faceHeight = points.frontChin.y - eyeY;
    const sideHeight = points.sideChin.y - points.sideEye.y;
    const cheek = points.frontRightCheek.x - points.frontLeftCheek.x;
    const jaw = points.frontRightJaw.x - points.frontLeftJaw.x;
    const eyes = points.frontRightEye.x - points.frontLeftEye.x;
    const noseOffset = points.sideNose.x - points.sideEye.x;
    if (faceHeight <= 0 || sideHeight <= 0 || cheek <= 0 || jaw <= 0 || eyes <= 0 || Math.abs(noseOffset) < 1e-6) {
        throw new Error("标记点的左右或上下顺序不正确");
    }
    return {
        cheekAspect: cheek * imageAspect / faceHeight,
        jawRatio: jaw / cheek,
        eyeRatio: eyes / cheek,
        noseProjection: Math.abs(noseOffset) * imageAspect / sideHeight,
        chinProjection: (points.sideChin.x - points.sideEye.x) * Math.sign(noseOffset) * imageAspect / sideHeight,
    };
}

// MakeHuman hm08 source vertex IDs, reviewed in front and profile projections.
// Eye centers average the inner/outer canthi, matching the image convention.
// Landmarks remain attached to these vertices throughout deformation.
export const FACE_MESH_LANDMARK_VERTICES = {
    frontLeftCheek: [269], frontRightCheek: [7038],
    frontLeftJaw: [894], frontRightJaw: [7596],
    frontLeftEye: [70, 86], frontRightEye: [6854, 6870],
    frontChin: [5225], sideEye: [6854, 6870], sideNose: [297], sideChin: [5162],
} as const;

/** Orthographic front and left-facing profile projections in mesh units. */
export function meshFaceLandmarks(shape: FaceShape, data: WhiteFaceMeshData): FaceFitLandmarks {
    const geometry = faceShellGeometry(shape, data);
    const positions = geometry.getAttribute("position");
    try {
        return Object.fromEntries(FACE_FIT_MARKS.map(([key]) => {
            const ids = FACE_MESH_LANDMARK_VERTICES[key];
            let x = 0, y = 0;
            for (const id of ids) {
                const index = data.sourceVertexIds.indexOf(id);
                if (index < 0) throw new Error(`白模缺少拟合所需的面部区域：${key}`);
                x += key.startsWith("side") ? -positions.getZ(index) : positions.getX(index);
                y -= positions.getY(index);
            }
            return [key, { x: x / ids.length, y: y / ids.length }];
        })) as FaceFitLandmarks;
    } finally {
        geometry.dispose();
    }
}

export function meshFaceMetrics(shape: FaceShape, data: WhiteFaceMeshData): Metrics {
    return landmarkMetrics(meshFaceLandmarks(shape, data), 1);
}

function metricError(key: FitMetric, predicted: number, target: number): number {
    // A chin may sit behind the eye or cross its depth. asinh remains signed
    // and finite at zero; the other four strictly positive ratios use logs.
    return key === "chinProjection"
        ? Math.asinh(predicted / 0.1) - Math.asinh(target / 0.1)
        : Math.log(Math.max(predicted, 0.001) / Math.max(target, 0.001));
}

export function faceFitDiagnostics(shape: FaceShape, data: WhiteFaceMeshData, points: FaceFitLandmarks, imageAspect = 1): FaceFitDiagnostics {
    const target = imageFaceMetrics(points, imageAspect);
    const actual = meshFaceMetrics(shape, data);
    return {
        metrics: (Object.keys(target) as FitMetric[]).map(key => ({
            key, target: target[key], actual: actual[key],
            error: metricError(key, actual[key], target[key]),
        })),
        atLimits: FIT_CONTROLS.filter(([key, min, max]) => shape[key] === min || shape[key] === max).map(([key]) => key),
    };
}

function fitError(predicted: Metrics, target: Metrics): number {
    return (Object.keys(target) as FitMetric[]).reduce((sum, key) => {
        const difference = metricError(key, predicted[key], target[key]);
        return sum + difference * difference;
    }, 0);
}

export function fitFaceToLandmarks(points: FaceFitLandmarks, data: WhiteFaceMeshData, preset: FaceBasePreset, imageAspect = 1): {
    shape: FaceShape; residual: number; diagnostics: FaceFitDiagnostics;
} {
    const target = imageFaceMetrics(points, imageAspect);
    const shape = { ...faceBaseShape(preset) };
    const score = () => fitError(meshFaceMetrics(shape, data), target);
    let best = score();
    for (const step of [16, 8, 4, 2, 1]) {
        for (let pass = 0; pass < 12; pass++) {
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
    return { shape, residual: Math.sqrt(best / 5), diagnostics: faceFitDiagnostics(shape, data, points, imageAspect) };
}
