"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, ChevronDown, Image, MessageCircle, Mic, Plus, Square, Video } from "lucide-react";
import { useCompanionVoice } from "../useCompanionVoice";
import styles from "./chat.module.css";
import { useRealtimeVoice } from "./useRealtimeVoice";

export type ComposerMode = "chat" | "image" | "video";
const modes = [
  { value: "chat", label: "聊天", icon: MessageCircle },
  { value: "image", label: "图片", icon: Image },
  { value: "video", label: "视频", icon: Video },
] as const;

export default function CompanionComposer({ mode, value, disabled, busy, allowed, inputRef, onMode, onChange, onSend, onUpload, onAllow, onRequestConsent, retry, attachments, hasAttachments = false, mediaAcknowledged = false, onMediaAcknowledged }: {
  mode: ComposerMode; value: string; disabled: boolean; busy: boolean; allowed: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  onMode: (mode: ComposerMode) => void; onChange: (text: string) => void;
  onSend: () => void; onUpload: () => void; onAllow: (allowed: boolean) => void; onRequestConsent: () => void;
  retry: (() => void) | null;
  attachments?: ReactNode; hasAttachments?: boolean;
  mediaAcknowledged?: boolean; onMediaAcknowledged?: (value: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false), [voicePrompt, setVoicePrompt] = useState(false);
  const picker = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const voice = useCompanionVoice(text => onChange(`${value}${value ? " " : ""}${text}`.slice(0, 4000)));
  const realtime = useRealtimeVoice();
  const [realtimeConsent,setRealtimeConsent] = useState(false);
  const recording = voice.listening || voice.finishing || realtime.active;
  const selected = modes.find(item => item.value === mode)!;
  const ModeIcon = selected.icon;
  useEffect(() => {
    if (!menu) return;
    picker.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);
  return <footer className={styles.composer}>
    {realtime.lines.length > 0 && <section aria-label="本次语音聊天" className={styles.realtimeTranscript}>{realtime.lines.map(line => <p key={line.id}><strong>{line.role}：</strong>{line.text}</p>)}</section>}
    {realtime.active && <section aria-label="实时语音通话" className={styles.realtimeCall}>
      <p role="status">{realtime.state === "connecting" ? "正在连接语音…" : realtime.state === "thinking" ? "正在想，稍等一下…" : realtime.state === "speaking" ? "正在回答，您随时可以插话。" : "我在听，您可以说话了。"}</p>
      {realtime.state !== "connecting" && <button type="button" onClick={realtime.interrupt}>打断，让我说</button>}
      <button type="button" onClick={() => realtime.stop()}>结束语音</button>
    </section>}
    {attachments}
    {mode === "chat" && hasAttachments && <div className={styles.mediaScope}>
      <p>本次素材只在页面展示，助手暂时看不到。刷新后请从相册重新选择。</p>
      {value.trim() && <label className={styles.check}><input type="checkbox" disabled={disabled || recording} checked={mediaAcknowledged} onChange={event => onMediaAcknowledged?.(event.target.checked)}/>我知道本次只发送文字给助手</label>}
    </div>}
    <div className={styles.inputPanel}>
      <label><span className={styles.visuallyHidden}>{mode === "chat" ? "和我聊聊天" : mode === "image" ? "想生成的图片" : "想生成的视频"}</span>
        <textarea ref={inputRef} rows={2} placeholder={mode === "chat" ? "和我聊聊天…" : "说说想做什么，再点箭头继续…"} maxLength={4000} value={value} disabled={disabled || recording} onChange={event => onChange(event.target.value)} />
      </label>
      <div className={styles.toolbar}>
        <div ref={picker} className={styles.modePicker} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); setMenu(false); trigger.current?.focus(); }
          if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const buttons = Array.from(picker.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }
        }}>
          <button ref={trigger} type="button" aria-label={`创作类型：${selected.label}`} aria-haspopup="menu" aria-expanded={menu} disabled={disabled || recording} onClick={() => setMenu(!menu)}><ModeIcon size={22} aria-hidden="true" /><span>{selected.label}</span><ChevronDown size={18} aria-hidden="true" /></button>
          {menu && <div role="menu" aria-label="选择创作类型" className={styles.modeMenu} style={{ left: Math.max(8, trigger.current?.getBoundingClientRect().left ?? 8), bottom: Math.max(8, Math.min(window.innerHeight * .45, window.innerHeight - (trigger.current?.getBoundingClientRect().top ?? 0) + 8)) }}>{modes.map(({ value: next, label, icon: Icon }) => <button type="button" role="menuitemradio" aria-checked={mode === next} key={next} onClick={() => { voice.stopAll(); onMode(next); setMenu(false); trigger.current?.focus(); }}><Icon size={22} aria-hidden="true" />{label}</button>)}</div>}
        </div>
        <button type="button" className={styles.albumButton} aria-label="上传" disabled={disabled || recording} onClick={onUpload}><Plus size={24} aria-hidden="true" /><span>上传</span></button>
        <div className={styles.composerActions}>
          <button type="button" className={styles.voiceButton} disabled={!realtime.active && (disabled || voice.finishing)} onClick={() => {
            if (realtime.active) { realtime.stop(); return; }
            if (mode === "chat") { if (realtimeConsent) void realtime.start(); else setVoicePrompt(true); }
            else if (voiceConsent) voice.toggleListening(); else setVoicePrompt(true);
          }}>
            {recording ? <Square size={28} aria-hidden="true" /> : <Mic size={28} aria-hidden="true" />}<span>{voice.finishing ? "正在整理" : realtime.active ? "结束语音" : recording ? "停止" : "对话中"}</span>
          </button>
          <button type="button" className={styles.sendButton} aria-label="发送" disabled={disabled || recording || (!value.trim() && !hasAttachments) || (mode === "chat" && !!value.trim() && (hasAttachments && !mediaAcknowledged))} onClick={() => {
            if (mode === "chat" && value.trim() && !allowed) { onRequestConsent(); return; }
            onSend();
          }}><ArrowUp size={30} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
    {voicePrompt && <section className={styles.voiceConsent} aria-label="语音输入说明">{mode === "chat" ? <>
      <p>开始后，语音会发送至您的 UniArt / Qwen 服务并播放回复，可能计费。点“结束语音”即可关闭麦克风。</p>
      <p>本次语音暂不写入聊天历史或日记；保存等操作请回到文字聊天确认。</p>
      <button type="button" disabled={disabled} onClick={() => { setRealtimeConsent(true); setVoicePrompt(false); void realtime.start(); }}>同意并开始语音聊天</button>
    </> : <><p>语音会交给浏览器的语音服务识别，文字先放入输入框，您检查后再发送。</p><button type="button" disabled={disabled} onClick={() => { setVoiceConsent(true); setVoicePrompt(false); voice.toggleListening(); }}>同意并开始听写</button></>}
      <button type="button" onClick={() => setVoicePrompt(false)}>先用文字</button></section>}
    {!realtime.active && realtime.notice && <p role="status" className={styles.voiceStatus}>{realtime.notice}</p>}
    {voice.listening || voice.finishing ? <p role="status" className={styles.voiceStatus}>{voice.finishing ? "正在整理语音，请稍等…" : "正在听，点停止结束。"}</p> : voice.notice && <p role="status" className={styles.voiceStatus}>{voice.notice}</p>}
    {retry && <button disabled={busy || !allowed} onClick={retry}>重试原请求</button>}
  </footer>;
}
