import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import BatchUndo from "./BatchUndo";

const api = vi.hoisted(() => ({ undoPreview: vi.fn(), undoBatch: vi.fn(), undoHistory: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./PhotoImage", () => ({ default: () => <span>照片缩略图</span> }));
const preview = { preview_token: "token", counts: { undo: 1, preserve: 1 }, items: [
  { photo_id: "auto", action: "undo", current: { date: { value: "1985" } }, target: { date: null, reason: "not_processed" } },
  { photo_id: "manual", action: "preserve", current: { date: { value: "1970" } }, target: { date: { value: "1970" } } },
] };
const receipt = { operation_id: "undo", created_at: "2026-10-22T01:00:00Z", counts: { undo: 1, preserve: 1 } };
beforeEach(() => {
  vi.resetAllMocks(); api.undoPreview.mockResolvedValue(preview); api.undoBatch.mockResolvedValue(receipt);
  api.undoHistory.mockResolvedValue({ changes: [receipt], next_after: null });
});
it("preview and cancel never write, confirmation refreshes tasks and history is readable", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<BatchUndo batchId="batch" disabled={false} onUndone={refresh} />);
  expect(api.undoPreview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览撤销本批时间整理" }));
  await screen.findByText("第 1 张：1985 → 尚未整理日期。");
  expect(screen.getByText("第 2 张：1970，保留。")).toBeInTheDocument();
  expect(api.undoBatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消撤销" }));
  expect(api.undoBatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览撤销本批时间整理" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认撤销本批时间整理" }));
  await screen.findByText(/已撤销 1 张的时间整理/);
  expect(refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "查看撤销记录" }));
  await waitFor(() => expect(api.undoHistory).toHaveBeenCalledWith("batch", 0));
  await screen.findByLabelText("批次撤销记录");
});
it("lost responses retain the operation ID", async () => {
  api.undoBatch.mockRejectedValueOnce(new Error("服务暂不可用，请稍后重试。"));
  render(<BatchUndo batchId="batch" disabled={false} onUndone={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "预览撤销本批时间整理" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认撤销本批时间整理" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "确认撤销本批时间整理" }));
  await screen.findByText(/已撤销 1 张的时间整理/);
  expect(api.undoBatch.mock.calls[0]).toEqual(api.undoBatch.mock.calls[1]);
});
it("refreshing a stale preview uses the new token and a new operation", async () => {
  api.undoBatch.mockRejectedValueOnce(new Error("照片或授权已变化，请重新预览后再确认撤销。"));
  api.undoPreview.mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, preview_token: "fresh" });
  render(<BatchUndo batchId="batch" disabled={false} onUndone={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "预览撤销本批时间整理" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认撤销本批时间整理" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重新预览撤销本批时间整理" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "确认撤销本批时间整理" }));
  await screen.findByText(/已撤销 1 张的时间整理/);
  expect(api.undoBatch.mock.calls[1][1].preview_token).toBe("fresh");
  expect(api.undoBatch.mock.calls[1][1].operation_id).not.toBe(api.undoBatch.mock.calls[0][1].operation_id);
});
it("does not allow confirming a preview with no automatic changes", async () => {
  api.undoPreview.mockResolvedValue({ ...preview, counts: { undo: 0, preserve: 2 } });
  render(<BatchUndo batchId="batch" disabled={false} onUndone={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "预览撤销本批时间整理" }));
  expect(await screen.findByRole("button", { name: "确认撤销本批时间整理" })).toBeDisabled();
});
