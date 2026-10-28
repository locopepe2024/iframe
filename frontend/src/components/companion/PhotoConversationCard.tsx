"use client";

import { useState } from "react";
import PhotoImage from "./photos/PhotoImage";
import PhotoStory from "./photos/PhotoStory";
import styles from "./photos/photos.module.css";

export default function PhotoConversationCard({ photoId, label, onOrganize }: { photoId: string; label: string; onOrganize?: () => void }) {
  const [opened, setOpened] = useState(false);
  return <article className={styles.panel} aria-label={label}>
    <h3>{label}</h3>
    <PhotoImage id={photoId} large />
    {onOrganize && <button type="button" onClick={onOrganize}>整理这张照片</button>}
    {!opened && <button type="button" onClick={() => setOpened(true)}>看看这张照片的故事</button>}
    {opened && <PhotoStory key={photoId} photoId={photoId} />}
  </article>;
}
