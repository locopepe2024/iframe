"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type PeopleConsentRequest, type PeopleTask, type TimeConsent, type TimeQuestion } from "@/lib/photoApi";
import PeopleCandidates from "./PeopleCandidates";
import styles from "./photos.module.css";

const taskLabels: Record<string, string> = { queued: "等待人物分析", running: "正在分析人脸", needs_review: "检测结束，等待核对人物候选", completed: "检测结束，未检测到可用人脸", partial_failed: "部分检测失败，其余结果可核对", failed: "人物检测未完成", cancelled: "已停止本任务", cleared: "本任务的人脸特征已清理" };
export default function PeopleTasks({ batchId }: { batchId: string }) {
  const [consent, setConsent] = useState<(TimeConsent & { enabled: boolean }) | null>(null);
  const [tasks, setTasks] = useState<PeopleTask[]>([]);
  const [question, setQuestion] = useState<(TimeQuestion & { consent_version: number }) | null>(null);
  const [stop, setStop] = useState(false), [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const locked = useRef(false), alive = useRef(true);
  const consentOperation = useRef<PeopleConsentRequest | null>(null);
  const taskOperation = useRef<{ operation_id: string; consent_version: number; retry_task_id?: string } | null>(null);
  const active = tasks.some(task => ["queued", "running"].includes(task.status));
  async function refresh() {
    const [value, rows] = await Promise.all([photoApi.peopleStatus(batchId), photoApi.peopleTasks(batchId)]);
    if (alive.current) { setConsent(value); setTasks(rows); }
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => { if (alive.current) setError("人物进度读取失败，请刷新；不会自动分析。"); });
    return () => { alive.current = false; };
    // Component is keyed by batch ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);
  useEffect(() => {
    if (!active) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { if (!locked.current) await refresh(); }
      catch { if (!disposed && alive.current) setError("人物进度暂时无法读取，请刷新进度。"); }
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 2000);
    return () => { disposed = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, batchId]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "人物整理操作失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function answer(granted: boolean) {
    if (!question) return;
    const values = { expected_version: question.consent_version, granted, question_id: question.question_id, method: "button" as const };
    if (!consentOperation.current || consentOperation.current.granted !== granted || consentOperation.current.question_id !== question.question_id) {
      consentOperation.current = { operation_id: crypto.randomUUID(), ...values };
    }
    await photoApi.peopleConsent(batchId, consentOperation.current);
    if (alive.current) { setQuestion(null); consentOperation.current = null; }
    await refresh();
  }
  async function create(retry?: string) {
    if (!consent?.granted) return;
    if (!taskOperation.current || taskOperation.current.consent_version !== consent.consent_version || taskOperation.current.retry_task_id !== retry) {
      taskOperation.current = { operation_id: crypto.randomUUID(), consent_version: consent.consent_version, ...(retry ? { retry_task_id: retry } : {}) };
    }
    await photoApi.createPeopleTask(batchId, taskOperation.current);
    taskOperation.current = null;
    if (alive.current) setNotice("人物任务已建立，可以离开页面后回来查看。等待状态不代表后台已在线。");
    await refresh();
  }
  return <section aria-label="批次人物整理" className={styles.voice} aria-busy={busy}>
    <h3>按人物整理这批照片</h3>
    <p>人物分析需要单独允许。只分析建立任务时已上传的照片，原照片保留。检测和分组只是建议，要由您核对。</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => void run(refresh)}>刷新人物进度</button>
    {consent && !consent.enabled && <p>当前测试站尚未启用新的人物分析。已有结果仍可查看，也可以停止和清理。</p>}
    {consent?.enabled && !consent.granted && !question && <button disabled={busy} onClick={() => void run(async () => {
      const value = await photoApi.peopleQuestion(batchId); if (alive.current) { setQuestion(value); consentOperation.current = null; }
    })}>了解并允许人物分析</button>}
    {question && <div role="region" aria-label="人物分析授权确认" className={styles.confirm}>
      <p>{question.text}</p>
      <button disabled={busy} onClick={() => void run(() => answer(true))}>确认允许本批人物分析</button>
      <button disabled={busy} onClick={() => void run(() => answer(false))}>暂不允许人物分析</button>
    </div>}
    {consent?.granted && consent.enabled && <button disabled={busy || active || stop} onClick={() => void run(() => create())}>建立人物分析任务</button>}
    {consent && <button disabled={busy || stop} onClick={() => { setStop(true); setClear(false); consentOperation.current = null; }}>停止或清理本批人物分析</button>}
    {stop && consent && <div role="region" aria-label="停止人物分析确认" className={styles.confirm}>
      <p>停止本批后续人物分析。已确认的人物相册、原照片、日期和照片故事保留。</p>
      <label className={styles.check}><input type="checkbox" checked={clear} disabled={busy} onChange={event => setClear(event.target.checked)} />同时清除本批人脸特征和未确认的自动候选</label>
      <button disabled={busy} onClick={() => void run(async () => {
        if (!consentOperation.current || consentOperation.current.expected_version !== consent.consent_version || consentOperation.current.clear !== clear) {
          consentOperation.current = { operation_id: crypto.randomUUID(), expected_version: consent.consent_version, granted: false, clear, method: "button" };
        }
        await photoApi.peopleConsent(batchId, consentOperation.current);
        if (alive.current) { setStop(false); setSelected(null); setQuestion(null); setNotice(clear ? "已停止并清理本批人脸特征及未确认候选。已确认人物相册保留。" : "已停止本批后续人物分析，既有结果保留。"); consentOperation.current = null; taskOperation.current = null; }
        await refresh();
      })}>确认停止人物分析</button>
      <button disabled={busy} onClick={() => { setStop(false); consentOperation.current = null; }}>返回，不停止</button>
    </div>}
    {tasks.map(task => <div className={styles.history} key={task.task_id}>
      <p>{taskLabels[task.status] ?? "人物任务状态待刷新"}</p>
      <p>已检测到人脸 {task.counts.detected} 张，未检测到可用人脸 {task.counts.no_faces} 张，失败 {task.counts.failed} 张，待处理 {task.counts.pending} 张，处理中 {task.counts.running} 张，已停止 {task.counts.cancelled} 张，已清理 {task.counts.cleared} 张。</p>
      {task.counts.no_faces > 0 && <p>未检测到可用人脸，不代表照片中没有人。</p>}
      {task.counts.failed > 0 && !["queued", "running"].includes(task.status) && <button disabled={busy || active || !consent?.granted || !consent.enabled || stop} onClick={() => void run(() => create(task.task_id))}>重试人物任务失败项</button>}
      {task.counts.detected > 0 && consent?.granted && consent.consent_version === task.consent_version && <button disabled={busy || stop} onClick={() => setSelected(task.task_id)}>核对这次人物候选</button>}
      {selected === task.task_id && consent?.granted && consent.consent_version === task.consent_version && <PeopleCandidates key={task.task_id} taskId={task.task_id} version={task.consent_version} />}
    </div>)}
  </section>;
}
