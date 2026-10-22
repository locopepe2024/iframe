"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type UploadBatch, type UploadManifestItem } from "@/lib/photoApi";
import styles from "./photos.module.css";

const errorText: Record<string, string> = {
  invalid_image: "不是有效的静态 JPEG、PNG 或 WebP 照片，可跳过此项，其他照片仍保留。",
  image_limit: "照片超出处理限制，可跳过此项，其他照片仍保留。",
  file_mismatch: "文件与原清单不同，请重新选择原文件。",
};

export default function BatchUpload({ onUploaded }: { onUploaded: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retries, setRetries] = useState<Record<string, File>>({});
  const batchKey = useRef("");
  const locked = useRef(false), alive = useRef(true);
  const selection = useRef<HTMLInputElement>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  useEffect(() => {
    alive.current = true;
    photoApi.uploadBatches().then(page => { if (alive.current) { setBatches(page.batches); setCursor(page.next_after_id); } })
      .catch(() => { if (alive.current) setError("上传批次读取失败，请点击查看上传批次重试。"); })
      .finally(() => { if (alive.current) setReady(true); });
    return () => { alive.current = false; };
  }, []);
  function update(batch: UploadBatch) {
    if (alive.current) setBatches(old => [batch, ...old.filter(item => item.batch_id !== batch.batch_id)]);
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function send(batch: string, item: string, file: File) {
    let failure: unknown;
    try { await photoApi.uploadBatchItem(batch, item, file); }
    catch (caught) { failure = caught; }
    // Even on a lost response, the server may have committed this photo.
    const current = await photoApi.uploadBatch(batch);
    update(current);
    if (failure && current.items.find(row => row.item_id === item)?.status !== "uploaded") {
      if (alive.current) setMessage("有照片尚未上传成功，其余照片会继续上传。可在下方单独重试。");
    }
  }
  async function start() {
    if (!files.length || files.length > 20 || files.some(file => !file.size || file.size > 10 * 1024 * 1024 || file.name.length > 255)) {
      throw new Error("每批请选择 1 到 20 张照片，每张不超过 10 MB，文件名不超过 255 字。");
    }
    const items: UploadManifestItem[] = [];
    for (let index = 0; index < files.length; index++) {
      items.push({ item_id: `item-${String(index + 1).padStart(3, "0")}`, filename: files[index].name,
        size: files[index].size, sha256: await photoApi.fingerprint(files[index]) });
    }
    if (!alive.current) return;
    const batch = await photoApi.createUploadBatch(batchKey.current, items);
    update(batch);
    for (let index = 0; index < items.length && alive.current; index++) {
      if (batch.items.find(row => row.item_id === items[index].item_id)?.status === "uploaded") continue;
      try { await send(batch.batch_id, items[index].item_id, files[index]); }
      catch { if (alive.current) setError("部分上传结果暂时无法读取，请查看上传批次核对。其余文件继续尝试。"); }
    }
    if (alive.current) {
      setFiles([]); if (selection.current) selection.current.value = "";
      setMessage("本轮上传已结束，请核对下方每张照片的结果。成功的照片可在相册查看，尚未自动整理。");
      onUploadedRef.current();
    }
  }
  return <section className={styles.panel} aria-label="批量上传照片" aria-busy={busy}>
    <h2>添一批照片</h2>
    <p>每批最多 20 张，每张最多 10 MB。逐张上传，失败不会删除已成功的照片。</p>
    <label htmlFor="photo-batch-files">选择多张照片</label>
    <input ref={selection} id="photo-batch-files" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || !ready} onChange={event => {
      setFiles(Array.from(event.target.files ?? [])); batchKey.current = crypto.randomUUID();
    }} />
    {files.length > 0 && <p>已选择 {files.length} 张照片。</p>}
    <button disabled={busy || !ready || !files.length} onClick={() => void run(start)}>{busy ? "正在处理上传…" : "上传这批照片"}</button>
    <p>上传期间请保持页面打开。刷新或离开后可查看已保存结果，未上传的照片需要重新选择原文件。上传不会自动授权或整理。</p>
    <button disabled={busy || !ready} onClick={() => void run(async () => {
      const page = await photoApi.uploadBatches();
      if (alive.current) { setBatches(page.batches); setCursor(page.next_after_id); }
    })}>查看上传批次</button>
    {busy && <p role="status">正在处理，请稍候。下方显示已确认的上传结果。</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {batches.map((batch, index) => <details key={batch.batch_id} open className={styles.history}>
      <summary>上传批次 {index + 1}：已上传 {batch.counts.uploaded} 张，失败 {batch.counts.failed} 张，待上传 {batch.counts.pending} 张</summary>
      <ul>{batch.items.map((item, itemIndex) => {
        const key = batch.batch_id + "/" + item.item_id;
        return <li key={item.item_id}>
          <p>{item.filename}：{item.status === "uploaded" ? "已上传，照片保留在相册中" : item.status === "failed" ? "上传失败" : "待上传"}</p>
          {item.error_code && <p>{errorText[item.error_code] ?? "上传未完成，请核对后重试。"}</p>}
          {item.status !== "uploaded" && <>
            <label htmlFor={`retry-${batch.batch_id}-${item.item_id}`}>重新选择第 {itemIndex + 1} 张原文件：{item.filename}</label>
            <input id={`retry-${batch.batch_id}-${item.item_id}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
              const file = event.target.files?.[0];
              setRetries(old => { const next = { ...old }; if (file) next[key] = file; else delete next[key]; return next; });
            }} />
            <button disabled={busy || !retries[key]} onClick={() => void run(async () => {
              const file = retries[key];
              if (file.size !== item.size || await photoApi.fingerprint(file) !== item.sha256) throw new Error("请选择这张照片的原文件；文件内容与批次清单不同。");
              await send(batch.batch_id, item.item_id, file);
              if (alive.current) onUploadedRef.current();
            })}>重试上传：{item.filename}</button>
          </>}
        </li>;
      })}</ul>
    </details>)}
    {cursor && <button disabled={busy} onClick={() => void run(async () => {
      const page = await photoApi.uploadBatches(cursor);
      if (alive.current) { setBatches(old => [...old, ...page.batches.filter(batch => !old.some(row => row.batch_id === batch.batch_id))]); setCursor(page.next_after_id); }
    })}>更多上传批次</button>}
  </section>;
}
