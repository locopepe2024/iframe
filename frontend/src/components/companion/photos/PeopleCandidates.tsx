"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type PeopleGroup, type PeopleReviewRequest } from "@/lib/photoApi";
import FacePhoto from "./FacePhoto";
import styles from "./photos.module.css";

function CandidateCard({ group, version, onSaved }: { group: PeopleGroup; version: number; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(""), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const locked = useRef(false), operation = useRef<PeopleReviewRequest | null>(null);
  const imagesReady = group.members.every(member => loaded[member.face_id]);
  async function save(action: PeopleReviewRequest["action"]) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const values = { expected_revision: group.revision, consent_version: version, action, label: action === "confirm" ? label.trim() : "" };
    if (!operation.current || operation.current.action !== action || operation.current.label !== values.label) {
      operation.current = { operation_id: crypto.randomUUID(), ...values };
    }
    try {
      await photoApi.reviewPeopleGroup(group.group_id, operation.current);
      operation.current = null; setConfirm(false); await onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "核对未保存，请重试。"); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className={styles.confirm} aria-label="当前人脸候选" aria-busy={busy}>
    <h4>{group.members.length > 1 ? "边框中的人脸，是同一个人吗？" : "要为这张人脸建立人物相册吗？"}</h4>
    <p>这是待核对建议。请核对每张照片边框中的人脸，看不清可以以后再说。</p>
    {group.members.map((member, index) => <div key={member.face_id}>
      <p>第 {index + 1} 张，核对边框中的人脸：</p>
      <FacePhoto photoId={member.photo_id} boxes={[member.box]} onReady={ready => setLoaded(old => old[member.face_id] === ready ? old : { ...old, [member.face_id]: ready })} />
    </div>)}
    {error && <p role="alert">{error}</p>}
    {!confirm && <>
      <button disabled={busy || !imagesReady} onClick={() => setConfirm(true)}>{group.members.length > 1 ? "是同一个人" : "建立这个人物相册"}</button>
      {group.members.length > 1 && <button disabled={busy} onClick={() => void save("split")}>不是同一个人，分开核对</button>}
      <button disabled={busy} onClick={() => void save("defer")}>以后再说</button>
    </>}
    {confirm && <div role="region" aria-label="保存人物确认">
      <label htmlFor={`person-label-${group.group_id}`}>怎么称呼？可以留空</label>
      <input id={`person-label-${group.group_id}`} value={label} maxLength={80} disabled={busy} onChange={event => setLabel(event.target.value)} />
      <p>将把上面边框中的人脸加入一个由您确认的人物相册。称呼：{label.trim() || "暂不填写"}。</p>
      <button disabled={busy || !imagesReady} onClick={() => void save("confirm")}>确认保存人物</button>
      <button disabled={busy} onClick={() => { setConfirm(false); operation.current = null; setError(""); }}>返回核对，不保存</button>
    </div>}
  </div>;
}

export default function PeopleCandidates({ taskId, version }: { taskId: string; version: number }) {
  const [groups, setGroups] = useState<PeopleGroup[]>([]), [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh() {
    const result = await photoApi.peopleGroups(taskId);
    setGroups(result.groups); setReady(result.ready); setSelected(null);
  }
  useEffect(() => {
    let active = true;
    setBusy(true); setGroups([]); setSelected(null);
    photoApi.peopleGroups(taskId).then(result => { if (active) { setGroups(result.groups); setReady(result.ready); } })
      .catch(() => { if (active) setError("候选读取失败，请刷新候选。"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [taskId]);
  const current = groups.find(group => group.group_id === selected);
  return <section aria-label="人物候选核对">
    <button disabled={busy} onClick={() => {
      setBusy(true); setError(""); void refresh().catch(() => setError("候选读取失败，请刷新候选。")).finally(() => setBusy(false));
    }}>刷新人物候选</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!busy && !ready && <p>正在等待后台生成候选，请稍后刷新。此时尚未建立人物相册。</p>}
    {groups.filter(group => group.status !== "split").map((group, index) => <button key={group.group_id} disabled={busy || ["confirmed", "corrected"].includes(group.status)} onClick={() => { setSelected(group.group_id); setNotice(""); }}>
      {group.status === "corrected" ? "确认后已调整" : group.status === "confirmed" ? "已确认" : group.status === "deferred" ? "以后再说" : "待核对"}人物组 {index + 1}：{group.members.length} 张人脸
    </button>)}
    {current && ["pending", "deferred"].includes(current.status) && <CandidateCard key={`${current.group_id}/${current.revision}`} group={current} version={version} onSaved={async () => {
      setNotice("核对已保存。只有确认的人物会进入人物相册。"); await refresh();
    }} />}
  </section>;
}
