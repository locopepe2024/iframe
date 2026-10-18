import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import RenderPromptPreviewDialog from "./RenderPromptPreviewDialog";

it("shows replaced shooting-plan lighting separately from the submitted prompt", () => {
    render(<RenderPromptPreviewDialog preview={{
        prompt: "场景视觉基线：冷灰蓝环境光",
        negativePrompt: "",
        referenceCount: 0,
        batchSize: 1,
        contextToken: "reviewed",
        sourceLabel: "关联场景设计：长街 r2",
        omittedPlanLighting: "残阳如血覆盖整条街",
    }} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole("note")).toHaveTextContent("残阳如血覆盖整条街");
    expect(screen.getByRole("note")).toHaveTextContent("不会在当前正文后额外追加");
    expect(screen.getByText("场景视觉基线：冷灰蓝环境光")).not.toHaveTextContent("残阳如血");
    expect(screen.getByText(/关联场景设计：长街 r2/)).toBeInTheDocument();
});

it("flags an accepted prompt whose confirmed design source changed", () => {
    render(<RenderPromptPreviewDialog preview={{
        prompt: "已采用的完整润色正文", negativePrompt: "", referenceCount: 0,
        batchSize: 1, contextToken: "reviewed", polishReview: "场景设计已变化；请核对润色正文后再生成。",
    }} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("场景设计已变化");
    expect(screen.getByRole("alert")).toHaveTextContent("不会自动改写正文");
});
