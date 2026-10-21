/** In-memory fixture state. This is not production consent or a photo API. */
export const SAMPLE_BATCH_ID = "sample-batch-20261021";
export const SAMPLE_LOCATION = "本页浏览器内（合成记录，不上传照片）";
export const SAMPLE_PHOTOS = [
  { id: "sample-walk", title: "散步示意", date: "1980", precision: "year" },
  { id: "sample-garden", title: "花园示意", date: "2001-05", precision: "month" },
  { id: "sample-unknown", title: "旧照示意", date: null, precision: "unknown" },
] as const;
export type FontSize = "normal" | "large";
export type Question =
  | { id: string; kind: "font"; size: FontSize }
  | { id: string; kind: "time"; batchId: string; revision: number };
export type Decision = { questionId: string; status: "confirmed" | "declined" | "cancelled"; message: string };
export type ScenarioState = {
  fontSize: FontSize;
  question: Question | null;
  revision: number;
  consent: "none" | "granted" | "declined" | "revoked";
  task: "idle" | "running" | "completed" | "cancelled";
  processedIds: string[];
  notice: string;
};
const initial = (): ScenarioState => ({
  fontSize: "normal", question: null, revision: 1, consent: "none", task: "idle", processedIds: [],
  notice: "仅使用 3 条合成照片记录，刷新后重置。",
});

export class TrialScenario {
  private state = initial();
  private listeners = new Set<() => void>();
  private decisions = new Map<string, Decision>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  activate() { this.disposed = false; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<ScenarioState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach(listener => listener());
  }
  open(question: Question) {
    if (this.disposed || this.decisions.has(question.id)) return false;
    if (this.state.question) return this.state.question.id === question.id;
    if (question.kind === "time" && (question.batchId !== SAMPLE_BATCH_ID || question.revision !== this.state.revision || this.state.task === "running")) return false;
    this.update({ question });
    return true;
  }
  decide(questionId: string, approved: boolean): Decision {
    const previous = this.decisions.get(questionId);
    if (previous) return previous;
    const question = this.state.question;
    if (!question || question.id !== questionId || this.disposed) throw new Error("这个确认问题已失效，请重新发起。");
    const decision: Decision = { questionId, status: approved ? "confirmed" : "declined", message: "" };
    if (question.kind === "font") {
      decision.message = approved ? `字号已${question.size === "large" ? "调大" : "恢复普通"}，仅此页有效。` : "保持原来的字号。";
      this.update({ question: null, fontSize: approved ? question.size : this.state.fontSize, notice: decision.message });
    } else {
      if (question.batchId !== SAMPLE_BATCH_ID || question.revision !== this.state.revision) throw new Error("批次确认已失效。");
      decision.message = approved ? "已同意本批合成记录的时间整理，正在本页模拟处理。" : "未授权，本批不整理。";
      this.update({ question: null, consent: approved ? "granted" : "declined", task: approved ? "running" : "idle", processedIds: [], notice: decision.message });
      if (approved) this.scheduleNext(this.state.revision);
    }
    this.decisions.set(questionId, decision);
    return decision;
  }
  private scheduleNext(revision: number) {
    this.timer = setTimeout(() => {
      // Match the consent version again immediately before each simulated commit.
      if (this.disposed || revision !== this.state.revision || this.state.consent !== "granted" || this.state.task !== "running") return;
      const ids = [...this.state.processedIds, SAMPLE_PHOTOS[this.state.processedIds.length].id];
      const finished = ids.length === SAMPLE_PHOTOS.length;
      this.update({ processedIds: ids, task: finished ? "completed" : "running", notice: finished ? "样例整理完成：2 条有已知时间，1 条时间待确认。" : `正在整理合成记录：${ids.length} / ${SAMPLE_PHOTOS.length}` });
      if (!finished) this.scheduleNext(revision);
    }, 500);
  }
  revoke() {
    clearTimeout(this.timer);
    this.update({ question: null, consent: "revoked", task: "cancelled", processedIds: [], revision: this.state.revision + 1, notice: "已撤回本页样例授权并清除模拟结果，原始样例保留。" });
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); }
}

export function parseDecision(text: string): boolean | null {
  const normalized = text.trim().replace(/[。！!，,？?\s]/g, "");
  if (/^(确认|确认调整|确认整理|同意|可以|好的?|是的?)$/.test(normalized)) return true;
  if (/^(取消|拒绝|不同意|不可以|不要|不要调整|不整理|暂时不用|不用了?)$/.test(normalized)) return false;
  return null;
}
export type TrialIntent = { tool: "confirm_font_size"; size: FontSize } | { tool: "confirm_time_batch" } | { tool: "help" };
export function parseIntent(text: string): TrialIntent {
  // Exact small grammar for the protocol fixture, never a claim of general NLU.
  const normalized = text.trim().replace(/[。！!，,？?\s]/g, "");
  if (/^(恢复普通字号|字调小一点|恢复字号)$/.test(normalized)) return { tool: "confirm_font_size", size: "normal" };
  if (/^(字调大一点|字太小了|帮我把字调大一点|帮我调大字号)$/.test(normalized)) return { tool: "confirm_font_size", size: "large" };
  if (/^(按时间整理|按时间整理这些照片|整理样例照片)$/.test(normalized)) return { tool: "confirm_time_batch" };
  return { tool: "help" };
}
