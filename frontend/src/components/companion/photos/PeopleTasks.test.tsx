import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PeopleTasks from "./PeopleTasks";

const api = vi.hoisted(() => ({ peopleStatus: vi.fn(), peopleTasks: vi.fn(), peopleQuestion: vi.fn(), peopleConsent: vi.fn(), createPeopleTask: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./PeopleCandidates", () => ({ default: () => <p>候选核对入口</p> }));
const task = (status = "queued", failed = 0) => ({ task_id: "task", consent_version: 1, status, counts: { pending: status === "queued" ? 1 : 0, running: 0, detected: status === "needs_review" ? 1 : 0, no_faces: 0, failed, cancelled: 0, cleared: 0 } });
beforeEach(() => {
  vi.resetAllMocks(); api.peopleStatus.mockResolvedValue({ granted: false, consent_version: 0, enabled: true }); api.peopleTasks.mockResolvedValue([]);
  api.peopleQuestion.mockResolvedValue({ question_id: "question", consent_version: 0, text: "只在本地处理人脸，不发送外部服务。" });
  api.peopleConsent.mockResolvedValue({ granted: true, consent_version: 1 }); api.createPeopleTask.mockResolvedValue(task());
});
it("requires independent visible permission then separate task creation", async () => {
  render(<PeopleTasks batchId="batch" />);
  fireEvent.click(await screen.findByRole("button", { name: "了解并允许人物分析" }));
  await screen.findByText("只在本地处理人脸，不发送外部服务。");
  expect(api.peopleConsent).not.toHaveBeenCalled(); expect(api.createPeopleTask).not.toHaveBeenCalled();
  api.peopleStatus.mockResolvedValue({ granted: true, consent_version: 1, enabled: true });
  fireEvent.click(screen.getByRole("button", { name: "确认允许本批人物分析" }));
  fireEvent.click(await screen.findByRole("button", { name: "建立人物分析任务" }));
  await screen.findByText(/人物任务已建立/);
  expect(api.peopleConsent).toHaveBeenCalledWith("batch", expect.objectContaining({ method: "button", expected_version: 0, question_id: "question", granted: true }));
  expect(api.createPeopleTask).toHaveBeenCalledWith("batch", expect.objectContaining({ consent_version: 1 }));
});
it("lost responses reuse operation IDs and stopping requires explicit confirmation", async () => {
  api.peopleStatus.mockResolvedValue({ granted: true, consent_version: 1, enabled: true });
  api.createPeopleTask.mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(task("needs_review"));
  render(<PeopleTasks batchId="batch" />);
  fireEvent.click(await screen.findByRole("button", { name: "建立人物分析任务" }));
  await screen.findByText("lost");
  fireEvent.click(screen.getByRole("button", { name: "建立人物分析任务" }));
  await screen.findByText(/人物任务已建立/);
  expect(api.createPeopleTask.mock.calls[0]).toEqual(api.createPeopleTask.mock.calls[1]);
  fireEvent.click(screen.getByRole("button", { name: "停止或清理本批人物分析" }));
  expect(api.peopleConsent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "同时清除本批人脸特征和未确认的自动候选" }));
  fireEvent.click(screen.getByRole("button", { name: "确认停止人物分析" }));
  await screen.findByText(/已停止并清理本批人脸特征/);
  expect(api.peopleConsent).toHaveBeenCalledWith("batch", expect.objectContaining({ granted: false, clear: true, expected_version: 1 }));
});
it("disabled deployment cannot request new analysis; existing tasks remain readable", async () => {
  api.peopleStatus.mockResolvedValue({ granted: false, consent_version: 2, enabled: false });
  api.peopleTasks.mockResolvedValue([task("cancelled")]);
  render(<PeopleTasks batchId="batch" />);
  await screen.findByText("已停止本任务");
  expect(screen.queryByRole("button", { name: "了解并允许人物分析" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "建立人物分析任务" })).not.toBeInTheDocument();
  expect(api.peopleQuestion).not.toHaveBeenCalled(); expect(api.createPeopleTask).not.toHaveBeenCalled();
});
it("retries failed items and opens candidates only under the current task consent", async () => {
  api.peopleStatus.mockResolvedValue({ granted: true, consent_version: 1, enabled: true });
  api.peopleTasks.mockResolvedValue([{ ...task("needs_review", 1), status: "partial_failed" }]);
  render(<PeopleTasks batchId="batch" />);
  fireEvent.click(await screen.findByRole("button", { name: "核对这次人物候选" }));
  await screen.findByText("候选核对入口");
  fireEvent.click(screen.getByRole("button", { name: "重试人物任务失败项" }));
  await screen.findByText(/人物任务已建立/);
  expect(api.createPeopleTask).toHaveBeenCalledWith("batch", expect.objectContaining({ retry_task_id: "task" }));
});
