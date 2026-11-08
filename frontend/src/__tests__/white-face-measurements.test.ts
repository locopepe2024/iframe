import { expect, it } from "vitest";
import { DEFAULT_FACE_SHAPE, effectiveFaceShape, faceShapePrompt, faceShapeMeasurements, faceBaseShape, type FaceShape, type FaceShapeCalibration } from "@/lib/whiteFaceShape";
import anchors from "@/lib/whiteFaceMeasurementAnchors.json";
import mesh from "../../public/models/character/makehuman-face-v1/head.json";
import { meshFaceLandmarks } from "@/lib/whiteFaceFit";
import type { WhiteFaceMeshData } from "@/lib/whiteFaceMesh";

it("gives image a defined length baseline and a measured target instead of a slider percentage", () => {
    const prompt = faceShapePrompt({ ...DEFAULT_FACE_SHAPE, faceLength: 90 });
    expect(prompt).toContain("两眼中心连线到下巴最低点的垂直距离");
    expect(prompt).toContain("参考图该距离为100，目标96");
    expect(prompt).not.toContain("调节值90%");
});

it("keeps compact measurement anchors identical to their shipped source vertices", () => {
    anchors.sourceVertexIds.forEach((id, i) => {
        const source = mesh.sourceVertexIds.indexOf(id);
        expect(source).toBeGreaterThanOrEqual(0);
        expect(anchors.positions.slice(i * 3, i * 3 + 3)).toEqual(mesh.positions.slice(source * 3, source * 3 + 3));
    });
    for (const ids of Object.values(anchors.groups)) for (const id of ids) expect(anchors.sourceVertexIds).toContain(id);
});

it("uses the measured fitted baseline and all simultaneous deformations", () => {
    const baseline = { ...DEFAULT_FACE_SHAPE, faceLength: 114, cheekWidth: 112, noseProjection: 109 };
    const shape: FaceShape = { ...DEFAULT_FACE_SHAPE, faceLength: 90, cheekHeight: 108, eyeSize: 105,
        calibration: { schema: "iframe.white-face-fit.v1", baseline,
            source: { asset_type: "character", asset_id: "role", variant_id: "sheet" }, landmarks: {}, residual: 0 } };
    const original = meshFaceLandmarks(baseline, mesh as WhiteFaceMeshData);
    const changed = meshFaceLandmarks(shape, mesh as WhiteFaceMeshData);
    const height = (p: typeof original) => p.frontChin.y - (p.frontLeftEye.y + p.frontRightEye.y) / 2;
    const expected = height(changed) / height(original) * 100;
    const actual = faceShapeMeasurements(shape).find(item => item.key === "faceLength")!;
    expect(actual.target).toBeCloseTo(expected, 2);
    expect(actual.target).not.toBe(90);
    expect(actual.target).not.toBe(96); // Fitted geometry and eye-size coupling both matter.
});

it("measures the complete rendered widths rather than copying an individual width control", () => {
    const shape = { ...DEFAULT_FACE_SHAPE, faceWidth: 120, cheekWidth: 117, jawWidth: 75 };
    const before = meshFaceLandmarks(DEFAULT_FACE_SHAPE, mesh as WhiteFaceMeshData);
    const after = meshFaceLandmarks(shape, mesh as WhiteFaceMeshData);
    const expected = (after.frontRightCheek.x - after.frontLeftCheek.x) / (before.frontRightCheek.x - before.frontLeftCheek.x) * 100;
    expect(faceShapeMeasurements(shape).find(item => item.key === "cheekWidth")!.target).toBeCloseTo(expected, 2);
    expect(expected).not.toBeCloseTo(117, 0);
});

it("uses the displayed face-preset baseline and leaves neutral measurements unchanged", () => {
    expect(faceShapeMeasurements(faceBaseShape("masculine_young")).every(item => item.target === item.baseline)).toBe(true);
    expect(faceShapePrompt(DEFAULT_FACE_SHAPE)).not.toContain("骨相测量目标");
});

it("defines angular and signed position changes without dividing by zero", () => {
    const values = faceShapeMeasurements({ ...DEFAULT_FACE_SHAPE, eyeTilt: 120, mouthCornerTilt: 115, chinProjection: 75, eyeDepth: 110 });
    expect(values.every(item => Number.isFinite(item.target))).toBe(true);
    expect(values.find(item => item.key === "eyeTiltLeft")!.baseline).toBe(0);
    const prompt = faceShapePrompt({ ...DEFAULT_FACE_SHAPE, eyeTilt: 120, chinProjection: 75 });
    expect(prompt).toContain("参考图原角度为θ₀");
    expect(prompt).toContain("眼线至下巴距离为100单位");
    expect(prompt).not.toMatch(/NaN|Infinity|调节值/);
});

it("measures nasal-root projection independently and keeps legacy calibrated shapes neutral", () => {
    const root = faceShapeMeasurements({ ...DEFAULT_FACE_SHAPE, noseRootHeight: 110 }).find(item => item.key === "noseRootHeight")!;
    expect(root.view).toBe("侧面");
    expect(root.label).toBe("鼻根前突");
    expect(root.unit).toBe("position");
    expect(root.target).toBeGreaterThan(0);
    for (const value of [50, 75, 125, 150]) for (const m of faceShapeMeasurements({ ...DEFAULT_FACE_SHAPE, noseRootHeight: value })) {
        if (m.key !== "noseRootHeight") expect(m.target).toBe(m.baseline);
    }

    const legacyBaseline = { ...DEFAULT_FACE_SHAPE } as Record<string, unknown>;
    delete legacyBaseline.noseRootHeight;
    const legacy = { ...DEFAULT_FACE_SHAPE, calibration: {
        schema: "iframe.white-face-fit.v1" as const,
        source: { asset_type: "character" as const, asset_id: "role", variant_id: "sheet" },
        baseline: legacyBaseline as unknown as FaceShapeCalibration["baseline"],
        landmarks: {}, residual: 0,
    } };
    expect(effectiveFaceShape(legacy).noseRootHeight).toBe(100);
    expect(faceShapeMeasurements(legacy).every(item => Number.isFinite(item.target))).toBe(true);
});
