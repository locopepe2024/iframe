"use client";

import { useRef, useState } from "react";
import { companionApi, type PhotoTask } from "@/lib/companionApi";
import PhotoImage from "../photos/PhotoImage";
import PhotoContent from "../photos/PhotoContent";
import PhotoStory from "../photos/PhotoStory";
import styles from "../photos/photos.module.css";

export default function PhotoTaskCard({ task }: { task: PhotoTask }) {
  const [current, setCurrent] = useState(task);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ operation_id: string; expected_revision: number; action: "select" | "close" | "cancel"; photo_id?: string } | null>(null);
  const lock = useRef(false);
  async function act(action: "select" | "close" | "cancel", photo_id?: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const body = pending.current ?? { operation_id: crypto.randomUUID(), expected_revision: current.revision, action, ...(photo_id ? { photo_id } : {}) };
    pending.current = body;
    try {
      setCurrent(await companionApi.photoTaskInput(current.task_id, body));
      pending.current = null;
    } catch { setError("操作暂未确认，请重试原操作。"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={styles.panel} aria-label="相册整理任务" aria-busy={busy}>
    <h3>一起整理照片</h3>
    {current.status === "cancelled" ? <p>已取消本次整理。</p> : current.status === "completed" ? <p>本次整理已结束。</p> : <>
      <p>{current.step === "select_photo" ? "先选一张照片。" : "可以核对画面，或讲讲照片背后的故事。"}</p>
      {!current.photos.length && <p>没有找到符合条件的照片，可以换个条件再找。</p>}
      {current.photos.map((photo, index) => <article key={photo.photo_id}>
        <PhotoImage id={photo.photo_id} large />
        <p>{photo.date.date?.value ?? "日期待核对"}</p>
        {current.step === "select_photo" ? <button disabled={busy || !!pending.current} onClick={() => void act("select", photo.photo_id)}>整理这张照片 {index + 1}</button> : <>
          <PhotoContent photoId={photo.photo_id} /><PhotoStory photoId={photo.photo_id} />
        </>}
      </article>)}
      <button disabled={busy || !!pending.current} onClick={() => void act("close")}>结束本次整理</button>
      <button disabled={busy || !!pending.current} onClick={() => void act("cancel")}>取消整理</button>
    </>}
    {error && <><p role="alert">{error}</p><button disabled={busy} onClick={() => { if (pending.current) void act(pending.current.action, pending.current.photo_id); }}>重试原操作</button></>}
  </section>;
}
