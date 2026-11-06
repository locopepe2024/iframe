// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { facePointInSource, renderFaceCrop, squareCropBounds, squareFaceCrop, frontReferenceBounds } from "@/lib/whiteFaceImage";
import { prepareAndMarkThreeView, prepareAndMarkFrontReference, prepareAndMarkFacePhoto } from "@/lib/whiteFaceAutoLandmarks";
import { imageFaceMetrics, type FaceFitLandmarks } from "@/lib/whiteFaceFit";

const drawImage = vi.fn();
const context = { fillRect: vi.fn(), drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: "low", fillStyle: "" };
const image = () => Object.assign(new Image(), { width: 1600, height: 1000 });
beforeEach(() => {
    drawImage.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

function sourceImage() {
    const result = image();
    Object.defineProperties(result, { naturalWidth: { value: 1600, configurable: true }, naturalHeight: { value: 1000, configurable: true } });
    return result;
}

it("preserves original point geometry through square crop scaling and padding", () => {
    const points: FaceFitLandmarks = {
        frontLeftCheek: { x: .03, y: .1 }, frontRightCheek: { x: .13, y: .1 },
        frontLeftJaw: { x: .05, y: .18 }, frontRightJaw: { x: .11, y: .18 },
        frontLeftEye: { x: .06, y: .08 }, frontRightEye: { x: .1, y: .08 },
        frontChin: { x: .08, y: .23 }, sideEye: { x: .6, y: .08 },
        sideNose: { x: .56, y: .14 }, sideChin: { x: .57, y: .21 },
    };
    const crop = squareFaceCrop([{ x: 0, y: 0 }, { x: .14, y: .23 }], 1600, 1000).crop;
    expect(crop.width).toBe(crop.height);
    expect(crop.x).toBeLessThan(0);
    expect(crop.y).toBeLessThan(0);
    const recovered = Object.fromEntries(Object.entries(points).map(([key, p]) => [key,
        facePointInSource({ x: (p.x * 1600 - crop.x) / crop.width, y: (p.y * 1000 - crop.y) / crop.height }, crop, 1600, 1000),
    ])) as FaceFitLandmarks;
    const expected = imageFaceMetrics(points, 1.6), actual = imageFaceMetrics(recovered, 1.6);
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) expect(actual[key]).toBeCloseTo(expected[key], 12);
});

it("pads edge crops and column locating without stretching or drawing neighboring columns", () => {
    const img = sourceImage();
    const canvas = renderFaceCrop(img, { x: -20, y: -10, width: 200, height: 200 });
    expect([canvas.width, canvas.height]).toEqual([512, 512]);
    expect(drawImage.mock.lastCall?.slice(1)).toEqual([0, 0, 180, 190, 51.2, 25.6, 460.8, 486.40000000000003]);
    renderFaceCrop(img, { x: 100, y: 0, width: 200, height: 400 });
    expect(drawImage.mock.lastCall?.slice(1)).toEqual([100, 0, 200, 400, 128, 0, 256, 512]);
    expect(squareCropBounds({ x: 100, y: 0, width: 200, height: 400 })).toEqual({ x: 0, y: 0, width: 400, height: 400 });
});

function detectedFace() {
    const face = Array.from({ length: 478 }, () => ({ x: .5, y: .4, z: 0 }));
    for (const index of [234, 172, 33]) face[index].x = .3;
    for (const index of [454, 397, 263]) face[index].x = .7;
    face[133].x = .4; face[362].x = .6;
    face[10].y = .15;
    face[152].y = .75;
    face[199] = { x: .46, y: .7, z: 0 };
    face[1] = { x: .35, y: .5, z: 0 };
    return face;
}

it("uses final processed detections and maps their points back to the original", () => {
    const coarse = detectedFace(), finalFace = detectedFace();
    finalFace[234].x = .2; // Different from the coarse result.
    const detect = vi.fn().mockReturnValueOnce(coarse).mockReturnValueOnce(finalFace)
        .mockReturnValueOnce(coarse).mockReturnValueOnce(finalFace);
    const onPrepared = vi.fn();
    const marks = prepareAndMarkThreeView(sourceImage(), detect, onPrepared);
    expect(Object.keys(marks)).toHaveLength(10);
    expect(detect).toHaveBeenCalledTimes(4);
    const prepared = onPrepared.mock.calls[0][0];
    expect(prepared.map((p: { canvas: HTMLCanvasElement }) => [p.canvas.width, p.canvas.height])).toEqual([[512, 512], [512, 512]]);
    expect(marks.frontLeftCheek?.x).toBeCloseTo(facePointInSource(finalFace[234], prepared[0].crop, 1600, 1000).x);
    expect(prepared[0].sourceFaceHeight).toBeGreaterThan(0);
});

it("does not silently use coarse marks when final face detection fails", () => {
    const detect = vi.fn().mockReturnValueOnce(detectedFace()).mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(detectedFace()).mockReturnValueOnce(detectedFace());
    const onPrepared = vi.fn();
    const marks = prepareAndMarkThreeView(sourceImage(), detect, onPrepared);
    expect(Object.keys(marks)).toHaveLength(3);
    expect(marks.frontLeftEye).toBeUndefined();
    expect(onPrepared.mock.calls[0][0][0].detected).toBe(false);
});

it("relocates the full column when a head-only sheet fails the upper crop", () => {
    const detect = vi.fn().mockReturnValueOnce(detectedFace()).mockReturnValueOnce(undefined)
        .mockReturnValueOnce(detectedFace()).mockReturnValueOnce(detectedFace())
        .mockReturnValueOnce(detectedFace()).mockReturnValueOnce(detectedFace());
    const onPrepared = vi.fn();
    const marks = prepareAndMarkThreeView(sourceImage(), detect, onPrepared);
    expect(Object.keys(marks)).toHaveLength(10);
    expect(detect).toHaveBeenCalledTimes(6);
    expect(onPrepared.mock.calls[0][0].every((face: { detected: boolean }) => face.detected)).toBe(true);
});

it("marks an independent portrait region in its own original coordinates", () => {
    expect(frontReferenceBounds(1600, 1000, "right")).toEqual({ x: 800, y: 0, width: 800, height: 1000 });
    expect(() => frontReferenceBounds(0, 1000, "left")).toThrow("尺寸无效");
    const final = detectedFace(); final[234].x = .25;
    const detect = vi.fn().mockReturnValueOnce([detectedFace()]).mockReturnValueOnce([final]);
    const prepared = vi.fn();
    const points = prepareAndMarkFrontReference(sourceImage(), "left", detect, prepared);
    expect(Object.keys(points)).toHaveLength(7);
    expect(points.sideEye).toBeUndefined();
    const image = prepared.mock.calls[0][0][0];
    expect(points.frontLeftCheek?.x).toBeCloseTo(facePointInSource(final[234], image.crop, 1600, 1000).x, 12);
    expect(points.frontChin?.y).toBeCloseTo(facePointInSource(final[152], image.crop, 1600, 1000).y, 12);
});

it("rejects ambiguous or unsuccessful portrait detections instead of picking or substituting a face", () => {
    const multiple = vi.fn().mockReturnValue([detectedFace(), detectedFace()]);
    expect(() => prepareAndMarkFrontReference(sourceImage(), "whole", multiple)).toThrow("多张人脸");
    expect(multiple).toHaveBeenCalledTimes(1);
    const failed = vi.fn().mockReturnValueOnce([detectedFace()]).mockReturnValueOnce([]);
    const prepared = vi.fn();
    expect(() => prepareAndMarkFrontReference(sourceImage(), "left", failed, prepared)).toThrow("处理后未识别");
    expect(prepared.mock.calls[0][0][0].detected).toBe(false);
});

it("detects only profile points when an independent portrait supplies the front", () => {
    const detect = vi.fn().mockReturnValue(detectedFace());
    const prepared = vi.fn();
    const points = prepareAndMarkThreeView(sourceImage(), detect, prepared, ["side"]);
    expect(Object.keys(points)).toHaveLength(3);
    expect(points.frontLeftCheek).toBeUndefined();
    expect(detect).toHaveBeenCalledTimes(2);
    expect(prepared.mock.calls[0][0].map((face: { view: string }) => face.view)).toEqual(["side"]);
});


it("requires one sufficiently detailed face of the correct view at both detection stages", () => {
    const front = detectedFace(); front[1].x = .5;
    const detect = vi.fn().mockReturnValue([front]);
    const result = prepareAndMarkFacePhoto(sourceImage(), "front", detect);
    expect(Object.keys(result.points)).toHaveLength(7);
    expect(result.points.frontLeftCheek?.x).toBeCloseTo(facePointInSource(front[234], result.prepared.crop, 1600, 1000).x);
    expect(() => prepareAndMarkFacePhoto(sourceImage(), "side", detect)).toThrow(/90/);
    expect(() => prepareAndMarkFacePhoto(sourceImage(), "front", () => [])).toThrow(/未识别/);
    expect(() => prepareAndMarkFacePhoto(sourceImage(), "front", () => [front, front])).toThrow(/只能有一个人/);
    expect(() => prepareAndMarkFacePhoto(sourceImage(), "front", vi.fn().mockReturnValueOnce([front]).mockReturnValueOnce([]))).toThrow(/未识别/);
    const small = sourceImage(); Object.defineProperties(small, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
    expect(() => prepareAndMarkFacePhoto(small, "front", detect)).toThrow(/低于128/);
});
