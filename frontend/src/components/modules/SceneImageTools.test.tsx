import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SceneImageTools, containedImageBounds } from "./SceneImageTools";

const apiMocks = vi.hoisted(() => ({
    uploadLibraryImage: vi.fn(), createLibraryAsset: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ API_URL: "", api: apiMocks }));
vi.mock("next/dynamic", () => ({ default: () => ({ onChange }: { onChange: (a: number, e: number) => void }) =>
    <button type="button" onClick={() => onChange(45, 30)}>选择三维方向</button> }));

const sources = [{ key: "source", label: "场景图片 · 1", url: "/source.png", variantId: "source" }];

it("compiles picked light coordinates and resets to a cardinal direction explicitly", () => {
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="lighting" sources={sources} busy={false} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "选择三维方向" }));
    expect(screen.getByLabelText("光源方位角")).toHaveValue("45");
    expect(screen.getByLabelText("光源仰角")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenLastCalledWith(sources[0], expect.objectContaining({ azimuth: 45, elevation: 30 }), expect.stringContaining("右前方上方"), undefined);
    fireEvent.click(screen.getByRole("button", { name: "左侧" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate.mock.lastCall?.[1]).not.toHaveProperty("azimuth");
    expect(onGenerate.mock.lastCall?.[2]).toContain("主光从左侧进入");
});

it("maps picked camera elevation to existing pitch and keeps focusing independent", () => {
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="camera" sources={sources} busy={false} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "选择三维方向" }));
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenCalledWith(sources[0], expect.objectContaining({ yaw: 45, pitch: -30, focus: false, preset: "custom" }), expect.stringContaining("水平环绕 45°；垂直俯仰 -30°"), undefined);
});

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

it("maps a pointer to the displayed image rather than the letterboxed container", () => {
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="camera" sources={sources} busy={false} onGenerate={onGenerate} />);
    const image = screen.getByAltText("来源图片：场景图片 · 1") as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { value: 1600 });
    Object.defineProperty(image, "naturalHeight", { value: 900 });
    image.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 } as DOMRect);
    const stage = image.parentElement as HTMLDivElement;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 } as DOMRect);
    expect(containedImageBounds(image)).toEqual({ left: 0, top: 37.5, width: 400, height: 225 });
    fireEvent.load(image);
    fireEvent.click(screen.getByLabelText("指定对焦点"));
    fireEvent.pointerDown(stage, { clientX: 200, clientY: 75, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenCalledWith(sources[0], expect.objectContaining({
        kind: "camera", focus: true, focus_x: 50, focus_y: 17,
    }), expect.any(String), undefined);
});

it("submits shared lighting panel settings and stable reference identity", () => {
    const onGenerate = vi.fn();
    const reference = { asset_type: "prop" as const, asset_id: "light-ref", variant_id: "variant" };
    render(<SceneImageTools kind="lighting" sources={sources} sceneAssetId="scene" lightingReferences={[
        { key: "light-ref", label: "蓝色参考", url: "/light.png", reference },
    ]} busy={false} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole("button", { name: "后方" }));
    fireEvent.click(screen.getByText("光影", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "清冷" }));
    fireEvent.change(screen.getByLabelText("光影参考图（可选）"), { target: { value: "light-ref" } });
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate).toHaveBeenCalledWith(sources[0], expect.objectContaining({
        kind: "lighting", light_side: "back", preset: null, panel_settings: { version: 1, lighting: { mood: "清冷疏离的空间氛围" } }, brightness: 50,
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

it("uses atmosphere templates to fill the shared panel without legacy preset injection", () => {
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="lighting" sources={sources} busy={false} onGenerate={onGenerate} />);
    expect(screen.queryByText("光影预设")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Prompt 模板 · 氛围", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "黄金时刻" }));
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    const [, tool, prompt] = onGenerate.mock.lastCall!;
    expect(tool.preset).toBeNull();
    expect(tool.azimuth).toBe(90);
    expect(tool.elevation).toBe(12);
    expect(tool.panel_settings.lighting.source).toBe("临近日落的太阳光");
    expect(tool.panel_settings.lighting.quality).toContain("柔和");
    expect(tool.panel_settings.lighting).not.toHaveProperty("angles");
    expect(prompt).toContain("温暖舒缓的傍晚氛围");
    expect(prompt).not.toContain("不额外增加明显轮廓光");
});

it("removes camera preset buttons and compiles independent lens and composition choices", () => {
    const onGenerate = vi.fn();
    render(<SceneImageTools kind="camera" sources={sources} busy={false} onGenerate={onGenerate} />);
    expect(screen.queryByText("镜头预设")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("镜头", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "鱼眼" }));
    fireEvent.click(screen.getByText("构图", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "倾斜画面" }));
    fireEvent.click(screen.getByRole("button", { name: "查看并确认提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(onGenerate.mock.lastCall?.[1].preset).toBe("custom");
    expect(onGenerate.mock.lastCall?.[2]).toContain("鱼眼镜头观感");
    expect(onGenerate.mock.lastCall?.[2]).toContain("倾斜构图");
    expect(onGenerate.mock.lastCall?.[2]).not.toContain("预设视角");
});
