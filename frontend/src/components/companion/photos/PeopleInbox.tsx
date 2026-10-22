"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type PendingPeopleReview } from "@/lib/photoApi";
import PeopleCandidates from "./PeopleCandidates";
import styles from "./photos.module.css";

export default function PeopleInbox() {
  const [reviews, setReviews] = useState<PendingPeopleReview[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<PendingPeopleReview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const locked = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load(after = "") {
    const page = await photoApi.pendingPeopleReviews(after);
    if (!alive.current) return;
    setReviews(old => after ? [...(old ?? []), ...page.reviews] : page.reviews);
    setCursor(page.next_after_id);
    if (!after) setSelected(null);
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "待确认人物读取失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section className={styles.panel} aria-label="人物待确认" aria-busy={busy}>
    <h2>人物待确认</h2>
    <p>这里汇总您当前允许分析、还未确认的人物建议，包括选择过“以后再说”的建议。核对后才会加入已确认人物相册。</p>
    {!selected && <button disabled={busy} onClick={() => void run(async () => { setNotice(""); await load(); })}>查看人物待确认</button>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!selected && reviews?.length === 0 && <p>当前有效授权下没有待确认的人物建议。正在处理的任务请在上传批次查看进度；停止分析后，已有确认相册仍保留。</p>}
    {!selected && reviews?.map((review, index) => <button key={review.task_id} disabled={busy} onClick={() => { setSelected(review); setNotice(""); }}>
      核对第 {index + 1} 次人物建议：待确认 {review.pending_groups} 组，以后再说 {review.deferred_groups} 组，涉及 {review.photo_count} 张照片
    </button>)}
    {!selected && cursor && <button disabled={busy} onClick={() => void run(() => load(cursor))}>更多待确认人物</button>}
    {selected && <div>
      <button disabled={busy} onClick={() => { setSelected(null); setNotice("已返回列表，未提交的核对内容不会保存。可重新查看列表获取最新状态。"); }}>返回人物待确认列表</button>
      <PeopleCandidates key={selected.task_id} taskId={selected.task_id} version={selected.consent_version} onReviewed={async () => {
        await run(async () => { await load(); if (alive.current) setNotice("核对已保存，列表已更新。已确认的人物可在下方相册查看。"); });
      }} />
    </div>}
  </section>;
}
