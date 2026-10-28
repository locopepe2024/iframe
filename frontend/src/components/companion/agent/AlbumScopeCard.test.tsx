import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AlbumScopeCard from "./AlbumScopeCard";
const api = vi.hoisted(() => ({list: vi.fn()}));
vi.mock("@/lib/photoApi", () => ({photoApi: api}));
vi.mock("../photos/PhotoImage", () => ({default: () => <img alt="相册照片" />}));
beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue({photos: [{photo_id: "mine"}], next_after_id: null}); });
it("asks scope without reading photos, then opens a dated album and selects explicitly", async () => {
  const select = vi.fn(); render(<AlbumScopeCard onSelect={select} />);
  expect(api.list).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "按时间找"}));
  fireEvent.change(screen.getByLabelText("照片日期"), {target: {value: "2025-10-01"}});
  fireEvent.click(screen.getByRole("button", {name: "找这些照片"}));
  await screen.findByRole("button", {name: "选择照片 1"});
  expect(api.list).toHaveBeenCalledWith("all", "", "", "", {date_prefix: "2025-10-01", order: "id"});
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "选择照片 1"}));
  expect(select).toHaveBeenCalledWith("mine");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("searches a saved person keyword and keeps it when paging", async () => {
  api.list.mockResolvedValueOnce({photos: [{photo_id: "mine"}], next_after_id: "mine"}).mockResolvedValueOnce({photos: [], next_after_id: null});
  render(<AlbumScopeCard onSelect={() => {}} />);
  fireEvent.click(screen.getByRole("button", {name: "按人物找"}));
  fireEvent.change(screen.getByLabelText("照片人物"), {target: {value: "女儿"}});
  fireEvent.click(screen.getByRole("button", {name: "找这些照片"}));
  fireEvent.click(await screen.findByRole("button", {name: "更多照片"}));
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith("all", "", "mine", "女儿"));
});
it("opens recent additions only after an explicit click and closes back to scope", async () => {
  render(<AlbumScopeCard onSelect={() => {}} />);
  fireEvent.click(screen.getByRole("button", {name: "最近加入"}));
  await screen.findByRole("button", {name: "选择照片 1"});
  expect(api.list).toHaveBeenCalledWith("all", "", "", "", {date_prefix: "", order: "recent"});
  fireEvent.click(screen.getByRole("button", {name: "关闭相册"}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("article", {name: "选择整理范围"})).toBeInTheDocument();
});
