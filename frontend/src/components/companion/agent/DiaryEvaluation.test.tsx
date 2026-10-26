import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import DiaryCard from "./DiaryCard";

const cases = readFileSync(resolve(process.cwd(), "../tests/fixtures/companion_character/cases.v1.jsonl"), "utf8")
  .trim().split("\n").map(line => JSON.parse(line));
const scenario = (id: string) => cases.find(item => item.id === id)!;
const api = vi.hoisted(() => ({ diaries: vi.fn(), saveDiary: vi.fn(), chat: vi.fn() }));
vi.mock("@/lib/companionApi", () => ({ companionApi: api }));

let recognition: Recognition;
class Recognition {
  lang = ""; continuous = false; interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  start = vi.fn(); abort = vi.fn(); stop = vi.fn();
  constructor() { recognition = this; }
}
function say(text: string) {
  act(() => recognition.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }));
}
function evidence(id: string, checks: { name: string; passed: boolean; observed: string }[]) {
  const path = process.env.COMPANION_DIARY_EVIDENCE;
  if (path) appendFileSync(path, JSON.stringify({ case_id: id, scope: "react_component_mock_api_and_asr", checks }) + "\n");
}
async function editor(text = "") {
  render(<DiaryCard day="2026-10-26" text={text} sourceTurn="" startEditing />);
  await waitFor(() => expect(screen.getByLabelText("日记内容")).toBeEnabled());
  return within(screen.getByRole("dialog", { name: "日记编辑器" }));
}
function startVoice() {
  fireEvent.click(screen.getByRole("button", { name: "开始或继续语音记录" }));
  fireEvent.click(screen.getByRole("button", { name: "同意并开始记录" }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(new Date("2026-10-26T04:00:00Z"));
  api.diaries.mockResolvedValue({ diaries: [] });
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
});

it("D01: appends media-related plans as diary content without chat routing or automatic save", async () => {
  const input = scenario("D01");
  await editor(); startVoice(); say(input.user_text);
  expect(screen.getByLabelText("日记内容")).toHaveValue(input.user_text);
  expect(screen.getByRole("region", { name: "日记编辑工作域" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("麦克风已开启");
  expect(api.chat).not.toHaveBeenCalled(); expect(api.saveDiary).not.toHaveBeenCalled();
  expect(screen.queryByText("怎么加入照片或视频？")).not.toBeInTheDocument();
  evidence("D01", [{ name: "content_stays_in_editor", passed: true, observed: "Verbatim plan appended; editor and listening stay active; no chat or save API called" }]);
});

it("D02: natural stop pauses without appending or saving", async () => {
  const input = scenario("D02");
  await editor(input.initial_state.draft); startVoice(); say(input.user_text);
  expect(screen.getByRole("status")).toHaveTextContent("麦克风已关闭");
  expect(screen.getByLabelText("日记内容")).toHaveValue(input.initial_state.draft);
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(api.saveDiary).not.toHaveBeenCalled(); expect(api.chat).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "日记编辑器" })).toBeInTheDocument();
  evidence("D02", [{ name: "seed_stop_pauses_without_append", passed: true, observed: "Natural stop aborted recognition; draft unchanged; no save" }]);
});

it("D03: natural save asks for confirmation and retries unchanged content after failure", async () => {
  const input = scenario("D03"), draft = input.initial_state.draft;
  api.saveDiary.mockRejectedValueOnce(new Error("测试网络断开")).mockImplementationOnce(async (day, body) => ({ day, ...body, revision: 1 }));
  await editor(draft); startVoice(); say(input.user_text);
  expect(api.saveDiary).not.toHaveBeenCalled();
  expect(screen.getByLabelText("日记内容")).toHaveValue(draft);
  expect(screen.getByRole("status")).toHaveTextContent("麦克风已关闭");
  fireEvent.click(screen.getByRole("button", { name: "确认保存日记" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("日记内容")).toHaveValue(draft);
  expect(api.saveDiary).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "确认保存日记" }));
  await screen.findByRole("article", { name: "已保存日记" });
  expect(api.saveDiary).toHaveBeenCalledTimes(2);
  expect(api.saveDiary.mock.calls[0]).toEqual(api.saveDiary.mock.calls[1]);
  expect(api.chat).not.toHaveBeenCalled();
  evidence("D03", [
    { name: "seed_save_request_shows_confirmation_without_append", passed: true, observed: "Natural save paused recognition and showed confirmation without save" },
    { name: "button_save_failure_preserves_draft_and_retry_id", passed: true, observed: "Confirmation retries identical draft and operation; no chat call" },
  ]);
});
