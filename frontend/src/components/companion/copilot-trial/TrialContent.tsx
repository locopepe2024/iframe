"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAgent, useHumanInTheLoop, useRenderToolCall } from "@copilotkit/react-core/v2/headless";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { Image as ImageIcon, Mic, Volume2 } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import type { ToolMessage } from "@ag-ui/core";
import { useCompanionVoice } from "../useCompanionVoice";
import { parseDecision, SAMPLE_BATCH_ID, SAMPLE_LOCATION, SAMPLE_PHOTOS, TrialScenario, type Question } from "./scenario";
import styles from "./trial.module.css";

const fontParameters = z.object({ size: z.enum(["normal", "large"]) }).strict();
const speechParameters = z.object({ speed: z.enum(["slow", "normal"]) }).strict();
const timeParameters = z.object({ batchId: z.literal(SAMPLE_BATCH_ID), revision: z.number().int().positive(), scope: z.literal("time") }).strict();
type Answer = (approved: boolean) => void;
const TrialContext = createContext<{ scenario: TrialScenario; answer: React.MutableRefObject<Answer | null> } | null>(null);
const VoiceContext = createContext<ReturnType<typeof useCompanionVoice> | null>(null);

type CardProps = { name: string; toolCallId: string; status: string; args: Record<string, unknown>; result?: string; respond?: (result: unknown) => void };
function ConfirmationCard({ name, toolCallId, status, args, result, respond }: CardProps) {
  const context = useContext(TrialContext)!;
  const { scenario, answer } = context;
  const voice = useContext(VoiceContext)!;
  const snapshot = useSyncExternalStore(scenario.subscribe, scenario.getSnapshot, scenario.getSnapshot);
  const [error, setError] = useState("");
  const sent = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const description = useRef<HTMLDivElement>(null);
  const font = name === "confirm_font_size";
  const speech = name === "confirm_speech_speed";
  const parsed = (font ? fontParameters : speech ? speechParameters : timeParameters).safeParse(args);
  const validArgs = parsed.success ? JSON.stringify(parsed.data) : "";
  useEffect(() => {
    if (!respond || !validArgs) return;
    const data = JSON.parse(validArgs);
    const question: Question = font ? { id: toolCallId, kind: "font", size: data.size }
      : speech ? { id: toolCallId, kind: "speech", speed: data.speed }
        : { id: toolCallId, kind: "time", batchId: data.batchId, revision: data.revision };
    if (!scenario.open(question)) {
      sent.current = true;
      respond({ questionId: toolCallId, status: "cancelled", message: "问题或批次已失效，请重新发起。" });
    }
  }, [scenario, respond, validArgs, font, speech, toolCallId]);
  const active = Boolean(respond && parsed.success && snapshot.question?.id === toolCallId && !sent.current);
  useEffect(() => {
    if (active) heading.current?.focus();
  }, [active]);
  const choose = (approved: boolean) => {
    if (!active || sent.current) return;
    try {
      voice.stopAll();
      const decision = scenario.decide(toolCallId, approved);
      sent.current = true;
      answer.current = null;
      respond?.(decision);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "请重新发起确认。"); }
  };
  useEffect(() => {
    if (!active) return;
    answer.current = choose;
    return () => { answer.current = null; };
  });
  if (!respond) {
    return <p className={styles.muted}>{result ? "这次选择已记录，请查看当前状态。" : "正在准备确认卡…"}</p>;
  }
  return <section className={`${styles.card} ${styles.prompt}`} aria-label={font ? "字号确认" : speech ? "语速确认" : "样例整理授权"}>
    <div ref={description}>
      <h2 ref={heading} tabIndex={-1}>{font ? (args.size === "large" ? "要把字调大一点吗？" : "要恢复普通字号吗？") : speech ? (args.speed === "slow" ? "要把朗读调慢一点吗？" : "要恢复普通语速吗？") : "只按时间整理这批样例吗？"}</h2>
      {font ? <p>只调整此页文字，刷新后恢复。取消会保留现在的字号。</p> : speech ? <p>只调整此页下一次朗读的速度，刷新后恢复慢速。取消会保留现在的语速。</p> : <>
        <p>本次仅处理 3 条合成记录的时间，不识别人脸、地点，也不处理真实照片。</p>
        <p>处理位置：{SAMPLE_LOCATION}。刷新后重置，您可以随时撤回并清除模拟结果。</p>
        <p className={styles.muted}>样例批次：{SAMPLE_BATCH_ID}；授权版本：{String(args.revision)}</p>
      </>}
      <p>请核对后点按钮，或听写“确认 / 取消”，检查文字后发送。</p>
    </div>
    <button disabled={!active} onClick={() => voice.speak(description.current?.textContent ?? "", snapshot.speechSpeed === "slow")}><Volume2 size={24} aria-hidden="true" />{voice.speaking ? "停止朗读" : "读给我听"}</button>
    <div className={styles.actions}>
      <button className={styles.primary} disabled={!active} onClick={() => choose(true)}>{font || speech ? "确认调整" : "同意本次整理"}</button>
      <button disabled={!active} onClick={() => choose(false)}>取消</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!parsed.success && <p role="alert">工具参数不完整，本次不能确认。</p>}
  </section>;
}

function Conversation() {
  const { scenario, answer } = useContext(TrialContext)!;
  const state = useSyncExternalStore(scenario.subscribe, scenario.getSnapshot, scenario.getSnapshot);
  const { agent, isReady } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const renderToolCall = useRenderToolCall();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const voice = useCompanionVoice(setDraft);
  useHumanInTheLoop({ name: "confirm_font_size", description: "请求用户确认当前页面字号调整", parameters: fontParameters, render: ConfirmationCard }, []);
  useHumanInTheLoop({ name: "confirm_speech_speed", description: "请求用户确认当前页面朗读速度调整", parameters: speechParameters, render: ConfirmationCard }, []);
  useHumanInTheLoop({ name: "confirm_time_batch", description: "请求合成批次的本地时间整理授权", parameters: timeParameters, render: ConfirmationCard }, []);
  useEffect(() => {
    scenario.activate();
    return () => { agent.abortRun(); scenario.dispose(); };
  }, [agent, scenario]);
  async function send(text: string) {
    if (!text.trim()) return;
    voice.stopAll();
    if (state.question) {
      const decision = parseDecision(text);
      if (decision === null || !answer.current) { setNotice("请核对当前确认卡，再说“确认”或“取消”，也可以直接点按钮。"); return; }
      answer.current(decision); setDraft(""); return;
    }
    if (busy || !isReady) return;
    setBusy(true); setNotice(""); setDraft("");
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text.trim() });
    try { await copilotkit.runAgent({ agent }); }
    catch { setNotice("这次试验未完成，请刷新重试。"); }
    finally { setBusy(false); }
  }
  return <VoiceContext.Provider value={voice}><main className={`${styles.shell} ${state.fontSize === "large" ? styles.large : ""}`} data-font-size={state.fontSize} data-speech-speed={state.speechSpeed}>
    <header className={styles.header}><h1>陪伴交互试验</h1><p className={styles.muted}>CopilotKit 工具确认 · 合成样例</p></header>
    <div className={styles.content}>
      <p>这里使用固定句式，不连接聊天模型。所有状态只在本页内存中，刷新后重置。</p>
      <p>当前朗读：{state.speechSpeed === "slow" ? "慢速" : "普通语速"}。可以说“说慢一点”或“恢复普通语速”，确认后调整。</p>
      <section className={styles.card} aria-label="尝试交互"><h2>您想试试什么？</h2><div className={styles.actions}>
        {["字调大一点", "恢复普通字号", "说慢一点", "恢复普通语速", "按时间整理"].map(text => <button key={text} disabled={busy || !isReady} onClick={() => void send(text)}>{text}</button>)}
      </div></section>
      <ol className={styles.messages} aria-label="对话记录">{agent.messages.map(message => <li key={message.id} className={styles.message}>
        {message.role === "user" && <strong>您： </strong>}
        {(message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content}
        {message.role === "assistant" && message.toolCalls?.map(toolCall => <div key={toolCall.id}>{renderToolCall({ toolCall, toolMessage: agent.messages.find((item): item is ToolMessage => item.role === "tool" && item.toolCallId === toolCall.id) })}</div>)}
      </li>)}</ol>
      <form onSubmit={event => { event.preventDefault(); void send(draft); }}>
        <label htmlFor="trial-input">说说您的需要（听写后请核对再发送）</label>
        <textarea id="trial-input" rows={2} value={draft} onChange={event => setDraft(event.target.value)} />
        <label className={styles.check}><input type="checkbox" checked={voiceConsent} onChange={event => { setVoiceConsent(event.target.checked); if (!event.target.checked) voice.stopAll(); }} />同意使用浏览器听写（可能由浏览器在线处理语音）</label>
        <div className={styles.actions}><button type="button" disabled={!voiceConsent || voice.finishing} onClick={voice.toggleListening}><Mic size={24} aria-hidden="true" />{voice.listening ? "停止听写" : "开始听写"}</button><button className={styles.primary} disabled={!draft.trim() || (!state.question && busy) || !isReady}>发送</button></div>
      </form>
      {(notice || voice.notice) && <p role="status">{notice || voice.notice}</p>}
      <section className={styles.card} aria-label="样例批次状态"><h2>合成照片样例</h2>
        <p role="status" className={styles.status}>{state.notice}</p>
        {state.task === "running" && <progress aria-label="样例整理进度" value={state.processedIds.length} max={3} />}
        {SAMPLE_PHOTOS.map(photo => <div className={styles.photo} key={photo.id}><ImageIcon aria-hidden="true" /><div><h3>{photo.title}</h3><p>{state.processedIds.includes(photo.id) ? `模拟结果：${photo.date ?? "时间待确认"}` : "合成示意 · 尚无整理结果"}</p></div></div>)}
        <button disabled={state.consent !== "granted"} onClick={() => { voice.stopAll(); answer.current?.(false); scenario.revoke(); }}>撤回授权并清除模拟结果</button>
      </section>
      <Link href="/companion">返回陪伴原型</Link>
    </div>
  </main></VoiceContext.Provider>;
}

export function TrialContent({ scenario }: { scenario: TrialScenario }) {
  const answer = useRef<Answer | null>(null);
  const [context] = useState(() => ({ scenario, answer }));
  return <TrialContext.Provider value={context}><Conversation /></TrialContext.Provider>;
}
