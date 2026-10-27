import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PhotoTaskCard from "./PhotoTaskCard";
import type { PhotoTask } from "@/lib/companionApi";
const api = vi.hoisted(() => ({ photoTaskInput: vi.fn() }));
vi.mock("@/lib/companionApi", () => ({ companionApi: api }));
vi.mock("../photos/PhotoImage", () => ({ default: () => <img alt="照片" /> }));
vi.mock("../photos/PhotoContent", () => ({ default: () => <div>分析确认入口</div> }));
vi.mock("../photos/PhotoStory", () => ({ default: () => <div>讲述编辑入口</div> }));
const task: PhotoTask = { kind: "photo_task", task_id: "task", revision: 1, status: "waiting_input", step: "select_photo", photos: [{photo_id: "mine", date: {date: null, status: "pending_confirmation", source: "none", reason: "missing", revision: 1}}] };
beforeEach(() => vi.resetAllMocks());
it("opens the selected photo workspace and closes with persisted task state", async () => {
  api.photoTaskInput.mockResolvedValueOnce({...task, revision: 2, step: "review_photo"}).mockResolvedValueOnce({...task, revision: 3, status: "completed", step: "closed", photos: []});
  render(<PhotoTaskCard task={task} />);
  fireEvent.click(screen.getByRole("button", {name: "整理这张照片 1"}));
  await screen.findByText("讲述编辑入口");
  expect(api.photoTaskInput.mock.calls[0][1]).toMatchObject({expected_revision: 1, action: "select", photo_id: "mine"});
  fireEvent.click(screen.getByRole("button", {name: "结束本次整理"}));
  await screen.findByText("本次整理已结束。");
  expect(screen.queryByText("讲述编辑入口")).not.toBeInTheDocument();
});
it("retries the same operation after a lost response", async () => {
  api.photoTaskInput.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({...task, revision: 2, status: "cancelled", photos: []});
  render(<PhotoTaskCard task={task} />);
  fireEvent.click(screen.getByRole("button", {name: "取消整理"}));
  fireEvent.click(await screen.findByRole("button", {name: "重试原操作"}));
  await screen.findByText("已取消本次整理。");
  expect(api.photoTaskInput.mock.calls[1]).toEqual(api.photoTaskInput.mock.calls[0]);
});
