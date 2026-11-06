import { FACE_FIT_IMAGE_SPEC, type FacePhotoReference, type FaceReferencePair } from "./whiteFaceImage";
import type { FaceFitPoint } from "./whiteFaceFit";

export function validateFacePhotoView(face: FaceFitPoint[], view: "front" | "side", width: number, height: number) {
    if (face.length < 468 || face.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) throw new Error("识别点位不完整，请更换清晰原图");
    const left = Math.abs(face[133].x - face[33].x), right = Math.abs(face[263].x - face[362].x);
    const eyes = { x: (face[33].x + face[133].x + face[362].x + face[263].x) / 4,
        y: (face[33].y + face[133].y + face[362].y + face[263].y) / 4 };
    const distance = Math.abs((face[263].x + face[362].x - face[33].x - face[133].x) / 2);
    if (Math.max(left, right) * width < 1 || distance * width < 1) throw new Error("眼部被遮挡或点位无效，请更换图片");
    const ratio = Math.min(left, right) / Math.max(left, right);
    if (view === "front") {
        const tilt = Math.abs((face[33].y + face[133].y - face[362].y - face[263].y) / 2) * height / (distance * width);
        if (ratio < .65 || tilt > .12 || Math.abs(face[1].x - eyes.x) / distance > .24) throw new Error("正面图需要平视镜头、头部摆正；请勿使用斜侧脸");
    } else {
        if (ratio > .55) throw new Error("侧脸图需要接近90°，只露出一侧眼睛；请勿使用正面或三分之二侧脸");
        const visible = left > right ? [33, 133] : [362, 263];
        const eyeY = (face[visible[0]].y + face[visible[1]].y) / 2;
        const noseY = face[1].y, chinY = face[199].y;
        if (noseY <= eyeY || chinY <= noseY) throw new Error("侧脸头部需保持水平，露出眼睛、鼻尖和下巴");
    }
}

export function validateFaceReferencePair(front: FacePhotoReference | undefined, side: FacePhotoReference | undefined): FaceReferencePair {
    if (!front || !side) throw new Error("请先提供并通过检查的正面照和侧脸照各一张");
    const sourceKey = (photo: FacePhotoReference) => [photo.source.source_scope, photo.source.source_container_id || "", photo.source.asset_type, photo.source.asset_id, photo.source.variant_id].join("\0");
    if (sourceKey(front) === sourceKey(side)) throw new Error("正面照和侧脸照必须是两张独立图片");
    for (const [label, photo, view] of [["正面", front, "front"], ["侧脸", side, "side"]] as const) {
        if (!Number.isInteger(photo.sourceWidth) || !Number.isInteger(photo.sourceHeight) || photo.sourceWidth < 2 || photo.sourceHeight < 2
            || !photo.source.asset_id || !photo.source.variant_id || photo.view !== view || photo.preparation.view !== view || !photo.preparation.detected
            || !Number.isFinite(photo.preparation.sourceFaceHeight)
            || photo.preparation.sourceFaceHeight < FACE_FIT_IMAGE_SPEC.minimumFaceHeight) throw new Error(`${label}照尚未通过人脸检查`);
    }
    return { schema: "iframe.face-reference-pair.v1", front, side };
}


/** MediaPipe's column-major similarity transform; this estimate is not a measured camera angle. */
export function validateProfilePose(matrix?: { rows: number; columns: number; data: number[] }) {
    if (!matrix || matrix.rows !== 4 || matrix.columns !== 4 || matrix.data.length !== 16 || matrix.data.some(v => !Number.isFinite(v))) {
        throw new Error("无法核对侧脸朝向，请使用清晰的接近90°侧脸原图");
    }
    const d = matrix.data;
    if (Math.hypot(d[8], d[10]) < .5) throw new Error("侧脸姿态矩阵无效，请更换原图");
    const yaw = Math.abs(Math.atan2(d[8], d[10]) * 180 / Math.PI);
    // The detector underestimates profile yaw (a reviewed near-profile fixture is ~55°).
    // This conservative extra gate rejects the observed ~45° two-eye source; manual review remains mandatory.
    if (yaw < 50 || yaw > 110) throw new Error("侧脸转头角度不足，请使用接近90°、只露一侧眼睛的侧脸照；当前斜侧脸不能用于侧面深度调整");
    return yaw;
}
