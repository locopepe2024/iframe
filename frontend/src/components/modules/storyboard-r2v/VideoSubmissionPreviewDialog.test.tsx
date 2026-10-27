// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import VideoSubmissionPreviewDialog from "./VideoSubmissionPreviewDialog";

const preview = {
    prompt: "[character1:探子] 站在粮铺前，暮秋残阳照亮青石板",
    negativePrompt: "不要现代建筑",
    model: "uniart/minimax-h3-vip",
    mode: "r2v",
    duration: 5,
    resolution: "720p",
    count: 2,
    generateAudio: false,
    references: ["https://example.com/reference.webp"],
    settings: [{ label: "画幅", value: "16:9" }],
};

it("shows the frozen video request and submits only after confirmation", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<VideoSubmissionPreviewDialog preview={preview} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByText(preview.prompt)).toBeInTheDocument();
    expect(screen.getByText(preview.negativePrompt)).toBeInTheDocument();
    expect(screen.getByAltText("参考素材 1")).toHaveAttribute("src", preview.references[0]);
    expect(screen.getByText("16:9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
    expect(onConfirm).toHaveBeenCalledOnce();
});

it("shows selected first and last frames for frame-to-video", () => {
    render(<VideoSubmissionPreviewDialog preview={{ ...preview, references: [], mode: "first_last_frame",
        firstFrame: "https://example.com/first.webp", lastFrame: "https://example.com/last.webp" }}
        onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByAltText("首帧")).toBeInTheDocument();
    expect(screen.getByAltText("尾帧")).toBeInTheDocument();
    expect(screen.queryByAltText("参考素材 1")).not.toBeInTheDocument();
});
