"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { companionApi, type MemoryPage, type Preview, type Turn, type UserMessage } from "@/lib/companionApi";
import styles from "../photos/photos.module.css";
import chatStyles from "./chat.module.css";
import PhotoConversationCard from "../PhotoConversationCard";
import TodayPlanCards from "./TodayPlanCards";
import AttachmentDraft from "./AttachmentDraft";
import AlbumPicker from "./AlbumPicker";
import MediaUpload, { type UploadedMedia } from "./MediaUpload";
import VideoConversationCard from "./VideoConversationCard";
import CompanionComposer, { type ComposerMode } from "./CompanionComposer";
import GenerationGuide, { createGenerationDraft, type GenerationDraft, type MediaMode } from "./GenerationGuide";
import CompanionFeatureSheet, { type CompanionFeature } from "./CompanionFeatureSheet";
import DiaryCalendar from "./DiaryCalendar";
import DiaryCard, { diaryDay, diaryPrompt, formatDiaryDay, today, type DiaryContextItem, type DiaryContextMedia } from "./DiaryCard";
import UploadGuideCard from "./UploadGuideCard";
import { BookOpen, Images, UserRound, Compass } from "lucide-react";

const prefix = process.env.NEXT_PUBLIC_API_URL === "/companion-demo" ? "/companion-demo" : "";
const sessionKey = "iframe-companion-agent-session-v1";
const turnKey = "iframe-companion-agent-turn-v1";
const consentKey = "iframe-companion-agent-text-consent-v1";

export default function AgentChat() {
  const [session, setSession] = useState("");
  const [menu, setMenu] = useState(false);
  const [messages, setMessages] = useState<UserMessage[]>([]), [after, setAfter] = useState<number | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("chat");
  const [drafts, setDrafts] = useState<Record<ComposerMode, string>>({ chat: "", image: "", video: "" });
  const [guides, setGuides] = useState<Record<MediaMode, GenerationDraft | null>>({ image: null, video: null });
  const text = drafts[mode];
  const guide = mode === "chat" ? null : guides[mode];
  const [turn, setTurn] = useState<Turn | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [lastSubmittedText, setLastSubmittedText] = useState("");
  const [page, setPage] = useState<MemoryPage | null>(null), [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const locked = useRef(false), alive = useRef(true);
  const sessionOperation = useRef("");
  const sendOperation = useRef<{ operation_id: string; text: string; allow_external_text: true } | null>(null);
  const confirmOperation = useRef<{ token: string; id: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [hasRetry, setHasRetry] = useState(false);
  const [albumOpen,setAlbumOpen] = useState(false);
  const [feature,setFeature] = useState<CompanionFeature | null>(null);
  const [uploading,setUploading] = useState(false);
  const [pendingMedia,setPendingMedia] = useState<Record<ComposerMode,UploadedMedia[]>>({chat:[],image:[],video:[]});
  const [mediaAcknowledged,setMediaAcknowledged] = useState(false);
  const [uploadFiles,setUploadFiles] = useState<File[]>([]);
  const [attached,setAttached] = useState<(UploadedMedia & { anchor: number })[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const updateDraft = (value: string) => {
    setDrafts(old => ({ ...old, [mode]: value }));
    if (mode !== "chat") setGuides(old => ({ ...old, [mode]: null }));
  };
  const inputDisabled = busy || hasRetry || uploading;
  function fillChat(value: string) { setMode("chat"); setDrafts(old => ({ ...old, chat: value })); inputRef.current?.focus(); }
  function startDiaryPrompt(day = today()) {
    if (drafts.chat.trim()) { setNotice("输入框里还有未发送的话，请先发送或清空，再整理日记。"); return; }
    fillChat(diaryPrompt(day));
    if (!allowed) setNotice("日记草稿已写入。请先勾选“允许发送文字，开始聊天”，再点击发送。");
  }
  function updateGuide(value: GenerationDraft | null) { if (mode !== "chat") setGuides(old => ({ ...old, [mode]: value })); }
  useEffect(() => {
    const node = streamRef.current;
    if (node) node.scrollTop = !messages.length && !turn && !guide && !albumOpen && !uploadFiles.length && !attached.length ? 0 : node.scrollHeight;
  }, [turn, busy, guide, mode, albumOpen, uploadFiles, attached]);
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
      if (localStorage.getItem(consentKey) === "true") setAllowed(true);
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
    setMenu(false); setAlbumOpen(false); setUploadFiles([]); setAttached([]); setPendingMedia({chat:[],image:[],video:[]}); setMediaAcknowledged(false); setSession(result.session_id); setMessages([]); setAfter(null); setTurn(null); setPreview(null); setDraft(null); setDrafts({ chat: "", image: "", video: "" }); setGuides({ image: null, video: null }); setMode("chat"); setNotice("已开始新的聊天。");
  }
  async function send(retry = false) {
    if (!sendOperation.current || !retry) sendOperation.current = { operation_id: crypto.randomUUID(), text, allow_external_text: true };
    if (!retry) setLastSubmittedText(text);
    setHasRetry(true); setPreview(null);
    if (!session && !sessionOperation.current) sessionOperation.current = crypto.randomUUID();
    const activeSession = session || (await companionApi.session(sessionOperation.current)).session_id;
    if (!session) { sessionOperation.current = ""; setSession(activeSession); localStorage.setItem(sessionKey, activeSession); }
    const result = await companionApi.chat(activeSession, sendOperation.current);
    localStorage.setItem(turnKey, result.turn_id);
    if (alive.current) { setDraft(null); setTurn(result); setPreview(result.result?.kind === "confirmation" ? result.result : null); setDrafts(old => ({ ...old, chat: "" })); sendOperation.current = null; setHasRetry(false);
      commitAttachments();
    }
    await history(activeSession);
  }
  async function memories(search: string, cursor = "") {
    const value = await companionApi.tool<MemoryPage>(search ? "memory.search" : "memory.list", { ...(search ? { query: search } : {}), cursor, limit: 20 });
    setPage(old => cursor ? { ...value, memories: [...(old?.memories ?? []), ...value.memories] } : value); setAppliedQuery(search);
  }
  function attach(media: UploadedMedia) {
    setPendingMedia(old => ({ ...old, [mode]: old[mode].some(item => item.id === media.id) ? old[mode] : [...old[mode], media] }));
    setMediaAcknowledged(false);
  }
  function commitAttachments() {
    const items = pendingMedia.chat;
    setAttached(old => [...old, ...items.map(item => ({ ...item, anchor: messages.length }))]);
    setPendingMedia(old => ({ ...old, chat: [] }));
    setMediaAcknowledged(false);
  }
  function renderAttached(anchor: number) {
    return attached.filter(item => item.anchor === anchor).map((item,index) => item.kind === "photo" ? <PhotoConversationCard key={`${item.id}-${index}`} photoId={item.id} label={item.name} /> : <VideoConversationCard key={`${item.id}-${index}`} id={item.id} name={item.name} />);
  }
  function submit() {
    if (inputDisabled || pending) return;
    if (mode === "chat") {
      if (text.trim()) {
        if (!allowed || (pendingMedia.chat.length && !mediaAcknowledged)) return;
        void run(() => send());
      } else if (pendingMedia.chat.length) {
        commitAttachments(); setNotice("素材已加入本页对话，未发送给助手。刷新后可从相册重新选择。");
      }
    } else {
      const items = pendingMedia[mode];
      if (!text.trim()) {setNotice("先描述想创作什么，再继续。");return;}
      if (items.length > 1 || items.some(item => item.kind !== "photo")) {setNotice("本次创作支持一张参考照片，请先移除多余素材或视频。");return;}
      updateGuide({ ...createGenerationDraft(mode, text.trim()), reference: items[0]?.id ?? null, step: items.length ? "parameters" : "reference" }); setNotice("");
    }
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
      <button disabled={inputDisabled || pending} onClick={() => void run(newSession)}>新建会话</button>
      <details open>
        <summary>聊天设置</summary>
        <p className={styles.note}>您本次及最近最多 20 条发言将发送至您配置的 UniArt / Qwen 服务。照片不会随文字自动发送。</p>
        <label className={styles.check}><input type="checkbox" checked={allowed} disabled={busy} onChange={event => {
          const value = event.target.checked; setAllowed(value); localStorage.setItem(consentKey, String(value));
        }} />允许发送文字，开始聊天</label>
      </details>
      <p className={styles.note}>聊天内容会保留，可继续查看历史消息。</p>
    </aside>}
    <div ref={streamRef} className={chatStyles.stream} role="region" aria-label="聊天内容">
    <div hidden={mode !== "chat"}><TodayPlanCards disabled={inputDisabled || pending} onPhotos={() => setAlbumOpen(true)} onDiary={() => {
      if (!drafts.chat.trim()) startDiaryPrompt();
      else { setNotice("输入框里还有未发送的话，先聊完这段，再一起记录今天。"); inputRef.current?.focus(); }
    }} /></div>
    <article className={chatStyles.assistant}><span>陪伴助手</span><p>您好，我在。想聊聊今天，还是一起看看照片？</p></article>
    {mode === "chat" && !messages.length && <section className={styles.guide} aria-labelledby="chat-guide-title">
      <h2 id="chat-guide-title">想从哪里聊起？</h2>
      <div className={styles.guideGrid}>
        <button type="button" className={styles.guideCard} disabled={busy || pending || hasRetry} onClick={() => { fillChat("聊聊今天发生的事情"); }}>
          <strong>聊聊今天</strong><span>说说今天的生活</span>
        </button>
        <button type="button" className={styles.guideCard} disabled={busy || pending || hasRetry} onClick={() => { setAlbumOpen(true); }}>
          <strong>讲讲一张照片</strong><span>在这里看看照片</span>
        </button>
        <button type="button" className={styles.guideCard} disabled={busy || pending || hasRetry} onClick={()=>startDiaryPrompt()}>
          <strong>整理今天的回忆</strong><span>把故事记下来</span>
        </button>
      </div>
    </section>}
    <section aria-label="会话消息">
      {renderAttached(0)}
      {messages.map((message,index) => <Fragment key={message.id}><div>
        <article className={chatStyles.user}><span>{diaryDay(message.text) ? `我 · ${formatDiaryDay(diaryDay(message.text)!)}` : "我"}</span><p>{message.text}</p></article>
        {message.turn?.result?.kind === "text" && (diaryDay(message.text) ? <DiaryCard day={diaryDay(message.text)!} text={message.turn.result.text} sourceTurn={message.turn.turn_id}
          context={messages.slice(Math.max(0, index - 7), index).flatMap(item => {
            const items: DiaryContextItem[] = [{ id: item.id, role: "user", text: item.text }];
            if (item.turn?.result?.kind === "text") items.push({ id: `${item.id}-reply`, role: "assistant", text: item.turn.result.text });
            return items;
          })}
          media={attached.filter(item => item.anchor === index + 1).map(item => ({ id: item.id, kind: item.kind, name: item.name })) as DiaryContextMedia[]}
        /> : <article className={chatStyles.assistant}><span>陪伴助手</span><p>{message.turn.result.text}</p></article>)}
        {message.turn?.result?.kind === "upload_guide" && <UploadGuideCard onUpload={() => fileRef.current?.click()} onAlbum={() => setAlbumOpen(true)} />}
      </div>{renderAttached(index+1)}</Fragment>
      )}
      {after !== null && <button disabled={busy} onClick={() => void run(() => history(session, after))}>更多历史消息</button>}
    </section>
    {turn?.result?.kind === "text" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && (diaryDay(lastSubmittedText) ? <DiaryCard day={diaryDay(lastSubmittedText)!} text={turn.result.text} sourceTurn={turn.turn_id} /> : <article className={chatStyles.assistant}><span>陪伴助手</span><p>{turn.result.text}</p></article>)}
    {turn?.result?.kind === "upload_guide" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <UploadGuideCard onUpload={() => fileRef.current?.click()} onAlbum={() => setAlbumOpen(true)} />}
    {uploadFiles.length > 0 && <MediaUpload files={uploadFiles} disabled={inputDisabled || pending} onUploaded={attach} onBusyChange={setUploading} onClose={() => setUploadFiles([])} />}
    {albumOpen && <AlbumPicker disabled={inputDisabled || pending} onClose={() => setAlbumOpen(false)} onPhoto={photo => {
      attach({kind:"photo",id:photo.photo_id,name:"相册照片"});setAlbumOpen(false);
    }} onVideo={video => {attach({kind:"video",id:video.video_id,name:video.name});setAlbumOpen(false);}} />}
    {feature === "diary" ? <DiaryCalendar onClose={()=>setFeature(null)} onCreate={day=>{setFeature(null);startDiaryPrompt(day);}}/> : feature && <CompanionFeatureSheet feature={feature} onClose={() => setFeature(null)} />}
    {mode !== "chat" && (guide ? <GenerationGuide key={mode} value={guide} disabled={inputDisabled || pending} onChange={updateGuide} onEdit={() => { updateGuide(null); inputRef.current?.focus(); }} onCancel={() => { updateGuide(null); setNotice("已取消创作，描述草稿仍保留。"); }} /> : <article className={chatStyles.assistant}><span>陪伴助手</span><p>{mode === "video" ? "想做一段什么视频？" : "想生成一张什么图片？"}在下面说说，点箭头后我们一步步来。</p></article>)}
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
    <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mov" multiple aria-label="选择要上传的照片或视频" onChange={event => {
      const files=Array.from(event.target.files ?? []);event.target.value="";
      if(files.length>20){setNotice("每次最多选择 20 个文件，请重新选择。");return;}
      if(files.length){setUploadFiles(files);setNotice("");}
    }} />
    <CompanionComposer mode={mode} value={text} disabled={inputDisabled || pending} busy={busy} allowed={allowed} inputRef={inputRef}
      attachments={<AttachmentDraft items={pendingMedia[mode]} disabled={inputDisabled || pending} onRemove={id => {setPendingMedia(old => ({...old,[mode]:old[mode].filter(item=>item.id!==id)}));setMediaAcknowledged(false);}} />}
      hasAttachments={pendingMedia[mode].length > 0} mediaAcknowledged={mediaAcknowledged} onMediaAcknowledged={setMediaAcknowledged}
      onMode={next => {setMode(next);setAlbumOpen(false);setMediaAcknowledged(false);}} onChange={updateDraft} onSend={submit} onAllow={setAllowed}
      onUpload={() => { if (uploadFiles.length) setNotice("请先完成或关闭当前上传。"); else fileRef.current?.click(); }}
      onRequestConsent={() => { setMenu(true); setNotice("请在“更多 → 聊天设置”中允许发送文字。"); }}
      retry={hasRetry ? () => void run(() => send(true)) : null} />
    <nav className={chatStyles.bottomNav} aria-label="主要功能">
      <button type="button" aria-current={feature === "diary" ? "page" : undefined} onClick={() => setFeature("diary")}><BookOpen size={22} aria-hidden="true" /><span>日记</span></button>
      <button type="button" aria-current={feature === "plaza" ? "page" : undefined} onClick={() => setFeature("plaza")}><Compass size={22} aria-hidden="true" /><span>广场</span></button>
      <button type="button" aria-current={albumOpen ? "page" : undefined} onClick={() => { setFeature(null); setAlbumOpen(true); }}><Images size={22} aria-hidden="true" /><span>相册</span></button>
      <button type="button" aria-current={feature === "mine" ? "page" : undefined} onClick={() => setFeature("mine")}><UserRound size={22} aria-hidden="true" /><span>我的</span></button>
    </nav>
  </main>;
}
