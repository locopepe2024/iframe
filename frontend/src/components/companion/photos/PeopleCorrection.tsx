"use client";
import { useMemo, useRef, useState } from "react";
import { photoApi, type PeopleCorrectionSelection, type PeopleCorrectionPreview, type PeopleCorrectionRequest, type FaceBox } from "@/lib/photoApi";
import FacePhoto from "./FacePhoto";
import styles from "./photos.module.css";
const labels = { remove: "移出所选人脸", split: "拆成另一个人物", merge: "合并到所选人物", undo_batch: "撤销本批新增人物关系" };
export default function PeopleCorrection({ selection, disabled, onSaved, onActiveChange }: { selection: PeopleCorrectionSelection; disabled?: boolean; onSaved?: () => Promise<void>; onActiveChange?: (active: boolean) => void }) {
  const [plan, setPlan] = useState<PeopleCorrectionPreview | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const locked = useRef(false), pending = useRef<PeopleCorrectionRequest | null>(null);
  const images = useMemo(() => {
    const map = new Map<string, FaceBox[]>();
    const affected = new Set(plan?.affected.map(m => `${m.task_id}/${m.face_id}`));
    for (const person of plan?.people ?? []) for (const member of person.members) {
      if (plan?.selection.action !== "merge" && !affected.has(`${member.task_id}/${member.face_id}`)) continue;
      map.set(member.photo_id, [...(map.get(member.photo_id) ?? []), JSON.parse(member.box) as FaceBox]);
    }
    return Array.from(map.entries());
  }, [plan]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "人物调整失败，请重试。"); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className={styles.history}>
    {!plan && <button disabled={busy || disabled} onClick={() => void run(async () => {
      const value = await photoApi.peopleCorrectionPreview(selection);
      setReady({}); pending.current = null; setPlan(value); setNotice(""); onActiveChange?.(true);
    })}>预览：{labels[selection.action]}</button>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {plan && <div role="region" aria-label="人物调整确认" className={styles.confirm}>
      <h3>{labels[plan.selection.action]}</h3>
      <p>将调整 {plan.counts.members} 个人脸关系，涉及 {plan.counts.photos} 张照片。原照片、日期和故事保留。</p>
      {plan.selection.action === "split" && <p>新人物称呼：{plan.selection.label || "暂不填写"}。</p>}
      {plan.selection.action === "merge" && <p>合并后保留目标人物的称呼：{plan.people.find(p => p.person_id === plan.selection.target_id)?.label || "暂未填写"}。请核对两个相册中的人脸。</p>}
      {plan.selection.action === "undo_batch" && <p>保留本批已人工调整的 {plan.counts.preserve} 个人脸关系，以及其他批次关系。此操作不停止后台分析；如需停止，请先使用“停止或清理”。</p>}
      {images.map(([id, boxes]) => <FacePhoto key={id} photoId={id} boxes={boxes} onReady={value => setReady(old => old[id] === value ? old : { ...old, [id]: value })} />)}
      {plan.counts.members === 0 && <p>没有可以撤销的新增关系。</p>}
      <button disabled={busy || plan.counts.members === 0 || images.some(([id]) => !ready[id])} onClick={() => void run(async () => {
        if (!pending.current) pending.current = { ...plan.selection, preview_token: plan.preview_token, operation_id: crypto.randomUUID(), method: "button" };
        const result = await photoApi.correctPeople(pending.current);
        setNotice(`已保存，调整了 ${result.counts.members} 个人脸关系。`); setPlan(null); pending.current = null; onActiveChange?.(false);
        await onSaved?.();
      })}>确认{labels[plan.selection.action]}</button>
      <button disabled={busy} onClick={() => { setPlan(null); setError(""); pending.current = null; onActiveChange?.(false); }}>返回，不调整</button>
    </div>}
  </div>;
}
