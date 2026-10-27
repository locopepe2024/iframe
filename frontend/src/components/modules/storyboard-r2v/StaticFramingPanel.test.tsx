import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import StaticFramingPanel from "./StaticFramingPanel";

vi.mock("@/lib/api", () => ({
    api: {
        previewStaticFraming: vi.fn(), generateStaticFraming: vi.fn(), applyStaticFraming: vi.fn(),
    },
}));

const review = { messages: { system: "只写静态起幅", user: '{"current_action":"停步"}' }, review_token: "review" };
const candidate = {
    id: "candidate", fields: { shot_size: "近景", composition: "主体居中" },
    current_fields: { shot_size: "中景", composition: "主体偏左" },
    rationale: { shot_size: "看清表情", composition: "保留背景" },
    source_refs: { shot_size: ["current_action"], composition: ["blocking"] }, uncertainties: [],
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.previewStaticFraming).mockResolvedValue(review);
    vi.mocked(api.generateStaticFraming).mockResolvedValue(candidate);
    vi.mocked(api.applyStaticFraming).mockResolvedValue({ frames: [{ id: "frame", shot_size: "近景" }] });
});

it("previews before generation and applies only selected fields", async () => {
    const applied = vi.fn();
    const generated = vi.fn();
    const { container } = render(<StaticFramingPanel projectId="film" frameId="frame"
        current={{ shot_size: "中景", camera_angle: "平视", composition: "主体偏左" }}
        initialCandidate={null} optimized={false} onGenerated={generated} onApplied={applied} />);
    fireEvent.click(container.querySelector("summary")!);
    fireEvent.click(screen.getByRole("button", { name: "预览模型输入" }));
    await waitFor(() => expect(api.previewStaticFraming).toHaveBeenCalledWith("film", "frame"));
    expect(api.generateStaticFraming).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认并生成候选" }));
    await waitFor(() => expect(api.generateStaticFraming).toHaveBeenCalledWith("film", "frame", review));
    expect(generated).toHaveBeenCalledExactlyOnceWith(candidate);
    expect(api.applyStaticFraming).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "采纳景别" }));
    fireEvent.click(screen.getByRole("button", { name: "应用所选字段" }));
    await waitFor(() => expect(api.applyStaticFraming).toHaveBeenCalledWith("film", "frame", "candidate", ["composition"]));
    expect(applied).toHaveBeenCalledExactlyOnceWith({ frames: [{ id: "frame", shot_size: "近景" }] });
});

it("blocks application over a complete optimized prompt", () => {
    const { container } = render(<StaticFramingPanel projectId="film" frameId="frame"
        current={{}} initialCandidate={candidate} optimized />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getByRole("button", { name: "应用所选字段" })).toBeDisabled();
});
