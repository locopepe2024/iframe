import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PhotoAlbum from "./PhotoAlbum";

const mock = vi.hoisted(() => ({
  list: vi.fn(), batch: vi.fn(), question: vi.fn(), answer: vi.fn(), organize: vi.fn(),
  upload: vi.fn(), correct: vi.fn(), history: vi.fn(), restore: vi.fn(), revoke: vi.fn(),
  image: vi.fn(),
}));
vi.mock("@/lib/photoApi", () => ({ photoApi: mock }));

const pending = { date: null, status: "pending_confirmation", reason: "not_processed", source: "none", revision: 1, evidence: [] };
const confirmed = { ...pending, date: { value: "1985", precision: "year", utc_offset: null }, reason: null, status: "confirmed", source: "user", revision: 2 };
const photo = { photo_id: "photo", batch_id: "batch", date: pending };

beforeEach(() => {
  vi.resetAllMocks();
  mock.list.mockResolvedValue({ photos: [photo], next_after_id: null });
  mock.batch.mockResolvedValue({ batch_id: "batch", granted: false, consent_version: 0 });
  mock.question.mockResolvedValue({ question_id: "q1", text: "是否按时间整理？本地处理，保留原照片。", scope: "time" });
  mock.answer.mockResolvedValue({ granted: true, consent_version: 1 });
  mock.organize.mockResolvedValue(confirmed);
  mock.correct.mockResolvedValue(confirmed);
  mock.history.mockResolvedValue({ changes: [], next_after_revision: null });
  mock.image.mockResolvedValue(new Blob(["image"], { type: "image/webp" }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() }));
});

async function select() {
  fireEvent.click(await screen.findByRole("button", { name: "查看照片 1" }));
  await screen.findByRole("button", { name: "按时间整理" });
}

describe("Photo album real service UI", () => {
  it("loads persisted photos without starting organization", async () => {
    render(<PhotoAlbum />);
    await select();
    expect(mock.organize).not.toHaveBeenCalled();
    expect(mock.answer).not.toHaveBeenCalled();
    expect(screen.getAllByText("尚未整理")).toHaveLength(2);
  });

  it("declines the current question without organizing", async () => {
    mock.answer.mockResolvedValue({ granted: false, consent_version: 1 });
    render(<PhotoAlbum />); await select();
    fireEvent.click(screen.getByRole("button", { name: "按时间整理" }));
    await screen.findByText("是否按时间整理？本地处理，保留原照片。");
    expect(mock.answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "暂时不用" }));
    await waitFor(() => expect(mock.answer).toHaveBeenCalledWith("batch", "q1", false));
    expect(mock.organize).not.toHaveBeenCalled();
  });

  it("authorizes then organizes once using the returned consent version", async () => {
    render(<PhotoAlbum />); await select();
    fireEvent.click(screen.getByRole("button", { name: "按时间整理" }));
    fireEvent.click(await screen.findByRole("button", { name: "同意并整理" }));
    await waitFor(() => expect(mock.organize).toHaveBeenCalledTimes(1));
    expect(mock.organize.mock.calls[0][0]).toBe("photo");
    expect(mock.organize.mock.calls[0][1]).toMatchObject({ consent_version: 1, expected_revision: 1 });
  });

  it("requires a second confirmation to save a year without manufacturing a date", async () => {
    mock.batch.mockResolvedValue({ batch_id: "batch", granted: true, consent_version: 1 });
    render(<PhotoAlbum />); await select();
    fireEvent.change(screen.getByLabelText("拍摄时间"), { target: { value: "1985" } });
    fireEvent.click(screen.getByRole("button", { name: "核对日期" }));
    expect(mock.correct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认日期" }));
    await waitFor(() => expect(mock.correct).toHaveBeenCalledTimes(1));
    expect(mock.correct.mock.calls[0][1]).toMatchObject({ value: "1985", precision: "year", expected_revision: 1 });
  });

  it("shows service failure and allows refresh instead of simulated success", async () => {
    mock.list.mockRejectedValueOnce(new Error("服务暂不可用"));
    render(<PhotoAlbum />);
    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "刷新相册" }));
    await screen.findByRole("button", { name: "查看照片 1" });
    expect(mock.organize).not.toHaveBeenCalled();
  });

  it("keeps one upload key for retry after a failed request", async () => {
    mock.upload.mockRejectedValueOnce(new Error("上传失败")).mockResolvedValueOnce({ photo_id: "photo", batch_id: "batch" });
    render(<PhotoAlbum />);
    await screen.findByRole("button", { name: "查看照片 1" });
    fireEvent.change(screen.getByLabelText("选择一张照片"), { target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "上传照片" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "上传照片" }));
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(2));
    expect(mock.upload.mock.calls[0][0]).toBe(mock.upload.mock.calls[1][0]);
  });

  it("restores a history version only after explicit confirmation", async () => {
    mock.batch.mockResolvedValue({ granted: true, consent_version: 3 });
    mock.list.mockResolvedValue({ photos: [{ ...photo, date: confirmed }], next_after_id: null });
    mock.history.mockResolvedValue({ changes: [{ revision: 1, after: pending }], next_after_revision: null });
    mock.restore.mockResolvedValue({ ...pending, revision: 3, reason: "missing" });
    render(<PhotoAlbum />); await select();
    fireEvent.click(screen.getByRole("button", { name: "查看修改历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复第 1 版" }));
    expect(mock.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(mock.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "恢复第 1 版" }));
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(mock.restore).toHaveBeenCalledTimes(1));
    expect(mock.restore.mock.calls[0][1]).toMatchObject({ target_revision: 1, expected_revision: 2, consent_version: 3 });
  });

  it("revoke preserves the displayed date and blocks further edits", async () => {
    mock.batch.mockResolvedValue({ granted: true, consent_version: 1 });
    mock.list.mockResolvedValue({ photos: [{ ...photo, date: confirmed }], next_after_id: null });
    mock.revoke.mockResolvedValue({ granted: false, consent_version: 2 });
    render(<PhotoAlbum />); await select();
    fireEvent.click(screen.getByRole("button", { name: "停止后续整理" }));
    expect(mock.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认停止" }));
    await screen.findByText("已停止后续整理，此前结果和原照片保留。");
    expect(mock.revoke).toHaveBeenCalledWith("batch", 1);
    expect(screen.queryByLabelText("拍摄时间")).not.toBeInTheDocument();
    expect(screen.getAllByText("1985（您确认的）")).toHaveLength(2);
  });

  it("does not reuse an old page cursor after changing filters", async () => {
    mock.list.mockResolvedValue({ photos: [photo], next_after_id: "photo" });
    render(<PhotoAlbum />);
    await screen.findByRole("button", { name: "查看照片 1" });
    fireEvent.change(screen.getByLabelText("年份（可不填）"), { target: { value: "1985" } });
    expect(screen.getByRole("button", { name: "再看一些照片" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新相册" }));
    await waitFor(() => expect(mock.list).toHaveBeenLastCalledWith("all", "1985", ""));
  });
});
