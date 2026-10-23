"use client";

import { useState } from "react";
import PhotoImage from "../photos/PhotoImage";
import VideoConversationCard, { VideoCover } from "./VideoConversationCard";
import type { UploadedMedia } from "./MediaUpload";
import styles from "./chat.module.css";

export default function AttachmentDraft({ items, disabled, onRemove }: {
  items: UploadedMedia[]; disabled: boolean; onRemove: (id: string) => void;
}) {
  const [opened,setOpened] = useState<string | null>(null);
  if (!items.length) return null;
  return <section aria-label="待发送附件" className={styles.attachmentDraft}>
    <h2>待发送素材</h2>
    <div className={styles.attachmentGrid}>{items.map(item => <article key={item.id} className={styles.attachmentItem}>
      <div className={styles.attachmentCover}>{item.kind === "photo" ? <PhotoImage id={item.id}/> : <VideoCover id={item.id}/>}</div>
      <p>{item.name}</p><span className={styles.muted}>已在相册 · 尚未发送</span>
      <div className={styles.choices}><button type="button" onClick={() => setOpened(opened === item.id ? null : item.id)} aria-expanded={opened === item.id}>预览{item.kind === "photo" ? "照片" : "视频"}</button><button type="button" disabled={disabled} aria-label={`移除附件：${item.name}`} onClick={() => {onRemove(item.id);if(opened===item.id)setOpened(null);}}>移除</button></div>
      {opened === item.id && (item.kind === "photo" ? <PhotoImage id={item.id} large/> : <VideoConversationCard id={item.id} name={item.name}/>)}
    </article>)}</div>
    <p className={styles.muted}>移除只取消本次选择，相册里的原文件仍保留。</p>
  </section>;
}
