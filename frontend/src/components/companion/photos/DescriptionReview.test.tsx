import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DescriptionReview from "./DescriptionReview";

const api = vi.hoisted(() => ({ description: vi.fn(), confirmDescription: vi.fn(), descriptionHistory: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
beforeEach(() => {
  vi.resetAllMocks(); api.description.mockResolvedValue(null);
  api.confirmDescription.mockImplementation((_id, body) => Promise.resolve({ revision: 1, description: body.description }));
  api.descriptionHistory.mockResolvedValue({ changes: [], next_after_revision: null });
});
afterEach(() => vi.unstubAllGlobals());
it("requires full preview and explicit save, and preserves edited text", async () => {
  render(<DescriptionReview photoId="photo" original="一张桌子" />);
  fireEvent.click(await screen.findByRole("button", { name: "改一下" }));
  fireEvent.change(screen.getByLabelText("修改后的完整描述"), { target: { value: "桌子旁有一把椅子" } });
  fireEvent.click(screen.getByRole("button", { name: "核对修改" }));
  expect(api.confirmDescription).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "描述保存确认" })).toHaveTextContent("桌子旁有一把椅子");
  fireEvent.click(screen.getByRole("button", { name: "确认保存描述" }));
  await screen.findByText("您确认的描述");
  expect(api.confirmDescription).toHaveBeenCalledWith("photo", expect.objectContaining({ description: "桌子旁有一把椅子", expected_revision: 0 }));
});
it("skip and cancelled confirmation do not write", async () => {
  render(<DescriptionReview photoId="photo" original="一张桌子" />);
  fireEvent.click(await screen.findByRole("button", { name: "以后再说" }));
  expect(api.confirmDescription).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续核对描述" }));
  fireEvent.click(screen.getByRole("button", { name: "描述正确" }));
  fireEvent.click(screen.getByRole("button", { name: "暂不保存" }));
  expect(api.confirmDescription).not.toHaveBeenCalled();
});
it("voice agreement only prepares a confirmation, never saves automatically", async () => {
  let recognition: any;
  vi.stubGlobal("SpeechRecognition", class {
    constructor() { recognition = this; }
    start() {} stop() {} abort() {}
  });
  render(<DescriptionReview photoId="photo" original="一张桌子" />);
  expect(await screen.findByRole("button", { name: "说话确认" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("本次允许听写描述核对"));
  fireEvent.click(screen.getByRole("button", { name: "说话确认" }));
  act(() => { recognition.onresult({ results: [[{ transcript: "同意" }]] }); recognition.onend(); });
  expect(api.confirmDescription).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "核对语音意见" }));
  expect(screen.getByRole("region", { name: "描述保存确认" })).toHaveTextContent("一张桌子");
  expect(api.confirmDescription).not.toHaveBeenCalled();
});
it("loads existing review and history", async () => {
  api.description.mockResolvedValue({ revision: 2, description: "用户描述" });
  api.descriptionHistory.mockResolvedValue({ changes: [{ revision: 1, description: "旧描述" }], next_after_revision: null });
  render(<DescriptionReview photoId="photo" original="AI描述" />);
  await screen.findByText("用户描述");
  fireEvent.click(screen.getByRole("button", { name: "查看描述修改历史" }));
  await screen.findByText("第 1 版：旧描述");
});
