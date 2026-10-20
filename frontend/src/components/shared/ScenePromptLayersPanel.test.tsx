import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ScenePromptLayersPanel from "./ScenePromptLayersPanel";
import { compileScenePromptLayers, type ScenePromptLayers } from "@/lib/scenePromptLayers";

vi.mock("next/dynamic", () => ({ default: () => ({ onChange }: any) => <button onClick={() => onChange(90, 30)}>选择球体方向</button> }));
function Harness() {
    const [value, setValue] = useState<ScenePromptLayers>({});
    return <><ScenePromptLayersPanel value={value} onChange={setValue} /><output data-testid="prompt">{compileScenePromptLayers(value)}</output></>;
}
function open(text: string) { fireEvent.click(screen.getByText(text, { selector: "summary" })); }

it("selects and clears independent fields, with no initial prompt", () => {
    render(<Harness />);
    expect(screen.getByTestId("prompt").textContent).toBe("");
    open("镜头");
    const lens = screen.getByRole("button", { name: "长焦" });
    fireEvent.click(lens);
    expect(lens).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("prompt")).toHaveTextContent("远近空间呈压缩感");
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("景深");
    fireEvent.click(screen.getByRole("button", { name: "深景深" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("景深：深景深");
    fireEvent.click(lens);
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("焦距观感");
    expect(screen.getByTestId("prompt")).toHaveTextContent("景深：深景深");
});

it("replaces only the chosen layer direction and can clear sphere settings", async () => {
    render(<Harness />);
    open("光影");
    fireEvent.click(screen.getByRole("button", { name: "左侧" }));
    open("三维光源方向");
    fireEvent.click(await screen.findByRole("button", { name: "选择球体方向" }));
    expect(screen.getByRole("button", { name: "左侧" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("prompt")).toHaveTextContent("方位 90°，仰角 30°");
    open("镜头");
    fireEvent.click(screen.getByRole("button", { name: "低机位" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("机位：低机位仰视");
    expect(screen.getByTestId("prompt")).toHaveTextContent("方位 90°");
    fireEvent.click(screen.getByRole("button", { name: "清除三维方向" }));
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("光影");
    expect(screen.getByTestId("prompt")).toHaveTextContent("低机位仰视");
});

it("records opt-in image focus coordinates and clears them independently of the target", () => {
    render(<Harness />);
    open("镜头");
    expect(screen.getByRole("checkbox", { name: "指定画面对焦位置" })).not.toBeChecked();
    expect(screen.getByTestId("prompt").textContent).toBe("");
    fireEvent.change(screen.getByRole("textbox", { name: "对焦目标" }), { target: { value: "门口石狮" } });
    expect(screen.getByTestId("prompt")).toHaveTextContent("对焦目标：门口石狮");
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("画面坐标");
    fireEvent.click(screen.getByRole("checkbox", { name: "指定画面对焦位置" }));
    fireEvent.change(screen.getByRole("slider", { name: "对焦水平位置" }), { target: { value: "30" } });
    fireEvent.change(screen.getByRole("slider", { name: "对焦垂直位置" }), { target: { value: "65" } });
    expect(screen.getByTestId("prompt")).toHaveTextContent("x=30%、y=65%");
    fireEvent.click(screen.getByRole("checkbox", { name: "指定画面对焦位置" }));
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("画面坐标");
    expect(screen.getByTestId("prompt")).toHaveTextContent("对焦目标：门口石狮");
    fireEvent.change(screen.getByRole("textbox", { name: "对焦目标" }), { target: { value: "" } });
    expect(screen.getByTestId("prompt").textContent).toBe("");
});

it("selects atmosphere separately and cancels it without resetting the light source", () => {
    render(<Harness />);
    open("光影");
    fireEvent.click(screen.getByRole("button", { name: "油灯" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("光源：传统油灯照明");
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("氛围");
    fireEvent.click(screen.getByRole("button", { name: "宁静" }));
    fireEvent.click(screen.getByRole("button", { name: "薄雾" }));
    fireEvent.click(screen.getByRole("button", { name: "暖光" }));
    expect(screen.getByTestId("prompt")).toHaveTextContent("氛围：宁静平和");
    expect(screen.getByTestId("prompt")).toHaveTextContent("空气介质：空气中有稀薄雾气");
    expect(screen.getByTestId("prompt")).toHaveTextContent("光色关系：照明偏暖");
    fireEvent.click(screen.getByRole("button", { name: "宁静" }));
    expect(screen.getByTestId("prompt")).not.toHaveTextContent("氛围：");
    expect(screen.getByRole("button", { name: "油灯" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "薄雾" })).toHaveAttribute("aria-pressed", "true");
});
