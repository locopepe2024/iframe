"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { companionApi, type CreativeContext, type MediaDraft, type MemoryPage, type Preview, type Turn, type UserMessage } from "@/lib/companionApi";
import styles from "../photos/photos.module.css";
import chatStyles from "./chat.module.css";
import PhotoActionCard from "./PhotoActionCard";
import AlbumScopeCard from "./AlbumScopeCard";
import PhotoTaskCard from "./PhotoTaskCard";
import PhotoToolResult from "./PhotoToolResult";
import PhotoConversationCard from "../PhotoConversationCard";
import TodayPlanCards from "./TodayPlanCards";
import AttachmentDraft from "./AttachmentDraft";
import AlbumPicker from "./AlbumPicker";
import MediaUpload, { type UploadedMedia } from "./MediaUpload";
import VideoConversationCard from "./VideoConversationCard";
import CompanionComposer, { type ComposerMode, type VoiceControl } from "./CompanionComposer";
import GenerationGuide, { createGenerationDraft, isUnderspecifiedMediaRequest, type GenerationDraft, type MediaMode } from "./GenerationGuide";
import CompanionFeatureSheet, { type CompanionFeature } from "./CompanionFeatureSheet";
import MediaDraftCard from "./MediaDraftCard";
import DiaryCalendar from "./DiaryCalendar";
import DiaryCard, { diaryDay, diaryPrompt, formatDiaryDay, today, type DiaryContextItem, type DiaryContextMedia } from "./DiaryCard";
import UniArtSettings from "./UniArtSettings";
import CompanionIdentitySettings, { defaultCompanionIdentity, readCompanionIdentity, type CompanionIdentity } from "./CompanionIdentitySettings";
import SpeechPlayback from "./SpeechPlayback";
import { spokenTurnText } from "./spokenTurnText";
import OpenTalkingReply, { type SpokenReply } from "./OpenTalkingReply";
import UploadGuideCard from "./UploadGuideCard";
import { isOpenAlbumCommand } from "./localCommands";
import { BookOpen, Images, UserRound, Compass, Mic } from "lucide-react";
import { companionPlayback } from "@/lib/companionPlaybackQueue";
import { detectCompanionRuntimeCapability, type CompanionRuntimeCapability } from "./companionRuntimeCapability";

import { InteractionFocusContext, createInteractionFocus, createFocusSync, type InteractionFocus } from "./InteractionFocus";

const prefix = process.env.NEXT_PUBLIC_API_URL === "/companion-demo" ? "/companion-demo" : "";
const sessionKey = "iframe-companion-agent-session-v1";
const turnKey = "iframe-companion-agent-turn-v1";
const consentKey = "iframe-companion-agent-text-consent-v1";
const responseModeKey = "iframe-companion-agent-response-mode-v1";
type ResponseMode = "audio" | "text";
const dismissedUploadGuideKey = "iframe-companion-agent-dismissed-upload-guides-v1";

export default function AgentChat() {
  const focus = useRef(createInteractionFocus()).current;
  const syncFocus = useRef(createFocusSync()).current;
  const sendFocus = useRef<{operation:string;focus:InteractionFocus;ready:boolean} | null>(null);
  const [session, setSession] = useState("");
  const [menu, setMenu] = useState(false);
  const [voiceControl,setVoiceControl] = useState<VoiceControl>();
  const [voiceActive,setVoiceActive] = useState(false);
  const [voiceChat,setVoiceChat] = useState(false);
  const speechEpoch = useRef(0);
  const speechEnabled = useRef(false);
  const captureChanged = useCallback((active:boolean)=>{setVoiceActive(active);if(!active){speechEpoch.current++;setVoiceChat(false);}},[]);
  const [messages, setMessages] = useState<UserMessage[]>([]), [after, setAfter] = useState<number | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [voiceConnectionEpoch, setVoiceConnectionEpoch] = useState(0);
  const [captureStatus, setCaptureStatus] = useState("");
  const [voiceOutputStatus, setVoiceOutputStatus] = useState("");
  const [spokenReply, setSpokenReply] = useState<SpokenReply | null>(null);
  const [responseMode, setResponseMode] = useState<ResponseMode>("text");
  const audioReply = responseMode === "audio" || voiceChat;
  speechEnabled.current = audioReply;
  const [identity, setIdentity] = useState<CompanionIdentity>(defaultCompanionIdentity);
  const [creativeTask,setCreativeTask] = useState<MediaDraft | null>(null);
  const [mode, setMode] = useState<ComposerMode>("chat");
  const [drafts, setDrafts] = useState<Record<ComposerMode, string>>({ chat: "", image: "", video: "" });
  const [guides, setGuides] = useState<Record<MediaMode, GenerationDraft | null>>({ image: null, video: null });
  const text = drafts[mode];
  const guide = mode === "chat" ? null : guides[mode];
  const [turn, setTurn] = useState<Turn | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [lastSubmittedText, setLastSubmittedText] = useState("");
  const [page, setPage] = useState<MemoryPage | null>(null), [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [runtimeCapability, setRuntimeCapability] = useState<CompanionRuntimeCapability>({ status: "checking", reason: "正在检查设备能力…", memoryGb: null });
  const locked = useRef(false), alive = useRef(true);
  const voiceQueue = useRef<{text:string;focus:InteractionFocus;creative:CreativeContext}[]>([]);
  const [voiceRevision, setVoiceRevision] = useState(0);
  const sessionOperation = useRef("");
  const sendOperation = useRef<{ operation_id: string; text: string; allow_external_text: true; selected_photo_id?: string;creative_context?:CreativeContext } | null>(null);
  const confirmOperation = useRef<{ token: string; id: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [hasRetry, setHasRetry] = useState(false);
  const [albumOpen,setAlbumOpen] = useState(false);
  const [diaryMonth, setDiaryMonth] = useState<string | undefined>();
  const [diarySelection, setDiarySelection] = useState<{day:string;request:string} | undefined>();
  const [feature,setFeature] = useState<CompanionFeature | null>(null);
  const [dismissedUploadGuides, setDismissedUploadGuides] = useState<string[]>([]);
  const [uploading,setUploading] = useState(false);
  const [pendingMedia,setPendingMedia] = useState<Record<ComposerMode,UploadedMedia[]>>({chat:[],image:[],video:[]});
  const [mediaAcknowledged,setMediaAcknowledged] = useState(false);
  const [uploadFiles,setUploadFiles] = useState<File[]>([]);
  const [attached,setAttached] = useState<(UploadedMedia & { anchor: number })[]>([]);
  const [selectedPhotoId,setSelectedPhotoId] = useState<string | null>(null);
  const selectedPhotoRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const creativeUpload = useRef<{task_id:string;revision:number;card_id:string}|null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const updateDraft = (value: string) => {
    setDrafts(old => ({ ...old, [mode]: value }));
    if (mode !== "chat") setGuides(old => ({ ...old, [mode]: null }));
  };
  const inputDisabled = busy || hasRetry || uploading;
  function fillChat(value: string) { setMode("chat"); setDrafts(old => ({ ...old, chat: value })); inputRef.current?.focus(); }
  function saveChatSettings() {
    localStorage.setItem(consentKey, String(allowed));
    localStorage.setItem(responseModeKey, responseMode);
    setSettingsSaved(true);
  }
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
  useEffect(() => {
    if (!allowed || locked.current || hasRetry || uploading || preview?.status === "pending_confirmation" || !voiceQueue.current.length) return;
    if ((preview ?? (turn?.result?.kind === "confirmation" ? turn.result : null))?.status === "pending_confirmation") return;
    const next = voiceQueue.current.shift()!;
    void run(() => send(false, next.text, undefined, next.focus, next.creative));
    // Use the current render's session and settings after each completed operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRevision, busy, hasRetry, uploading, preview, turn, allowed]);
  useEffect(() => { void detectCompanionRuntimeCapability().then(setRuntimeCapability); }, []);
  async function history(id: string, cursor?: number) {
    const result = await companionApi.messages(id, cursor);
    if (alive.current) { setMessages(old => cursor !== undefined ? [...result.messages, ...old] : result.messages); setAfter(result.next_before ?? null); }
  }
  useEffect(() => {
    setIdentity(readCompanionIdentity());
    alive.current = true;
    void run(async () => {
      if (localStorage.getItem(consentKey) === "true") setAllowed(true);
      const savedResponseMode = localStorage.getItem(responseModeKey);
      if (savedResponseMode === "audio" || savedResponseMode === "text") setResponseMode(savedResponseMode);
      const id = localStorage.getItem(sessionKey);
      if (id) {
        await history(id);
        const creative = await companionApi.mediaDrafts(id);
        if (alive.current) {setSession(id);setCreativeTask(creative.tasks.find(task=>task.status==="active") ?? creative.tasks.find(task=>task.status==="paused") ?? null);}
      }
      const savedTurn = localStorage.getItem(turnKey);
      if (id && savedTurn) { const result = await companionApi.turn(savedTurn); if (alive.current) setTurn(result); }
    });
    return () => { alive.current = false; voiceQueue.current = []; };
    // The browser stores identifiers only; the server checks current ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(dismissedUploadGuideKey) || "[]");
      if (Array.isArray(saved)) setDismissedUploadGuides(saved.filter(item => typeof item === "string"));
    } catch { /* ignore malformed browser state */ }
  }, []);
  async function newSession() {
    speechEpoch.current++;
    voiceQueue.current = [];
    setVoiceChat(false);setVoiceControl(old=>({id:(old?.id ?? 0)+1,action:"cancel"}));
    companionPlayback.cancel();setSpokenReply(null);
    if (!sessionOperation.current) sessionOperation.current = crypto.randomUUID();
    const result = await companionApi.session(sessionOperation.current);
    localStorage.setItem(sessionKey, result.session_id); localStorage.removeItem(turnKey);
    sessionOperation.current = ""; sendOperation.current = null; setHasRetry(false);
    setCreativeTask(null);
    selectedPhotoRef.current = null; setSelectedPhotoId(null);
    setMenu(false); setAlbumOpen(false); setUploadFiles([]); setAttached([]); setPendingMedia({chat:[],image:[],video:[]}); setMediaAcknowledged(false); setSession(result.session_id); setMessages([]); setAfter(null); setTurn(null); setPreview(null); setDraft(null); setDrafts({ chat: "", image: "", video: "" }); setGuides({ image: null, video: null }); setMode("chat"); setNotice("已开始新的聊天。");
  }
  async function send(retry = false, voiceText?: string, selectedPhotoArg?: string, capturedFocus?:InteractionFocus, capturedCreative?:CreativeContext) {
    const requestSpeechEpoch = speechEpoch.current;
    const requestedText = voiceText ?? text;
    const turnFocus = capturedFocus ?? focus.current();
    const editing = turnFocus.kind !== "chat";
    const requestedDay = editing ? undefined : diaryDay(requestedText, "", today());
    const submittedText = requestedDay ? diaryPrompt(requestedDay) : requestedText;
    const resolvedSelectedPhotoId = selectedPhotoArg || (/^(使用|用)(这张|该)照片/.test(requestedText.trim()) ? selectedPhotoRef.current : null);
    if (!sendOperation.current || !retry) sendOperation.current = { operation_id: crypto.randomUUID(), text: submittedText, allow_external_text: true, ...(resolvedSelectedPhotoId ? {selected_photo_id: resolvedSelectedPhotoId} : {}), ...(capturedCreative ? {creative_context:capturedCreative} : creativeTask?.status === "active" ? {creative_context:{task_id:creativeTask.task_id,revision:creativeTask.revision}} : {}) };
    if (!sendFocus.current || sendFocus.current.operation !== sendOperation.current.operation_id)
      sendFocus.current = {operation:sendOperation.current.operation_id,focus:{...turnFocus},ready:false};
    if (!retry) setLastSubmittedText(submittedText);
    setPreview(null);
    if (!session && !sessionOperation.current) sessionOperation.current = crypto.randomUUID();
    const activeSession = session || (await companionApi.session(sessionOperation.current)).session_id;
    if (!session) { sessionOperation.current = ""; setSession(activeSession); localStorage.setItem(sessionKey, activeSession); }
    let result: Turn;
    try {
      if (!sendFocus.current.ready) {
        await syncFocus(activeSession, sendFocus.current.operation, sendFocus.current.focus);
        sendFocus.current.ready = true;
      }
      result = await companionApi.chat(activeSession, sendOperation.current);
    } catch (failure) {
      if (alive.current) setHasRetry(true);
      // The server retains the user message even when tool validation fails.
      // A history failure must not replace the original request error.
      try { await history(activeSession); } catch { /* retain original failure */ }
      throw failure;
    }
    localStorage.setItem(turnKey, result.turn_id);
    if (alive.current) {
      if (audioReply && speechEnabled.current && requestSpeechEpoch === speechEpoch.current) {
        const replyText = spokenTurnText(result.result);
        if (replyText) setSpokenReply({ id: result.turn_id, text: replyText });
      }
      if (result.result?.kind === "diary_read") {
        const day = result.result.name === "diary.read" ? result.result.arguments?.day || result.result.diaries[0]?.day : undefined;
        setDiarySelection(day ? {day,request:result.turn_id} : undefined);
        setDiaryMonth(day?.slice(0,7) || result.result.month); setFeature("diary");
      }
      if (result.result?.kind === "media_draft") {setCreativeTask(result.result);}
      setDraft(null); setTurn(result); setPreview(result.result?.kind === "confirmation" ? result.result : null); setDrafts(old => ({ ...old, chat: "" })); sendOperation.current = null; setHasRetry(false);
      commitAttachments();
      if (resolvedSelectedPhotoId) { selectedPhotoRef.current = null; setSelectedPhotoId(null); }
    }
    try { await history(activeSession); }
    catch { if (alive.current) setNotice("回复已收到，历史消息暂未刷新，请稍后重新打开聊天。"); }
  }
  async function startCreative(type: MediaDraft["type"]) {
    if (focus.current().kind !== "chat") {setNotice("请先返回聊天，当前编辑草稿会保留。");return;}
    if (!sessionOperation.current) sessionOperation.current = crypto.randomUUID();
    const activeSession = session || (await companionApi.session(sessionOperation.current)).session_id;
    if (!session) {setSession(activeSession);localStorage.setItem(sessionKey,activeSession);sessionOperation.current="";}
    const task=await companionApi.startMediaDraft(activeSession,{operation_id:crypto.randomUUID(),type});
    setCreativeTask(task);setNotice("");
  }
  async function changeCreative(action:"clear_photo"|"select_photo"|"select_first_photo"|"select_last_photo"|"add_reference_photo"|"remove_reference_photo"|"video_mode"|"setting"|"pause"|"resume"|"cancel", photo_id?:string) {
    if (!creativeTask) return;
    const task=await companionApi.updateMediaDraft(session,{operation_id:crypto.randomUUID(),task_id:creativeTask.task_id,expected_revision:creativeTask.revision,action,...(photo_id?(action==="setting"?{setting:photo_id}:action==="video_mode"?{video_mode:photo_id as "t2v"|"i2v"|"f2v"|"r2v"}:{photo_id}):{})});
    setCreativeTask(task);
    // An explicit task action supersedes the failed sentence, not a silent retry.
    if (hasRetry) {sendOperation.current=null;setHasRetry(false);setNotice("已更新创作，先前失败的请求没有重新执行。");}
  }
  function organizeSelectedPhoto(id: string) {
    if (inputDisabled || pending) return;
    if (!allowed) { setMenu(true); setNotice("请先在聊天设置中允许发送文字。"); return; }
    if (drafts.chat.trim()) { setNotice("输入框里还有未发送的话，请先发送或清空，再整理照片。"); return; }
    void run(() => send(false, "整理这张照片", id));
  }
  function retryLastRequest() {
    if (!sendOperation.current) {
      setHasRetry(false);
      setError("原请求已失效，请重新输入后发送。");
      return;
    }
    if (!allowed) {
      setMenu(true);
      setNotice("请先在“更多 → 聊天设置”中允许发送文字，再重试原请求。");
      return;
    }
    if (/UniArt|渠道|API Key|API 密钥/.test(error)) {
      setMenu(true);
      setNotice("请先在“更多 → UniArt 渠道”中配置当前移动端身份，再重试原请求。");
      return;
    }
    void run(() => send(true));
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
  function dismissUploadGuide(turnId: string) {
    setDismissedUploadGuides(old => {
      const next = old.includes(turnId) ? old : [...old, turnId];
      localStorage.setItem(dismissedUploadGuideKey, JSON.stringify(next));
      return next;
    });
  }
  function uploadGuideActions(turnId: string) {
    return {
      onUpload: () => { dismissUploadGuide(turnId); fileRef.current?.click(); },
      onAlbum: () => { dismissUploadGuide(turnId); setAlbumOpen(true); },
      onDismiss: () => dismissUploadGuide(turnId),
    };
  }
  function renderAttached(anchor: number) {
    return attached.filter(item => item.anchor === anchor).map((item,index) => item.kind === "photo" ? <PhotoConversationCard key={`${item.id}-${index}`} photoId={item.id} label={item.name} selected={selectedPhotoId === item.id} onOrganize={() => organizeSelectedPhoto(item.id)} /> : <VideoConversationCard key={`${item.id}-${index}`} id={item.id} name={item.name} />);
  }
  function submit() {
    if (inputDisabled || pending) return;
    if (isOpenAlbumCommand(text) && creativeTask?.status !== "active") {
      setAlbumOpen(true);
      setDrafts(old => ({ ...old, [mode]: "" }));
      setNotice("");
      return;
    }
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
      if (isUnderspecifiedMediaRequest(text)) {
        setDrafts(old => ({ ...old, [mode]: "" }));
        updateGuide(null);
        setNotice(items.length || /优化|加工|修改|修饰|编辑|美化|修/.test(text)
          ? "想怎么修改这张照片？比如：调亮一点，或把背景换成公园。可以继续说，也可以打字。"
          : "想创作什么内容？比如：两只小狗在草地上奔跑。可以继续说，也可以打字。");
        inputRef.current?.focus();
        return;
      }
      if (items.length > 1 || items.some(item => item.kind !== "photo")) {setNotice("本次创作支持一张参考照片，请先移除多余素材或视频。");return;}
      updateGuide({ ...createGenerationDraft(mode, text.trim()), reference: items[0]?.id ?? null, step: items.length ? "parameters" : "reference" });
      setDrafts(old => ({ ...old, [mode]: "" })); setNotice("");
    }
  }
  const activePreview = preview ?? (turn?.result?.kind === "confirmation" ? turn.result : null);
  const pending = activePreview?.status === "pending_confirmation";
  async function closePreview() {
    if (!activePreview) return;
    await companionApi.cancel(activePreview.preview_token);
    setDraft(null); setPreview({ status: "preview_closed", preview_token: activePreview.preview_token }); setNotice("已关闭预览，未执行新的保存或删除。");
  }
  return <InteractionFocusContext.Provider value={focus}><main className={`${styles.shell} ${chatStyles.shell}`} data-agent-build="upload-preview-20261024-v3">
    <header className={chatStyles.header}><div className={chatStyles.assistantIdentity}><h1><span aria-hidden="true">{identity.avatar}</span> {identity.name}</h1><span role="status" className={chatStyles.assistantStatus}>{voiceOutputStatus || (busy ? "正在处理…" : hasRetry ? "请求未完成，请重试或操作创作卡片" : captureStatus || "在线")}</span></div><div className={chatStyles.headerActions}><button type="button" className={chatStyles.headerIcon} aria-label={voiceActive ? "停止语音聊天" : "打开语音聊天"} aria-pressed={voiceActive} disabled={(!voiceActive && (inputDisabled || pending))} onClick={() => {
      if (voiceActive) {speechEpoch.current++;setVoiceChat(false);companionPlayback.cancel();setVoiceControl(old=>({id:(old?.id ?? 0)+1,action:"stop"}));}
      else {
        if(!allowed){setMenu(true);setNotice("请先在聊天设置中允许发送文字，再开始语音聊天。");return;}
        setMode("chat");setSpokenReply(null);setVoiceChat(true);setVoiceControl(old=>({id:(old?.id ?? 0)+1,action:"start"}));}
    }}><Mic size={22} aria-hidden="true" /></button><button type="button" aria-expanded={menu} onClick={() => setMenu(!menu)}>更多</button></div></header>
    {menu && <aside className={`${styles.panel} ${chatStyles.settingsPanel}`} aria-label="聊天管理">
      <div className={chatStyles.settingsHeader}><h2>设置</h2><button type="button" aria-label="关闭设置" onClick={() => setMenu(false)}>×</button></div>
      <a href={`${prefix}/companion/photos`}>生活相册</a>
      <button disabled={inputDisabled || pending} onClick={() => void run(newSession)}>新建会话</button>
      <section aria-label="聊天设置">
        <h2>聊天设置</h2>
        <p className={styles.note}>您本次及最近最多 20 条发言将发送至您配置的 UniArt / Qwen 服务。照片不会随文字自动发送。</p>
        <label className={styles.check}><input type="checkbox" checked={allowed} onChange={event => {
          const value = event.target.checked; setAllowed(value); localStorage.setItem(consentKey, String(value));
        }} />允许发送文字，开始聊天</label>
        <fieldset className={styles.choice}><legend>小安回复方式</legend>
          <label className={styles.check}><input type="radio" name="companion-response-mode" value="audio" checked={responseMode === "audio"} onChange={() => { setResponseMode("audio"); localStorage.setItem(responseModeKey, "audio"); }} />方案 1：语音回复（可能计费）</label>
          <label className={styles.check}><input type="radio" name="companion-response-mode" value="text" checked={responseMode === "text"} onChange={() => { speechEpoch.current++;speechEnabled.current=false;companionPlayback.cancel();setSpokenReply(null);setVoiceChat(false);setResponseMode("text"); localStorage.setItem(responseModeKey, "text"); }} />方案 2：只回复文字</label>
        </fieldset>
        <p className={styles.note}>语音回复由 OpenTalking 播放，并保留文字记录；播放受阻时可点击“播放声音”。</p>
        <div className={chatStyles.settingsSaveRow}>
          <button type="button" className={chatStyles.settingsSaveButton} onClick={saveChatSettings}>保存设置</button>
          {settingsSaved && <span className={chatStyles.settingsSaved} role="status">✓ 设置已保存</span>}
        </div>
      </section>
      <CompanionIdentitySettings onChange={setIdentity} />
      <UniArtSettings />
      <section aria-label="端侧协调器状态">
        <h2>设备能力</h2>
        <p className={styles.note}>{runtimeCapability.status === "edge_ready" ? "设备支持 WebGPU。" : runtimeCapability.status === "checking" ? "正在检查设备…" : "任务由服务端处理。"} {runtimeCapability.reason}</p>
      </section>
      <p className={styles.note}>聊天内容会保留，可继续查看历史消息。</p>
    </aside>}
    <div ref={streamRef} className={chatStyles.stream} role="region" aria-label="聊天内容">
    <div hidden={mode !== "chat"}><TodayPlanCards disabled={inputDisabled || pending} onPhotos={() => setAlbumOpen(true)} onDiary={() => {
      if (!drafts.chat.trim()) startDiaryPrompt();
      else { setNotice("输入框里还有未发送的话，先聊完这段，再一起记录今天。"); inputRef.current?.focus(); }
    }} /></div>
    <article className={chatStyles.assistant}><p>您好，我在。想聊聊今天，还是一起看看照片？</p></article>
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
      {after !== null && <button disabled={busy} onClick={() => void run(() => history(session, after))}>更多历史消息</button>}
      {renderAttached(0)}
      {messages.map((message,index) => {
        const day = diaryDay(message.text, message.turn?.result?.kind === "text" ? message.turn.result.text : "");
        return <Fragment key={message.id}><div>
        <article className={chatStyles.user}><span>{diaryDay(message.text) ? `我 · ${formatDiaryDay(diaryDay(message.text)!)}` : "我"}</span><p>{message.text}</p></article>
        {message.turn?.result?.kind === "text" && (day ? <DiaryCard day={day} text={message.turn.result.text} sourceTurn={message.turn.turn_id} onOpenDiary={() => setFeature("diary")}
          context={messages.slice(Math.max(0, index - 7), index).flatMap(item => {
            const items: DiaryContextItem[] = [{ id: item.id, role: "user", text: item.text }];
            if (item.turn?.result?.kind === "text") items.push({ id: `${item.id}-reply`, role: "assistant", text: item.turn.result.text });
            return items;
          })}
          media={attached.filter(item => item.anchor === index + 1).map(item => ({ id: item.id, kind: item.kind, name: item.name })) as DiaryContextMedia[]}
        /> : <article className={chatStyles.assistant}><p>{message.turn.result.text}</p><SpeechPlayback text={message.turn.result.text} voice={identity.voice}/></article>)}
        {message.turn?.result?.kind === "diary_read" && <section className={styles.panel} aria-label="日记查询结果">
          <p>{message.turn.result.spoken_text}</p>
          {message.turn.result.name === "diary.read" && message.turn.result.diaries.map(entry => <DiaryCard key={`${entry.day}-${entry.revision}`} day={entry.day} text={entry.text} sourceTurn={entry.source_turn_id} saved={entry} onOpenDiary={() => setFeature("diary")} />)}
          <button type="button" onClick={() => {setDiaryMonth(message.turn?.result?.kind === "diary_read" ? message.turn.result.month : undefined);setFeature("diary");}}>打开日记月历</button>
        </section>}
        {message.turn?.result?.kind === "photo_action" && index === messages.length - 1 && <PhotoActionCard key={message.turn.turn_id} result={message.turn.result} />}
        {message.turn?.result?.kind === "album_guide" && index === messages.length - 1 && <AlbumScopeCard key={message.turn.turn_id} browse={message.turn.result.browse} disabled={inputDisabled || pending} onSelect={organizeSelectedPhoto} />}
        {message.turn?.result?.kind === "photo_task" && !messages.slice(index + 1).some(later => later.turn?.result?.kind === "photo_task" && later.turn.result.task_id === (message.turn?.result?.kind === "photo_task" ? message.turn.result.task_id : "")) && <PhotoTaskCard key={`${message.turn.turn_id}-${message.turn.result.revision}`} task={message.turn.result} />}
        {message.turn?.result?.kind === "photo_read" && <><article className={chatStyles.assistant}><p>我找到照片了，我们一起看看。需要整理哪一张，可以直接告诉我。</p></article><PhotoToolResult key={message.turn.turn_id} result={message.turn.result} onSelect={organizeSelectedPhoto} /></>}
        {message.turn?.result?.kind === "upload_guide" && !dismissedUploadGuides.includes(message.turn.turn_id) && <UploadGuideCard {...uploadGuideActions(message.turn.turn_id)} />}
      </div>{renderAttached(index+1)}</Fragment>;
      })}
    </section>
    {creativeTask && creativeTask.status !== "cancelled" && <MediaDraftCard key={creativeTask.task_id} task={creativeTask} onChooseSource={async event=>{let ok=false;await run(async()=>{const task=await companionApi.updateMediaDraft(session,{...event,task_id:creativeTask.task_id,expected_revision:creativeTask.revision,action:"choose_source"});setCreativeTask(task);ok=true;});return ok;}} onRefresh={()=>{void run(async()=>{const data=await companionApi.mediaDrafts(session);setCreativeTask(data.tasks.find(task=>task.task_id===creativeTask.task_id)??null);});}} disabled={busy || uploading || !!pending} onAction={async(action,photo)=>{let ok=false;await run(async()=>{await changeCreative(action,photo);ok=true;});return ok;}} onAssetSelected={async(photoId,slot,cardId)=>{let ok=false;await run(async()=>{if(!creativeTask) return;const result=await companionApi.mediaEvent(session,{operation_id:crypto.randomUUID(),event_type:"photo_selected",task_id:creativeTask.task_id,card_id:cardId,photo_id:photoId,slot,expected_revision:creativeTask.revision});setCreativeTask(result.task);ok=true;});return ok;}} onUpload={()=>{creativeUpload.current={task_id:creativeTask.task_id,revision:creativeTask.revision,card_id:creativeTask.ui_card?.card_id || ""};fileRef.current?.click();}}/>}
    {turn?.result?.kind === "text" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && (diaryDay(lastSubmittedText) ? <DiaryCard day={diaryDay(lastSubmittedText)!} text={turn.result.text} sourceTurn={turn.turn_id} onOpenDiary={() => setFeature("diary")} /> : <article className={chatStyles.assistant}><p>{turn.result.text}</p>{responseMode === "text" && <SpeechPlayback text={turn.result.text} voice={identity.voice}/>}</article>)}
    {turn?.result?.kind === "photo_action" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <PhotoActionCard key={turn.turn_id} result={turn.result} />}
    {turn?.result?.kind === "album_guide" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <AlbumScopeCard key={turn.turn_id} browse={turn.result.browse} disabled={inputDisabled || pending} onSelect={organizeSelectedPhoto} />}
    {turn?.result?.kind === "photo_read" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <PhotoToolResult key={turn.turn_id} result={turn.result} onSelect={organizeSelectedPhoto} />}
    {turn?.result?.kind === "photo_task" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <PhotoTaskCard key={`${turn.turn_id}-${turn.result.revision}`} task={turn.result} />}
    {turn?.result?.kind === "diary_read" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && <section className={styles.panel} aria-label="日记查询结果">
      <p>{turn.result.spoken_text}</p>
      {turn.result.name === "diary.read" && turn.result.diaries.map(entry => <DiaryCard key={`${entry.day}-${entry.revision}`} day={entry.day} text={entry.text} sourceTurn={entry.source_turn_id} saved={entry} onOpenDiary={() => setFeature("diary")} />)}
      <button type="button" onClick={() => {setDiaryMonth(turn.result?.kind === "diary_read" ? turn.result.month : undefined);setFeature("diary");}}>打开日记月历</button>
    </section>}
    {turn?.result?.kind === "upload_guide" && !messages.some(m => m.turn?.turn_id === turn.turn_id) && !dismissedUploadGuides.includes(turn.turn_id) && <UploadGuideCard {...uploadGuideActions(turn.turn_id)} />}
    {uploadFiles.length > 0 && <MediaUpload files={uploadFiles} disabled={inputDisabled || pending} onUploaded={item=>{
      const target=creativeUpload.current;
      if (!target) {attach(item);return;}
      if (item.kind !== "photo" || !target.card_id || target.task_id !== creativeTask?.task_id || target.revision !== creativeTask.revision || creativeTask.status!=="active") {setNotice("素材已保存到相册，当前创作已变化，请重新选择要用的照片。");return;}
      void run(async()=>{const result=await companionApi.mediaEvent(session,{operation_id:crypto.randomUUID(),event_type:"photo_uploaded",task_id:target.task_id,card_id:target.card_id,photo_id:item.id,slot:"source",expected_revision:target.revision});setCreativeTask(result.task);});
    }} onBusyChange={setUploading} onClose={() => {setUploadFiles([]);creativeUpload.current=null;}} />}
    {albumOpen && <AlbumPicker disabled={inputDisabled || pending} onClose={() => setAlbumOpen(false)} onPhoto={photo => {
      attach({kind:"photo",id:photo.photo_id,name:"相册照片"}); selectedPhotoRef.current = photo.photo_id; setSelectedPhotoId(photo.photo_id); setNotice("已选中这张照片。您可以说“使用这张照片”，或继续查看。"); setAlbumOpen(false);
    }} onVideo={video => {attach({kind:"video",id:video.video_id,name:video.name});setAlbumOpen(false);}} />}
    {feature === "diary" ? <DiaryCalendar initialMonth={diaryMonth} selection={diarySelection} onClose={()=>{setDiarySelection(undefined);setFeature(null);}} onCreate={day=>{setFeature(null);startDiaryPrompt(day);}}/> : feature && <CompanionFeatureSheet feature={feature} onClose={() => setFeature(null)} />}
    {mode !== "chat" && (guide ? <GenerationGuide key={mode} value={guide} disabled={inputDisabled || pending} onChange={updateGuide} onEdit={() => { updateDraft(guide.prompt); inputRef.current?.focus(); }} onCancel={() => { updateDraft(guide.prompt); setNotice("已取消创作，描述草稿仍保留。"); }} /> : <article className={chatStyles.assistant}><span>陪伴助手</span><p>{mode === "video" ? "想做一段什么视频？" : "想生成一张什么图片？"}在下面说说，点箭头后我们一步步来。</p></article>)}
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
    {audioReply && <OpenTalkingReply key={session} reply={spokenReply} voice={identity.voice} connectionEpoch={voiceConnectionEpoch} onStatus={setVoiceOutputStatus} />}
    <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mov" multiple aria-label="选择要上传的照片或视频" onChange={event => {
      const files=Array.from(event.target.files ?? []);event.target.value="";
      if(files.length>20){setNotice("每次最多选择 20 个文件，请重新选择。");return;}
      if(files.length){setUploadFiles(files);setNotice("");}
    }} />
    <CompanionComposer unified onCreative={type=>void run(()=>startCreative(type))} voiceControl={voiceControl} onCaptureActive={captureChanged} onVoiceCancel={()=>setVoiceChat(false)} onCaptureStatus={setCaptureStatus} onVoiceStart={() => setVoiceConnectionEpoch(value => value + 1)} mode={mode} value={text} disabled={inputDisabled || pending} busy={busy} allowed={allowed} inputRef={inputRef}
      attachments={<AttachmentDraft items={pendingMedia[mode]} disabled={inputDisabled || pending} onRemove={id => {setPendingMedia(old => ({...old,[mode]:old[mode].filter(item=>item.id!==id)}));setMediaAcknowledged(false);}} />}
      hasAttachments={pendingMedia[mode].length > 0} mediaAcknowledged={mediaAcknowledged} onMediaAcknowledged={setMediaAcknowledged}
      onMode={next => {setMode(next);setAlbumOpen(false);setMediaAcknowledged(false);}} onChange={updateDraft} onSend={submit} onVoiceFinal={voiceText => {
        if (!allowed) { setMenu(true); setNotice("请先在“更多 → 聊天设置”中允许发送文字。"); return; }
        voiceQueue.current.push({text:voiceText,focus:{...focus.current()},creative:creativeTask?.status === "active" ? {task_id:creativeTask.task_id,revision:creativeTask.revision} : {task_id:"",revision:0}});
        setVoiceRevision(value => value + 1);
      }} onAllow={setAllowed}
      onUpload={() => { if (uploadFiles.length) setNotice("请先完成或关闭当前上传。"); else {creativeUpload.current=null;fileRef.current?.click();} }}
      onRequestConsent={() => { setMenu(true); setNotice("请在“更多 → 聊天设置”中允许发送文字。"); }}
      retry={hasRetry ? retryLastRequest : null} />
    <nav className={chatStyles.bottomNav} aria-label="主要功能">
      <button type="button" aria-current={feature === "diary" ? "page" : undefined} onClick={() => {setDiarySelection(undefined);setDiaryMonth(undefined);setFeature("diary");}}><BookOpen size={22} aria-hidden="true" /><span>日记</span></button>
      <button type="button" aria-current={feature === "plaza" ? "page" : undefined} onClick={() => setFeature("plaza")}><Compass size={22} aria-hidden="true" /><span>广场</span></button>
      <button type="button" aria-current={albumOpen ? "page" : undefined} onClick={() => { setFeature(null); setAlbumOpen(true); }}><Images size={22} aria-hidden="true" /><span>相册</span></button>
      <button type="button" aria-current={feature === "mine" ? "page" : undefined} onClick={() => setFeature("mine")}><UserRound size={22} aria-hidden="true" /><span>我的</span></button>
    </nav>
  </main></InteractionFocusContext.Provider>;
}
