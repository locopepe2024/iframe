// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import DirectorSkillsSelector from "./DirectorSkillsSelector";

const task = { id: "opening-hook", revision: "a".repeat(64), label: "开场吸引力", category: "钩子与节奏设计", description: "已有事件建立问题", version: "1.0.0", source: "本地适配", source_revision: "source" };
function state(overrides = {}) {
    return { catalog: [task], selected: [], loading: false, saving: false, error: "", canRun: true, update: vi.fn(), retry: vi.fn(), ...overrides };
}
it("opens, searches, explicitly selects and restores trigger focus on Escape", () => {
    const data = state(); render(<DirectorSkillsSelector state={data} />);
    const trigger = screen.getByRole("button", { name: "创作 Skills · 已选 0" });
    fireEvent.click(trigger);
    const search = screen.getByRole("textbox", { name: "搜索创作 Skills" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "不匹配" } });
    expect(screen.queryByRole("button", { name: "开场吸引力" })).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "开场吸引力" }));
    expect(data.update).toHaveBeenCalledWith([{ id: task.id, revision: task.revision }]);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
});
it("removes a selection without executing and blocks changes during generation", () => {
    const data = state({ selected: [{ id: task.id, revision: task.revision }] });
    const { rerender } = render(<DirectorSkillsSelector state={data} />);
    fireEvent.click(screen.getByRole("button", { name: "创作 Skills · 已选 1" }));
    fireEvent.click(screen.getByRole("button", { name: "✓ 开场吸引力" }));
    expect(data.update).toHaveBeenCalledWith([]);
    rerender(<DirectorSkillsSelector state={data} disabled />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "✓ 开场吸引力" }).disabled).toBe(true);
});
it("shows stale revisions and offers explicit removal", () => {
    const data = state({ selected: [{ id: task.id, revision: "old" }] });
    render(<DirectorSkillsSelector state={data} />);
    fireEvent.click(screen.getByRole("button", { name: "创作 Skills · 已选 1" }));
    expect(screen.getByRole("alert").textContent).toContain("版本已变化");
    fireEvent.click(screen.getByRole("button", { name: "移除失效选择" }));
    expect(data.update).toHaveBeenCalledWith([]);
});
