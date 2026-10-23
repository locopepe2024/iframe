"use client";

import PhotoImage from "./photos/PhotoImage";
import styles from "./companion.module.css";

export default function PhotoConversationCard({ photoId, label, onOpen }: { photoId: string; label: string; onOpen: () => void }) {
  return <article className={styles.conversationCard} aria-label={label}>
    <h3>{label}</h3>
    <PhotoImage id={photoId} large />
    <button type="button" onClick={onOpen}>去相册讲讲这张照片</button>
  </article>;
}
