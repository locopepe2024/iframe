"use client";

import { useRef, useState } from "react";
import { photoApi } from "@/lib/photoApi";
import styles from "./chat.module.css";

type Props = { photoId: string };
type Review = { revision: number; description: string } | null;

export default function PhotoMetadataPrompt({ photoId }: Props) {
  const [mode, setMode] = useState<"prompt" | "edit" | "confirm" | "later" | "saved">("prompt");
  const [review, setReview] = useState<Review>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ description: string; expected_revision: number; operation_id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function start() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const current = await photoApi.description(photoId);
      setReview(current); setDraft(current?.description ?? ""); setMode("edit");
    } catch { setError("照片备注读取失败，请稍后再试。"); }
    finally { locked.current = false; setBusy(false); }
  }
  function preview() {
    const text = draft.trim();
    if (!text || text.length > 1600) { setError("请填写 1 到 1600 字的照片备注。"); return; }
    setError(""); setPending({ description: text, expected_revision: review?.revision ?? 0, operation_id: crypto.randomUUID() }); setMode("confirm");
  }
  async function save() {
    if (!pending || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const saved = await photoApi.confirmDescription(photoId, pending);
      setReview(saved); setPending(null); setDraft(""); setMode("saved");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "照片备注保存失败，请重试。"); }
    finally { locked.current = false; setBusy(false); }
  }
  if (mode === "saved") return <p role="status" className={styles.muted}>照片备注已保存，之后可以在相册里继续修改。</p>;
  if (mode === "later") return <div><p className={styles.muted}>好的，先不整理。照片已保存在相册里。</p><button type="button" disabled={busy} onClick={() => void start()}>现在整理备注</button></div>;
  return <section aria-label="照片结构化备注" className={styles.mediaScope}>
    {mode === "prompt" && <>
      <p><strong>要不要给这张照片加一句说明？</strong></p>
      <p className={styles.muted}>例如：这是 2026 年春天在公园拍的照片。以后搜索相册时更容易找到。</p>
      <button type="button" disabled={busy} onClick={() => void start()}>现在整理</button>
      <button type="button" disabled={busy} onClick={() => setMode("later")}>以后再说</button>
    </>}
    {mode === "edit" && <>
      <label htmlFor={`photo-note-${photoId}`}>照片备注</label>
      <textarea id={`photo-note-${photoId}`} rows={3} maxLength={1600} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
      <p className={styles.muted}>可以写时间、地点、人物或事情；只保存为相册资料，不会自动发送给聊天模型。</p>
      <button type="button" disabled={busy || !draft.trim()} onClick={preview}>核对备注</button>
      <button type="button" disabled={busy} onClick={() => setMode("later")}>以后再说</button>
    </>}
    {mode === "confirm" && pending && <div role="region" aria-label="照片备注保存确认">
      <p>请确认要保存这段备注：</p><p>{pending.description}</p>
      <button type="button" disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : "确认保存备注"}</button>
      <button type="button" disabled={busy} onClick={() => setMode("edit")}>返回修改</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
