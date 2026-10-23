"use client";
import { useEffect, useRef, useState } from "react";
import { companionApi, type MemoryPage, type Preview, type Turn, type UserMessage } from "@/lib/companionApi";
import styles from "../photos/photos.module.css";
import ConversationCard from "../ConversationCard";
import PhotoConversationCard from "../PhotoConversationCard";
import { photoApi, type AlbumPhoto } from "@/lib/photoApi";

const prefix = process.env.NEXT_PUBLIC_API_URL === "/companion-demo" ? "/companion-demo" : "";
const sessionKey = "iframe-companion-agent-session-v1";
const turnKey = "iframe-companion-agent-turn-v1";

export default function AgentChat() {
  const [session, setSession] = useState("");
  const [messages, setMessages] = useState<UserMessage[]>([]), [after, setAfter] = useState<number | null>(null);
  const [text, setText] = useState(""), [allowed, setAllowed] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState<MemoryPage | null>(null), [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const locked = useRef(false), alive = useRef(true);
  const sessionOperation = useRef("");
  const sendOperation = useRef<{ operation_id: string; text: string; allow_external_text: true } | null>(null);
  const confirmOperation = useRef<{ token: string; id: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [hasRetry, setHasRetry] = useState(false);
  const [recentPhotos, setRecentPhotos] = useState<AlbumPhoto[] | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作未完成，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function history(id: string, cursor = 0) {
    const result = await companionApi.messages(id, cursor);
    if (alive.current) { setMessages(old => cursor ? [...old, ...result.messages] : result.messages); setAfter(result.next_after); }
  }
  useEffect(() => {
    alive.current = true;
    void run(async () => {
      const id = localStorage.getItem(sessionKey);
      if (id) { await history(id); if (alive.current) setSession(id); }
      const savedTurn = localStorage.getItem(turnKey);
      if (id && savedTurn) { const result = await companionApi.turn(savedTurn); if (alive.current) setTurn(result); }
    });
    return () => { alive.current = false; };
    // The browser stores identifiers only; the server checks current ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function newSession() {
    if (!sessionOperation.current) sessionOperation.current = crypto.randomUUID();
    const result = await companionApi.session(sessionOperation.current);
    localStorage.setItem(sessionKey, result.session_id); localStorage.removeItem(turnKey);
    sessionOperation.current = ""; sendOperation.current = null; setHasRetry(false);
    setSession(result.session_id); setMessages([]); setAfter(null); setTurn(null); setPreview(null); setDraft(null); setText(""); setNotice("已打开新会话，先前记忆仍可在下方查询。");
  }
  async function send(retry = false) {
    if (!sendOperation.current || !retry) sendOperation.current = { operation_id: crypto.randomUUID(), text, allow_external_text: true };
    setHasRetry(true); setPreview(null);
    const result = await companionApi.chat(session, sendOperation.current);
    localStorage.setItem(turnKey, result.turn_id);
    if (alive.current) { setDraft(null); setTurn(result); setPreview(result.result?.kind === "confirmation" ? result.result : null); setText(""); sendOperation.current = null; setHasRetry(false); }
    await history(session);
  }
  async function memories(search: string, cursor = "") {
    const value = await companionApi.tool<MemoryPage>(search ? "memory.search" : "memory.list", { ...(search ? { query: search } : {}), cursor, limit: 20 });
    setPage(old => cursor ? { ...value, memories: [...(old?.memories ?? []), ...value.memories] } : value); setAppliedQuery(search);
  }
  async function loadRecentPhotos() {
    const result = await photoApi.list("all", "", "", "");
    if (alive.current) setRecentPhotos(result.photos.slice(0, 6));
  }
  const activePreview = preview ?? (turn?.result?.kind === "confirmation" ? turn.result : null);
  const pending = activePreview?.status === "pending_confirmation";
  async function closePreview() {
    if (!activePreview) return;
    await companionApi.cancel(activePreview.preview_token);
    setDraft(null); setPreview({ status: "preview_closed", preview_token: activePreview.preview_token }); setNotice("已关闭预览，未执行新的保存或删除。");
  }
  return <main className={styles.shell}>
    <a href={`${prefix}/companion/photos`}>返回生活相册</a>
    <h1>陪伴聊天与个人记忆</h1>
    <p>文字聊天测试。发送时，本轮及最近最多 20 条用户原话经您个人的 UniArt 渠道发给 Qwen。暂不发送照片、全库记忆或此前助手回复；模型可能说错，请核对。</p>
    <button disabled={busy || pending} onClick={() => void run(newSession)}>新建会话</button>
    {session && <button disabled={busy || pending} onClick={() => void run(() => history(session))}>重新读取本会话原话</button>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <section className={styles.guide} aria-labelledby="chat-guide-title">
      <h2 id="chat-guide-title">你想做什么？</h2>
      <p>选一张卡片开始，也可以直接告诉我。</p>
      <div className={styles.guideGrid}>
        <button type="button" className={styles.guideCard} disabled={busy || pending || !session} onClick={() => { setText("聊聊今天发生的事情"); inputRef.current?.focus(); }}>
          <strong>聊聊今天</strong><span>说说今天的生活</span>
        </button>
        <button type="button" className={styles.guideCard} disabled={busy || pending} onClick={() => { window.location.href = `${prefix}/companion/photos`; }}>
          <strong>讲讲一张照片</strong><span>去生活相册看看</span>
        </button>
        <button type="button" className={styles.guideCard} disabled={busy || pending || !session} onClick={() => { setText("请把我们今天聊的内容整理成一篇回忆日记"); inputRef.current?.focus(); }}>
          <strong>整理今天的回忆</strong><span>把故事记下来</span>
        </button>
      </div>
    </section>
    <section className={styles.panel} aria-label="相册照片">
      <h2>想聊聊照片吗？</h2>
      <p>可以先看看相册里的照片，再慢慢讲故事。这里展示部分照片，更多照片可进入生活相册查看。</p>
      {!recentPhotos && <button type="button" disabled={busy || pending} onClick={() => void run(loadRecentPhotos)}>看看相册照片</button>}
      {recentPhotos && !recentPhotos.length && <p>相册里还没有照片。</p>}
      {recentPhotos?.map((photo, index) => <PhotoConversationCard key={photo.photo_id} photoId={photo.photo_id} label={`相册照片 ${index + 1}`} />)}
    </section>
    <section className={styles.panel} aria-label="会话原话">
      <h2>已保存的用户原话</h2><p>原话按页查看，不受模型最近 20 条上下文限制。这里只恢复用户消息和最近一次模型结果。</p>
      {messages.map(message => <p key={message.id}>{message.text}</p>)}
      {after !== null && <button disabled={busy} onClick={() => void run(() => history(session, after))}>更多历史原话</button>}
    </section>
    <label>和我聊聊天<textarea ref={inputRef} placeholder="在这里打字，比如：今天有什么开心的事？" maxLength={4000} value={text} disabled={busy || pending || hasRetry} onChange={e => setText(e.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" checked={allowed} disabled={busy} onChange={e => setAllowed(e.target.checked)} />允许将上述范围的文字发送给个人 UniArt / Qwen 渠道</label>
    <button disabled={busy || pending || !session || !allowed || !text.trim() || hasRetry} onClick={() => void run(() => send())}>发送给陪伴助手</button>
    {hasRetry && <button disabled={busy || !allowed} onClick={() => void run(() => send(true))}>重试原请求</button>}
    {turn?.result?.kind === "text" && <ConversationCard card={{ kind: "text", title: "陪伴助手", body: turn.result.text }} />}
    {turn?.result?.kind === "read" && <section className={styles.panel} aria-label="工具读取结果"><h2>实际记忆查询结果</h2>
      {turn.result.memories.length === 0 && <p>没有匹配的记忆。</p>}{turn.result.memories.map(m => <p key={m.id}>{m.content}（原话：{m.quote}）</p>)}
      {turn.result.next_cursor && <p>还有更多结果，请使用下方个人记忆列表分页查看。</p>}
    </section>}
    {pending && activePreview.preview && <section className={styles.confirm} aria-label="记忆操作确认">
      <h2>{activePreview.action === "save" ? "要保存这条个人记忆吗？" : "要删除这条个人记忆吗？"}</h2>
      {activePreview.action === "save" ? <><p>拟保存：{activePreview.preview.content}</p><p>引用原话：{activePreview.preview.quote}</p><p>来源消息：{activePreview.preview.source_text}</p></> : <><p>{activePreview.preview.memory?.content}</p><p>引用原话：{activePreview.preview.memory?.quote}</p><p>只删除这条记忆，原始聊天消息仍保留。</p></>}
      {activePreview.action === "save" && <>
        <label>修改拟保存内容（修改后需重新预览）<textarea maxLength={1600} disabled={busy} value={draft ?? activePreview.preview.content ?? ""} onChange={e => setDraft(e.target.value)} /></label>
        {draft !== null && <button disabled={busy || !draft.trim()} onClick={() => void run(async () => {
          const values = activePreview.preview!;
          const next = await companionApi.tool<Preview>("memory.save", { source_message_id: values.source_message_id, quote: values.quote, content: draft.trim(), type: values.type, importance: values.importance });
          await companionApi.cancel(activePreview.preview_token);
          setPreview(next); setDraft(null); confirmOperation.current = null;
        })}>重新预览修改后的记忆</button>}
      </>}
      <button disabled={busy || draft !== null} onClick={() => void run(async () => {
        const token = activePreview.preview_token;
        if (confirmOperation.current?.token !== token) confirmOperation.current = { token, id: crypto.randomUUID() };
        const receipt = await companionApi.confirm(token, confirmOperation.current.id);
        setPreview({ status: "preview_closed", preview_token: token }); confirmOperation.current = null;
        setNotice(receipt.action === "save" ? "个人记忆已保存。" : "个人记忆已删除；原始聊天仍保留。");
        setPage(null); if (turn?.result?.kind === "read") setTurn(null);
      })}>{activePreview.action === "save" ? "确认保存记忆" : "确认删除记忆"}</button>
      <button disabled={busy} onClick={() => void run(closePreview)}>取消，不执行</button>
    </section>}
    <section className={styles.panel} aria-label="个人记忆">
      <h2>个人记忆</h2><p>只展示明确确认过的记忆。搜索按原文文字匹配，不是语义检索。</p>
      <label>搜索记忆<input maxLength={100} disabled={busy || pending} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button disabled={busy || pending} onClick={() => void run(() => memories(query.trim()))}>查询个人记忆</button>
      <button disabled={busy || pending} onClick={() => void run(async () => { setQuery(""); await memories(""); })}>列出全部记忆</button>
      {page?.memories.length === 0 && <p>没有匹配的记忆。</p>}
      {page?.memories.map(memory => <article key={memory.id} className={styles.history}><p>{memory.content}</p><p>来源原话：{memory.quote}</p>
        <button disabled={busy || pending} onClick={() => void run(async () => { setDraft(null); setPreview(await companionApi.tool<Preview>("memory.delete", { memory_id: memory.id })); })}>删除这条记忆</button>
      </article>)}
      {page?.next_cursor && <button disabled={busy || pending} onClick={() => void run(() => memories(appliedQuery, page.next_cursor!))}>更多个人记忆</button>}
    </section>
  </main>;
}
