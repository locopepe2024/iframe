import type { ShotNode } from "./ShotCard";
import { getActiveT2IImageUrl } from "./shotNodeHelpers";

export type ShotVideoMode = "t2v" | "i2v" | "first_last_frame" | "r2v";

/** Resolve the images shown as selected in the current shot, never a stale
 * URL mirror left over from a deleted or changed candidate. */
export function resolveShotVideoInput(shot: ShotNode): {
    mode: ShotVideoMode;
    firstFrameUrl: string;
    lastFrameUrl: string;
    error?: string;
} {
    const mode = shot.videoMode ?? (shot.tabMode === "direct_r2v" ? "r2v" : "i2v");
    if (mode === "t2v" || mode === "r2v") {
        return { mode, firstFrameUrl: "", lastFrameUrl: "" };
    }
    const firstFrameUrl = Array.isArray(shot.t2iImageUrls)
        ? (shot.t2iImageUrls.length ? getActiveT2IImageUrl(shot) : shot.imageUrl) || ""
        : getActiveT2IImageUrl(shot) || shot.imageUrl || "";
    const urls = shot.lastFrameImageUrls ?? [];
    const lastFrameUrl = urls.length
        ? urls[Math.max(0, Math.min(shot.lastFrameSelectedIndex ?? 0, urls.length - 1))]
        : "";
    if (!firstFrameUrl) return { mode, firstFrameUrl, lastFrameUrl, error: "请先选择首帧。" };
    if (mode === "first_last_frame" && !lastFrameUrl) {
        return { mode, firstFrameUrl, lastFrameUrl, error: "请先选择尾帧。" };
    }
    if (mode === "first_last_frame" && firstFrameUrl === lastFrameUrl) {
        return { mode, firstFrameUrl, lastFrameUrl, error: "首帧与尾帧不能使用同一张图片。" };
    }
    return { mode, firstFrameUrl, lastFrameUrl };
}
