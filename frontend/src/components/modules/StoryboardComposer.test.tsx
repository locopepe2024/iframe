// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import StoryboardComposer from "./StoryboardComposer";
const { state, api } = vi.hoisted(() => {
    const project = {id: "p", originalText: "source", frames: [], characters: [], scenes: []};
    return {state: {currentProject: project, renderingFrames: new Set<string>(), updateProject: vi.fn(), setIsAnalyzingStoryboard: vi.fn()},
        api: {getProject: vi.fn().mockResolvedValue(project), analyzeStoryboardPreview: vi.fn(), applyStoryboardDraft: vi.fn()}};
});
vi.mock("@/store/projectStore", () => ({useProjectStore: Object.assign((select: any) => select(state), {getState: () => state})}));
vi.mock("@/lib/api", () => ({api, crudApi: {}, API_URL: ""}));
vi.mock("./StoryboardFrameEditor", () => ({default: () => null}));
vi.mock("./StoryboardContinuitySheet", () => ({default: ({focusedFrameId}: any) => <div data-testid="continuity-focus">{focusedFrameId ? "focused" : "all"}</div>}));
vi.mock("./RenderPromptPreviewDialog", () => ({default: () => null}));
vi.mock("./storyboard-r2v/StoryboardGenerateDialog", () => ({default: ({isOpen, onConfirm}: any) => isOpen ? <button onClick={() => onConfirm({mode: "script", skills: []})}>选择从剧本设计</button> : null}));
vi.mock("./storyboard-r2v/StoryboardAnalysisModal", () => ({default: ({isOpen, onApply}: any) => isOpen ? <button onClick={onApply}>采用草稿</button> : null}));
it("actual Storyboard button opens selection before generation and requires explicit apply", async () => {
    const draft = {frames: [{action_summary: "draft"}], lineage: {status: "pinned", storyboard_mode: "script"}};
    api.analyzeStoryboardPreview.mockResolvedValue(draft);
    api.applyStoryboardDraft.mockResolvedValue({...state.currentProject, frames: []});
    render(<NextIntlClientProvider locale="en" messages={messages}><StoryboardComposer /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", {name: /Generate Storyboard/i}));
    expect(screen.getByText("选择从剧本设计")).toBeTruthy();
    expect(api.analyzeStoryboardPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("选择从剧本设计"));
    await screen.findByText("采用草稿");
    expect(api.analyzeStoryboardPreview).toHaveBeenCalledWith("p", "source", undefined, {mode: "script", skills: []});
    expect(api.applyStoryboardDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("采用草稿"));
    await waitFor(() => expect(api.applyStoryboardDraft).toHaveBeenCalledWith("p", "source", draft.frames, draft.lineage));
});

it("opens the shared continuity sheet focused on the selected storyboard card", async () => {
    (state.currentProject.frames as any[]) = [{ id: "internal-frame-id", image_url: "/preview.webp", action_description: "走入粮店" }];
    render(<NextIntlClientProvider locale="en" messages={messages}><StoryboardComposer /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "查看分镜 1 的一致性" }));
    expect(screen.getByTestId("continuity-focus").textContent).toBe("focused");
    expect(screen.queryByText("internal-frame-id")).toBeNull();
    (state.currentProject.frames as any[]) = [];
});
