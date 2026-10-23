"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { companionApi, type MemoryPage, type Preview, type Turn, type UserMessage } from "@/lib/companionApi";
import styles from "../photos/photos.module.css";
import chatStyles from "./chat.module.css";
import PhotoConversationCard from "../PhotoConversationCard";
import { photoApi, type AlbumPhoto } from "@/lib/photoApi";

const prefix = process.env.NEXT_PUBLIC_API_URL === "/companion-demo" ? "/companion-demo" : "";
const sessionKey = "iframe-companion-agent-session-v1";
const turnKey = "iframe-companion-agent-turn-v1";

export default function AgentChat() {
  const [session, setSession] = useState("");
  const [menu, setMenu] = useState(false);
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
  const [photoAnchor, setPhotoAnchor] = useState(0);
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = streamRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turn, recentPhotos, busy]);
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
    setMenu(false); setRecentPhotos(null); setSession(result.session_id); setMessages([]); setAfter(null); setTurn(null); setPreview(null); setDraft(null); setText(""); setNotice("已开始新的聊天。");
  }
  async function send(retry = false) {
    if (!sendOperation.current || !retry) sendOperation.current = { operation_id: crypto.randomUUID(), text, allow_external_text: true };
    setHasRetry(true); setPreview(null);
    if (!session && !sessionOperation.current) sessionOperation.current = crypto.randomUUID();
    const activeSession = session || (await companionApi.session(sessionOperation.current)).session_id;
    if (!session) { sessionOperation.current = ""; setSession(activeSession); localStorage.setItem(sessionKey, activeSession); }
    const result = await companionApi.chat(activeSession, sendOperation.current);
    localStorage.setItem(turnKey, result.turn_id);
    if (alive.current) { setDraft(null); setTurn(result); setPreview(result.result?.kind === "confirmation" ? result.result : null); setText(""); sendOperation.current = null; setHasRetry(false); }
    await history(activeSession);
  }
  async function memories(search: string, cursor = "") {
    const value = await companionApi.tool<MemoryPage>(search ? "memory.search" : "memory.list", { ...(search ? { query: search } : {}), cursor, limit: 20 });
    setPage(old => cursor ? { ...value, memories: [...(old?.memories ?? []), ...value.memories] } : value); setAppliedQuery(search);
  }
  async function loadRecentPhotos() {
    const result = await photoApi.list("all", "", "", "");
    if (alive.current) { setRecentPhotos(result.photos.slice(0, 6)); setPhotoAnchor(messages.length); }
  }
  const activePreview = preview ?? (turn?.result?.kind === "confirmation" ? turn.result : null);
  const pending = activePreview?.status === "pending_confirmation";
  async function closePreview() {
    if (!activePreview) return;
    await companionApi.cancel(activePreview.preview_token);
    setDraft(null); setPreview({ status: "preview_closed", preview_token: activePreview.preview_token }); setNotice("已关闭预览，未执行新的保存或删除。");
  }
  return <main className={`${styles.shell} ${chatStyles.shell}`}>
    <header className={chatStyles.header}><h1>聊天</h1><button type="button" aria-expanded={menu} onClick={() => setMenu(!menu)}>更多</button></header>
    {menu && <aside className={styles.panel} aria-label="聊天管理">
      <a href={`${prefix}/companion/photos`}>生活相册</a>
      <button disabled={busy || pending} onClick={() => void run(newSession)}>新建会话</button>
      <p className={styles.note}>聊天内容会保留，可继续查看历史消息。</p>
    </aside>}
    <div ref={streamRef} className={chatStyles.stream} role="region" aria-label="聊天内容">
    <article className={chatStyles.assistant}><span>陪伴助手</span><p>您好，我在。想聊聊今天，还是一起看看照片？</p></article>
    {!messages.length && <section className={styles.guide} aria-labelledby="chat-guide-title">
      <h2 id="chat-guide-title">想从哪里聊起？</h2>
      <div className={styles.guideGrid}>
        <button type="button" className={styles.guideCard} disabled={busy || pending || hasRetry} onClick={() => { setText("聊聊今天发生的事情"); inputRef.current?.focus(); }}>
          <strong>聊聊今天</strong><span>说说今天的生活</span>
        </button>
        <button type="button" className={styles.guideCard} disabled={busy || pending || hasRetry} onClick={() => { void run(loadRecentPhotos); }}>
          <strong>讲讲一张照片</strong><span>在这里看看照片</span>
        </button>
        <button type="button" className={styles.guideCard} disabled={busy || pending || hasRetry} onClick={() => { setText("请把我们今天聊的内容整理成一篇回忆日记"); inputRef.current?.focus(); }}>
          <strong>整理今天的回忆</strong><span>把故事记下来</span>
        </button>
      </div>
    </section>}
    {!recentPhotos && <button type="button" disabled={busy || pending} onClick={() => void run(loadRecentPhotos)}>看看相册照片</button>}
    <section aria-label="会话消息">
      {recentPhotos && photoAnchor === 0 && <section aria-label="相册照片">{!recentPhotos.length && <p>相册里还没有照片。</p>}{recentPhotos.map((photo, index) => <PhotoConversationCard key={photo.photo_id} photoId={photo.photo_id} label={`相册照片 ${index + 1}`} />)}</section>}
      {messages.map((message, messageIndex) => <Fragment key={message.id}><div>
        <article className={chatStyles.user}><span>我</span><p>{message.text}</p></article>
        {message.turn?.result?.kind === "text" && <article className={chatStyles.assistant}><span>陪伴助手</span><p>{message.turn.result.text}</p></article>}
      </div>
      {recentPhotos && photoAnchor === messageIndex + 1 && <section aria-label="相册照片">{!recentPhotos.length && <p>相册里还没有照片。</p>}{recentPhotos.map((photo, index) => <PhotoConversationCard key={photo.photo_id} photoId={photo.photo_id} label={`相册照片 ${index + 1}`} />)}</section>}
      </Fragment>)}
      {after !== null && <button disabled={busy} onClick={() => void run(() => history(session, after))}>更多历史消息</button>}
    </section>
    {turn?.result?.kind === "text" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <article className={chatStyles.assistant}><span>陪伴助手</span><p>{turn.result.text}</p></article>}
    {busy && <p role="status">正在处理…</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
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
    </div>
    {menu && <details className={chatStyles.management}><summary>我的记忆</summary>
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
    </details>}
    <footer className={chatStyles.composer}>
      <label>和我聊聊天<textarea ref={inputRef} rows={2} placeholder="想说什么，都可以写在这里…" maxLength={4000} value={text} disabled={busy || pending || hasRetry} onChange={e => setText(e.target.value)} /></label>
      {!allowed && <details><summary>开始聊天前，请确认文字发送范围</summary>
        <p>您本次及最近最多 20 条发言将发送至您配置的 UniArt / Qwen 服务。照片不会随文字自动发送。</p>
        <label className={styles.check}><input type="checkbox" checked={allowed} disabled={busy} onChange={e => setAllowed(e.target.checked)} />允许发送文字，开始聊天</label>
      </details>}
      <button disabled={busy || pending || !allowed || !text.trim() || hasRetry} onClick={() => void run(() => send())}>发送</button>
      {hasRetry && <button disabled={busy || !allowed} onClick={() => void run(() => send(true))}>重试原请求</button>}
    </footer>
  </main>;
}
