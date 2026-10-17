import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SceneImageTools } from "./SceneImageTools";

const apiMocks = vi.hoisted(() => ({
    uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ API_URL: "", api: apiMocks }));

const sources = [{ key: "source", label: "场景图片 · 1", url: "/source.png", variantId: "source" }];

it("requires a saved scene image and disables submission while busy", () => {
    const onGenerate = vi.fn();
    const { rerender } = render(<SceneImageTools kind="lighting" sources={[]} busy={false} onGenerate={onGenerate} />);
    expect(screen.getByRole("button", { name: "查看并确认提示词" })).toBeDisabled();
    rerender(<SceneImageTools kind="lighting" sources={sources} busy onGenerate={onGenerate} />);
    expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
    expect(onGenerate).not.toHaveBeenCalled();
});

it("submits camera angle and focus settings as structured parameters", () => {
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="camera" sources={sources} busy={false} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "镜头向右" }));
    fireEvent.click(screen.getByLabelText("指定对焦点"));
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    expect(screen.getByText("提交前提示词核对")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenCalledWith(sources[0], expect.objectContaining({
        kind: "camera", yaw: 15, pitch: 0, focus: true, focus_x: 50, focus_y: 50,
    }), expect.any(String), undefined);
    expect(screen.getByTestId("camera-preview")).toHaveTextContent("水平 15°");
});

it("submits lighting direction, preset, and stable reference identity", () => {
    const onGenerate = vi.fn();
    const reference = { asset_type: "prop" as const, asset_id: "light-ref", variant_id: "variant" };
    render(<SceneImageTools kind="lighting" sources={sources} sceneAssetId="scene" lightingReferences={[
        { key: "light-ref", label: "蓝色参考", url: "/light.png", reference },
    ]} busy={false} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "后方" }));
    fireEvent.click(screen.getByRole("button", { name: "诺兰冷灰" }));
    fireEvent.change(screen.getByLabelText("光影参考图（可选）"), { target: { value: "light-ref" } });
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenCalledWith(sources[0], expect.objectContaining({
        kind: "lighting", light_side: "back", preset: "nolan_cool_gray", brightness: 50,
    }), expect.any(String), reference);
    expect(screen.getByTestId("lighting-preview")).toHaveTextContent("透视观察");
});

it("uploads a separate lighting reference into the asset library before submission", async () => {
    apiMocks.uploadLibraryImage.mockResolvedValue({ image_url: "uploads/light.png" });
    apiMocks.createLibraryAsset.mockResolvedValue({
        id: "uploaded-prop", name: "光影参考 · light.png",
        image_asset: { variants: [{ id: "uploaded-v1", url: "uploads/light.png" }] },
    });
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="lighting" sources={sources} sceneAssetId="scene" busy={false} onGenerate={onGenerate} />);
    fireEvent.change(screen.getByLabelText("上传光影参考图"), {
        target: { files: [new File(["image"], "light.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(apiMocks.uploadLibraryImage).toHaveBeenCalled());
    await waitFor(() => expect(apiMocks.createLibraryAsset).toHaveBeenCalled());
    await waitFor(() => {
        const error = screen.queryByRole("alert");
        if (error) throw new Error(error.textContent || "upload failed");
        expect(screen.getByAltText("光影参考图：光影参考 · light.png")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenCalledWith(sources[0], expect.objectContaining({ kind: "lighting" }), expect.any(String), {
        asset_type: "prop", asset_id: "uploaded-prop", variant_id: "uploaded-v1",
    });
});
