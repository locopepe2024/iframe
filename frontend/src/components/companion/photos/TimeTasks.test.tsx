import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import TimeTasks from "./TimeTasks";

const api = vi.hoisted(() => ({ batch:vi.fn(), timeTasks:vi.fn(), question:vi.fn(), answer:vi.fn(), createTimeTask:vi.fn(), revoke:vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi:api }));
vi.mock("./BatchUndo", () => ({ default: () => null }));
const task = (status="queued", failed=0) => ({ task_id:"task",status,counts:{pending:status==="queued"?2:0,completed:1,needs_confirmation:0,failed,cancelled:0},items:[] });
beforeEach(() => {
  vi.resetAllMocks(); api.batch.mockResolvedValue({granted:false,consent_version:0}); api.timeTasks.mockResolvedValue([]);
  api.question.mockResolvedValue({question_id:"q",text:"本地按时间整理，是否允许？"});
  api.answer.mockResolvedValue({granted:true,consent_version:1}); api.createTimeTask.mockResolvedValue(task());
});
it("loads without granting or running and requires visible authorization then explicit task creation", async () => {
  render(<TimeTasks batchId="batch" />);
  fireEvent.click(await screen.findByRole("button",{name:"允许这批照片按时间整理"}));
  await screen.findByText("本地按时间整理，是否允许？");
  expect(api.answer).not.toHaveBeenCalled(); expect(api.createTimeTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"确认允许时间整理"}));
  fireEvent.click(await screen.findByRole("button",{name:"建立后台整理任务"}));
  await screen.findByText("等待后台整理");
  expect(api.createTimeTask).toHaveBeenCalledWith("batch",expect.objectContaining({consent_version:1}));
  expect(screen.getByRole("button",{name:"建立后台整理任务"})).toBeDisabled();
});
it("retains operation ID on a lost response and restores progress on refresh", async () => {
  api.batch.mockResolvedValue({granted:true,consent_version:2});
  api.createTimeTask.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(task("completed"));
  render(<TimeTasks batchId="batch" />);
  fireEvent.click(await screen.findByRole("button",{name:"建立后台整理任务"}));
  await screen.findByText("lost response");
  fireEvent.click(screen.getByRole("button",{name:"建立后台整理任务"}));
  await screen.findByText("本任务已完成");
  expect(api.createTimeTask.mock.calls[0]).toEqual(api.createTimeTask.mock.calls[1]);
  api.timeTasks.mockResolvedValue([task("needs_confirmation")]);
  fireEvent.click(screen.getByRole("button",{name:"刷新整理任务"}));
  await screen.findByText("整理结束，部分日期需要核对");
});
it("retries only failed items and requires explicit revoke confirmation", async () => {
  api.batch.mockResolvedValue({granted:true,consent_version:3}); api.timeTasks.mockResolvedValue([task("partial_failed",1)]);
  render(<TimeTasks batchId="batch" />);
  fireEvent.click(await screen.findByRole("button",{name:"重试此任务的失败项"}));
  await screen.findByText("等待后台整理");
  expect(api.createTimeTask).toHaveBeenCalledWith("batch",expect.objectContaining({retry_task_id:"task",consent_version:3}));
  fireEvent.click(screen.getByRole("button",{name:"停止这批后续时间整理"}));
  expect(api.revoke).not.toHaveBeenCalled();
  api.revoke.mockResolvedValue({granted:false,consent_version:4});
  api.batch.mockResolvedValue({granted:false,consent_version:4}); api.timeTasks.mockResolvedValue([task("cancelled")]);
  fireEvent.click(screen.getByRole("button",{name:"确认停止批次任务"}));
  await screen.findByText("已停止未完成项");
  expect(api.revoke).toHaveBeenCalledWith("batch",3);
});
it("failed initial reads cannot be treated as permission to run", async () => {
  api.batch.mockRejectedValueOnce(new Error("offline"));
  render(<TimeTasks batchId="batch" />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button",{name:"建立后台整理任务"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"刷新整理任务"}));
  await screen.findByRole("button",{name:"允许这批照片按时间整理"});
  expect(api.createTimeTask).not.toHaveBeenCalled();
});
