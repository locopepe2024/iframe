"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type BatchUndoPreview, type BatchUndoReceipt, type PhotoDateAnnotation } from "@/lib/photoApi";
import PhotoImage from "./PhotoImage";
import styles from "./photos.module.css";

function dateLabel(date: PhotoDateAnnotation) {
  return date.date?.value ?? (date.reason === "not_processed" ? "尚未整理日期" : "日期待核对");
}

export default function BatchUndo({ batchId, disabled, onUndone }: {
  batchId: string; disabled: boolean; onUndone: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<BatchUndoPreview | null>(null);
  const [history, setHistory] = useState<BatchUndoReceipt[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), locked = useRef(false);
  const operation = useRef<{ operation_id: string; preview_token: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(action: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function loadHistory(after = 0) {
    const result = await photoApi.undoHistory(batchId, after);
    if (alive.current) { setHistory(old => after ? [...(old ?? []), ...result.changes] : result.changes); setNext(result.next_after); }
  }
  return <section aria-label="撤销批次时间整理" aria-busy={busy}>
    <h4>撤销已完成的时间整理</h4>
    <p>仅恢复本批当前自动整理的日期。您改过或恢复过的日期保留，原照片、照片故事和历史记录保留。</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <button disabled={disabled || busy} onClick={() => void run(async () => {
      const value = await photoApi.undoPreview(batchId);
      if (alive.current) { setPreview(value); operation.current = { operation_id: crypto.randomUUID(), preview_token: value.preview_token }; setNotice(""); }
    })}>{preview ? "重新预览撤销本批时间整理" : "预览撤销本批时间整理"}</button>
    {preview && <div role="region" aria-label="撤销时间整理确认" className={styles.confirm}>
      <p>将撤销 {preview.counts.undo} 张，保留 {preview.counts.preserve} 张。同时停止本批尚未完成的时间整理并撤回整理授权。</p>
      {preview.items.map((item, index) => <div key={item.photo_id} className={styles.history}><PhotoImage id={item.photo_id} /><p>
        第 {index + 1} 张：{item.action === "undo"
          ? `${dateLabel(item.current)} → ${dateLabel(item.target)}` : `${dateLabel(item.current)}，保留`}。
      </p></div>)}
      <button disabled={disabled || busy || preview.counts.undo === 0} onClick={() => void run(async () => {
        if (!operation.current) return;
        const result = await photoApi.undoBatch(batchId, operation.current);
        if (!alive.current) return;
        operation.current = null; setPreview(null); setHistory(null); setNext(null);
        setNotice(`已撤销 ${result.counts.undo} 张的时间整理，保留 ${result.counts.preserve} 张。请刷新相册查看日期。`);
        await onUndone();
      })}>确认撤销本批时间整理</button>
      <button disabled={disabled || busy} onClick={() => { setPreview(null); operation.current = null; setError(""); }}>取消撤销</button>
    </div>}
    <button disabled={disabled || busy} onClick={() => void run(() => loadHistory())}>查看撤销记录</button>
    {history && <div aria-label="批次撤销记录">
      {history.length === 0 && <p>本批还没有撤销记录。</p>}
      {history.map(item => <p key={item.operation_id} className={styles.history}>
        {new Date(item.created_at).toLocaleString("zh-CN")}：撤销 {item.counts.undo} 张，保留 {item.counts.preserve} 张。
      </p>)}
      {next !== null && <button disabled={disabled || busy} onClick={() => void run(() => loadHistory(next))}>加载更多撤销记录</button>}
    </div>}
  </section>;
}
