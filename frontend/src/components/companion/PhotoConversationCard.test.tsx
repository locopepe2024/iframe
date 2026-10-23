import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PhotoConversationCard from "./PhotoConversationCard";

const api = vi.hoisted(() => ({ story: vi.fn(), saveStory: vi.fn(), storyHistory: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
vi.mock("./photos/PhotoImage", () => ({ default: ({ id }: { id: string }) => <img src={`/photo/${id}`} alt="照片缩略图" /> }));
beforeEach(() => {
  vi.resetAllMocks();
  api.story.mockResolvedValue(null);
  api.saveStory.mockImplementation((_id, body) => Promise.resolve({ revision: 1, text: body.text }));
});

it("reads and saves a story inside the selected photo card only after confirmation", async () => {
  api.story.mockResolvedValue({ revision: 2, text: "在公园散步" });
  render(<PhotoConversationCard photoId="photo-1" label="照片 1" />);
  expect(api.story).not.toHaveBeenCalled();
  expect(screen.getByRole("img")).toHaveAttribute("src", "/photo/photo-1");
  fireEvent.click(screen.getByRole("button", { name: "看看这张照片的故事" }));
  await screen.findByText("在公园散步");
  expect(api.story).toHaveBeenCalledWith("photo-1");
  fireEvent.click(screen.getByRole("button", { name: "修改我的讲述" }));
  fireEvent.change(screen.getByLabelText("我的讲述草稿（可修改）"), { target: { value: "和女儿在公园散步" } });
  fireEvent.click(screen.getByRole("button", { name: "核对我的讲述" }));
  expect(api.saveStory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认保存讲述" }));
  await screen.findByText("讲述已保存。");
  expect(api.saveStory).toHaveBeenCalledWith("photo-1", expect.objectContaining({ text: "和女儿在公园散步", expected_revision: 2 }));
});

it("keeps drafts, labels and save targets independent across photo cards", async () => {
  render(<><PhotoConversationCard photoId="one" label="照片 1" /><PhotoConversationCard photoId="two" label="照片 2" /></>);
  const one = within(screen.getByRole("article", { name: "照片 1" }));
  const two = within(screen.getByRole("article", { name: "照片 2" }));
  for (const card of [one, two]) {
    fireEvent.click(card.getByRole("button", { name: "看看这张照片的故事" }));
    fireEvent.click(await card.findByRole("button", { name: "讲讲这张照片" }));
  }
  expect(one.getByLabelText("我的讲述草稿（可修改）").id).not.toBe(two.getByLabelText("我的讲述草稿（可修改）").id);
  fireEvent.change(one.getByLabelText("我的讲述草稿（可修改）"), { target: { value: "第一张的回忆" } });
  fireEvent.change(two.getByLabelText("我的讲述草稿（可修改）"), { target: { value: "第二张的回忆" } });
  fireEvent.click(two.getByRole("button", { name: "核对我的讲述" }));
  fireEvent.click(two.getByRole("button", { name: "确认保存讲述" }));
  await two.findByText("讲述已保存。");
  expect(api.saveStory).toHaveBeenCalledOnce();
  expect(api.saveStory).toHaveBeenCalledWith("two", expect.objectContaining({ text: "第二张的回忆" }));
  expect(one.getByLabelText("我的讲述草稿（可修改）")).toHaveValue("第一张的回忆");
});
