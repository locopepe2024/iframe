import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import FacePhotoInput from "./FacePhotoInput";
import type { FacePhotoReference } from "@/lib/whiteFaceImage";

const mocks = vi.hoisted(() => ({ autoMarkFacePhoto: vi.fn(), uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(),
    resolveAssetVariantDelivery: vi.fn(), authenticatedFetch: vi.fn() }));
vi.mock("@/lib/whiteFaceAutoLandmarks", () => ({ autoMarkFacePhoto: mocks.autoMarkFacePhoto }));
vi.mock("@/lib/api", () => ({ API_URL: "http://localhost", authenticatedFetch: mocks.authenticatedFetch,
    api: { uploadLibraryImage: mocks.uploadLibraryImage, createLibraryAsset: mocks.createLibraryAsset } }));
vi.mock("@/lib/mediaDelivery", () => ({ resolveAssetVariantDelivery: mocks.resolveAssetVariantDelivery }));
const points = { frontChin: { x: .5, y: .8 } };
const preparation = { view: "front" as const, crop: { x: 10, y: 10, width: 500, height: 500 }, sourceFaceHeight: 350, detected: true };
const initial: FacePhotoReference = { view: "front", source: { asset_type: "prop", asset_id: "original", variant_id: "v1", source_scope: "global" },
    sourceWidth: 800, sourceHeight: 1000, preparation };
beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:photo"); URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1000);
    mocks.autoMarkFacePhoto.mockResolvedValue({ points, prepared: { ...preparation, canvas: { toDataURL: () => "data:image/png;base64,crop" } } });
    mocks.uploadLibraryImage.mockResolvedValue({ image_url: "uploads/original.png" });
    mocks.createLibraryAsset.mockResolvedValue({ id: "original", image_asset: { variants: [{ id: "v1" }] } });
    mocks.resolveAssetVariantDelivery.mockResolvedValue("http://localhost/original.png");
    mocks.authenticatedFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(["original"]) });
});
const upload = () => fireEvent.change(screen.getByLabelText("上传正面照"), { target: { files: [new File(["pixels"], "original.png", { type: "image/png" })] } });
const props = () => ({ view: "front" as const, characterName: "苏砚", points, onChange: vi.fn(), onMark: vi.fn(), onBusy: vi.fn() });

it("rejects invalid photos before any upload and permits retry", async () => {
    mocks.autoMarkFacePhoto.mockRejectedValueOnce(new Error("正面图需要平视镜头"));
    const p = props(); render(<FacePhotoInput {...p} />); upload();
    expect(await screen.findByRole("alert")).toHaveTextContent("平视镜头");
    expect(mocks.uploadLibraryImage).not.toHaveBeenCalled(); expect(mocks.createLibraryAsset).not.toHaveBeenCalled();
    upload(); await waitFor(() => expect(mocks.createLibraryAsset).toHaveBeenCalledOnce());
    expect(p.onChange).toHaveBeenLastCalledWith(initial, points);
    expect(mocks.uploadLibraryImage.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.autoMarkFacePhoto.mock.invocationCallOrder[1]);
});

it("restores the original without overwriting saved manual marks or writing assets", async () => {
    const p = props(); render(<FacePhotoInput {...p} initial={initial} />);
    await screen.findByText(/正面照已通过检查/);
    expect(p.onChange).not.toHaveBeenCalled(); expect(mocks.uploadLibraryImage).not.toHaveBeenCalled();
    expect(mocks.resolveAssetVariantDelivery).toHaveBeenCalledWith(expect.objectContaining({ scope: "global", assetType: "prop", variantId: "v1" }));
});

it("shows the detected nasal-root point on restored legacy profile photos and lets it be corrected", async () => {
    const sideInitial: FacePhotoReference = { ...initial, view: "side" };
    const saved = { sideEye: { x: .6, y: .2 }, sideNose: { x: .5, y: .3 }, sideChin: { x: .55, y: .7 } };
    const detected = { ...saved, sideNoseRoot: { x: .54, y: .27 } };
    mocks.autoMarkFacePhoto.mockResolvedValueOnce({ points: detected,
        prepared: { ...preparation, view: "side", canvas: { toDataURL: () => "data:image/png;base64,crop" } } });
    const p = { ...props(), view: "side" as const, points: saved };
    const view = render(<FacePhotoInput {...p} initial={sideInitial} />);
    await screen.findByText(/侧脸照已通过检查/);
    fireEvent.click(screen.getByText("查看512×512标准化裁剪和校正点位"));
    const rootButton = screen.getByRole("button", { name: "侧面鼻根（山根）" });
    expect(rootButton).toHaveAttribute("aria-pressed", "false");
    const image = screen.getByAltText("苏砚侧脸拟合原图");
    image.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) });
    fireEvent.click(rootButton);
    fireEvent.click(image, { clientX: 43, clientY: 29 });
    expect(p.onMark).toHaveBeenCalledWith("sideNoseRoot", { x: .43, y: .29 });
    expect(mocks.uploadLibraryImage).not.toHaveBeenCalled();
    view.unmount();
});

it("invalidates saved references whose original dimensions no longer match", async () => {
    const p = props(); render(<FacePhotoInput {...p} initial={{ ...initial, sourceWidth: 900 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("尺寸与保存记录不一致");
    expect(p.onChange).toHaveBeenCalledWith(); expect(mocks.uploadLibraryImage).not.toHaveBeenCalled();
});

it("ignores a completed detector after the input has unmounted", async () => {
    let finish!: (value: any) => void;
    mocks.autoMarkFacePhoto.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const p = props(), view = render(<FacePhotoInput {...p} />); upload();
    await waitFor(() => expect(finish).toBeDefined()); view.unmount();
    await act(async () => finish({ points, prepared: { ...preparation, canvas: { toDataURL: () => "crop" } } }));
    expect(mocks.uploadLibraryImage).not.toHaveBeenCalled(); expect(p.onChange).toHaveBeenCalledTimes(1);
});
