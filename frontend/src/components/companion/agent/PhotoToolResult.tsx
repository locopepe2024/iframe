"use client";

import { useRef, useState } from "react";
import { companionApi, type PhotoRead } from "@/lib/companionApi";
import PhotoImage from "../photos/PhotoImage";
import PhotoContent from "../photos/PhotoContent";
import PhotoStory from "../photos/PhotoStory";
import styles from "../photos/photos.module.css";

export default function PhotoToolResult({ result }: { result: PhotoRead }) {
  const [photos, setPhotos] = useState(result.photos);
  const [cursor, setCursor] = useState(result.next_after_id);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function more() {
    if (!cursor || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const page = await companionApi.tool<Pick<PhotoRead, "photos" | "next_after_id">>("photo.album.list", { ...result.arguments, after_id: cursor });
      setPhotos(current => [...current, ...page.photos.filter(photo => !current.some(item => item.photo_id === photo.photo_id))]);
      setCursor(page.next_after_id);
    } catch { setError("照片暂时没有读出来，请再试一次。"); }
    finally { locked.current = false; setBusy(false); }
  }
  return <section className={styles.panel} aria-label="小安找到的照片">
    <h3>{result.name === "photo.item.read" ? "一起整理这张照片" : "找到这些照片"}</h3>
    {photos.length === 0 && <p>没有找到符合条件的照片。可以换个年份，或按已经写过的讲述和备注查找。</p>}
    {photos.map((photo, index) => <article key={photo.photo_id}>
      <PhotoImage id={photo.photo_id} large />
      <p>{photo.date.date?.value ?? "日期待核对"}{photo.date.date && photo.date.status !== "confirmed" ? "（尚未确认）" : ""}</p>
      {photo.description && <p>{photo.description.description}</p>}
      {photo.story && <p>{photo.story.text}</p>}
      {photo.analysis && <p>AI 观察，待核对：{photo.analysis.observation.visible_summary}</p>}
      <button type="button" aria-expanded={opened === photo.photo_id} onClick={() => setOpened(opened === photo.photo_id ? null : photo.photo_id)}>
        {opened === photo.photo_id ? "收起照片" : `整理照片 ${index + 1}`}
      </button>
      {opened === photo.photo_id && <div><PhotoContent key={`content-${photo.photo_id}`} photoId={photo.photo_id} /><PhotoStory key={`story-${photo.photo_id}`} photoId={photo.photo_id} /></div>}
    </article>)}
    {error && <p role="alert">{error}</p>}
    {cursor && <button type="button" disabled={busy} onClick={() => void more()}>{busy ? "正在找照片…" : "再看一些照片"}</button>}
  </section>;
}
