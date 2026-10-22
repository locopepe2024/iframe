"use client";

import { useRef, useState } from "react";
import { photoApi, type PersonAlbum, type PersonPhoto, type PeopleCorrectionReceipt } from "@/lib/photoApi";
import FacePhoto from "./FacePhoto";
import PeopleCorrection from "./PeopleCorrection";
import styles from "./photos.module.css";

export default function PeopleAlbums() {
  const [people, setPeople] = useState<PersonAlbum[] | null>(null), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<PersonAlbum | null>(null);
  const [photos, setPhotos] = useState<PersonPhoto[]>([]);
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [correctionActive, setCorrectionActive] = useState(false);
  const [editing, setEditing] = useState(false), [faces, setFaces] = useState<string[]>([]);
  const [target, setTarget] = useState(""), [label, setLabel] = useState("");
  const [history, setHistory] = useState<PeopleCorrectionReceipt[] | null>(null), [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const locked = useRef(false);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "人物相册读取失败。"); }
    finally { locked.current = false; setBusy(false); }
  }
  async function list(after = "") {
    const page = await photoApi.peopleAlbums(after);
    setPeople(old => after ? [...(old ?? []), ...page.people] : page.people); setCursor(page.next_after_id);
    if (!after) { setSelected(null); setPhotos([]); setPhotoCursor(null); setEditing(false); setFaces([]); }
  }
  async function open(person: PersonAlbum, after = "") {
    const page = await photoApi.personPhotos(person.person_id, after);
    if (!after) { setEditing(false); setFaces([]); setTarget(""); setLabel(""); }
    setSelected(person); setPhotos(old => after ? [...old, ...page.photos] : page.photos); setPhotoCursor(page.next_after_id);
  }
  const faceKey = (m: { task_id: string; face_id: string }) => `${m.task_id}/${m.face_id}`;
  const selection = { person_id: selected?.person_id, members: photos.flatMap(p => p.members ?? []).filter(m => faces.includes(faceKey(m))).map(m => ({ task_id: m.task_id, face_id: m.face_id })) };
  async function loadHistory(after = 0) {
    const page = await photoApi.peopleCorrectionHistory(after);
    setHistory(old => after ? [...(old ?? []), ...page.changes] : page.changes); setHistoryCursor(page.next_after);
  }
  return <section className={styles.panel} aria-label="已确认人物相册" aria-busy={busy}>
    <h2>您确认过的人物</h2><p>只展示您明确确认的人物。没有填写称呼也可以浏览。</p>
    <button disabled={busy || correctionActive} onClick={() => void run(() => list())}>查看已确认人物相册</button>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {people?.length === 0 && <p>还没有已确认人物，可以在上传批次的人物整理中核对。</p>}
    {people?.map((person, index) => <button key={person.person_id} disabled={busy || correctionActive} aria-pressed={selected?.person_id === person.person_id} onClick={() => void run(() => open(person))}>
      {person.label || `未填写称呼的人物 ${index + 1}`}：{person.photo_count} 张照片
    </button>)}
    {cursor && <button disabled={busy || correctionActive} onClick={() => void run(() => list(cursor))}>更多已确认人物</button>}
    {selected && <div aria-label="所选人物的照片">
      <h3>{selected.label || "未填写称呼的人物"}</h3>
      <p>边框标出您确认的人脸；同一张合照可以出现在多个人物相册中。</p>
      {photos.map(photo => <FacePhoto key={photo.photo_id} photoId={photo.photo_id} boxes={photo.boxes} />)}
      <button disabled={busy || correctionActive} onClick={() => { setEditing(old => !old); setFaces([]); }}>调整这个人物</button>
      {editing && <div aria-label="选择人物调整" className={styles.confirm}>
        <p>逐张核对边框内的人脸，选择需要移出或拆分的部分。</p>
        {photos.flatMap(p => (p.members ?? []).map((m, index) => <div key={faceKey(m)}>
          <FacePhoto photoId={p.photo_id} boxes={[m.box]} />
          <label className={styles.check}><input type="checkbox" disabled={correctionActive} checked={faces.includes(faceKey(m))} onChange={event => setFaces(old => event.target.checked ? [...old, faceKey(m)] : old.filter(key => key !== faceKey(m)))} />选择这张照片中的人脸 {index + 1}</label>
        </div>))}
        <PeopleCorrection key={`remove/${faces.join()}`} selection={{ ...selection, action: "remove" }} disabled={correctionActive || !faces.length} onActiveChange={setCorrectionActive} onSaved={async () => { setNotice("人物调整已保存。可在调整记录中查看。"); await list(); }} />
        <label>拆分后的称呼（可不填）<input disabled={correctionActive} value={label} maxLength={80} onChange={event => setLabel(event.target.value)} /></label>
        <PeopleCorrection key={`split/${faces.join()}/${label}`} selection={{ ...selection, action: "split", label }} disabled={correctionActive || !faces.length} onActiveChange={setCorrectionActive} onSaved={async () => { setNotice("人物调整已保存。可在调整记录中查看。"); await list(); }} />
        <label>合并到哪个人物？<select disabled={correctionActive} value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">请选择人物</option>
          {people?.filter(p => p.person_id !== selected.person_id).map((p, i) => <option key={p.person_id} value={p.person_id}>{p.label || `未填写称呼的人物 ${(people?.indexOf(p) ?? i) + 1}`}（{p.photo_count} 张）</option>)}
        </select></label>
        <PeopleCorrection key={`merge/${target}`} selection={{ action: "merge", person_id: selected.person_id, target_id: target }} disabled={correctionActive || !target} onActiveChange={setCorrectionActive} onSaved={async () => { setNotice("人物调整已保存。可在调整记录中查看。"); await list(); }} />
      </div>}
      {photoCursor && <button disabled={busy || correctionActive} onClick={() => void run(() => open(selected, photoCursor))}>更多人物照片</button>}
    </div>}
    <button disabled={busy || correctionActive} onClick={() => void run(() => loadHistory())}>查看人物调整记录</button>
    {history?.length === 0 && <p>还没有人物调整记录。</p>}
    {history?.map(item => <p key={item.operation_id}>{({ remove: "移出人脸", split: "拆分人物", merge: "合并人物", undo_batch: "撤销本批新增关系" })[item.action]}：{item.counts.members} 个人脸关系，{new Date(item.created_at * 1000).toLocaleString("zh-CN")}</p>)}
    {historyCursor !== null && <button disabled={busy || correctionActive} onClick={() => void run(() => loadHistory(historyCursor))}>更多人物调整记录</button>}
  </section>;
}
