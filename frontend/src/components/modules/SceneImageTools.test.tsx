import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SceneImageTools } from "./SceneImageTools";

const sources = [
    { key: "one", variantId: "one", label: "场景图片 · 1", url: "/one.png" },
    { key: "two", variantId: "two", label: "场景图片 · 2", url: "/two.png" },
];

it("requires a saved scene image before submitting a lighting task", () => {
    const generate = vi.fn();
    render(<SceneImageTools kind="lighting" sources={[]} busy={false} onGenerate={generate} />);
    expect(screen.getByRole("button", { name: "生成光影候选" })).toBeDisabled();
    expect(generate).not.toHaveBeenCalled();
});

it("sends the selected scene variant with a lighting-only prompt", () => {
    const generate = vi.fn();
    render(<SceneImageTools kind="lighting" sources={sources} busy={false} onGenerate={generate} />);
    fireEvent.change(screen.getByRole("combobox", { name: "来源图片" }), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: "黄金时刻" }));
    fireEvent.click(screen.getByRole("button", { name: "左侧" }));
    fireEvent.click(screen.getByRole("button", { name: "生成光影候选" }));
    expect(generate).toHaveBeenCalledWith(sources[1], expect.stringContaining("主光从左侧进入"));
    expect(generate.mock.calls[0][1]).toContain("低角度暖阳");
    expect(generate.mock.calls[0][1]).toContain("保持场景结构");
});

it("keeps camera controls in a separate prompt and disables submission while busy", () => {
    const generate = vi.fn();
    const { rerender } = render(<SceneImageTools kind="camera" sources={sources} busy={false} onGenerate={generate} />);
    fireEvent.click(screen.getByRole("button", { name: "正面俯拍" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "指定对焦点" }));
    fireEvent.click(screen.getByRole("button", { name: "生成镜头候选" }));
    expect(generate).toHaveBeenCalledWith(sources[0], expect.stringContaining("正面俯拍"));
    expect(generate.mock.calls[0][1]).toContain("主体区域为对焦中心");
    expect(generate.mock.calls[0][1]).not.toContain("主光从");
    rerender(<SceneImageTools kind="camera" sources={sources} busy onGenerate={generate} />);
    expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
});
