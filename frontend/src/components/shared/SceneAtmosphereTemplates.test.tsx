import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SceneAtmosphereTemplates from "./SceneAtmosphereTemplates";
import { compileScenePromptLayers } from "@/lib/scenePromptLayers";

it("finds a reusable blue-hour recipe from Chinese context or English aliases", () => {
    const apply = vi.fn();
    render(<SceneAtmosphereTemplates onApply={apply} />);
    fireEvent.click(screen.getByText("Prompt 模板 · 光影"));
    const search = screen.getByRole("searchbox", { name: "搜索氛围模板" });
    for (const value of ["秋天 傍晚 冷蓝色", "Blue hour lighting", "Twilight lighting"]) {
        fireEvent.change(search, { target: { value } });
        fireEvent.click(screen.getByRole("button", { name: "蓝调时刻" }));
    }
    const prompt = compileScenePromptLayers(apply.mock.calls[0][0].settings);
    expect(prompt).toContain("冷蓝色");
    expect(prompt).not.toMatch(/季节|薄雾|暖|柔焦|景深/);
    fireEvent.change(search, { target: { value: "不存在的模板" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配");
});

it("keeps mist, warm highlights and clear air in explicitly selected recipes", () => {
    const apply = vi.fn();
    render(<SceneAtmosphereTemplates onApply={apply} />);
    fireEvent.click(screen.getByText("Prompt 模板 · 光影"));
    fireEvent.click(screen.getByRole("button", { name: "蓝橙暮光·薄雾" }));
    const prompt = compileScenePromptLayers(apply.mock.calls[0][0].settings);
    for (const term of ["薄雾", "橙色余晖", "低饱和", "暗部阴影"]) expect(prompt).toContain(term);
    fireEvent.click(screen.getByRole("button", { name: "清晨冷光" }));
    expect(compileScenePromptLayers(apply.mock.calls[1][0].settings)).not.toMatch(/雾|暖|光束/);
    fireEvent.click(screen.getByRole("button", { name: "通透冷光" }));
    expect(apply.mock.calls[2][0].settings.lighting.air).toContain("空气通透");
    fireEvent.click(screen.getByRole("button", { name: "丁达尔冷光束" }));
    expect(apply.mock.calls[3][0].settings.lighting.air).toContain("光束路径可见");
});

it("offers tonal recipes without changing skin, camera or scene contents", () => {
    const apply = vi.fn();
    render(<SceneAtmosphereTemplates onApply={apply} />);
    fireEvent.click(screen.getByText("Prompt 模板 · 光影"));
    for (const name of ["高调光", "低调光", "明暗对照"]) {
        fireEvent.click(screen.getByRole("button", { name }));
        const settings = apply.mock.lastCall![0].settings;
        expect(settings.camera).toBeUndefined();
        expect(settings.composition).toBeUndefined();
        expect(compileScenePromptLayers(settings)).not.toMatch(/磨皮|瓷肌|脸型|虚化|背景|8K|--ar/);
    }
    expect(apply.mock.calls[0][0].settings.lighting.contrast).toBeUndefined();
    expect(apply.mock.calls[1][0].settings.lighting.contrast).toBeUndefined();
});


it("filters portrait, interior and exterior recipes and searches within the selected category", () => {
    render(<SceneAtmosphereTemplates onApply={vi.fn()} />);
    fireEvent.click(screen.getByText("Prompt 模板 · 光影"));
    fireEvent.click(screen.getByRole("tab", { name: "人像" }));
    expect(screen.getByRole("button", { name: "伦勃朗光" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "蓝调时刻" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "室内" }));
    expect(screen.getByRole("button", { name: "实景灯具" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "室外" }));
    expect(screen.getByRole("button", { name: "蓝调时刻" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "蝴蝶光" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Twilight" } });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "季节" }));
    expect(screen.getByRole("button", { name: "秋日冷蓝暮光" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "伦勃朗光" })).not.toBeInTheDocument();
});
