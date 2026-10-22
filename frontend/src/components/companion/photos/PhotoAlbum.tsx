"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type AlbumPhoto, type DateChange, type PhotoDateAnnotation, type TimeConsent, type TimeQuestion } from "@/lib/photoApi";
import styles from "./photos.module.css";

function dateLabel(annotation: PhotoDateAnnotation) {
  if (annotation.date) return `${annotation.date.value.replace("T", " ")}${annotation.source === "user" ? "（您确认的）" : "（来自照片信息）"}`;
  return annotation.reason === "not_processed" ? "尚未整理" : "时间待确认";
}
function PhotoImage({ id, large = false }: { id: string; large?: boolean }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; let objectUrl = "";
    setUrl(""); setFailed(false);
    photoApi.image(id).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return url ? <img className={large ? styles.largeImage : styles.image} src={url} alt={large ? "当前选择的照片" : "照片缩略图"} />
    : <span>{failed ? "图片暂不可用，请刷新相册" : "正在读取照片…"}</span>;
}

type Confirmation = { kind: "date"; value: string; precision: "year" | "month" | "day" }
  | { kind: "restore"; revision: number } | { kind: "revoke" };

export default function PhotoAlbum() {
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const [year, setYear] = useState("");
  const [applied, setApplied] = useState({ view: "all", year: "" });
  const [selected, setSelected] = useState<AlbumPhoto | null>(null);
  const [consent, setConsent] = useState<TimeConsent | null>(null);
  const [question, setQuestion] = useState<TimeQuestion | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [changes, setChanges] = useState<DateChange[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const uploadKey = useRef("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true); const locked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const questionRegion = useRef<HTMLDivElement>(null);
  const errorRegion = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected?.photo_id]);
  useEffect(() => { if (question || confirmation) questionRegion.current?.focus(); }, [question, confirmation]);
  useEffect(() => { if (error) errorRegion.current?.focus(); }, [error]);

  async function load(append = false, filters = applied) {
    const page = await photoApi.list(filters.view, filters.year, append ? cursor ?? "" : "");
    if (alive.current) {
      setPhotos(old => append ? [...old, ...page.photos] : page.photos);
      setCursor(page.next_after_id);
    }
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作未完成，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    void run(() => load());
    return () => { alive.current = false; };
    // Initial load; filters apply only through the explicit refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDate(annotation: PhotoDateAnnotation) {
    if (!alive.current || !selected) return;
    setSelected({ ...selected, date: annotation });
    setDateInput(annotation.date?.value.slice(0, 10) ?? "");
    setPhotos(old => old.map(p => p.photo_id === selected.photo_id ? { ...p, date: annotation } : p));
  }
  async function open(photo: AlbumPhoto) {
    await run(async () => {
      const status = await photoApi.batch(photo.batch_id);
      if (!alive.current) return;
      setSelected(photo); setConsent(status); setQuestion(null); setConfirmation(null);
      setChanges(null); setHistoryCursor(null); setDateInput(photo.date.date?.value.slice(0, 10) ?? "");
    });
  }
  function mutation() {
    return { expected_revision: selected!.date.revision, consent_version: consent!.consent_version, operation_id: crypto.randomUUID() };
  }
  async function organize(status: TimeConsent) {
    if (!selected) return;
    const annotation = await photoApi.organize(selected.photo_id, { ...mutation(), consent_version: status.consent_version });
    if (!alive.current) return;
    applyDate(annotation); setMessage(annotation.date ? "已按照片时间整理。" : "这张照片的时间需要您确认，可以只填写年份。");
    await load();
  }
  async function requestOrganization() {
    if (!selected || !consent) return;
    await run(async () => {
      if (consent.granted) await organize(consent);
      else {
        const q = await photoApi.question(selected.batch_id);
        if (alive.current) setQuestion(q);
      }
    });
  }
  async function answer(granted: boolean) {
    if (!selected || !question) return;
    await run(async () => {
      const status = await photoApi.answer(selected.batch_id, question.question_id, granted);
      if (!alive.current) return;
      setConsent(status); setQuestion(null);
      if (granted) await organize(status);
      else setMessage("已跳过整理，照片仍保留在相册中。");
    });
  }
  async function confirm() {
    if (!selected || !consent || !confirmation) return;
    const pending = confirmation;
    await run(async () => {
      if (pending.kind === "revoke") {
        const status = await photoApi.revoke(selected.batch_id, consent.consent_version);
        if (alive.current) { setConsent(status); setMessage("已停止后续整理，此前结果和原照片保留。"); }
      } else {
        const annotation = pending.kind === "date"
          ? await photoApi.correct(selected.photo_id, { ...mutation(), value: pending.value, precision: pending.precision })
          : await photoApi.restore(selected.photo_id, { ...mutation(), target_revision: pending.revision });
        if (!alive.current) return;
        applyDate(annotation); setChanges(null); setMessage("已保存，修改历史保留。");
        await load();
      }
      if (alive.current) setConfirmation(null);
    });
  }

  return <main className={styles.shell} aria-busy={busy}>
    <a href="/companion">返回陪伴首页</a>
    <h1>我的生活相册</h1>
    <p>留住照片，慢慢说说照片里的故事。</p>
    <p className={styles.note}>照片 Demo · 当前支持一张一张上传，按时间整理。照片保存在当前服务端；人物和语音整理稍后加入。</p>
    <section className={styles.panel} aria-label="上传照片">
      <h2>添一张照片</h2>
      <label htmlFor="photo-file">选择一张照片</label>
      <input ref={fileInput} id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => {
        setFile(e.target.files?.[0] ?? null); uploadKey.current = crypto.randomUUID();
      }} />
      <p className={styles.note}>支持 JPEG、PNG、WebP，最多 10 MB。上传后由您选择是否整理。</p>
      <button disabled={busy || !file} onClick={() => void run(async () => {
        await photoApi.upload(uploadKey.current, file!);
        if (!alive.current) return;
        setFile(null); if (fileInput.current) fileInput.current.value = "";
        setMessage("照片已保存，尚未开始整理。");
        await load(false, { view: "all", year: "" });
        if (alive.current) { setView("all"); setYear(""); setApplied({ view: "all", year: "" }); }
      })}>上传照片</button>
    </section>

    <section className={styles.panel} aria-label="相册浏览">
      <h2>看看照片</h2>
      <div className={styles.filters}>
        <label>查看范围<select value={view} disabled={busy} onChange={e => { setView(e.target.value); setYear(""); }}>
          <option value="all">全部照片</option><option value="pending">时间待确认 / 尚未整理</option>
        </select></label>
        <label>年份（可不填）<input inputMode="numeric" maxLength={4} value={year} disabled={busy || view === "pending"} onChange={e => setYear(e.target.value)} /></label>
      </div>
      <button disabled={busy} onClick={() => void run(async () => {
        setSelected(null); setQuestion(null); setConfirmation(null);
        await load(false, { view, year });
        if (alive.current) setApplied({ view, year });
      })}>刷新相册</button>
      {(view !== applied.view || year !== applied.year) && <p>范围已更改，请点“刷新相册”查看。</p>}
      <div className={styles.grid}>
        {photos.map((photo, index) => <button key={photo.photo_id} className={styles.photo} disabled={busy} aria-label={`查看照片 ${index + 1}`} aria-pressed={selected?.photo_id === photo.photo_id} onClick={() => void open(photo)}>
          <PhotoImage id={photo.photo_id} /><span>{dateLabel(photo.date)}</span>
        </button>)}
      </div>
      {!photos.length && !busy && <p>这里还没有照片。可以先上传一张，或更换查看范围。</p>}
      {cursor && <button disabled={busy || view !== applied.view || year !== applied.year} onClick={() => void run(() => load(true))}>再看一些照片</button>}
    </section>

    {selected && <section className={styles.panel} aria-label="当前照片">
      <h2 ref={detailHeading} tabIndex={-1}>这张照片</h2><PhotoImage id={selected.photo_id} large />
      <p>{dateLabel(selected.date)}</p>
      <p>{consent?.granted ? "您已允许按时间整理。" : "当前未授权整理。"}</p>
      {!question && !confirmation && <>
        <button disabled={busy || !consent} onClick={() => void requestOrganization()}>按时间整理</button>
        {consent?.granted && <>
          <label htmlFor="photo-date">拍摄时间</label>
          <input id="photo-date" value={dateInput} disabled={busy} onChange={e => setDateInput(e.target.value)} placeholder="例如 1985 或 1985-06" aria-describedby="photo-date-help" />
          <p id="photo-date-help" className={styles.note}>只记得年份也可以；还可填写 1985-06 或 1985-06-07。不记得可以跳过。</p>
          <button disabled={busy || !dateInput} onClick={() => {
            const value = dateInput.trim();
            const precision = /^[0-9]{4}$/.test(value) ? "year" : /^[0-9]{4}-[0-9]{2}$/.test(value) ? "month" : /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ? "day" : null;
            if (!precision) { setError("请填写四位年份、年月或完整日期，例如 1985。"); return; }
            setError(""); setConfirmation({ kind: "date", value, precision });
          }}>核对日期</button>
          <button disabled={busy} onClick={() => setConfirmation({ kind: "revoke" })}>停止后续整理</button>
        </>}
        <button disabled={busy} onClick={() => void run(async () => {
          const history = await photoApi.history(selected.photo_id);
          if (alive.current) { setChanges(history.changes); setHistoryCursor(history.next_after_revision); }
        })}>查看修改历史</button>
      </>}
      {question && <div ref={questionRegion} tabIndex={-1} role="region" aria-label="时间整理授权" className={styles.confirm}>
        <p>{question.text}</p>
        <button disabled={busy} onClick={() => void answer(true)}>同意并整理</button>
        <button disabled={busy} onClick={() => void answer(false)}>暂时不用</button>
      </div>}
      {confirmation && <div ref={questionRegion} tabIndex={-1} role="region" aria-label="操作确认" className={styles.confirm}>
        <p>{confirmation.kind === "date" ? `按您说的，记录为 ${confirmation.value}，可以吗？`
          : confirmation.kind === "restore" ? `恢复到第 ${confirmation.revision} 版的日期？恢复自动结果时会重新读取已保存的照片日期信息。历史仍保留。`
          : "停止这批照片的后续时间整理？此前整理结果和原照片会保留。"}</p>
        <button disabled={busy} onClick={() => void confirm()}>{confirmation.kind === "date" ? "确认日期" : confirmation.kind === "restore" ? "确认恢复" : "确认停止"}</button>
        <button disabled={busy} onClick={() => setConfirmation(null)}>取消</button>
      </div>}
      {changes && !question && !confirmation && <section aria-label="修改历史">
        <h3>修改历史</h3>
        {!changes.length && <p>还没有修改记录。</p>}
        {changes.map(change => <div key={change.revision} className={styles.history}>
          <p>第 {change.revision} 版 · {dateLabel(change.after)}</p>
          <button disabled={busy || !consent?.granted || change.revision === selected.date.revision} onClick={() => setConfirmation({ kind: "restore", revision: change.revision })}>恢复第 {change.revision} 版</button>
        </div>)}
        {historyCursor !== null && <button disabled={busy} onClick={() => void run(async () => {
          const page = await photoApi.history(selected.photo_id, historyCursor);
          if (alive.current) { setChanges(old => [...old ?? [], ...page.changes]); setHistoryCursor(page.next_after_revision); }
        })}>查看更多历史</button>}
      </section>}
    </section>}
    {busy && <p role="status">正在处理，请稍候…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p ref={errorRegion} tabIndex={-1} role="alert" className={styles.error}>{error}</p>}
  </main>;
}
