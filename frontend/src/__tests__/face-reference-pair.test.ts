import { expect, it } from "vitest";
import { validateFacePhotoView, validateFaceReferencePair, validateProfilePose } from "../lib/faceReferencePair";
import type { FacePhotoReference } from "../lib/whiteFaceImage";

function face() {
    const p = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
    p[33] = { x: .3, y: .3 }; p[133] = { x: .4, y: .3 };
    p[362] = { x: .6, y: .3 }; p[263] = { x: .7, y: .3 };
    p[1] = { x: .5, y: .45 }; p[199] = { x: .5, y: .7 };
    return p;
}
const reference = (view: "front" | "side"): FacePhotoReference => ({ view,
    source: { asset_type: "prop", asset_id: view, variant_id: "v1", source_scope: "global" },
    sourceWidth: 1024, sourceHeight: 1024,
    preparation: { view, crop: { x: 0, y: 0, width: 512, height: 512 }, sourceFaceHeight: 300, detected: true },
});

it("accepts frontal and mirrored profile geometry and rejects swapped or tilted inputs", () => {
    const front = face(); expect(() => validateFacePhotoView(front, "front", 800, 1000)).not.toThrow();
    expect(() => validateFacePhotoView(front, "side", 800, 1000)).toThrow(/90/);
    const side = face(); side[133].x = .31; side[1].x = .2;
    expect(() => validateFacePhotoView(side, "side", 800, 1000)).not.toThrow();
    expect(() => validateFacePhotoView(side.map(p => ({ ...p, x: 1 - p.x })), "side", 800, 1000)).not.toThrow();
    expect(() => validateFacePhotoView(side, "front", 800, 1000)).toThrow(/正面图/);
    const tilt = face(); tilt[33].y = tilt[133].y = .4;
    expect(() => validateFacePhotoView(tilt, "front", 800, 1000)).toThrow(/头部摆正/);
});

it("requires two distinct validated sources and sufficient native face detail", () => {
    const front = reference("front"), side = reference("side");
    expect(validateFaceReferencePair(front, side).schema).toBe("iframe.face-reference-pair.v1");
    expect(() => validateFaceReferencePair(front, undefined)).toThrow(/各一张/);
    expect(() => validateFaceReferencePair(front, { ...side, source: front.source })).toThrow(/独立/);
    expect(() => validateFaceReferencePair(front, { ...side, preparation: { ...side.preparation, sourceFaceHeight: 91 } })).toThrow(/侧脸照/);
    expect(() => validateFaceReferencePair(front, { ...side, view: "front" })).toThrow(/侧脸照/);
});


it("rejects the observed oblique pose even when its eye widths resemble a profile", () => {
    const matrix = (yaw: number) => { const a = yaw*Math.PI/180; return { rows:4,columns:4,data:[Math.cos(a),0,-Math.sin(a),0,0,1,0,0,Math.sin(a),0,Math.cos(a),0,0,0,-30,1] }; };
    expect(() => validateProfilePose(matrix(45))).toThrow(/角度不足/);
    expect(() => validateProfilePose(matrix(0))).toThrow(/角度不足/);
    expect(validateProfilePose(matrix(60))).toBeCloseTo(60);
    expect(validateProfilePose(matrix(-85))).toBeCloseTo(85);
    expect(() => validateProfilePose()).toThrow(/无法核对/);
});
