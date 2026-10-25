"use client";

import { X } from "lucide-react";
import styles from "./chat.module.css";

const openTalkingUrl = process.env.NEXT_PUBLIC_OPENTALKING_URL || "/opentalking-mock/";

export default function OpenTalkingPanel({ onClose }: { onClose: () => void }) {
  return <div className={styles.sheetBackdrop} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={styles.openTalkingSheet} role="dialog" aria-modal="true" aria-labelledby="opentalking-title">
      <header className={styles.openTalkingHeader}>
        <div>
          <h2 id="opentalking-title">语音聊天</h2>
          <p>可以说话，也可以随时停下来。</p>
        </div>
        <button type="button" className={styles.albumIcon} aria-label="关闭语音聊天" onClick={onClose}>
          <X size={24} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.openTalkingFrame}>
        <iframe title="OpenTalking 角色语音聊天" src={openTalkingUrl}
          allow="microphone; autoplay; camera" referrerPolicy="no-referrer" />
      </div>
      <p className={styles.voiceStatus}>返回后仍可继续文字聊天、查看相册和日记。</p>
    </section>
  </div>;
}
