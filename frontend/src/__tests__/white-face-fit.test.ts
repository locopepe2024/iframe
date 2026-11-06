import { describe, expect, it } from "vitest";
import mesh from "../../public/models/character/makehuman-face-v1/head.json";
import { imageFaceMetrics, fitFaceToLandmarks, meshFaceLandmarks, meshFaceMetrics, isHeightMetric, type FaceFitLandmarks } from "@/lib/whiteFaceFit";
import { DEFAULT_FACE_SHAPE, effectiveFaceShape, faceShapePrompt, normalizeFaceShape, type FaceShape } from "@/lib/whiteFaceShape";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";

const landmarks: FaceFitLandmarks = {
    frontLeftCheek: { x: 0.19, y: 0.16 }, frontRightCheek: { x: 0.31, y: 0.16 },
    frontLeftJaw: { x: 0.21, y: 0.21 }, frontRightJaw: { x: 0.29, y: 0.21 },
    frontLeftEye: { x: 0.22, y: 0.12 }, frontRightEye: { x: 0.28, y: 0.12 },
    frontChin: { x: 0.25, y: 0.25 }, sideEye: { x: 0.55, y: 0.12 },
    sideNose: { x: 0.51, y: 0.16 }, sideChin: { x: 0.53, y: 0.25 },
};

describe("three-view face fitting", () => {
    it("turns bone controls into explicit anatomical changes with baseline values", () => {
        const prompt = faceShapePrompt({ ...DEFAULT_FACE_SHAPE, faceLength: 90, faceWidth: 120,
            eyeSpacing: 80, cheekWidth: 117, jawWidth: 75, noseProjection: 75 });
        for (const phrase of ["脸部纵向轮廓缩短", "面部横向宽度加宽", "眼距收窄",
            "颧部横向加宽", "下颌横向收窄", "鼻尖突出度减弱"]) expect(prompt).toContain(phrase);
        expect(prompt).toContain("中性基准100%");
        expect(prompt).not.toContain("脸长 90%（中性基准 100%）");
        expect(prompt).toContain("参考图用于保持目标角色身份、发型和肤色");
        expect(prompt).toContain("骨相要求优先于参考图中的原始轮廓比例");
    });
    it("preserves exact calibrated controls, including small edits and every control group, in prompts", () => {
        const calibration = { schema: "iframe.white-face-fit.v1" as const,
            source: { asset_type: "character" as const, asset_id: "su-yan", variant_id: "sheet" },
            baseline: { ...DEFAULT_FACE_SHAPE }, landmarks, residual: 0, reviewed: true };
        const shape = { ...DEFAULT_FACE_SHAPE, calibration, noseBridgeHeight: 105,
            noseBridgeWidth: 110, noseTipWidth: 102, foreheadWidth: 101, chinWidth: 99,
            eyeTilt: 103, browEyeDistance: 97, philtrumLength: 101, mouthCornerTilt: 98 };
        const prompt = faceShapePrompt(shape);
        for (const value of ["鼻梁高度调节值105%", "鼻梁宽度调节值110%", "鼻尖宽度调节值102%",
            "额头宽度调节值101%", "下巴宽度调节值99%", "眼尾倾斜调节值103%", "眉眼距离调节值97%",
            "人中长度调节值101%", "嘴角倾斜调节值98%"]) expect(prompt).toContain(value);
        expect(prompt).toContain("拟合基准100%");
        expect(prompt).not.toContain("略增");
        expect(faceShapePrompt({ ...shape, noseBridgeHeight: 110 })).not.toEqual(prompt);
        expect(faceShapePrompt({ ...DEFAULT_FACE_SHAPE, calibration })).not.toContain("骨相调节");
    });
    it("measures and fits independent original images with different aspect ratios and scales", () => {
        const known = { ...DEFAULT_FACE_SHAPE, cheekWidth: 94, cheekHeight: 114, noseTipHeight: 90 };
        const projected = meshFaceLandmarks(known, mesh as WhiteFaceMeshData);
        const aspects = { front: 1, side: .6 };
        const points = Object.fromEntries(Object.entries(projected).map(([key, p]) => {
            const side = key.startsWith("side"), scale = side ? .2 : .3;
            return [key, { x: (side ? .7 : .5) + p.x * scale / (side ? aspects.side : aspects.front), y: .3 + p.y * scale }];
        })) as FaceFitLandmarks;
        const actual = imageFaceMetrics(points, aspects), expected = meshFaceMetrics(known, mesh as WhiteFaceMeshData);
        for (const key of Object.keys(expected) as Array<keyof typeof expected>) expect(actual[key]).toBeCloseTo(expected[key], 12);
        const fitted = fitFaceToLandmarks(points, mesh as WhiteFaceMeshData, "neutral_young", aspects);
        expect(fitted.residual).toBeLessThan(.01);
        expect(fitted.shape.cheekHeight).toBeGreaterThan(100);
        expect(() => imageFaceMetrics(points, { front: 0, side: .6 })).toThrow("尺寸无效");
        expect(() => imageFaceMetrics(points, { front: 1, side: NaN })).toThrow("尺寸无效");
    });
    it("preserves chin depth and metrics when a profile is mirrored", () => {
        const recessed = { ...landmarks, sideChin: { x: .57, y: .25 } };
        const mirrored = Object.fromEntries(Object.entries(recessed).map(([key, point]) => [key,
            key.startsWith("side") ? { ...point, x: 1 - point.x } : point,
        ])) as FaceFitLandmarks;
        expect(imageFaceMetrics(recessed).chinProjection).toBeLessThan(0);
        expect(imageFaceMetrics(landmarks).chinProjection).toBeGreaterThan(0);
        expect(imageFaceMetrics(mirrored)).toEqual(imageFaceMetrics(recessed));
        const aligned = { ...landmarks, sideChin: { x: landmarks.sideEye.x, y: .25 } };
        expect(Number.isFinite(fitFaceToLandmarks(aligned, mesh as WhiteFaceMeshData, "neutral_young").residual)).toBe(true);
    });

    it("recovers proportions from a deformed mesh at a non-square image aspect", () => {
        const known = { ...DEFAULT_FACE_SHAPE, cheekWidth: 92, jawWidth: 90, eyeSpacing: 88, noseProjection: 110, chinProjection: 109 };
        const projected = meshFaceLandmarks(known, mesh as WhiteFaceMeshData);
        const aspect = 1.7;
        const points = Object.fromEntries(Object.entries(projected).map(([key, point]) => [key, {
            x: (key.startsWith("side") ? .65 : .25) + point.x * .15 / aspect,
            y: .25 + point.y * .15,
        }])) as FaceFitLandmarks;
        const result = fitFaceToLandmarks(points, mesh as WhiteFaceMeshData, "neutral_young", aspect);
        const actual = meshFaceMetrics(result.shape, mesh as WhiteFaceMeshData);
        const target = imageFaceMetrics(points, aspect);
        expect(result.residual).toBeLessThan(.01);
        for (const key of Object.keys(target) as Array<keyof typeof target>) {
            expect(Math.abs(isHeightMetric(key) ? actual[key] - target[key] : actual[key] / target[key] - 1)).toBeLessThan(.02);
        }
        expect(result.diagnostics.atLimits).toEqual([]);
    });

    it("recovers landmark heights that width and projection ratios cannot constrain", () => {
        const known = { ...DEFAULT_FACE_SHAPE, cheekHeight: 114, jawHeight: 108, noseTipHeight: 87 };
        const projected = meshFaceLandmarks(known, mesh as WhiteFaceMeshData);
        const aspect = 2.3;
        const points = Object.fromEntries(Object.entries(projected).map(([key, point]) => [key, {
            x: (key.startsWith("side") ? .68 : .25) + point.x * .17 / aspect,
            y: .3 + point.y * .17,
        }])) as FaceFitLandmarks;
        const target = imageFaceMetrics(points, aspect);
        const before = meshFaceMetrics(DEFAULT_FACE_SHAPE, mesh as WhiteFaceMeshData);
        expect(Math.abs(before.cheekHeight - target.cheekHeight)).toBeGreaterThan(.06);
        expect(Math.abs(before.jawHeight - target.jawHeight)).toBeGreaterThan(.03);
        expect(Math.abs(before.noseTipHeight - target.noseTipHeight)).toBeGreaterThan(.05);
        const result = fitFaceToLandmarks(points, mesh as WhiteFaceMeshData, "neutral_young", aspect);
        const after = meshFaceMetrics(result.shape, mesh as WhiteFaceMeshData);
        for (const key of Object.keys(target) as Array<keyof typeof target>) {
            expect(Math.abs(isHeightMetric(key) ? after[key] - target[key] : after[key] / target[key] - 1)).toBeLessThan(.02);
        }
        expect(result.shape.cheekHeight).toBeGreaterThan(100);
        expect(result.shape.jawHeight).toBeGreaterThan(100);
        expect(result.shape.noseTipHeight).toBeLessThan(100);
        expect(result.diagnostics.atLimits).toEqual([]);
    });

    it("keeps signed and zero landmark heights finite", () => {
        const points = { ...landmarks, frontLeftCheek: { ...landmarks.frontLeftCheek, y: .1 },
            frontRightCheek: { ...landmarks.frontRightCheek, y: .1 }, sideNose: { ...landmarks.sideNose, y: .12 } };
        const metrics = imageFaceMetrics(points, 1.6);
        expect(metrics.cheekHeight).toBeLessThan(0);
        expect(metrics.noseTipHeight).toBe(0);
        const result = fitFaceToLandmarks(points, mesh as WhiteFaceMeshData, "neutral_young", 1.6);
        expect(Number.isFinite(result.residual)).toBe(true);
        expect(result.diagnostics.metrics.every(metric => Number.isFinite(metric.error))).toBe(true);
    });

    it("preserves legacy calibrated geometry when height controls are absent", () => {
        const { basePreset, cheekHeight: ignoredCheek, jawHeight: ignoredJaw, noseTipHeight: ignoredNose, ...baseline } = DEFAULT_FACE_SHAPE;
        void ignoredCheek; void ignoredJaw; void ignoredNose;
        const legacy = normalizeFaceShape({ ...baseline, basePreset, calibration: {
            schema: "iframe.white-face-fit.v1" as const, baseline: { ...baseline, cheekWidth: 112 },
            source: { asset_type: "character" as const, asset_id: "su-yan", variant_id: "old" },
            landmarks, residual: .1,
        } });
        expect(effectiveFaceShape(legacy)).toMatchObject({ cheekHeight: 100, jawHeight: 100, noseTipHeight: 100, cheekWidth: 112 });
        const oldGeometry = faceShellGeometry(legacy, mesh as WhiteFaceMeshData);
        const expected = faceShellGeometry({ ...DEFAULT_FACE_SHAPE, cheekWidth: 112 }, mesh as WhiteFaceMeshData);
        expect(Array.from(oldGeometry.getAttribute("position").array)).toEqual(Array.from(expected.getAttribute("position").array));
        oldGeometry.dispose(); expected.dispose();
    });

    it("raises fixed front regions symmetrically while leaving the back of the head unchanged", () => {
        const original = meshFaceLandmarks(DEFAULT_FACE_SHAPE, mesh as WhiteFaceMeshData);
        const raisedShape = { ...DEFAULT_FACE_SHAPE, cheekHeight: 120, jawHeight: 115, noseTipHeight: 110 };
        const raised = meshFaceLandmarks(raisedShape, mesh as WhiteFaceMeshData);
        expect(raised.frontLeftCheek.y).toBeLessThan(original.frontLeftCheek.y);
        expect(raised.frontRightCheek.y).toBe(raised.frontLeftCheek.y);
        expect(raised.frontLeftJaw.y).toBeLessThan(original.frontLeftJaw.y);
        expect(raised.sideNose.y).toBeLessThan(original.sideNose.y);
        const geometry = faceShellGeometry(raisedShape, mesh as WhiteFaceMeshData);
        const positions = geometry.getAttribute("position");
        const source = mesh as WhiteFaceMeshData;
        for (let i = 0; i < source.sourceVertexIds.length; i++) {
            if (source.positions[i * 3 + 2] < -.05) {
                expect(positions.getY(i)).toBe(Math.fround(source.positions[i * 3 + 1]));
            }
        }
        geometry.dispose();
    });

    it("rejects missing or reversed face landmarks", () => {
        expect(() => imageFaceMetrics({ ...landmarks, frontLeftCheek: { x: 0.4, y: 0.16 } })).toThrow("顺序");
        expect(() => imageFaceMetrics({ ...landmarks, sideNose: { x: 1.2, y: 0.16 } })).toThrow("无效");
    });

    it("fits finite mesh parameters and treats the frozen geometry as 100%", () => {
        const result = fitFaceToLandmarks(landmarks, mesh as WhiteFaceMeshData, "masculine_young", 1223 / 1286);
        expect(result.residual).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(result.residual)).toBe(true);
        const { basePreset, calibration: ignored, ...baseline } = result.shape;
        void ignored;
        const fitted: FaceShape = { ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
            schema: "iframe.white-face-fit.v1", source: { asset_type: "character", asset_id: "su-yan", variant_id: "three-view-1" },
            baseline, landmarks, residual: result.residual, reviewed: true,
        } };
        expect(effectiveFaceShape(fitted).cheekWidth).toBe(baseline.cheekWidth);
        const referenceGeometry = faceShellGeometry(result.shape, mesh as WhiteFaceMeshData);
        const fittedGeometry = faceShellGeometry(fitted, mesh as WhiteFaceMeshData);
        expect(Array.from(fittedGeometry.getAttribute("position").array)).toEqual(Array.from(referenceGeometry.getAttribute("position").array));
        expect(faceShapePrompt(fitted)).not.toContain("100% 为中性基准");
        referenceGeometry.dispose(); fittedGeometry.dispose();
    });

    it("moves the cheek control toward a wider marked face", () => {
        const narrow = fitFaceToLandmarks(landmarks, mesh as WhiteFaceMeshData, "masculine_young", 1223 / 1286);
        const wide = fitFaceToLandmarks({ ...landmarks,
            frontLeftCheek: { x: 0.15, y: 0.16 }, frontRightCheek: { x: 0.35, y: 0.16 },
        }, mesh as WhiteFaceMeshData, "masculine_young", 1223 / 1286);
        expect(wide.shape.cheekWidth).toBeGreaterThan(narrow.shape.cheekWidth);
    });
});
