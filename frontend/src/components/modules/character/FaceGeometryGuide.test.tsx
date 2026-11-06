// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import FaceGeometryGuide from "./FaceGeometryGuide";
import { DEFAULT_FACE_SHAPE } from "@/lib/whiteFaceShape";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), fetch: vi.fn(), create: vi.fn(), upload: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/api", () => ({ API_URL: "http://localhost", authenticatedFetch: mocks.fetch,
    api: { uploadLibraryImage: mocks.upload, createLibraryAsset: mocks.create } }));
vi.mock("@/lib/mediaDelivery", () => ({ resolveAssetVariantDelivery: mocks.resolve }));
vi.mock("@/lib/createFaceGeometryGuide", () => ({ createFaceGeometryGuide: mocks.preview }));
const changedShape = { ...DEFAULT_FACE_SHAPE, cheekWidth: 110 };
const source = { scope: "series" as const, containerId: "series", assetId: "role", variantId: "portrait" };
const result = () => ({ blob: new Blob(["guide"], { type: "image/png" }), sourceFaceHeight: 501, verified: true, iterations: 4,
    checks: [{ key: "faceLength", label: "脸长／颧宽", target: 84.48, observed: 85.21, error: .009 }], omitted: ["鼻尖突出度"] });
beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
    mocks.resolve.mockResolvedValue("http://localhost/source.png");
    mocks.fetch.mockResolvedValue({ ok: true, blob: async () => new Blob(["source"], { type: "image/png" }) });
    mocks.preview.mockResolvedValue(result()); mocks.upload.mockResolvedValue({ image_url: "uploads/guide.png" });
    mocks.create.mockResolvedValue({ id: "guide", image_asset: { variants: [{ id: "guide-v1" }] } });
});
async function preview() {
    const image = await screen.findByAltText("骨相引导原始头像");
    Object.defineProperty(image, "naturalWidth", { value: 1000 });
    fireEvent.click(screen.getByRole("button", { name: "制作本地引导预览" }));
    await screen.findByAltText("局部变形后的骨相引导图");
}

it("previews without writes and requires visual review before uploading and applying the guide", async () => {
    const onApplied = vi.fn();
    render(<FaceGeometryGuide characterName="苏砚" shape={changedShape} source={source} onApplied={onApplied} />);
    await preview();
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("table", { name: "骨相引导比例复核" })).toHaveTextContent("85.21");
    const use = screen.getByRole("button", { name: "使用引导图细化头像" }); expect(use).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(use);
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith("prop", expect.objectContaining({ description: expect.stringContaining('"source"') }));
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ asset_id: "guide", variant_id: "guide-v1" }), JSON.stringify(changedShape));
});

it("invalidates preview and review when the saved shape or region changes", async () => {
    const props = { characterName: "苏砚", shape: changedShape, source, onApplied: vi.fn() };
    const view = render(<FaceGeometryGuide {...props} />); await preview(); fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(<FaceGeometryGuide {...props} shape={{ ...DEFAULT_FACE_SHAPE, cheekWidth: 117 }} />);
    expect(screen.queryByAltText("局部变形后的骨相引导图")).toBeNull();
    await preview(); fireEvent.change(screen.getByLabelText("引导图正脸区域"), { target: { value: "left" } });
    expect(screen.queryByAltText("局部变形后的骨相引导图")).toBeNull();
    expect(screen.getByText(/单人正脸头像请选/)).toHaveTextContent("已选择左半图");
    fireEvent.change(screen.getByLabelText("引导图正脸区域"), { target: { value: "whole" } });
    expect(screen.queryByText(/单人正脸头像请选/)).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
});

it("rejects failed output verification and ignores an obsolete preview result", async () => {
    mocks.preview.mockResolvedValueOnce({ ...result(), verified: false });
    const props = { characterName: "苏砚", shape: changedShape, source, onApplied: vi.fn() };
    const view = render(<FaceGeometryGuide {...props} />); await preview();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "使用引导图细化头像" })).toBeDisabled();
    let finish!: (value: ReturnType<typeof result>) => void;
    mocks.preview.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "制作本地引导预览" }));
    view.rerender(<FaceGeometryGuide {...props} source={{ ...source, variantId: "new" }} />);
    await act(async () => finish(result()));
    expect(screen.queryByAltText("局部变形后的骨相引导图")).toBeNull(); expect(props.onApplied).not.toHaveBeenCalled();
});

it("reports upload failure and does not apply an unpersisted reference", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("上传失败")); const onApplied = vi.fn();
    render(<FaceGeometryGuide characterName="苏砚" shape={changedShape} source={source} onApplied={onApplied} />);
    await preview(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "使用引导图细化头像" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上传失败"); expect(onApplied).not.toHaveBeenCalled();
});

it("blocks stale saved controls during unsaved editing and invalidates the old preview", async () => {
    const props = { characterName: "苏砚", shape: changedShape, source, onApplied: vi.fn() };
    const view = render(<FaceGeometryGuide {...props} />); await preview();
    view.rerender(<FaceGeometryGuide {...props} editingPending />);
    expect(screen.getByText(/骨相参数尚未保存/)).toBeVisible();
    expect(screen.getByRole("button", { name: "制作本地引导预览" })).toBeDisabled();
    expect(screen.queryByAltText("局部变形后的骨相引导图")).toBeNull();
    view.rerender(<FaceGeometryGuide {...props} shape={{ ...changedShape, noseBridgeWidth: 110 }} />);
    expect(screen.getByRole("button", { name: "制作本地引导预览" })).toBeEnabled();
    expect(mocks.upload).not.toHaveBeenCalled();
});

it("discloses unsupported depth changes and prevents a depth-only unchanged guide", async () => {
    render(<FaceGeometryGuide characterName="苏砚" shape={{ ...DEFAULT_FACE_SHAPE, noseBridgeHeight: 110 }} source={source} onApplied={vi.fn()} />);
    await screen.findByAltText("骨相引导原始头像");
    expect(screen.getByText(/本次未应用/)).toHaveTextContent("鼻梁隆起高度");
    expect(screen.getByRole("button", { name: "制作本地引导预览" })).toBeDisabled();
    expect(mocks.preview).not.toHaveBeenCalled();
});

it("shows matching nasal crops and rejects an unreliable pixel check", async () => {
    mocks.preview.mockResolvedValue({ ...result(), verified: false, pixelCheckPassed: false,
        noseComparison: { original: new Blob(["before"]), guide: new Blob(["after"]) } });
    render(<FaceGeometryGuide characterName="苏砚" shape={{ ...DEFAULT_FACE_SHAPE, noseBridgeWidth: 110 }} source={source} onApplied={vi.fn()} />);
    await preview();
    expect(screen.getByAltText("原始鼻部放大")).toBeVisible();
    expect(screen.getByAltText("引导图鼻部放大")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("鼻部纹理核对未通过");
    expect(screen.getByRole("button", { name: "使用引导图细化头像" })).toBeDisabled();
});
