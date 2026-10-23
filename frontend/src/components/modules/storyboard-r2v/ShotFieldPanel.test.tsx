import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import ShotFieldPanel from "./ShotFieldPanel";

vi.mock("@/lib/api", () => ({ api: {
    previewShotFields: vi.fn(), generateShotFields: vi.fn(), applyShotFields: vi.fn(),
} }));

const review = { messages: { system: "只设计当前镜头", user: '{"current_action":"商贩穿行"}' },
    review_token: "review", input: { effective_visual: {
        style: { value: "写实电影", source: "scene_design", revision: 2 },
        ambient_lighting: { value: "暮秋残阳", source: "scene_design", revision: 2 },
    } } };
const candidate = { id: "candidate", fields: { transition_hint: "硬切" },
    rationale: { transition_hint: "本镜结束后切换场景" },
    source_refs: { transition_hint: ["current_action"] }, uncertainties: [] };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.previewShotFields).mockResolvedValue(review);
    vi.mocked(api.generateShotFields).mockResolvedValue(candidate);
    vi.mocked(api.applyShotFields).mockResolvedValue({});
});

it("shows effective sources and keeps AI proposals reviewable", async () => {
    const applied = vi.fn();
    const before = vi.fn();
    const { container } = render(<ShotFieldPanel projectId="project" frameId="shot"
        initialCandidate={null} optimized={false} onBeforePreview={before} onApplied={applied}
        effectiveFields={{ style: { value: "写实电影", source_kind: "scene_design", source_revision: 2 },
            ambient_lighting: { value: "暮秋残阳", source_kind: "scene_design", source_revision: 2 } }} />);
    fireEvent.click(container.querySelector("summary")!);
    expect(api.previewShotFields).not.toHaveBeenCalled();
    expect(screen.getByText("写实电影")).toBeInTheDocument();
    expect(screen.getByText("暮秋残阳")).toBeInTheDocument();
    expect(api.generateShotFields).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI 建议镜头字段" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认输入并生成建议" })).toBeInTheDocument());
    expect(api.previewShotFields).toHaveBeenCalledWith("project", "shot");
    expect(before).toHaveBeenCalledOnce();
    expect(api.generateShotFields).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认输入并生成建议" }));
    await waitFor(() => expect(api.generateShotFields).toHaveBeenCalledWith("project", "shot", review));
    expect(api.applyShotFields).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用所选字段" }));
    await waitFor(() => expect(api.applyShotFields).toHaveBeenCalledWith("project", "shot", "candidate", ["transition_hint"]));
    expect(applied).toHaveBeenCalledOnce();
});

it("does not apply a candidate over an accepted full prompt", () => {
    render(<ShotFieldPanel projectId="project" frameId="shot" initialCandidate={candidate} optimized />);
    expect(screen.getByRole("button", { name: "应用所选字段" })).toBeDisabled();
});
