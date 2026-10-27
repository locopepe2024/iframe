"use client";

import { Mic, Square, Volume2, X } from "lucide-react";
import type { CompanionIdentity } from "./CompanionIdentitySettings";
import { useRealtimeVoice } from "./useRealtimeVoice";
import styles from "./chat.module.css";

const voiceNames: Record<string, string> = {
  "longanhuan_v3.6": "温和女声",
  "longanyang_v3.6": "沉稳男声",
};

export default function DigitalCompanionPanel({ identity, onClose }: { identity: CompanionIdentity; onClose: () => void }) {
  const voice = useRealtimeVoice();
  const label = voice.state === "listening" ? "我在听" : voice.state === "thinking" ? "正在想" : voice.state === "speaking" ? "正在说话" : "准备好了";
  return <div className={styles.sheetBackdrop} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={styles.digitalCompanionSheet} role="dialog" aria-modal="true" aria-labelledby="digital-companion-title">
      <header className={styles.digitalCompanionHeader}>
        <div className={styles.digitalCompanionIdentity}>
          <div className={styles.digitalCompanionAvatar} aria-hidden="true">{identity.avatar}</div>
          <div><h2 id="digital-companion-title">{identity.name}</h2><p>{label} · {voiceNames[identity.voice] || "已设置音色"}</p></div>
        </div>
        <button type="button" className={styles.albumIcon} aria-label="关闭语音聊天" onClick={() => { voice.stop(); onClose(); }}><X size={24} aria-hidden="true" /></button>
      </header>
      <div className={styles.digitalCompanionStage} aria-live="polite">
        <div className={`${styles.digitalCompanionOrb} ${voice.active ? styles.digitalCompanionOrbActive : ""}`} aria-hidden="true"><span>{identity.avatar}</span></div>
        <p className={styles.digitalCompanionStatus}>{voice.notice || (voice.active ? (voice.state === "speaking" ? "正在回答您" : voice.state === "thinking" ? "正在整理您的话" : "您可以继续说") : "点击下方按钮开始聊天")}</p>
      </div>
      {voice.lines.length > 0 && <div className={styles.digitalCompanionTranscript} aria-label="聊天信息流">
        {voice.lines.map(line => <p key={line.id} data-role={line.role}><strong>{line.role}</strong>{line.text}</p>)}
      </div>}
      <div className={styles.digitalCompanionActions}>
        {voice.active && <button type="button" className={styles.digitalCompanionSecondary} onClick={voice.interrupt}><Volume2 size={20} aria-hidden="true" />打断</button>}
        <button type="button" className={styles.digitalCompanionPrimary} onClick={voice.active ? () => voice.stop() : () => void voice.start()}>
          {voice.active ? <Square size={22} aria-hidden="true" /> : <Mic size={22} aria-hidden="true" />}
          {voice.active ? "结束聊天" : "开始说话"}
        </button>
      </div>
      <p className={styles.voiceStatus}>聊天记录会回到当前聊天流；相册和日记仍在底部功能栏中。</p>
    </section>
  </div>;
}
