// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import WhiteFaceModel from "./WhiteFaceModel";
import { DEFAULT_FACE_SHAPE } from "@/lib/whiteFaceShape";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";
import headMesh from "../../../../public/models/character/makehuman-face-v1/head.json";

const meshData = headMesh as WhiteFaceMeshData;

const { uploadLibraryImage, createLibraryAsset, authenticatedFetch, autoMarkThreeView, resolveAssetVariantDelivery } = vi.hoisted(() => ({
    uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(), authenticatedFetch: vi.fn(), autoMarkThreeView: vi.fn(), resolveAssetVariantDelivery: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({ Canvas: () => <canvas /> }));
vi.mock("@/lib/api", () => ({ API_URL: "http://test", authenticatedFetch, api: { uploadLibraryImage, createLibraryAsset } }));
vi.mock("@/lib/whiteFaceAutoLandmarks", () => ({ autoMarkThreeView }));
vi.mock("@/lib/mediaDelivery", () => ({ resolveAssetVariantDelivery }));

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => meshData }));
    uploadLibraryImage.mockReset().mockResolvedValue({ image_url: "uploads/white-face.png" });
    createLibraryAsset.mockReset().mockResolvedValue({
        id: "face-prop", image_asset: { variants: [{ id: "face-v1" }] },
    });
    authenticatedFetch.mockReset().mockResolvedValue({ ok: true, blob: async () => new Blob(["reference"], { type: "image/png" }) });
    resolveAssetVariantDelivery.mockReset().mockResolvedValue("http://test/studio/owned-media/owner/three-view.png");
    autoMarkThreeView.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:three-view");
    URL.revokeObjectURL = vi.fn();
    HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(new Blob(["white-face"], { type: "image/png" }));
    };
});

it("shows automatic face marks and lets the user correct one point", async () => {
    const points = {
        frontLeftCheek: { x: .19, y: .16 }, frontRightCheek: { x: .31, y: .16 },
        frontLeftJaw: { x: .21, y: .21 }, frontRightJaw: { x: .29, y: .21 },
        frontLeftEye: { x: .22, y: .12 }, frontRightEye: { x: .28, y: .12 },
        frontChin: { x: .25, y: .25 }, sideEye: { x: .55, y: .12 },
        sideNose: { x: .51, y: .16 }, sideChin: { x: .53, y: .25 },
    };
    autoMarkThreeView.mockResolvedValue(points);
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    await waitFor(() => expect(resolveAssetVariantDelivery).toHaveBeenCalledWith({
        scope: "series", containerId: "series-1", assetType: "character", assetId: "su-yan", variantId: "three-view-1",
    }));
    expect(authenticatedFetch).toHaveBeenCalledWith("http://test/studio/owned-media/owner/three-view.png", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
        left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => {},
    });
    fireEvent.load(image);
    await waitFor(() => expect(screen.getByText(/已自动标记正面和侧面/)).toBeInTheDocument());
    expect(autoMarkThreeView).toHaveBeenCalledWith(image);
    expect(screen.getByText("已标记 10/10 · 可以拟合")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /正面画面左颧部/ }));
    fireEvent.click(image, { clientX: 17, clientY: 18 });
    expect(screen.getByRole("button", { name: /正面画面左颧部/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTitle("正面画面左颧部")).toHaveStyle({ left: "17%", top: "18%" });
    expect(screen.getByTitle("正面画面右颧部")).toHaveStyle({ left: "31%", top: "16%" });
});

it("keeps front marks when profile detection needs manual completion", async () => {
    autoMarkThreeView.mockResolvedValue({
        frontLeftCheek: { x: .19, y: .16 }, frontRightCheek: { x: .31, y: .16 },
        frontLeftJaw: { x: .21, y: .21 }, frontRightJaw: { x: .29, y: .21 },
        frontLeftEye: { x: .22, y: .12 }, frontRightEye: { x: .28, y: .12 },
        frontChin: { x: .25, y: .25 },
    });
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    fireEvent.load(image);
    expect(await screen.findByText("已自动标记正面，请手动补齐侧面点位。")).toBeInTheDocument();
    expect(screen.getByText("已标记 7/10 · 下一点：侧面眼中心")).toBeInTheDocument();
    expect(screen.getByTitle("正面画面左颧部")).toHaveStyle({ left: "19%", top: "16%" });
});

it("fits a selected three-view source and saves the reviewed shape as its 100% baseline", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    fireEvent.click(screen.getByRole("button", { name: "拟合白模" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请先在三视图上标记 正面画面左颧部（1/10）");
    expect(screen.getByRole("status")).toHaveTextContent("已标记 0/10 · 下一点：正面画面左颧部");
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1223 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 1286 });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
        left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => {},
    });
    const points = [[19, 16], [31, 16], [21, 21], [29, 21], [22, 12], [28, 12], [25, 25], [55, 12], [51, 16], [53, 25]];
    for (const [clientX, clientY] of points) fireEvent.click(image, { clientX, clientY });
    expect(screen.getByRole("status")).toHaveTextContent("已标记 10/10 · 可以拟合");
    fireEvent.click(screen.getByRole("button", { name: "拟合白模" }));
    expect(screen.getByText(/拟合初稿/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("已核对正面与侧面白模"));
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const saved = onSaved.mock.calls[0][2];
    expect(saved.faceWidth).toBe(100);
    expect(saved.calibration).toEqual(expect.objectContaining({
        source: { asset_type: "character", asset_id: "su-yan", variant_id: "three-view-1",
            source_scope: "series", source_container_id: "series-1" }, reviewed: true,
        residual: expect.any(Number),
    }));
    expect(createLibraryAsset.mock.calls[0][1].description).not.toContain("中性基准 100%");
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
