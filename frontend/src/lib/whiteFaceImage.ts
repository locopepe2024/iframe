import type { FaceFitPoint } from "./whiteFaceFit";

export const FACE_FIT_IMAGE_SPEC = {
    version: "face-crop-512.v1",
    size: 512,
    margin: 0.2,
    minimumFaceHeight: 128,
    recommendedFaceHeight: 256,
} as const;

/** Source-pixel rectangle; negative origins deliberately preserve edge padding. */
export type FaceImageCrop = { x: number; y: number; width: number; height: number };
export type PreparedFaceInfo = {
    view: "front" | "side";
    crop: FaceImageCrop;
    sourceFaceHeight: number;
    detected: boolean;
};
export type FaceImagePreparation = {
    version: typeof FACE_FIT_IMAGE_SPEC.version;
    size: number;
    sourceWidth: number;
    sourceHeight: number;
    views: PreparedFaceInfo[];
};
export type PreparedFaceImage = PreparedFaceInfo & { canvas: HTMLCanvasElement };
export type FrontReferenceRegion = "whole" | "left" | "right";
export type FaceFitSource = { scope: "series" | "project" | "global"; containerId: string; assetId: string; variantId: string; assetType?: "character" | "prop" };
export type FacePhotoSource = { asset_type: "character" | "prop"; asset_id: string; variant_id: string;
    source_scope: "series" | "project" | "global"; source_container_id?: string };
export type FacePhotoReference = { source: FacePhotoSource; sourceWidth: number; sourceHeight: number;
    preparation: PreparedFaceInfo; view: "front" | "side" };
export type FaceReferencePair = { schema: "iframe.face-reference-pair.v1"; front: FacePhotoReference; side: FacePhotoReference };

export type FrontFaceReference = {
    source: FacePhotoSource;
    region: FrontReferenceRegion;
    sourceWidth: number;
    sourceHeight: number;
    preparation?: PreparedFaceInfo;
};

export function frontReferenceBounds(width: number, height: number, region: FrontReferenceRegion): FaceImageCrop {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("正脸原图尺寸无效");
    if (region !== "whole" && region !== "left" && region !== "right") throw new Error("正脸参考区域无效");
    return { x: region === "right" ? width / 2 : 0, y: 0, width: region === "whole" ? width : width / 2, height };
}

export function facePointInSource(point: FaceFitPoint, crop: FaceImageCrop, sourceWidth: number, sourceHeight: number): FaceFitPoint {
    return { x: (crop.x + point.x * crop.width) / sourceWidth, y: (crop.y + point.y * crop.height) / sourceHeight };
}

export function squareFaceCrop(points: FaceFitPoint[], sourceWidth: number, sourceHeight: number): {
    crop: FaceImageCrop; sourceFaceHeight: number;
} {
    if (!points.length || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)
        || sourceWidth <= 0 || sourceHeight <= 0
        || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
        throw new Error("无法确定人脸裁剪范围");
    }
    const left = Math.min(...points.map(p => p.x)) * sourceWidth;
    const right = Math.max(...points.map(p => p.x)) * sourceWidth;
    const top = Math.min(...points.map(p => p.y)) * sourceHeight;
    const bottom = Math.max(...points.map(p => p.y)) * sourceHeight;
    const size = Math.max(right - left, bottom - top) * (1 + 2 * FACE_FIT_IMAGE_SPEC.margin);
    if (size < 1) throw new Error("人脸裁剪范围过小");
    return {
        crop: { x: (left + right - size) / 2, y: (top + bottom - size) / 2, width: size, height: size },
        sourceFaceHeight: bottom - top,
    };
}

/** Uniformly scale original pixels onto a square; clip with explicit padding. */
export function renderFaceCrop(image: HTMLImageElement, crop: FaceImageCrop): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = FACE_FIT_IMAGE_SPEC.size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取三视图图像");
    context.fillStyle = "#eeeeee";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(canvas.width / crop.width, canvas.height / crop.height);
    const dx = (canvas.width - crop.width * scale) / 2;
    const dy = (canvas.height - crop.height * scale) / 2;
    const left = Math.max(0, crop.x), top = Math.max(0, crop.y);
    const right = Math.min(image.naturalWidth, crop.x + crop.width);
    const bottom = Math.min(image.naturalHeight, crop.y + crop.height);
    if (right <= left || bottom <= top) throw new Error("人脸裁剪范围超出原图");
    context.drawImage(image, left, top, right - left, bottom - top,
        dx + (left - crop.x) * scale, dy + (top - crop.y) * scale, (right - left) * scale, (bottom - top) * scale);
    return canvas;
}

/** Include any letterbox padding in the inverse transform for coarse locating. */
export function squareCropBounds(crop: FaceImageCrop): FaceImageCrop {
    const size = Math.max(crop.width, crop.height);
    return { x: crop.x - (size - crop.width) / 2, y: crop.y - (size - crop.height) / 2, width: size, height: size };
}
