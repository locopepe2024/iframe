import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PhotoContent from "./PhotoContent";

const api = vi.hoisted(() => ({ analysis: vi.fn(), analyze: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
const result = { observation: { visible_summary: "画面中有一张桌子。", visible_text: [], uncertainties: ["看不清桌上的字。"], story_question: "您想说说这张照片吗？" } };
beforeEach(() => { vi.resetAllMocks(); api.analysis.mockResolvedValue(null); api.analyze.mockResolvedValue(result); });
describe("Qwen photo observations", () => {
  it("loads without sending photos and requires explicit external analysis permission", async () => {
    render(<PhotoContent photoId="one" />);
    const button = await screen.findByRole("button", { name: "看看照片内容" });
    expect(button).toBeDisabled(); expect(api.analyze).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("本次允许 Qwen 分析这张照片"));
    fireEvent.click(button);
    expect(await screen.findByText("画面中有一张桌子。")).toBeInTheDocument();
    expect(api.analyze).toHaveBeenCalledWith("one");
    expect(screen.getByText("AI 看图描述，尚待您核对")).toBeInTheDocument();
    expect(screen.getByText("看不清桌上的字。")).toBeInTheDocument();
  });
  it("shows stored results without another paid request", async () => {
    api.analysis.mockResolvedValue(result);
    render(<PhotoContent photoId="one" />);
    await screen.findByText("画面中有一张桌子。");
    expect(api.analyze).not.toHaveBeenCalled();
  });
  it("shows provider failure and allows an explicit retry", async () => {
    api.analyze.mockRejectedValueOnce(new Error("unavailable"));
    render(<PhotoContent photoId="one" />);
    fireEvent.click(await screen.findByLabelText("本次允许 Qwen 分析这张照片"));
    fireEvent.click(screen.getByRole("button", { name: "看看照片内容" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("AI 看图描述，尚待您核对")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "准备重试" }));
    fireEvent.click(screen.getByRole("button", { name: "看看照片内容" }));
    await waitFor(() => expect(api.analyze).toHaveBeenCalledTimes(2));
    await screen.findByText("画面中有一张桌子。");
  });
});
