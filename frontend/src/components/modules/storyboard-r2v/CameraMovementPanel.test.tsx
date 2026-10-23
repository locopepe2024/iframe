import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import CameraMovementPanel from "./CameraMovementPanel";

vi.mock("@/lib/api", () => ({
    api: {
        previewCameraMovement: vi.fn(),
        generateCameraMovement: vi.fn(),
        applyCameraMovement: vi.fn(),
    },
}));

const review = { messages: { system: "只写运镜", user: '{"current_action":"向前走"}' }, review_token: "review" };
const candidate = {
    id: "candidate",
    camera_movement_structured: { primary: "follow", speed: "normal", description: "平稳跟随" },
    rationale: "配合当前主体运动", source_refs: ["current_action"], uncertainties: [],
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.previewCameraMovement).mockResolvedValue(review);
    vi.mocked(api.generateCameraMovement).mockResolvedValue(candidate);
    vi.mocked(api.applyCameraMovement).mockResolvedValue({});
});

it("requires reviewed input and explicit application before changing the shot", async () => {
    const before = vi.fn();
    const applied = vi.fn();
    const { container } = render(<CameraMovementPanel projectId="film" frameId="frame"
        current={{ primary: "static", speed: "normal" }} initialCandidate={null}
        optimized={false} onBeforePreview={before} onApplied={applied} />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getByText(/当前运镜：static/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览模型输入" }));
    await waitFor(() => expect(api.previewCameraMovement).toHaveBeenCalledWith("film", "frame"));
    expect(before).toHaveBeenCalledOnce();
    expect(screen.getByText(/只写运镜/)).toBeInTheDocument();
    expect(api.generateCameraMovement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认并生成候选" }));
    await waitFor(() => expect(api.generateCameraMovement).toHaveBeenCalledWith("film", "frame", review));
    expect(screen.getByText(/建议运镜：follow/)).toBeInTheDocument();
    expect(api.applyCameraMovement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用运镜" }));
    await waitFor(() => expect(api.applyCameraMovement).toHaveBeenCalledWith("film", "frame", "candidate"));
    expect(applied).toHaveBeenCalledOnce();
});

it("does not apply a candidate over a complete optimized prompt", () => {
    const { container } = render(<CameraMovementPanel projectId="film" frameId="frame"
        current={null} initialCandidate={candidate} optimized />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getByRole("button", { name: "应用运镜" })).toBeDisabled();
    expect(api.applyCameraMovement).not.toHaveBeenCalled();
});
