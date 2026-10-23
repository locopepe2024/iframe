"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, House, MessageCircle, Mic, Settings, Volume2 } from "lucide-react";
import { Diary, emptyData, Feedback, Message, readSaved, SavedData, STORAGE_KEY, writeSaved } from "./storage";
import { useCompanionVoice } from "./useCompanionVoice";
import styles from "./companion.module.css";
import FeatureCardNav from "./FeatureCardNav";

type Tab = "today" | "chat" | "diary" | "more";
type Adjustment = "large" | "slow" | "normal-size" | "normal-speed";
const adjustmentLabels: Record<Adjustment, string> = { large: "把字调大一点", slow: "把朗读放慢一点", "normal-size": "恢复普通字号", "normal-speed": "恢复普通语速" };
const tabs = [
  { id: "today", label: "今天", Icon: House }, { id: "chat", label: "聊天", Icon: MessageCircle },
  { id: "diary", label: "日记", Icon: BookOpen }, { id: "more", label: "更多", Icon: Settings },
] as const;
const greeting: Message = { id: "welcome", role: "assistant", content: "您好，我在这里。今天有什么想聊的事？也可以告诉我：字调大一点、说慢一点。" };
const uid = () => crypto.randomUUID();

export default function Companion() {
  const [tab, setTab] = useState<Tab>("today");
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState<SavedData>(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [large, setLarge] = useState(false);
  const [slow, setSlow] = useState(false);
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [diary, setDiary] = useState<Diary | null>(null);
  const [candidate, setCandidate] = useState<Feedback | null>(null);
  const [feedbackAsked, setFeedbackAsked] = useState(false);
  const [feedbackConsent, setFeedbackConsent] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastMessage = useRef<HTMLDivElement>(null);
  const voice = useCompanionVoice(text => setInput(previous => previous ? `${previous} ${text}` : text));

  useEffect(() => {
    try { setSaved(readSaved()); }
    catch { setStorageBlocked(true); setNotice("无法读取本机记录，暂不覆盖。请在“更多”清除原型记录后重试。"); }
    setLoaded(true);
  }, []);
  useEffect(() => {
    heading.current?.focus();
    if (tab !== "chat") voice.stopAll();
    // Stop microphone and playback when leaving the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => { if (tab === "chat") lastMessage.current?.scrollIntoView?.({ block: "nearest" }); }, [messages, tab]);

  function persist(next: SavedData, success: string) {
    if (!loaded || storageBlocked) { setNotice("本机存储尚不可用，请先查看“更多”。"); return false; }
    try { writeSaved(next); setSaved(next); setNotice(success); return true; }
    catch { setNotice("保存失败，内容仍在本页。请释放浏览器空间后重试。"); return false; }
  }
  function assistant(content: string) { setMessages(previous => [...previous, { id: uid(), role: "assistant", content }]); }
  function applyAdjustment() {
    if (!adjustment) return;
    if (adjustment === "large" || adjustment === "normal-size") setLarge(adjustment === "large");
    else setSlow(adjustment === "slow");
    const result = `已${adjustmentLabels[adjustment]}，本次打开有效。您可以继续说“恢复普通字号”或“恢复普通语速”。`;
    assistant(result); setNotice(result); setAdjustment(null);
  }
  function send() {
    const text = input.trim();
    if (!text) return;
    const message: Message = { id: uid(), role: "user", content: text };
    setMessages(previous => [...previous, message]); setInput("");
    if (adjustment && /^(确认|好的?|可以|同意|是的?)[。！!，,\s]*$/.test(text)) { applyAdjustment(); return; }
    if (adjustment && /^(取消|不用了?|不要|不)[。！!，,\s]*$/.test(text)) { setAdjustment(null); assistant("好的，保持现在的设置。"); return; }
    const requested: Adjustment | null = /恢复.*(字号|字体)|字.*(小一点|调小)/.test(text) ? "normal-size"
      : /恢复.*语速|说.*快一点/.test(text) ? "normal-speed"
      : /字太小|看不清|字.*(大一点|调大|放大)/.test(text) ? "large"
      : /说.*慢一点|读.*慢一点|语速.*慢|没听清/.test(text) ? "slow" : null;
    if (requested) {
      setAdjustment(requested); assistant(`我可以${adjustmentLabels[requested]}，只在本次打开生效。您看可以吗？可以说“确认”或“取消”，也可以点下方按钮。`); return;
    }
    setAdjustment(null);
    assistant("谢谢您和我分享。演示中这段话会留在本页，您还可以继续聊，或整理成日记草稿。");
    if (/找不到|不会用|太复杂|不好用/.test(text) && !feedbackAsked) {
      setFeedbackAsked(true); setFeedbackConsent(false);
      setCandidate({ id: uid(), date: new Date().toISOString(), sourceIds: [message.id], text: "使用界面时遇到困难，请补充希望改进的地方。", evidence: "explicit", hypothesis: "演示规则根据使用困难词语提示；具体原因尚未验证。", consentAt: "", status: "pending-review", version: "h5-demo-v1" });
    }
  }
  function draftDiary() {
    const source = messages.filter(message => message.role === "user");
    if (!source.length) { setNotice("先聊一件今天的事，再整理日记。"); setTab("chat"); return; }
    setDiary({ id: uid(), date: new Date().toISOString(), sourceIds: source.map(message => message.id), text: source.map(message => message.content).join("\n\n") });
    setTab("diary"); setNotice("已把您说的话排成草稿，请修改后保存。");
  }
  function clearAll() {
    try { localStorage.removeItem(STORAGE_KEY); setSaved(emptyData()); setStorageBlocked(false); setNotice("已清除这台设备上的原型记录。"); }
    catch { setNotice("清除失败，记录未删除，请检查浏览器存储权限。"); }
  }
  const latestReply = [...messages].reverse().find(message => message.role === "assistant")?.content ?? greeting.content;

  return <div className={`${styles.shell} ${large ? styles.large : ""}`} data-testid="companion-shell">
    <header className={styles.header}><div><span className={styles.eyebrow}>iFrame · 生活陪伴</span><h1 ref={heading} tabIndex={-1}>{tabs.find(item => item.id === tab)?.label}</h1></div><span className={styles.badge}>体验原型</span></header>
    <main className={styles.main}>
      <p className={styles.disclosure}>演示对话 · 不连接真实 Agent<br />保存的日记和反馈仅在此设备，不同步账号。</p>
      <p role="status" className={styles.status}>{notice || "聊天暂存在本页，刷新后会消失。"}</p>
      {tab === "today" && <>
        <section className={styles.hero}><p>{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p><h2>慢慢说，我在听</h2><p>一顿可口的饭，一次散步，<br />或是今天惦记的人。</p><button className={styles.primary} onClick={() => setTab("chat")}><MessageCircle aria-hidden="true" /> 和我聊聊天</button></section>
        <FeatureCardNav onSelect={target => target === "photos" ? window.location.assign(`${process.env.NEXT_PUBLIC_API_URL === "/companion-demo" ? "/companion-demo" : ""}/companion/photos`) : setTab(target)} />
        <section className={styles.card}><h2>按您的习惯来</h2><p>可以直接告诉我“字调大一点”或“说慢一点”，我会先和您确认，再调整。</p><button onClick={() => setTab("chat")}>试试说一句</button></section>
        <section className={styles.card}><h2>留住今天的小事</h2><p>先聊聊，再整理成日记。保存前都能修改。</p><button onClick={draftDiary}>整理今天的日记</button></section>
        <section className={styles.card}><h2>提醒与问候</h2><p>后续可由您选择问候时段、安静时段和提醒内容。</p><p>本原型尚不提供到点提醒，也不会在后台主动发消息。</p></section>
      </>}
      {tab === "chat" && <>
        <section aria-label="聊天内容" className={styles.messages}>{messages.map(message => <article className={`${styles.message} ${message.role === "user" ? styles.mine : ""}`} key={message.id}><span className={styles.eyebrow}>{message.role === "user" ? "我" : "陪伴助手 · 演示回复"}</span><p>{message.content}</p></article>)}<div ref={lastMessage} /></section>
        <button onClick={() => voice.speak(latestReply, slow)}><Volume2 aria-hidden="true" />{voice.speaking ? "停止朗读" : "读给我听"}</button>
        {adjustment && <section className={styles.card} aria-label="确认个人设置"><h2>{adjustmentLabels[adjustment]}，可以吗？</h2><p>可以说“确认”或“取消”，也可以点击。</p><div className={styles.actions}><button onClick={() => { setAdjustment(null); assistant("好的，保持现在的设置。"); }}>取消调整</button><button onClick={applyAdjustment}>确认调整</button></div></section>}
        <section className={styles.card} aria-label="说话和打字">
          <p id="voice-disclosure">听写可能由浏览器的语音服务处理音频。文字只放入输入框，不自动发送。</p>
          <label className={styles.check}><input type="checkbox" checked={voiceConsent} onChange={event => { setVoiceConsent(event.target.checked); if (voice.listening) voice.stopAll(); }} />本次允许使用浏览器听写</label>
          <button className={styles.primary} disabled={!voiceConsent || voice.finishing} aria-pressed={voice.listening} aria-describedby="voice-disclosure" onClick={voice.toggleListening}><Mic aria-hidden="true" />{voice.finishing ? "正在结束听写" : voice.listening ? "停止听写" : "点一下，说话"}</button><p role="status">{voice.notice}</p>
          <label htmlFor="companion-input">想说的话（可修改）</label><textarea id="companion-input" value={input} onChange={event => setInput(event.target.value)} rows={3} />
          <div className={styles.actions}><button onClick={() => setInput("今天和老朋友一起散步，心情很好。")}>试用示例</button><button className={styles.primary} disabled={!input.trim() || voice.listening} onClick={send}>发送</button></div>
        </section>
        {candidate && <section className={styles.card} aria-label="使用问题候选"><h2>要记下这个使用问题吗？</h2><p>只保存在此设备供您查看，没有发给开发团队。</p>
          <label htmlFor="feedback-text">请用简短文字描述困难，避免个人隐私</label><textarea id="feedback-text" value={candidate.text} rows={3} onChange={event => setCandidate({ ...candidate, text: event.target.value })} />
          <p>证据：您明确提到了使用困难。关联本次消息 1 条。</p><p>待验证的推测：{candidate.hypothesis}</p>
          <label className={styles.check}><input type="checkbox" checked={feedbackConsent} onChange={event => setFeedbackConsent(event.target.checked)} />允许保存上面这条反馈摘要</label>
          <div className={styles.actions}><button onClick={() => { setCandidate(null); setFeedbackConsent(false); }}>暂不记录</button><button disabled={!feedbackConsent || !candidate.text.trim() || !loaded || storageBlocked} onClick={() => {
            const record = { ...candidate, text: candidate.text.trim(), consentAt: new Date().toISOString() };
            if (persist({ ...saved, feedback: [...saved.feedback.filter(item => item.id !== record.id), record] }, "反馈已保存到本机，尚未提交评审。")) { setCandidate(null); setFeedbackConsent(false); }
          }}>确认保存反馈</button></div></section>}
        <button onClick={draftDiary}>把聊天整理成日记</button>
      </>}
      {tab === "diary" && <>
        <section className={styles.card}><h2>今天，值得记下来</h2><p>演示会将您说的话排成草稿，您可以自己修改。</p><button onClick={draftDiary}>从聊天整理草稿</button></section>
        {diary && <section className={styles.card}><h2>日记草稿</h2><p>来源：本次聊天中您发送的 {diary.sourceIds.length} 条消息。</p><label htmlFor="diary-text">日记内容</label><textarea id="diary-text" value={diary.text} rows={8} onChange={event => setDiary({ ...diary, text: event.target.value })} /><p>只保存在本机，其他共用此浏览器的人也可能看到。</p><button disabled={!diary.text.trim() || !loaded || storageBlocked} className={styles.primary} onClick={() => {
          const record = { ...diary, text: diary.text.trim() };
          if (persist({ ...saved, diaries: [...saved.diaries.filter(item => item.id !== record.id), record] }, "日记已保存到本机。")) setDiary(null);
        }}>确认保存日记</button></section>}
        <h2>已保存的日记</h2>{!saved.diaries.length && <p>还没有保存日记。先和我聊聊吧。</p>}
        {saved.diaries.map(item => <article className={styles.card} key={item.id}><h3>{new Date(item.date).toLocaleDateString("zh-CN")}</h3><p className={styles.preserve}>{item.text}</p><p>来自 {item.sourceIds.length} 条聊天消息</p><button onClick={() => persist({ ...saved, diaries: saved.diaries.filter(record => record.id !== item.id) }, "日记已从本机删除。")}>删除这篇日记</button></article>)}
      </>}
      {tab === "more" && <>
        <section className={styles.card}><h2>按您的习惯来</h2><p>设置仅在本次打开时生效，也可以在聊天中告诉我。</p><label className={styles.check}><input type="checkbox" checked={large} onChange={event => setLarge(event.target.checked)} />字再大一点</label><label className={styles.check}><input type="checkbox" checked={slow} onChange={event => setSlow(event.target.checked)} />朗读慢一点</label></section>
        <section className={styles.card}><h2>您记录的使用问题</h2><p>没有开启自动收集。每条反馈都需要您单独确认，随时可以删除。</p>{!saved.feedback.length && <p>还没有保存反馈。</p>}{saved.feedback.map(item => <article className={styles.feedback} key={item.id}><h3>用户明确反馈 · 待评审</h3><p className={styles.preserve}>{item.text}</p><p>待验证的推测：{item.hypothesis}</p><p>版本：{item.version} · 仅本机</p><button onClick={() => persist({ ...saved, feedback: saved.feedback.filter(record => record.id !== item.id) }, "反馈已从本机删除。")}>删除这条反馈</button></article>)}</section>
        <section className={styles.card}><h2>本机记录</h2><p>清除只删除本原型的日记和反馈，不影响创作台。清除后无法恢复。</p><details><summary>清除原型记录</summary><button onClick={clearAll}>确认清除本机原型记录</button></details></section>
      </>}
    </main>
    <nav className={styles.nav} aria-label="主要导航">{tabs.map(({ id, label, Icon }) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}</nav>
  </div>;
}
