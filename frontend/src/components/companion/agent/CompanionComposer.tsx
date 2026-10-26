"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, ChevronDown, Image, MessageCircle, Mic, Plus, Square, Video } from "lucide-react";
import { useCompanionVoice } from "../useCompanionVoice";
import { useContinuousCapture } from "./useContinuousCapture";
import { isOpenAlbumCommand } from "./localCommands";
import styles from "./chat.module.css";

export type ComposerMode = "chat" | "image" | "video";
const modes = [
  { value: "chat", label: "聊天", icon: MessageCircle },
  { value: "image", label: "图片", icon: Image },
  { value: "video", label: "视频", icon: Video },
] as const;

export default function CompanionComposer({ mode, value, disabled, busy, allowed, inputRef, onMode, onChange, onSend, onVoiceFinal, onUpload, onAllow, onRequestConsent, retry, attachments, hasAttachments = false, mediaAcknowledged = false, onMediaAcknowledged }: {
  mode: ComposerMode; value: string; disabled: boolean; busy: boolean; allowed: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  onMode: (mode: ComposerMode) => void; onChange: (text: string) => void;
  onSend: () => void; onVoiceFinal?: (text: string) => void; onUpload: () => void; onAllow: (allowed: boolean) => void; onRequestConsent: () => void;
  retry: (() => void) | null;
  attachments?: ReactNode; hasAttachments?: boolean;
  mediaAcknowledged?: boolean; onMediaAcknowledged?: (value: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false), [voicePrompt, setVoicePrompt] = useState(false);
  const picker = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [engine,setEngine] = useState<"browser"|"local">(process.env.NEXT_PUBLIC_API_URL === "/companion-demo" ? "local" : "browser");
  const capture=useContinuousCapture(text=>onVoiceFinal?.(text.slice(0,4000)));
  const browserVoice = useCompanionVoice(text => {
    if (mode === "chat" && onVoiceFinal) return;
    const next = `${value}${value ? " " : ""}${text}`.slice(0, 4000);
    onChange(next);
  }, { continuous: mode === "chat", onFinalTranscript: mode === "chat" ? text => {
    onVoiceFinal?.(text.slice(0, 4000));
  } : undefined });
  const localCapture=mode === "chat" && engine === "local";
  const voice=localCapture?capture:browserVoice;
  const recording = voice.listening || voice.finishing;
  const localCommand = isOpenAlbumCommand(value);
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
          <button type="button" className={styles.voiceButton} disabled={(!recording && (disabled || (localCapture && capture.failed))) || voice.finishing} onClick={() => {
            if (voiceConsent) voice.toggleListening(); else setVoicePrompt(true);
          }}>
            {recording ? <Square size={28} aria-hidden="true" /> : <Mic size={28} aria-hidden="true" />}<span>{voice.finishing ? "正在整理" : recording ? "停止" : "语音输入"}</span>
          </button>
          <button type="button" className={styles.sendButton} aria-label="发送" disabled={disabled || recording || (!value.trim() && !hasAttachments) || (!localCommand && mode === "chat" && !!value.trim() && (hasAttachments && !mediaAcknowledged))} onClick={() => {
            if (!localCommand && mode === "chat" && value.trim() && !allowed) { onRequestConsent(); return; }
            onSend();
          }}><ArrowUp size={30} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
    {localCapture && capture.playing && recording && <button type="button" onClick={capture.interrupt}>打断并说话</button>}
    {localCapture && capture.failed && <div><button type="button" onClick={capture.retry}>重试语音识别</button><button type="button" onClick={capture.stopAll}>结束并清空待识别语音</button></div>}
    {voicePrompt && <section className={styles.voiceConsent} aria-label="语音输入说明">
      {mode === "chat" && process.env.NEXT_PUBLIC_API_URL === "/companion-demo" && <label>识别方式<select aria-label="识别方式" value={engine} onChange={event=>setEngine(event.target.value as "local"|"browser")}><option value="local">持续收音（测试）</option><option value="browser">浏览器识别</option></select></label>}
      <p>{localCapture ? "持续采集麦克风，停顿后分段交给本站 SenseVoice 测试服务识别并加入聊天。播放回复时暂停识别，点击打断即可继续说；不会保存录音文件。" : mode === "chat" ? "语音会交给浏览器识别，并连续加入聊天。您可以随时点停止。" : "语音会交给浏览器的语音服务识别，文字先放入输入框，您检查后再发送。"}</p>
      <button type="button" disabled={disabled} onClick={() => { setVoiceConsent(true); setVoicePrompt(false); voice.toggleListening(); }}>{mode === "chat" ? "同意并开始聊天" : "同意并开始听写"}</button>
      <button type="button" onClick={() => setVoicePrompt(false)}>先用文字</button>
    </section>}
    {voice.notice && !recording && <p role="status" className={styles.voiceStatus}>{voice.notice}</p>}
    {voice.listening || voice.finishing ? <p role="status" className={styles.voiceStatus}>{voice.finishing ? "正在整理语音，请稍等…" : localCapture ? capture.playing ? "正在播放回复，点击打断后说话。" : voice.notice : "正在听，点停止结束。"}</p> : null}
    {retry && <button disabled={busy || !allowed} onClick={retry}>重试原请求</button>}
  </footer>;
}
