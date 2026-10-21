import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Companion from "./Companion";
import { STORAGE_KEY } from "./storage";

function send(text: string) {
  fireEvent.change(screen.getByLabelText("想说的话（可修改）"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}
function chat() { fireEvent.click(screen.getByRole("button", { name: "聊天" })); }
function stored() { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Companion H5", () => {
  it("keeps chat ephemeral and saves edited diary with source ids only on confirmation", () => {
    render(<Companion />); chat(); send("今天去散步了");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "把聊天整理成日记" }));
    expect(screen.getByLabelText("日记内容")).toHaveValue("今天去散步了");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    fireEvent.change(screen.getByLabelText("日记内容"), { target: { value: "今天散步很开心。" } });
    fireEvent.click(screen.getByRole("button", { name: "确认保存日记" }));
    expect(stored().diaries).toHaveLength(1);
    expect(stored().diaries[0].sourceIds).toHaveLength(1);
    expect(stored().diaries[0].text).toBe("今天散步很开心。");
    fireEvent.click(screen.getByRole("button", { name: "删除这篇日记" }));
    expect(stored().diaries).toEqual([]);
  });

  it("asks once for feedback, saves nothing on refusal, and does not copy chat", () => {
    render(<Companion />); chat(); send("找不到日记入口，我家住某某街");
    expect(screen.getByRole("button", { name: "确认保存反馈" })).toBeDisabled();
    expect(screen.getByLabelText("请用简短文字描述困难，避免个人隐私")).not.toHaveValue(expect.stringContaining("某某街"));
    fireEvent.click(screen.getByRole("button", { name: "暂不记录" }));
    send("还是不会用");
    expect(screen.queryByRole("region", { name: "使用问题候选" })).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("retains feedback on storage failure and saves a single consented record on retry", () => {
    render(<Companion />); chat(); send("入口太复杂");
    fireEvent.change(screen.getByLabelText("请用简短文字描述困难，避免个人隐私"), { target: { value: "希望日记入口更明显" } });
    fireEvent.click(screen.getByLabelText("允许保存上面这条反馈摘要"));
    const setter = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new Error("full"); });
    fireEvent.click(screen.getByRole("button", { name: "确认保存反馈" }));
    expect(screen.getByText("保存失败，内容仍在本页。请释放浏览器空间后重试。")).toBeInTheDocument();
    expect(screen.getByLabelText("请用简短文字描述困难，避免个人隐私")).toHaveValue("希望日记入口更明显");
    setter.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "确认保存反馈" }));
    expect(stored().feedback).toHaveLength(1);
    expect(stored().feedback[0]).toMatchObject({ evidence: "explicit", status: "pending-review", text: "希望日记入口更明显" });
    expect(stored().feedback[0].consentAt).toBeTruthy();
    expect(stored().feedback[0].hypothesis).toContain("尚未验证");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "删除这条反馈" }));
    expect(stored().feedback).toEqual([]);
  });

  it("changes personal settings only after conversational confirmation and permits undo", () => {
    render(<Companion />); chat(); send("字太小了，帮我调大一点");
    const shell = screen.getByTestId("companion-shell");
    expect(shell.className).not.toContain("large");
    expect(screen.queryByRole("button", { name: "确认保存反馈" })).not.toBeInTheDocument();
    send("确认"); expect(shell.className).toContain("large");
    send("恢复普通字号"); send("取消"); expect(shell.className).toContain("large");
    send("恢复普通字号"); fireEvent.click(screen.getByRole("button", { name: "确认调整" }));
    expect(shell.className).not.toContain("large");
    send("说慢一点"); send("好的");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByLabelText("朗读慢一点")).toBeChecked();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("offers text fallback when speech recognition is unavailable", () => {
    vi.stubGlobal("SpeechRecognition", undefined); vi.stubGlobal("webkitSpeechRecognition", undefined);
    render(<Companion />); chat();
    expect(screen.getByRole("button", { name: "点一下，说话" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("本次允许使用浏览器听写"));
    fireEvent.click(screen.getByRole("button", { name: "点一下，说话" }));
    expect(screen.getByText("这个浏览器暂不支持听写，请用文字输入或试用示例。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "试用示例" }));
    expect(screen.getByLabelText("想说的话（可修改）")).toHaveValue("今天和老朋友一起散步，心情很好。");
  });

  it("requires sending recognized text, confirms settings, and aborts recognition on unmount", () => {
    class MockRecognition {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: (() => void) | null = null; onend: (() => void) | null = null;
      start = vi.fn(); stop = vi.fn(); abort = vi.fn();
      constructor() { instance = this; }
    }
    let instance: MockRecognition;
    vi.stubGlobal("SpeechRecognition", MockRecognition);
    const { unmount } = render(<Companion />); chat();
    fireEvent.click(screen.getByLabelText("本次允许使用浏览器听写"));
    fireEvent.click(screen.getByRole("button", { name: "点一下，说话" }));
    act(() => { instance.onresult?.({ results: [[{ transcript: "字调大一点" }]] }); instance.onend?.(); });
    expect(screen.getByLabelText("想说的话（可修改）")).toHaveValue("字调大一点");
    expect(screen.queryByRole("button", { name: "确认调整" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByRole("button", { name: "确认调整" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "点一下，说话" }));
    unmount(); expect(instance!.abort).toHaveBeenCalled(); expect(instance!.onresult).toBeNull();
  });

  it("finishes recognition on stop, keeps the transcript, and stops on navigation", () => {
    let recognition: { onresult: ((event: { results: { transcript: string }[][] }) => void) | null; onend: (() => void) | null; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
    class Recognition {
      lang = ""; continuous = false; interimResults = false;
      onresult = null; onerror = null; onend = null;
      start = vi.fn(); stop = vi.fn(); abort = vi.fn();
      constructor() { recognition = this; }
    }
    vi.stubGlobal("SpeechRecognition", Recognition);
    render(<Companion />); chat();
    fireEvent.click(screen.getByLabelText("本次允许使用浏览器听写"));
    fireEvent.click(screen.getByRole("button", { name: "点一下，说话" }));
    fireEvent.click(screen.getByRole("button", { name: "停止听写" }));
    expect(recognition!.stop).toHaveBeenCalled();
    expect(recognition!.abort).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "正在结束听写" })).toBeDisabled();
    act(() => { recognition.onresult?.({ results: [[{ transcript: "今天很开心" }]] }); recognition.onend?.(); });
    expect(screen.getByLabelText("想说的话（可修改）")).toHaveValue("今天很开心");
    fireEvent.click(screen.getByRole("button", { name: "点一下，说话" }));
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(recognition!.abort).toHaveBeenCalled();
  });

  it("applies the confirmed slow setting to browser playback", () => {
    const speak = vi.fn(); const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; rate = 1; text: string; constructor(text: string) { this.text = text; } });
    render(<Companion />); chat(); send("说慢一点"); send("确认");
    fireEvent.click(screen.getByRole("button", { name: "读给我听" }));
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ rate: 0.7, lang: "zh-CN" }));
    fireEvent.click(screen.getByRole("button", { name: "停止朗读" }));
    expect(cancel).toHaveBeenCalled();
  });

  it("does not overwrite corrupt saved data before explicit clearing", () => {
    localStorage.setItem(STORAGE_KEY, "invalid");
    render(<Companion />); chat(); send("今天散步");
    fireEvent.click(screen.getByRole("button", { name: "把聊天整理成日记" }));
    expect(screen.getByRole("button", { name: "确认保存日记" })).toBeDisabled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("invalid");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清除本机原型记录" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
