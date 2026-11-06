// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import WhiteFaceModel from "./WhiteFaceModel";
import { DEFAULT_FACE_SHAPE } from "@/lib/whiteFaceShape";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";
import headMesh from "../../../../public/models/character/makehuman-face-v1/head.json";
import { FACE_FIT_LANDMARK_CONVENTION, FACE_FIT_OBJECTIVE } from "@/lib/whiteFaceFit";
import { FACE_FIT_IMAGE_SPEC, type PreparedFaceImage } from "@/lib/whiteFaceImage";

const meshData = headMesh as WhiteFaceMeshData;

const { uploadLibraryImage, createLibraryAsset, authenticatedFetch, autoMarkThreeView, autoMarkFrontReference, resolveAssetVariantDelivery } = vi.hoisted(() => ({
    uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(), authenticatedFetch: vi.fn(), autoMarkThreeView: vi.fn(), autoMarkFrontReference: vi.fn(), resolveAssetVariantDelivery: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({ Canvas: () => <canvas /> }));
vi.mock("@/lib/api", () => ({ API_URL: "http://test", authenticatedFetch, api: { uploadLibraryImage, createLibraryAsset } }));
vi.mock("@/lib/whiteFaceAutoLandmarks", () => ({ autoMarkThreeView, autoMarkFrontReference }));
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
    autoMarkFrontReference.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:three-view");
    URL.revokeObjectURL = vi.fn();
    HTMLCanvasElement.prototype.toBlob = function (callback) {
        callback(new Blob(["white-face"], { type: "image/png" }));
    };
});

const portraitPoints = {
    frontLeftCheek: { x: .2, y: .35 }, frontRightCheek: { x: .45, y: .35 },
    frontLeftJaw: { x: .23, y: .45 }, frontRightJaw: { x: .42, y: .45 },
    frontLeftEye: { x: .26, y: .33 }, frontRightEye: { x: .38, y: .33 }, frontChin: { x: .32, y: .55 },
};
const profilePoints = { sideEye: { x: .55, y: .12 }, sideNose: { x: .51, y: .16 }, sideChin: { x: .53, y: .25 } };
const sheetSource = { scope: "series" as const, containerId: "series-1", assetId: "su-yan", variantId: "three-view-1" };
const portraitSource = { ...sheetSource, variantId: "avatar-1" };

it("fits and saves independent original images with separate points and source provenance", async () => {
    const crop = { x: 40, y: 180, width: 430, height: 430 };
    const canvas = { toDataURL: () => "data:image/png;base64,preview" } as HTMLCanvasElement;
    autoMarkFrontReference.mockImplementation(async (_image, options) => {
        options.onPrepared([{ view: "front", crop, sourceFaceHeight: 307, detected: true, canvas }]);
        return portraitPoints;
    });
    autoMarkThreeView.mockImplementation(async (_image, options) => {
        options.onPrepared([{ view: "side", crop, sourceFaceHeight: 91, detected: true, canvas }]);
        return profilePoints;
    });
    const onSaved = vi.fn();
    const { rerender } = render(<WhiteFaceModel characterName="苏砚" fitSource={sheetSource} portraitSource={portraitSource} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const sheet = await screen.findByAltText("苏砚三视图拟合参考");
    fireEvent.change(screen.getByLabelText("正面参考"), { target: { value: "portrait" } });
    fireEvent.change(screen.getByLabelText("正脸所在区域"), { target: { value: "left" } });
    const portrait = await screen.findByAltText("苏砚头像正脸拟合参考");
    Object.defineProperties(portrait, { naturalWidth: { value: 1024 }, naturalHeight: { value: 1024 } });
    Object.defineProperties(sheet, { naturalWidth: { value: 1223 }, naturalHeight: { value: 1286 } });
    fireEvent.load(portrait);
    await screen.findByText(/已标记头像正脸/);
    fireEvent.load(sheet);
    await screen.findByText("已标记 10/10 · 可以拟合");
    expect(autoMarkThreeView).toHaveBeenLastCalledWith(sheet, { views: ["side"], onPrepared: expect.any(Function) });
    expect(autoMarkFrontReference).toHaveBeenLastCalledWith(portrait, { region: "left", onPrepared: expect.any(Function) });
    expect(resolveAssetVariantDelivery).toHaveBeenCalledWith({ scope: "series", containerId: "series-1", assetType: "character", assetId: "su-yan", variantId: "avatar-1" });
    expect(within(screen.getByLabelText("独立正脸参考")).getByTitle("正面画面左颧部")).toHaveStyle({ left: "20%" });
    expect(portrait.parentElement?.querySelector('[title="侧面眼中心"]')).toBeNull();
    expect(sheet.parentElement?.querySelector('[title="正面画面左颧部"]')).toBeNull();
    vi.spyOn(portrait, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: /正面画面左颧部/ }));
    fireEvent.click(portrait, { clientX: 19, clientY: 35 });
    fireEvent.click(screen.getByRole("button", { name: "拟合白模" }));
    fireEvent.click(screen.getByLabelText("已核对正面与侧面白模"));
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const calibration = onSaved.mock.calls[0][2].calibration;
    expect(calibration.frontReference).toEqual({
        source: { asset_type: "character", asset_id: "su-yan", variant_id: "avatar-1", source_scope: "series", source_container_id: "series-1" },
        region: "left", sourceWidth: 1024, sourceHeight: 1024,
        preparation: { view: "front", crop, sourceFaceHeight: 307, detected: true },
    });
    expect(calibration.imagePreparation).toMatchObject({ sourceWidth: 1223, sourceHeight: 1286, views: [{ view: "side" }] });
    expect(calibration.landmarks.frontLeftCheek).toEqual({ x: .19, y: .35 });
    expect(calibration.landmarks.sideEye).toEqual(profilePoints.sideEye);
    expect(JSON.stringify(calibration)).not.toContain("data:image");
    fireEvent.change(screen.getByLabelText("正脸所在区域"), { target: { value: "right" } });
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    expect(screen.getByLabelText("已核对正面与侧面白模")).toBeDisabled();
    rerender(<WhiteFaceModel characterName="苏砚" fitSource={sheetSource} portraitSource={{ ...portraitSource, variantId: "avatar-2" }} onSaved={onSaved} />);
    await waitFor(() => expect(screen.getByText(/已标记 0\/10/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
});

it("discards old portrait callbacks after changing region without clearing a newer busy state", async () => {
    let finishOld: (value: object) => void = () => {};
    let finishNew: (value: object) => void = () => {};
    let oldPrepared: (value: PreparedFaceImage[]) => void = () => {};
    autoMarkFrontReference.mockImplementationOnce((_image, options) => {
        oldPrepared = options.onPrepared;
        return new Promise(resolve => { finishOld = resolve; });
    }).mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    render(<WhiteFaceModel characterName="苏砚" fitSource={sheetSource} portraitSource={portraitSource} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    await screen.findByAltText("苏砚三视图拟合参考");
    fireEvent.change(screen.getByLabelText("正面参考"), { target: { value: "portrait" } });
    const oldImage = await screen.findByAltText("苏砚头像正脸拟合参考");
    Object.defineProperties(oldImage, { naturalWidth: { value: 1024 }, naturalHeight: { value: 1024 } });
    fireEvent.load(oldImage);
    await waitFor(() => expect(autoMarkFrontReference).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("正脸所在区域"), { target: { value: "left" } });
    const newImage = await screen.findByAltText("苏砚头像正脸拟合参考");
    expect(newImage).not.toBe(oldImage);
    Object.defineProperties(newImage, { naturalWidth: { value: 1024 }, naturalHeight: { value: 1024 } });
    fireEvent.load(newImage);
    await waitFor(() => expect(autoMarkFrontReference).toHaveBeenCalledTimes(2));
    await act(async () => {
        oldPrepared([{ view: "front", crop: { x: 0, y: 0, width: 512, height: 512 }, sourceFaceHeight: 999, detected: true,
            canvas: { toDataURL: () => "stale" } as HTMLCanvasElement }]);
        finishOld({ ...portraitPoints, frontLeftCheek: { x: .99, y: .99 } });
    });
    expect(screen.getByRole("button", { name: "拟合白模" })).toBeDisabled();
    expect(screen.queryByAltText("正面标准化人脸")).not.toBeInTheDocument();
    await act(async () => finishNew(portraitPoints));
    expect(screen.getByRole("button", { name: "拟合白模" })).toBeEnabled();
    expect(screen.getByTitle("正面画面左颧部")).toHaveStyle({ left: "20%", top: "35%" });
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
    expect(autoMarkThreeView).toHaveBeenCalledWith(image, { onPrepared: expect.any(Function) });
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

it("previews standardized faces, warns on native detail, and saves crop provenance without preview images", async () => {
    const points = {
        frontLeftCheek: { x: .19, y: .16 }, frontRightCheek: { x: .31, y: .16 },
        frontLeftJaw: { x: .21, y: .21 }, frontRightJaw: { x: .29, y: .21 },
        frontLeftEye: { x: .22, y: .12 }, frontRightEye: { x: .28, y: .12 },
        frontChin: { x: .25, y: .25 }, sideEye: { x: .55, y: .12 },
        sideNose: { x: .51, y: .16 }, sideChin: { x: .53, y: .25 },
    };
    const crop = { x: 20, y: 20, width: 160, height: 160 };
    const canvas = { toDataURL: () => "data:image/png;base64,face-preview" } as HTMLCanvasElement;
    autoMarkThreeView.mockImplementation(async (_image, { onPrepared }) => {
        onPrepared([
            { view: "front", crop, sourceFaceHeight: 99, detected: true, canvas },
            { view: "side", crop: { ...crop, x: 400 }, sourceFaceHeight: 280, detected: true, canvas },
        ] as PreparedFaceImage[]);
        return points;
    });
    const onSaved = vi.fn();
    const fitSource = { scope: "series" as const, containerId: "series-1", assetId: "su-yan", variantId: "three-view-1" };
    const { rerender } = render(<WhiteFaceModel characterName="苏砚" fitSource={fitSource} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    Object.defineProperties(image, { naturalWidth: { value: 1223 }, naturalHeight: { value: 1286 } });
    fireEvent.load(image);
    expect(await screen.findByAltText("正面标准化人脸")).toHaveAttribute("width", "512");
    expect(screen.getByAltText("侧面标准化人脸")).toBeInTheDocument();
    expect(screen.getAllByText(/原始人脸小于 128 像素/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "拟合白模" }));
    fireEvent.click(screen.getByLabelText("已核对正面与侧面白模"));
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const preparation = onSaved.mock.calls[0][2].calibration.imagePreparation;
    expect(preparation).toMatchObject({ version: FACE_FIT_IMAGE_SPEC.version, size: 512, sourceWidth: 1223, sourceHeight: 1286 });
    expect(preparation.views[0]).toEqual({ view: "front", crop, sourceFaceHeight: 99, detected: true });
    expect(JSON.stringify(preparation)).not.toContain("data:image");
    rerender(<WhiteFaceModel characterName="苏砚" fitSource={{ ...fitSource, variantId: "three-view-2" }} onSaved={onSaved} />);
    await waitFor(() => expect(screen.queryByAltText("正面标准化人脸")).not.toBeInTheDocument());
});

it("disables fitting and saving while preprocessing is running", async () => {
    let finish: (points: object) => void = () => {};
    autoMarkThreeView.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    fireEvent.load(image);
    expect(screen.getByRole("button", { name: "拟合白模" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    finish({ frontChin: { x: .2, y: .2 } });
    await waitFor(() => expect(screen.getByRole("button", { name: "拟合白模" })).toBeEnabled());
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
        residual: expect.any(Number), landmarkConvention: FACE_FIT_LANDMARK_CONVENTION, fitObjective: FACE_FIT_OBJECTIVE,
        fitDiagnostics: expect.objectContaining({ metrics: expect.any(Array) }),
    }));
    expect(createLibraryAsset.mock.calls[0][1].description).not.toContain("中性基准 100%");
});

it("retains old calibrated geometry but requires fresh marking and fitting", async () => {
    const { basePreset, ...baseline } = DEFAULT_FACE_SHAPE;
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} initialShape={{ ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
        schema: "iframe.white-face-fit.v1", baseline: { ...baseline, jawWidth: 125 },
        source: { asset_type: "character", asset_id: "su-yan", variant_id: "three-view-1" },
        landmarks: { sideChin: { x: .5, y: .2 } }, residual: .239, reviewed: true,
    } }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    await screen.findByAltText("苏砚三视图拟合参考");
    expect(screen.getByText(/已标记 0\/10/)).toBeInTheDocument();
    expect(screen.getByText("拟合方法或标记点已变更，请重新拟合并核对。")).toBeInTheDocument();
    expect(screen.getByLabelText("已核对正面与侧面白模")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    expect(screen.getByLabelText("基础脸型正面与侧面预览")).toBeInTheDocument();
});

it("requires refitting after a reviewed mark is moved", async () => {
    const { basePreset, ...baseline } = DEFAULT_FACE_SHAPE;
    const points = {
        frontLeftCheek: { x: .19, y: .16 }, frontRightCheek: { x: .31, y: .16 },
        frontLeftJaw: { x: .21, y: .21 }, frontRightJaw: { x: .29, y: .21 },
        frontLeftEye: { x: .22, y: .12 }, frontRightEye: { x: .28, y: .12 },
        frontChin: { x: .25, y: .25 }, sideEye: { x: .55, y: .12 },
        sideNose: { x: .51, y: .16 }, sideChin: { x: .53, y: .25 },
    };
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} initialShape={{ ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
        schema: "iframe.white-face-fit.v1", landmarkConvention: FACE_FIT_LANDMARK_CONVENTION, fitObjective: FACE_FIT_OBJECTIVE, baseline,
        source: { asset_type: "character", asset_id: "su-yan", variant_id: "three-view-1" },
        landmarks: points, residual: .1, reviewed: true,
    } }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    await waitFor(() => expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeEnabled());
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: /侧面下巴前端/ }));
    fireEvent.click(image, { clientX: 51, clientY: 24 });
    expect(screen.getByLabelText("已核对正面与侧面白模")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
});

it("reuses convention-compatible marks but requires refitting a reviewed result from the old objective", async () => {
    const { basePreset, ...baseline } = DEFAULT_FACE_SHAPE;
    const points = {
        frontLeftCheek: { x: .19, y: .16 }, frontRightCheek: { x: .31, y: .16 },
        frontLeftJaw: { x: .21, y: .21 }, frontRightJaw: { x: .29, y: .21 },
        frontLeftEye: { x: .22, y: .12 }, frontRightEye: { x: .28, y: .12 },
        frontChin: { x: .25, y: .25 }, sideEye: { x: .55, y: .12 },
        sideNose: { x: .51, y: .16 }, sideChin: { x: .53, y: .25 },
    };
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="苏砚" fitSource={{
        scope: "series", containerId: "series-1", assetId: "su-yan", variantId: "three-view-1",
    }} initialShape={{ ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
        schema: "iframe.white-face-fit.v1", landmarkConvention: FACE_FIT_LANDMARK_CONVENTION, baseline,
        source: { asset_type: "character", asset_id: "su-yan", variant_id: "three-view-1" },
        landmarks: points, residual: .002, reviewed: true,
    } }} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    const image = await screen.findByAltText("苏砚三视图拟合参考");
    Object.defineProperties(image, { naturalWidth: { value: 1223 }, naturalHeight: { value: 1286 } });
    expect(screen.getByText(/已标记 10\/10/)).toBeInTheDocument();
    expect(screen.getByLabelText("已核对正面与侧面白模")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "拟合白模" }));
    expect(screen.getByLabelText("已核对正面与侧面白模")).not.toBeChecked();
    expect(screen.getByLabelText("已核对正面与侧面白模")).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("已核对正面与侧面白模"));
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onSaved.mock.calls[0][2].calibration).toMatchObject({ fitObjective: FACE_FIT_OBJECTIVE, reviewed: true });
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
        description: expect.stringContaining("脸部纵向轮廓拉长（脸部长度调节值112%）"),
    }));
    expect(onSaved).toHaveBeenCalledWith(
        { asset_type: "prop", asset_id: "face-prop", variant_id: "face-v1", application_mode: "reference_only", applied_fields: ["face_geometry"] },
        expect.stringContaining("鼻尖突出度增强（鼻尖突出度调节值118%）"),
        expect.objectContaining({ faceLength: 112, foreheadWidth: 108, mouthCornerTilt: 115 }),
    );
    expect(createLibraryAsset.mock.calls[0][1].description).toContain("嘴角上提（嘴角倾斜调节值115%）");
});

it("compares the base face with the edit and exports only the edited preview", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="苏砚" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByLabelText("基础脸型正面与侧面预览")).toBeInTheDocument();
    expect(screen.getByLabelText("当前调整正面与侧面预览")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(2));
    fireEvent.click(screen.getByLabelText("显示鼻部放大对比"));
    expect(screen.getByLabelText("基准鼻部正面放大预览")).toBeInTheDocument();
    expect(screen.getByLabelText("当前鼻部侧面放大预览")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll("canvas")).toHaveLength(6));
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
