"use client";

import { useRef, useState } from "react";
import { photoApi, type PersonAlbum, type FaceBox } from "@/lib/photoApi";
import FacePhoto from "./FacePhoto";
import styles from "./photos.module.css";

export default function PeopleAlbums() {
  const [people, setPeople] = useState<PersonAlbum[] | null>(null), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<PersonAlbum | null>(null);
  const [photos, setPhotos] = useState<{ photo_id: string; boxes: FaceBox[] }[]>([]);
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
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
    if (!after) { setSelected(null); setPhotos([]); setPhotoCursor(null); }
  }
  async function open(person: PersonAlbum, after = "") {
    const page = await photoApi.personPhotos(person.person_id, after);
    setSelected(person); setPhotos(old => after ? [...old, ...page.photos] : page.photos); setPhotoCursor(page.next_after_id);
  }
  return <section className={styles.panel} aria-label="已确认人物相册" aria-busy={busy}>
    <h2>您确认过的人物</h2><p>只展示您明确确认的人物。没有填写称呼也可以浏览。</p>
    <button disabled={busy} onClick={() => void run(() => list())}>查看已确认人物相册</button>
    {error && <p role="alert">{error}</p>}
    {people?.length === 0 && <p>还没有已确认人物，可以在上传批次的人物整理中核对。</p>}
    {people?.map((person, index) => <button key={person.person_id} disabled={busy} aria-pressed={selected?.person_id === person.person_id} onClick={() => void run(() => open(person))}>
      {person.label || `未填写称呼的人物 ${index + 1}`}：{person.photo_count} 张照片
    </button>)}
    {cursor && <button disabled={busy} onClick={() => void run(() => list(cursor))}>更多已确认人物</button>}
    {selected && <div aria-label="所选人物的照片">
      <h3>{selected.label || "未填写称呼的人物"}</h3>
      <p>边框标出您确认的人脸；同一张合照可以出现在多个人物相册中。</p>
      {photos.map(photo => <FacePhoto key={photo.photo_id} photoId={photo.photo_id} boxes={photo.boxes} />)}
      {photoCursor && <button disabled={busy} onClick={() => void run(() => open(selected, photoCursor))}>更多人物照片</button>}
    </div>}
  </section>;
}
