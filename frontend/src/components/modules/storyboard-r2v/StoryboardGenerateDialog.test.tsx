// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import StoryboardGenerateDialog from "./StoryboardGenerateDialog";
const { getPlan, selected } = vi.hoisted(() => ({ getPlan: vi.fn(), selected: [{id: "storyboard-action", revision: "a".repeat(64)}] }));
vi.mock("@/lib/api", () => ({api: {getDirectorShootingPlan: getPlan}}));
vi.mock("@/lib/directorSkills", () => ({useDirectorSkills: () => ({selected, canRun: true})}));
vi.mock("@/components/modules/DirectorSkillsSelector", () => ({default: () => <div>分镜 Skill 选择</div>}));
function show(onConfirm = vi.fn(), existingShotCount = 0) {
    render(<NextIntlClientProvider locale="en" messages={messages}><StoryboardGenerateDialog isOpen onClose={vi.fn()} project={{id: "p", originalText: "剧本".repeat(30), characters: [{}]}} existingShotCount={existingShotCount} onConfirm={onConfirm} /></NextIntlClientProvider>);
    return onConfirm;
}
it("defaults to confirmed plan and submits no optional skills", async () => {
    getPlan.mockResolvedValue({current_revision: 6, current_stale: false});
    const confirm = show();
    await waitFor(() => expect(screen.getByRole("button", {name: "按导演计划生成"})).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("分镜 Skill 选择")).toBeNull();
    expect(screen.getByText("Convert the confirmed director plan into editable shots.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Apply director plan"}));
    expect(confirm).toHaveBeenCalledWith({mode: "plan", skills: []});
});
it("warns before replacing shots from the confirmed plan", async () => {
    getPlan.mockResolvedValue({current_revision: 6, current_stale: false});
    const confirm = show(vi.fn(), 3);
    await waitFor(() => expect(screen.getByRole("button", {name: "Replace with director plan"})).toBeEnabled());
    expect(screen.getByText("Applying the confirmed director plan will replace the existing 3 shots.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: "Replace with director plan"}));
    expect(confirm).toHaveBeenCalledWith({mode: "plan", skills: []});
});
it("offers stage skills when the user chooses script design", async () => {
    getPlan.mockResolvedValue({current_revision: 6, current_stale: false});
    const confirm = show();
    await waitFor(() => expect(screen.getByRole("button", {name: "按导演计划生成"})).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", {name: "从剧本设计分镜"}));
    expect(screen.getByText("分镜 Skill 选择")).toBeTruthy();
    expect(screen.getByText("AI will create a storyboard draft and add it only after your confirmation.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name: /Analyze storyboard/}));
    expect(confirm).toHaveBeenCalledWith({mode: "script", skills: selected});
});
