import { describe, expect, it } from "vitest";
import { resolveShotVideoInput } from "../components/modules/storyboard-r2v/shotVideoInput";
import type { ShotNode } from "../components/modules/storyboard-r2v/ShotCard";
import { VIDEO_I2V_MODELS, videoModelSupportsMode } from "../lib/modelCatalog";

const shot = (mode: ShotNode["videoMode"], extra: Partial<ShotNode> = {}): ShotNode => ({
    id: "shot-1", prompt: "test", tabMode: mode === "r2v" ? "direct_r2v" : "t2i_i2v",
    videoMode: mode, ...extra,
});

describe("shot video inputs", () => {
    it("keeps published first-last models selectable beside Wan", () => {
        expect(VIDEO_I2V_MODELS.some(model => model.id === "uniart/seedance-2.5-vip")).toBe(true);
        expect(videoModelSupportsMode("uniart/seedance-2.5-vip", "first_last_frame")).toBe(true);
        expect(videoModelSupportsMode("uniart/minimax-h3-vip", "first_last_frame")).toBe(true);
        expect(videoModelSupportsMode("uniart/seedance-2.5-vip", "t2v")).toBe(true);
    });
    it("sends no image for text and reference modes", () => {
        for (const mode of ["t2v", "r2v"] as const) {
            expect(resolveShotVideoInput(shot(mode, { imageUrl: "storyboard.png" }))).toMatchObject({
                mode, firstFrameUrl: "", lastFrameUrl: "",
            });
        }
    });
    it("uses storyboard first frame when there is no selected override", () => {
        expect(resolveShotVideoInput(shot("i2v", { imageUrl: "storyboard.png" }))).toMatchObject({
            firstFrameUrl: "storyboard.png",
        });
        expect(resolveShotVideoInput(shot("i2v", { imageUrl: "storyboard.png" })).error).toBeUndefined();
    });
    it("uses selected first and last variants and rejects absent or identical frames", () => {
        const selected = shot("first_last_frame", {
            imageUrl: "storyboard.png", t2iImageUrls: ["a.png", "b.png"], t2iSelectedIndex: 1,
            lastFrameImageUrls: ["c.png", "d.png"], lastFrameSelectedIndex: 0,
            lastFrameUrl: "stale.png",
        });
        expect(resolveShotVideoInput(selected)).toMatchObject({ firstFrameUrl: "b.png", lastFrameUrl: "c.png" });
        expect(resolveShotVideoInput(selected).error).toBeUndefined();
        expect(resolveShotVideoInput({ ...selected, lastFrameImageUrls: [] }).error).toContain("尾帧");
        expect(resolveShotVideoInput({ ...selected, lastFrameImageUrls: ["b.png"] }).error).toContain("同一张");
    });
});
