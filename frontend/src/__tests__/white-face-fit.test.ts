import { describe, expect, it } from "vitest";
import mesh from "../../public/models/character/makehuman-face-v1/head.json";
import { imageFaceMetrics, fitFaceToLandmarks, type FaceFitLandmarks } from "@/lib/whiteFaceFit";
import { DEFAULT_FACE_SHAPE, effectiveFaceShape, faceShapePrompt, type FaceShape } from "@/lib/whiteFaceShape";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";

const landmarks: FaceFitLandmarks = {
    frontLeftCheek: { x: 0.19, y: 0.16 }, frontRightCheek: { x: 0.31, y: 0.16 },
    frontLeftJaw: { x: 0.21, y: 0.21 }, frontRightJaw: { x: 0.29, y: 0.21 },
    frontLeftEye: { x: 0.22, y: 0.12 }, frontRightEye: { x: 0.28, y: 0.12 },
    frontChin: { x: 0.25, y: 0.25 }, sideEye: { x: 0.55, y: 0.12 },
    sideNose: { x: 0.51, y: 0.16 }, sideChin: { x: 0.53, y: 0.25 },
};

describe("three-view face fitting", () => {
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
