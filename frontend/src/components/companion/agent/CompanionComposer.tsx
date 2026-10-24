"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, ChevronDown, Image, MessageCircle, Mic, Plus, Square, Video } from "lucide-react";
import { useCompanionVoice } from "../useCompanionVoice";
import styles from "./chat.module.css";

export type ComposerMode = "chat" | "image" | "video";
const modes = [
  { value: "chat", label: "聊天", icon: MessageCircle },
  { value: "image", label: "图片", icon: Image },
  { value: "video", label: "视频", icon: Video },
] as const;

export default function CompanionComposer({ mode, value, disabled, busy, allowed, inputRef, onMode, onChange, onSend, onUpload, onAllow, retry, attachments, hasAttachments = false, mediaAcknowledged = false, onMediaAcknowledged }: {
  mode: ComposerMode; value: string; disabled: boolean; busy: boolean; allowed: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  onMode: (mode: ComposerMode) => void; onChange: (text: string) => void;
  onSend: () => void; onUpload: () => void; onAllow: (allowed: boolean) => void;
  retry: (() => void) | null;
  attachments?: ReactNode; hasAttachments?: boolean;
  mediaAcknowledged?: boolean; onMediaAcknowledged?: (value: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const consentRef = useRef<HTMLDetailsElement>(null);
  const [consentRequested, setConsentRequested] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false), [voicePrompt, setVoicePrompt] = useState(false);
  const picker = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const voice = useCompanionVoice(text => onChange(`${value}${value ? " " : ""}${text}`.slice(0, 4000)));
  const recording = voice.listening || voice.finishing;
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
          <button type="button" className={styles.voiceButton} disabled={disabled || voice.finishing} onClick={() => { if (voiceConsent) voice.toggleListening(); else setVoicePrompt(true); }}>
            {recording ? <Square size={28} aria-hidden="true" /> : <Mic size={28} aria-hidden="true" />}<span>{voice.finishing ? "正在整理" : recording ? "停止" : "对话中"}</span>
          </button>
          <button type="button" className={styles.sendButton} aria-label="发送" disabled={disabled || recording || (!value.trim() && !hasAttachments) || (mode === "chat" && !!value.trim() && (hasAttachments && !mediaAcknowledged))} onClick={() => {
            if (mode === "chat" && value.trim() && !allowed) {
              setConsentRequested(true);
              if (consentRef.current) { consentRef.current.open = true; consentRef.current.scrollIntoView?.({block:"nearest"}); consentRef.current.querySelector<HTMLInputElement>("input")?.focus(); }
              return;
            }
            onSend();
          }}><ArrowUp size={30} aria-hidden="true" /></button>
        </div>
      </div>
    </div>
    {mode === "chat" && !allowed && <details ref={consentRef} className={styles.consent}><summary>开始聊天前，请确认文字发送范围</summary>
      <p>您本次及最近最多 20 条发言将发送至您配置的 UniArt / Qwen 服务。照片不会随文字自动发送。</p>
      <label className={styles.check}><input type="checkbox" checked={allowed} disabled={busy} onChange={event => onAllow(event.target.checked)} />允许发送文字，开始聊天</label>
    </details>}
    {consentRequested && !allowed && <p role="status">请先确认允许发送文字，再点箭头发送。</p>}
    {voicePrompt && <section className={styles.voiceConsent} aria-label="语音输入说明"><p>语音会交给浏览器的语音服务识别，文字先放入输入框，您检查后再发送。</p><button type="button" disabled={disabled} onClick={() => { setVoiceConsent(true); setVoicePrompt(false); voice.toggleListening(); }}>同意并开始听写</button><button type="button" onClick={() => setVoicePrompt(false)}>先用文字</button></section>}
    {recording ? <p role="status" className={styles.voiceStatus}>{voice.finishing ? "正在整理语音，请稍等…" : "正在听，点停止结束。"}</p> : voice.notice && <p role="status" className={styles.voiceStatus}>{voice.notice}</p>}
    {retry && <button disabled={busy || !allowed} onClick={retry}>重试原请求</button>}
  </footer>;
}
