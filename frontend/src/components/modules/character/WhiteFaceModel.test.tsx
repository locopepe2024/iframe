// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import WhiteFaceModel from "./WhiteFaceModel";
import { DEFAULT_FACE_SHAPE } from "@/lib/whiteFaceShape";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";
import headMesh from "../../../../public/models/character/makehuman-face-v1/head.json";

const meshData = headMesh as WhiteFaceMeshData;

const { uploadLibraryImage, createLibraryAsset } = vi.hoisted(() => ({
    uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({ Canvas: () => <canvas /> }));
vi.mock("@/lib/api", () => ({ api: { uploadLibraryImage, createLibraryAsset } }));

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => meshData }));
    uploadLibraryImage.mockReset().mockResolvedValue({ image_url: "uploads/white-face.png" });
    createLibraryAsset.mockReset().mockResolvedValue({
        id: "face-prop", image_asset: { variants: [{ id: "face-v1" }] },
    });
    HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(new Blob(["white-face"], { type: "image/png" }));
    };
});

it("saves the edited geometry as a stable reference and matching prompt", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="探子首领" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText(/脸部长度/), { target: { value: "112" } });
    fireEvent.change(screen.getByLabelText(/鼻尖突出度/), { target: { value: "118" } });
    fireEvent.change(screen.getByLabelText(/额头宽度/), { target: { value: "108" } });
    fireEvent.click(screen.getByText("嘴唇与下巴"));
    fireEvent.change(screen.getByLabelText(/嘴角倾斜/), { target: { value: "115" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(createLibraryAsset).toHaveBeenCalledWith("prop", expect.objectContaining({
        name: "探子首领 · 面部比例白模", image_url: "uploads/white-face.png",
        description: expect.stringContaining("脸长 112%"),
    }));
    expect(onSaved).toHaveBeenCalledWith(
        { asset_type: "prop", asset_id: "face-prop", variant_id: "face-v1", application_mode: "reference_only", applied_fields: ["face_geometry"] },
        expect.stringContaining("鼻尖突出度 118%"),
        expect.objectContaining({ faceLength: 112, foreheadWidth: 108, mouthCornerTilt: 115 }),
    );
    expect(createLibraryAsset.mock.calls[0][1].description).toContain("嘴角倾斜 115%");
});

it("compares the base face with the edit and exports only the edited preview", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="苏砚" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByLabelText("基础脸型正面与侧面预览")).toBeInTheDocument();
    expect(screen.getByLabelText("当前调整正面与侧面预览")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(2));
    const exported: HTMLCanvasElement[] = [];
    HTMLCanvasElement.prototype.toBlob = function (callback) {
        exported.push(this);
        callback(new Blob(["edited-face"], { type: "image/png" }));
    };
    fireEvent.change(screen.getByLabelText(/脸部长度/), { target: { value: "112" } });
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(exported).toEqual([screen.getByLabelText("当前调整正面与侧面预览").querySelector("canvas")]);
});

it("restores saved proportions when the workbench reopens its design", () => {
    const { rerender } = render(<WhiteFaceModel characterName="探子首领" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByLabelText(/脸部长度/)).toHaveValue("100");

    rerender(<WhiteFaceModel characterName="探子首领" initialShape={{
        faceLength: 112, faceWidth: 90, cheekWidth: 105, jawWidth: 85,
        eyeSpacing: 96, noseProjection: 110,
    }} onSaved={vi.fn()} />);

    expect(screen.getByLabelText(/脸部长度/)).toHaveValue("112");
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("85");
});

it("applies a human base face preset before fine tuning", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="苏砚" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText("基础脸型"), { target: { value: "masculine_young" } });
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("112");
    expect(screen.getByLabelText(/鼻尖突出度/)).toHaveValue("106");
    await waitFor(() => expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onSaved.mock.calls[0][2]).toEqual(expect.objectContaining({ basePreset: "masculine_young" }));
});

it("starts each base preset from its own proportions", () => {
    render(<WhiteFaceModel characterName="苏砚" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText("基础脸型"), { target: { value: "masculine_young" } });
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("112");
    fireEvent.change(screen.getByLabelText("基础脸型"), { target: { value: "neutral_young" } });
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("100");
    expect(screen.getByLabelText(/鼻尖突出度/)).toHaveValue("100");
});

it("offers five face presets, including a distinct child shape", () => {
    render(<WhiteFaceModel characterName="苏砚" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const select = screen.getByLabelText("基础脸型") as HTMLSelectElement;
    expect(Array.from(select.options, option => option.text)).toEqual(["中性青年", "老年", "儿童", "男性", "女性"]);
    fireEvent.change(select, { target: { value: "child" } });
    expect(screen.getByLabelText(/脸部长度/)).toHaveValue("88");
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("84");
    expect(screen.getByLabelText(/鼻尖突出度/)).toHaveValue("86");
});

it("keeps a saved middle-aged shape selectable when reopening it", () => {
    render(<WhiteFaceModel characterName="苏砚" initialShape={{ basePreset: "middle_aged", jawWidth: 107 }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByLabelText("基础脸型")).toHaveValue("middle_aged");
    expect(screen.getByLabelText(/下颌宽度/)).toHaveValue("107");
});

it("deforms the mature head mesh around the nose without moving the opposite side", () => {
    const neutral = faceShellGeometry(DEFAULT_FACE_SHAPE, meshData);
    const wide = faceShellGeometry({ ...DEFAULT_FACE_SHAPE, noseBridgeWidth: 125 }, meshData);
    const high = faceShellGeometry({ ...DEFAULT_FACE_SHAPE, noseBridgeHeight: 125 }, meshData);
    const base = neutral.getAttribute("position");
    const widePositions = wide.getAttribute("position");
    const highPositions = high.getAttribute("position");
    const indices = neutral.getIndex();
    expect(base.count).toBe(4154);
    expect(indices?.count).toBe(8244 * 3);
    expect(Math.max(...Array.from({ length: indices!.count }, (_, i) => indices!.getX(i)))).toBeLessThan(base.count);
    const bridge = Array.from({ length: base.count }, (_, i) => i).find(i =>
        Math.abs(base.getX(i)) > 0.04 && Math.abs(base.getX(i)) < 0.13 &&
        base.getY(i) > -0.2 && base.getY(i) < -0.04 && base.getZ(i) > 0.5);
    expect(bridge).toBeDefined();
    expect(Math.abs(widePositions.getX(bridge!))).toBeGreaterThan(Math.abs(base.getX(bridge!)));
    expect(highPositions.getZ(bridge!)).toBeGreaterThan(base.getZ(bridge!));
    const back = Array.from({ length: base.count }, (_, i) => i).find(i => base.getZ(i) < -0.5);
    expect(back).toBeDefined();
    expect(highPositions.getZ(back!)).toBe(base.getZ(back!));
    neutral.dispose();
    wide.dispose();
    high.dispose();
});
