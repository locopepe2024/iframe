import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import BatchOrganization from "./BatchOrganization";
vi.mock("./TimeTasks", () => ({ default: () => {
  const [draft, setDraft] = useState("");
  return <label>时间草稿<input value={draft} onChange={e => setDraft(e.target.value)} /></label>;
}}));
vi.mock("./PeopleTasks", () => ({ default: ({ batchId }: { batchId: string }) => <p>人物管理 {batchId}</p> }));
function details(label: string) { return screen.getByText(label).closest("details")!; }
it("initially folds management and offers four choices without granting permissions", () => {
  render(<BatchOrganization batchId="batch" />);
  expect(details("时间整理与任务管理")).not.toHaveAttribute("open");
  expect(details("人物整理（需单独允许）")).not.toHaveAttribute("open");
  for (const label of ["按时间整理", "按人物整理", "都整理", "暂时不用"]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "按人物整理" }));
  expect(details("人物整理（需单独允许）")).toHaveAttribute("open");
  expect(details("时间整理与任务管理")).not.toHaveAttribute("open");
  expect(screen.getByRole("status")).toHaveTextContent("不代表已授权或已整理");
});
it("guides both sequentially and abandons unsubmitted drafts when switching", () => {
  render(<BatchOrganization batchId="batch" />);
  fireEvent.click(screen.getByRole("button", { name: "都整理" }));
  expect(details("时间整理与任务管理")).toHaveAttribute("open");
  expect(details("人物整理（需单独允许）")).not.toHaveAttribute("open");
  fireEvent.change(screen.getByLabelText("时间草稿"), { target: { value: "未确认" } });
  fireEvent.click(screen.getByRole("button", { name: "继续了解人物整理" }));
  expect(details("人物整理（需单独允许）")).toHaveAttribute("open");
  expect(screen.getByLabelText("时间草稿")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "暂时不用" }));
  expect(screen.getByText(/已有后台任务会继续/)).toBeInTheDocument();
  expect(details("人物整理（需单独允许）")).not.toHaveAttribute("open");
});
it("keeps batch choices isolated and disables choices during upload", () => {
  const { rerender } = render(<><div aria-label="第一批"><BatchOrganization batchId="one" /></div><div aria-label="第二批"><BatchOrganization batchId="two" /></div></>);
  fireEvent.click(within(screen.getByLabelText("第一批")).getByRole("button", { name: "按时间整理" }));
  expect(within(screen.getByLabelText("第二批")).queryByRole("status")).not.toBeInTheDocument();
  rerender(<BatchOrganization batchId="one" disabled />);
  for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
});
