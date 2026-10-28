import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PhotoStory from "./PhotoStory";

const api = vi.hoisted(() => ({ story: vi.fn(), saveStory: vi.fn(), storyHistory: vi.fn() }));
vi.mock("@/lib/photoApi", () => ({ photoApi: api }));
beforeEach(() => {
  vi.resetAllMocks(); api.story.mockResolvedValue(null);
  api.saveStory.mockImplementation((_id, body) => Promise.resolve({ revision: body.expected_revision + 1, text: body.text }));
  api.storyHistory.mockResolvedValue({ changes: [], next_after_revision: null });
});
afterEach(() => vi.unstubAllGlobals());
async function draft(text = "那年和家人去了公园。") {
  fireEvent.click(await screen.findByRole("button", { name: "讲讲这张照片" }));
  fireEvent.change(screen.getByLabelText("我的讲述草稿（可修改）"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "核对我的讲述" }));
}
it("requires preview and final save; supports editing and cancellation without writes", async () => {
  render(<PhotoStory photoId="photo" />);
  await draft();
  expect(api.saveStory).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "讲述保存确认" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "返回修改讲述" }));
  expect(screen.getByLabelText("我的讲述草稿（可修改）")).toHaveValue("那年和家人去了公园。");
  fireEvent.change(screen.getByLabelText("我的讲述草稿（可修改）"), { target: { value: "是和朋友去的。" } });
  fireEvent.click(screen.getByRole("button", { name: "核对我的讲述" }));
  fireEvent.click(screen.getByRole("button", { name: "暂不保存讲述" }));
  expect(api.saveStory).not.toHaveBeenCalled();
  await draft("确认后的回忆");
  fireEvent.click(screen.getByRole("button", { name: "确认保存讲述" }));
  await screen.findByText("讲述已保存。");
  expect(api.saveStory).toHaveBeenCalledWith("photo", expect.objectContaining({ text: "确认后的回忆", expected_revision: 0 }));
});
it("preserves the same operation and draft after save failure", async () => {
  api.saveStory.mockRejectedValueOnce(new Error("服务暂不可用"));
  render(<PhotoStory photoId="photo" />);
  await draft();
  fireEvent.click(screen.getByRole("button", { name: "确认保存讲述" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("region", { name: "讲述保存确认" })).toHaveTextContent("那年和家人去了公园。");
  fireEvent.click(screen.getByRole("button", { name: "确认保存讲述" }));
  await screen.findByText("讲述已保存。");
  expect(api.saveStory.mock.calls[0]).toEqual(api.saveStory.mock.calls[1]);
});
it("dictation only updates a draft and switching photos aborts recognition", async () => {
  let recognition: any;
  vi.stubGlobal("SpeechRecognition", class {
    constructor() { recognition = this; }
    start() {} stop() {} abort = vi.fn();
  });
  const view = render(<PhotoStory key="one" photoId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: "讲讲这张照片" }));
  expect(screen.getByRole("button", { name: "说说这张照片" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("本次允许听写照片讲述"));
  fireEvent.click(screen.getByRole("button", { name: "说说这张照片" }));
  expect(recognition.continuous).toBe(true);
  act(() => { recognition.onresult({ results: [[{ transcript: "同意" }]] }); });
  expect(screen.getByLabelText("我的讲述草稿（可修改）")).toHaveValue("同意");
  expect(api.saveStory).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "讲述保存确认" })).not.toBeInTheDocument();
  const old = recognition;
  view.rerender(<PhotoStory key="two" photoId="two" />);
  await screen.findByRole("button", { name: "讲讲这张照片" });
  expect(old.abort).toHaveBeenCalled();
  expect(old.onresult).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "讲讲这张照片" }));
  expect(screen.getByLabelText("我的讲述草稿（可修改）")).toHaveValue("");
});
it("appends sentences across a browser recognition restart without saving", async () => {
  const instances:any[]=[];
  vi.stubGlobal("SpeechRecognition", class {
    onresult:any;onend:any;onerror:any;
    constructor(){instances.push(this);}
    start(){} stop(){this.onend?.();} abort=vi.fn();
  });
  const view=render(<PhotoStory photoId="photo"/>);
  fireEvent.click(await screen.findByRole("button",{name:"讲讲这张照片"}));
  fireEvent.change(screen.getByLabelText("我的讲述草稿（可修改）"),{target:{value:"已有回忆"}});
  fireEvent.click(screen.getByLabelText("本次允许听写照片讲述"));
  fireEvent.click(screen.getByRole("button",{name:"说说这张照片"}));
  act(()=>instances[0].onresult({results:[[{transcript:"女儿来了"}]]}));
  act(()=>instances[0].onend());
  await waitFor(()=>expect(instances).toHaveLength(2));
  act(()=>instances[1].onresult({results:[[{transcript:"我们一起喝茶"}]]}));
  expect(screen.getByLabelText("我的讲述草稿（可修改）")).toHaveValue("已有回忆\n女儿来了\n我们一起喝茶");
  expect(api.saveStory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"停止讲述听写"}));
  expect(screen.getByRole("button",{name:"核对我的讲述"})).not.toBeDisabled();
  view.unmount();
});
it("loads history pages and restores old text only through a new confirmation", async () => {
  api.story.mockResolvedValue({ revision: 3, text: "现在的讲述" });
  api.storyHistory.mockResolvedValueOnce({ changes: [{ revision: 1, text: "旧回忆" }], next_after_revision: 1 })
    .mockResolvedValueOnce({ changes: [{ revision: 2, text: "另一版" }], next_after_revision: null });
  render(<PhotoStory photoId="photo" />);
  await screen.findByText("现在的讲述");
  fireEvent.click(screen.getByRole("button", { name: "查看讲述修改历史" }));
  fireEvent.click(await screen.findByRole("button", { name: "更多讲述记录" }));
  await screen.findByText("第 2 版：另一版");
  expect(api.storyHistory).toHaveBeenLastCalledWith("photo", 1);
  fireEvent.click(screen.getByRole("button", { name: "使用第 1 版讲述" }));
  expect(api.saveStory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认保存讲述" }));
  await screen.findByText("讲述已保存。");
  expect(api.saveStory).toHaveBeenCalledWith("photo", expect.objectContaining({ text: "旧回忆", expected_revision: 3 }));
});
it("blocks oversized stories and leaves failed reads unwritable", async () => {
  const view = render(<PhotoStory photoId="one" />);
  await draft("x".repeat(4001));
  expect(screen.getByRole("alert")).toHaveTextContent("4000");
  expect(api.saveStory).not.toHaveBeenCalled();
  api.story.mockRejectedValueOnce(new Error("offline"));
  view.rerender(<PhotoStory key="two" photoId="two" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读取失败"));
  expect(screen.queryByRole("button", { name: "讲讲这张照片" })).not.toBeInTheDocument();
});
