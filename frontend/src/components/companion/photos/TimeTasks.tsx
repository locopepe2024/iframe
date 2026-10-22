"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type PhotoTimeTask, type TimeConsent, type TimeQuestion } from "@/lib/photoApi";
import styles from "./photos.module.css";
import BatchUndo from "./BatchUndo";

const labels: Record<PhotoTimeTask["status"], string> = {
  queued: "等待后台整理", running: "正在后台整理", completed: "本任务已完成",
  needs_confirmation: "整理结束，部分日期需要核对", partial_failed: "部分项目未完成", failed: "任务未完成", cancelled: "已停止未完成项",
};
export default function TimeTasks({ batchId }: { batchId: string }) {
  const [consent, setConsent] = useState<TimeConsent | null>(null);
  const [tasks, setTasks] = useState<PhotoTimeTask[]>([]);
  const [question, setQuestion] = useState<TimeQuestion | null>(null);
  const [stop, setStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true), locked = useRef(false);
  const operation = useRef<{ operation_id: string; consent_version: number; retry_task_id?: string } | null>(null);
  const active = tasks.some(task => task.status === "queued" || task.status === "running");
  async function refresh() {
    const [status, rows] = await Promise.all([photoApi.batch(batchId), photoApi.timeTasks(batchId)]);
    if (alive.current) { setConsent(status); setTasks(rows); }
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => { if (alive.current) setError("整理任务读取失败，请刷新任务。不会自动提交。"); });
    return () => { alive.current = false; };
    // This component is keyed by its batch ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);
  useEffect(() => {
    if (!active) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { if (!locked.current) await refresh(); }
      catch { if (!disposed && alive.current) setError("进度暂时无法读取，任务不会因此自动取消，请刷新任务。"); }
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 2000);
    return () => { disposed = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, batchId]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function create(retry?: string) {
    if (!consent?.granted) return;
    if (!operation.current || operation.current.consent_version !== consent.consent_version || operation.current.retry_task_id !== retry) {
      operation.current = { operation_id: crypto.randomUUID(), consent_version: consent.consent_version, ...(retry ? { retry_task_id: retry } : {}) };
    }
    const value = await photoApi.createTimeTask(batchId, operation.current);
    if (alive.current) { operation.current = null; setTasks(old => [value, ...old.filter(task => task.task_id !== value.task_id)]); setNotice("后台任务已建立，可以离开页面，回来查看进度。"); }
  }
  return <section aria-label="批次后台时间整理" aria-busy={busy} className={styles.voice}>
    <h3>按时间整理这批已上传照片</h3>
    <p>任务只处理建立时已上传的照片；后续补传照片需再建立任务。未上传项不在本任务中。不调用外部模型，不分析人脸。</p>
    <p>没有日期的照片会等待核对，已确认日期保留。任务结束后请刷新相册查看日期。</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => void run(refresh)}>刷新整理任务</button>
    {consent && !consent.granted && !question && <button disabled={busy} onClick={() => void run(async () => {
      const q = await photoApi.question(batchId); if (alive.current) setQuestion(q);
    })}>允许这批照片按时间整理</button>}
    {question && <div role="region" aria-label="批次时间授权确认" className={styles.confirm}>
      <p>{question.text}</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const value = await photoApi.answer(batchId, question.question_id, true);
        if (alive.current) { setConsent(value); setQuestion(null); operation.current = null; setNotice("已允许时间整理，请点击建立后台整理任务。"); }
      })}>确认允许时间整理</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const value = await photoApi.answer(batchId, question.question_id, false);
        if (alive.current) { setConsent(value); setQuestion(null); }
      })}>暂不允许这批整理</button>
    </div>}
    {consent?.granted && <>
      <button disabled={busy || active || stop} onClick={() => void run(() => create())}>建立后台整理任务</button>
      <button disabled={busy || stop} onClick={() => setStop(true)}>停止这批后续时间整理</button>
    </>}
    {stop && consent && <div role="region" aria-label="停止批次任务确认" className={styles.confirm}>
      <p>撤回本批时间整理授权并停止尚未完成的项目？原照片和已提交结果保留，不等于撤销本批已完成的整理。</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const value = await photoApi.revoke(batchId, consent.consent_version);
        if (alive.current) { setConsent(value); setStop(false); operation.current = null; }
        await refresh();
      })}>确认停止批次任务</button>
      <button disabled={busy} onClick={() => setStop(false)}>继续保留整理授权</button>
    </div>}
    {tasks.map(task => <div key={task.task_id} className={styles.history}>
      <p>{labels[task.status]}</p>
      <p>成功 {task.counts.completed} 张，日期待核对 {task.counts.needs_confirmation} 张，失败 {task.counts.failed} 张，待处理 {task.counts.pending} 张，已停止 {task.counts.cancelled} 张。</p>
      {task.items.filter(item => item.status === "failed").map(item => <p key={item.photo_id}>
        {item.error_code === "revision_changed" ? "有照片日期在任务建立后发生变化，未覆盖新日期。" : "有照片日期资料无法处理，请先检查照片资料。"}
      </p>)}
      {task.counts.failed > 0 && !["queued", "running"].includes(task.status) && <button disabled={busy || active || !consent?.granted || stop} onClick={() => void run(() => create(task.task_id))}>重试此任务的失败项</button>}
    </div>)}
    <BatchUndo batchId={batchId} disabled={busy} onUndone={async () => {
      setQuestion(null); setStop(false); operation.current = null;
      await refresh();
    }} />
  </section>;
}
