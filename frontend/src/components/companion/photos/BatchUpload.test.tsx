import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import BatchUpload from "./BatchUpload";

const api = vi.hoisted(() => ({ fingerprint: vi.fn(), uploadBatches: vi.fn(), uploadBatch: vi.fn(), createUploadBatch: vi.fn(), uploadBatchItem: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./TimeTasks", () => ({ default: () => null }));
const entry = (id: string, status = "pending") => ({ item_id: id, filename: id + ".png", size: 3, sha256: id, status, photo_id: null, error_code: null });
function batch(items = [entry("item-001"), entry("item-002")]) {
  return { batch_id: "batch", items, counts: {
    pending: items.filter(item => item.status === "pending").length,
    uploaded: items.filter(item => item.status === "uploaded").length,
    failed: items.filter(item => item.status === "failed").length,
  } };
}
beforeEach(() => {
  vi.resetAllMocks(); api.uploadBatches.mockResolvedValue({ batches: [], next_after_id: null });
  api.fingerprint.mockImplementation(file => Promise.resolve(file.name.startsWith("wrong") ? "wrong" : "item-001"));
});
async function choose(files: File[]) {
  await waitFor(() => expect(screen.getByLabelText("选择多张照片")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("选择多张照片"), { target: { files } });
  fireEvent.click(screen.getByRole("button", { name: "上传这批照片" }));
}
it("keeps individual results and continues after one failed upload, without organizing", async () => {
  const done = vi.fn();
  api.createUploadBatch.mockResolvedValue(batch());
  api.uploadBatchItem.mockRejectedValueOnce(new Error("invalid")).mockResolvedValueOnce({});
  api.uploadBatch.mockResolvedValueOnce(batch([entry("item-001", "failed"), entry("item-002")]))
    .mockResolvedValueOnce(batch([entry("item-001", "failed"), entry("item-002", "uploaded")]));
  render(<BatchUpload onUploaded={done} />);
  await choose([new File(["abc"], "first.png"), new File(["abc"], "second.png")]);
  await screen.findByText(/本轮上传已结束/);
  expect(api.uploadBatchItem).toHaveBeenCalledTimes(2);
  expect(api.uploadBatchItem.mock.calls[1][1]).toBe("item-002");
  expect(screen.getByText(/已上传 1 张，失败 1 张，待上传 0 张/)).toBeInTheDocument();
  expect(api.createUploadBatch.mock.calls[0][1]).toHaveLength(2);
  expect(done).toHaveBeenCalledTimes(1);
});
it("restores pending items from the server and checks the original file before retry", async () => {
  api.uploadBatches.mockResolvedValue({ batches: [batch([entry("item-001")])], next_after_id: null });
  api.uploadBatchItem.mockResolvedValue({});
  api.uploadBatch.mockResolvedValue(batch([entry("item-001", "uploaded")]));
  render(<BatchUpload onUploaded={vi.fn()} />);
  const input = await screen.findByLabelText("重新选择第 1 张原文件：item-001.png");
  fireEvent.change(input, { target: { files: [new File(["abc"], "wrong.png")] } });
  fireEvent.click(screen.getByRole("button", { name: "重试上传：item-001.png" }));
  await screen.findByRole("alert");
  expect(api.uploadBatchItem).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(["abc"], "original.png")] } });
  fireEvent.click(screen.getByRole("button", { name: "重试上传：item-001.png" }));
  await screen.findByText(/已上传 1 张，失败 0 张，待上传 0 张/);
  expect(api.uploadBatchItem).toHaveBeenCalledTimes(1);
  expect(api.createUploadBatch).not.toHaveBeenCalled();
});
it("reuses manifest key after lost creation response and trusts committed upload receipts", async () => {
  api.createUploadBatch.mockRejectedValueOnce(new Error("network" )).mockResolvedValueOnce(batch([entry("item-001")]));
  api.uploadBatchItem.mockRejectedValueOnce(new Error("lost response"));
  api.uploadBatch.mockResolvedValue(batch([entry("item-001", "uploaded")]));
  render(<BatchUpload onUploaded={vi.fn()} />);
  await choose([new File(["abc"], "first.png")]);
  await screen.findByText("network");
  fireEvent.click(screen.getByRole("button", { name: "上传这批照片" }));
  await screen.findByText(/本轮上传已结束/);
  expect(api.createUploadBatch.mock.calls[0]).toEqual(api.createUploadBatch.mock.calls[1]);
  expect(screen.getByText(/已上传 1 张，失败 0 张，待上传 0 张/)).toBeInTheDocument();
});
it("rejects too many files before creating anything and supports refreshing failed reads", async () => {
  api.uploadBatches.mockRejectedValueOnce(new Error("offline"));
  render(<BatchUpload onUploaded={vi.fn()} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "查看上传批次" }));
  await waitFor(() => expect(api.uploadBatches).toHaveBeenCalledTimes(2));
  await choose(Array.from({ length: 21 }, (_, index) => new File(["a"], `${index}.png`)));
  await screen.findByText(/每批请选择 1 到 20 张照片/);
  expect(api.createUploadBatch).not.toHaveBeenCalled();
});
