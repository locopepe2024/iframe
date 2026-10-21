import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopilotTrial, { createTrial } from "./CopilotTrial";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const input = () => screen.getByLabelText("说说您的需要（听写后请核对再发送）");
function send(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "字调大一点" })).toBeEnabled()); }
async function settled() { await ready(); }
async function confirm(name = "确认调整") {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await settled();
}

describe("real CopilotKit local trial", () => {
  it("round-trips actual tool calls, refuses before applying, then restores the font", async () => {
    const trial = createTrial();
    render(<CopilotTrial trial={trial} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "字调大一点" }));
    const cancel = await screen.findByRole("button", { name: "取消" });
    await waitFor(() => expect(cancel).toBeEnabled());
    expect(trial.scenario.getSnapshot().fontSize).toBe("normal");
    expect(trial.agent.messages.some(message => message.role === "assistant" && message.toolCalls?.some(call => call.function.name === "confirm_font_size"))).toBe(true);
    fireEvent.click(cancel); await settled();
    expect(trial.scenario.getSnapshot().fontSize).toBe("normal");
    expect(trial.agent.messages.some(message => message.role === "tool" && String(message.content).includes("declined"))).toBe(true);
    send("字调大一点"); await confirm();
    expect(screen.getByRole("main")).toHaveAttribute("data-font-size", "large");
    send("恢复普通字号"); await confirm();
    expect(screen.getByRole("main")).toHaveAttribute("data-font-size", "normal");
  });

  it("binds typed decisions to the visible question and never treats a negation as approval", async () => {
    const trial = createTrial(); render(<CopilotTrial trial={trial} />); await ready();
    send("不要把字调大一点"); await settled();
    expect(screen.queryByRole("button", { name: "确认调整" })).not.toBeInTheDocument();
    send("字调大一点");
    await waitFor(() => expect(screen.getByRole("button", { name: "确认调整" })).toBeEnabled());
    send("我还没说同意");
    expect(trial.scenario.getSnapshot().fontSize).toBe("normal");
    send("不可以"); await settled();
    expect(trial.scenario.getSnapshot().fontSize).toBe("normal");
    send("字调大一点");
    await waitFor(() => expect(screen.getByRole("button", { name: "确认调整" })).toBeEnabled());
    send("确认"); await settled();
    expect(trial.scenario.getSnapshot().fontSize).toBe("large");
  });

  it("requires time-only consent and clears results on withdrawal without new commits", async () => {
    const trial = createTrial(); render(<CopilotTrial trial={trial} />); await ready();
    send("按时间整理");
    const cancel = await screen.findByRole("button", { name: "取消" });
    await waitFor(() => expect(cancel).toBeEnabled());
    fireEvent.click(cancel); await settled();
    expect(trial.scenario.getSnapshot()).toMatchObject({ task: "idle", processedIds: [] });
    send("按时间整理"); await confirm("同意本次整理");
    await waitFor(() => expect(trial.scenario.getSnapshot().processedIds.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "撤回授权并清除模拟结果" }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1700)); });
    expect(trial.scenario.getSnapshot()).toMatchObject({ consent: "revoked", task: "cancelled", processedIds: [] });
    expect(screen.queryByText(/^模拟结果：/)).not.toBeInTheDocument();
    send("按时间整理"); await confirm("同意本次整理");
    await waitFor(() => expect(trial.scenario.getSnapshot().task).toBe("completed"), { timeout: 2500 });
    expect(screen.getByText("模拟结果：1980")).toBeInTheDocument();
    expect(screen.getByText("模拟结果：2001-05")).toBeInTheDocument();
    expect(screen.getByText("模拟结果：时间待确认")).toBeInTheDocument();
  });

  it("does not send SDK network requests or persist trial content; remount starts empty", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("Network forbidden in local trial")));
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const trial = createTrial();
    const view = render(<StrictMode><CopilotTrial trial={trial} /></StrictMode>); await ready();
    send("字调大一点"); await confirm();
    expect(fetchSpy).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
    view.unmount();
    render(<CopilotTrial />); await ready();
    expect(screen.getByRole("main")).toHaveAttribute("data-font-size", "normal");
    expect(screen.queryByRole("region", { name: "字号确认" })).not.toBeInTheDocument();
  });

  it("cancels a running sample on exit and handles unsupported voice", async () => {
    vi.stubGlobal("SpeechRecognition", undefined); vi.stubGlobal("webkitSpeechRecognition", undefined);
    const trial = createTrial(); const view = render(<CopilotTrial trial={trial} />); await ready();
    expect(screen.getByRole("button", { name: "开始听写" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "开始听写" }));
    expect(await screen.findByText(/不支持.*语音|不支持.*听写/)).toBeInTheDocument();
    send("按时间整理"); await confirm("同意本次整理");
    const before = trial.scenario.getSnapshot().processedIds.length;
    view.unmount();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1700)); });
    expect(trial.scenario.getSnapshot().processedIds).toHaveLength(before);
  });
});
