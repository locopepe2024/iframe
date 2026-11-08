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
vi.mock("./FacePhotoInput", () => ({ default: ({ view, initial, onChange, onMark }: any) => <div aria-label={`${view} photo input`}>
    <button onClick={() => onChange({ view, source: { asset_type: "prop", asset_id: view, variant_id: `${view}-v1`, source_scope: "global" },
        sourceWidth: view === "front" ? 800 : 600, sourceHeight: 1000,
        preparation: { view, crop: { x: 0, y: 0, width: 500, height: 500 }, detected: true, sourceFaceHeight: 350 } }, view === "front" ? portraitPoints : profilePoints)}>load {view}</button>
    <button onClick={() => onChange()}>clear {view}</button>
    <button onClick={() => onMark(view === "front" ? "frontLeftCheek" : "sideNoseRoot", { x: .19, y: .35 })}>correct {view}</button>
    {initial && <span>{initial.source.variant_id}</span>}
</div> }));
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
const profilePoints = { sideEye: { x: .55, y: .12 }, sideNoseRoot: { x: .52, y: .145 }, sideNose: { x: .51, y: .16 }, sideChin: { x: .53, y: .25 } };
const sheetSource = { scope: "series" as const, containerId: "series-1", assetId: "su-yan", variantId: "three-view-1" };
const portraitSource = { ...sheetSource, variantId: "avatar-1" };

it("saves the edited geometry as a stable reference and matching prompt", async () => {
    const onSaved = vi.fn();
    render(<WhiteFaceModel characterName="探子首领" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText(/脸部长度/), { target: { value: "112" } });
    fireEvent.change(screen.getByLabelText(/鼻尖突出度/), { target: { value: "118" } });
    fireEvent.change(screen.getByLabelText("鼻根前突"), { target: { value: "115" } });
    fireEvent.change(screen.getByLabelText("鼻梁高度"), { target: { value: "108" } });
    fireEvent.change(screen.getByLabelText(/额头宽度/), { target: { value: "108" } });
    fireEvent.click(screen.getByText("嘴唇与下巴"));
    fireEvent.change(screen.getByLabelText(/嘴角倾斜/), { target: { value: "115" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(createLibraryAsset).toHaveBeenCalledWith("prop", expect.objectContaining({
        name: "探子首领 · 面部比例白模", image_url: "uploads/white-face.png",
        description: expect.stringContaining("两眼中心连线到下巴最低点的垂直距离"),
    }));
    expect(onSaved).toHaveBeenCalledWith(
        { asset_type: "prop", asset_id: "face-prop", variant_id: "face-v1", application_mode: "reference_only", applied_fields: ["face_geometry"] },
        expect.stringContaining("鼻尖到过眼中心竖直线的水平距离"),
        expect.objectContaining({ faceLength: 112, foreheadWidth: 108, mouthCornerTilt: 115, noseRootHeight: 115, noseBridgeHeight: 108 }),
    );
    expect(createLibraryAsset.mock.calls[0][1].description).toContain("嘴角上提为正");
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

it("shows the defined reference baseline and measured target independently of the slider value", () => {
    render(<WhiteFaceModel characterName="苏砚" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText("脸部长度"), { target: { value: "90" } });
    fireEvent.click(screen.getByText("查看出图测量定义、参考基准与目标值"));
    const table = screen.getByRole("table", { name: "出图测量目标" });
    expect(table).toHaveTextContent("两眼中心连线到下巴最低点的垂直距离");
    expect(table).toHaveTextContent("参考图该距离为100，目标96");
    expect(screen.getByLabelText("脸部长度")).toHaveValue("90");
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

it("reports unsaved sliders and clears dirty status only when the saved shape returns", async () => {
    const onDirtyChange = vi.fn(), onSaved = vi.fn();
    const props = { characterName: "苏砚", initialShape: DEFAULT_FACE_SHAPE, onSaved, onDirtyChange, standalone: true };
    const view = render(<WhiteFaceModel {...props} />);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    fireEvent.change(screen.getByLabelText("鼻梁宽度"), { target: { value: "110" } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    view.rerender(<WhiteFaceModel {...props} initialShape={{ ...DEFAULT_FACE_SHAPE, noseBridgeWidth: 110 }} />);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

it("requires both independent photos, saves crop provenance and restores sources without legacy region choices", async () => {
    const onSaved = vi.fn(); const view = render(<WhiteFaceModel characterName="苏砚" fitSource={sheetSource} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByRole("button", { name: "拟合白模" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "load front" }));
    expect(screen.getByRole("button", { name: "拟合白模" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "load side" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "拟合白模" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "拟合白模" }));
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /已核对正面与侧面白模及同一角色身份/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const shape = onSaved.mock.calls[0][2];
    expect(shape.calibration.referencePair).toMatchObject({ schema: "iframe.face-reference-pair.v1", front: { sourceWidth: 800 }, side: { sourceWidth: 600 } });
    expect(shape.calibration.frontReference.region).toBe("whole");
    expect(JSON.stringify(shape.calibration)).not.toMatch(/data:image|blob:/);
    view.rerender(<WhiteFaceModel characterName="苏砚" initialShape={shape} onSaved={onSaved} />);
    expect(screen.getByText("front-v1")).toBeVisible(); expect(screen.getByText("side-v1")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /已核对正面与侧面白模及同一角色身份/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "correct side" }));
    expect(screen.getByRole("checkbox", { name: /已核对正面与侧面白模及同一角色身份/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存骨相参数" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(onSaved.mock.calls[1][2].calibration.landmarks.sideNoseRoot).toEqual({ x: .19, y: .35 });
    expect(onSaved.mock.calls[1][2].noseBridgeHeight).toBe(shape.noseBridgeHeight);
    fireEvent.click(screen.getByRole("button", { name: "correct front" }));
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /已核对正面与侧面白模及同一角色身份/ })).toBeDisabled();
    expect(screen.queryByLabelText("正脸所在区域")).toBeNull();
    expect(screen.queryByLabelText("正面参考")).toBeNull();
});

it("keeps legacy geometry but requires an independent pair to refit or save a calibrated edit", () => {
    const { basePreset, ...baseline } = DEFAULT_FACE_SHAPE;
    render(<WhiteFaceModel characterName="苏砚" initialShape={{ ...DEFAULT_FACE_SHAPE, noseBridgeWidth: 110,
        calibration: { schema: "iframe.white-face-fit.v1", source: { asset_type: "character", asset_id: "role", variant_id: "old-sheet" }, baseline, landmarks: {}, residual: .03 } }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "面部比例白模" }));
    expect(screen.getByLabelText("鼻梁宽度")).toHaveValue("110");
    expect(screen.getByText(/旧骨相数值已保留/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存骨相参数" })).toBeDisabled();
});
