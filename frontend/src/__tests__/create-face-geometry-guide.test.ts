import { expect, it, vi } from "vitest";
import { DEFAULT_FACE_SHAPE } from "../lib/whiteFaceShape";
import { createFaceGeometryGuide } from "../lib/createFaceGeometryGuide";

const detect = vi.hoisted(() => vi.fn());
vi.mock("../lib/whiteFaceAutoLandmarks", () => ({ detectFrontFaceGuide: detect }));

it.each(["noseBridgeHeight", "noseProjection"])("rejects depth-only %s before detection or image processing", async key => {
    await expect(createFaceGeometryGuide({} as HTMLImageElement, { ...DEFAULT_FACE_SHAPE, [key]: 110 }, "whole")).rejects.toThrow(/暂不支持/);
    expect(detect).not.toHaveBeenCalled();
});
