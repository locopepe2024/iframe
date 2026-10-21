import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDecision, parseIntent, SAMPLE_BATCH_ID, TrialScenario } from "./scenario";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const timeQuestion = (id = "q-time", revision = 1) => ({ id, kind: "time" as const, batchId: SAMPLE_BATCH_ID, revision });

describe("in-memory trial contract (not production authorization)", () => {
  it("cannot mutate before the exact current question is confirmed", () => {
    const scenario = new TrialScenario();
    scenario.open({ id: "font-1", kind: "font", size: "large" });
    expect(scenario.getSnapshot().fontSize).toBe("normal");
    expect(() => scenario.decide("old-question", true)).toThrow();
    scenario.decide("font-1", false);
    expect(scenario.getSnapshot().fontSize).toBe("normal");
    scenario.open({ id: "font-2", kind: "font", size: "large" });
    scenario.decide("font-2", true);
    expect(scenario.getSnapshot().fontSize).toBe("large");
    scenario.open({ id: "font-3", kind: "font", size: "normal" });
    scenario.decide("font-3", true);
    expect(scenario.getSnapshot().fontSize).toBe("normal");
  });
  it("rejects another batch, a stale revision, and overlapping questions", () => {
    const scenario = new TrialScenario();
    expect(scenario.open({ ...timeQuestion(), batchId: "other-batch" })).toBe(false);
    expect(scenario.open(timeQuestion("stale", 0))).toBe(false);
    expect(scenario.open(timeQuestion())).toBe(true);
    expect(scenario.open({ id: "font", kind: "font", size: "large" })).toBe(false);
  });
  it("does not process on refusal or silence", () => {
    const scenario = new TrialScenario(); scenario.open(timeQuestion());
    vi.runAllTimers(); expect(scenario.getSnapshot().processedIds).toEqual([]);
    scenario.decide("q-time", false);
    vi.runAllTimers();
    expect(scenario.getSnapshot()).toMatchObject({ consent: "declined", task: "idle", processedIds: [] });
  });
  it("commits once despite repeated decisions and clears results on withdrawal", () => {
    const scenario = new TrialScenario(); scenario.open(timeQuestion());
    const decision = scenario.decide("q-time", true);
    expect(scenario.decide("q-time", true)).toEqual(decision);
    vi.advanceTimersByTime(500);
    expect(scenario.getSnapshot().processedIds).toHaveLength(1);
    scenario.revoke(); vi.runAllTimers();
    expect(scenario.getSnapshot()).toMatchObject({ consent: "revoked", task: "cancelled", processedIds: [], revision: 2 });
    expect(scenario.open(timeQuestion("old-revision", 1))).toBe(false);
    expect(scenario.open(timeQuestion("new-revision", 2))).toBe(true);
    scenario.decide("new-revision", true); vi.runAllTimers();
    expect(scenario.getSnapshot()).toMatchObject({ task: "completed", processedIds: ["sample-walk", "sample-garden", "sample-unknown"] });
  });
  it("stops timers when disposed", () => {
    const scenario = new TrialScenario(); scenario.open(timeQuestion()); scenario.decide("q-time", true);
    scenario.dispose(); vi.runAllTimers(); expect(scenario.getSnapshot().processedIds).toEqual([]);
  });
  it("can activate after the initial StrictMode cleanup", () => {
    const scenario = new TrialScenario();
    scenario.dispose(); scenario.activate();
    expect(scenario.open({ id: "after-mount", kind: "font", size: "large" })).toBe(true);
    scenario.decide("after-mount", true);
    expect(scenario.getSnapshot().fontSize).toBe("large");
  });
  it.each(["不要确认", "不可以", "不同意", "取消", "暂时不用", "确认取消", "可以吗", "", "也许", "我还没说同意"])("never treats %s as approval", text => {
    expect(parseDecision(text)).not.toBe(true);
  });
  it("uses a restricted intent grammar and will not reverse negations", () => {
    expect(parseIntent("不要把字调大一点")).toEqual({ tool: "help" });
    expect(parseIntent("不按时间整理")).toEqual({ tool: "help" });
    expect(parseIntent("字调大一点")).toEqual({ tool: "confirm_font_size", size: "large" });
    expect(parseDecision("确认。")).toBe(true);
  });
});
