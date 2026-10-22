"use client";

import { useEffect, useRef, useState } from "react";
import PeopleAlbums from "./PeopleAlbums";
import PhotoImage from "./PhotoImage";
import PhotoContent from "./PhotoContent";
import PhotoStory from "./PhotoStory";
import BatchUpload from "./BatchUpload";
import { photoApi, type AlbumPhoto, type DateChange, type PhotoDateAnnotation, type TimeConsent, type TimeQuestion } from "@/lib/photoApi";
import { useCompanionVoice } from "../useCompanionVoice";
import { parseSpokenPhotoDate, type DateSuggestion } from "./spokenDate";
import styles from "./photos.module.css";

function dateLabel(annotation: PhotoDateAnnotation) {
  if (annotation.date) return `${annotation.date.value.replace("T", " ")}${annotation.source === "user" ? "（您确认的）" : "（来自照片信息）"}`;
  return annotation.reason === "not_processed" ? "尚未整理" : "时间待确认";
}

type Confirmation = { kind: "date"; photoId: string; expectedRevision: number; consentVersion: number; value: string; precision: "year" | "month" | "day" }
  | { kind: "restore"; revision: number } | { kind: "revoke" };

export default function PhotoAlbum() {
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const [year, setYear] = useState("");
  const [query, setQuery] = useState("");
  const [searchVoiceConsent, setSearchVoiceConsent] = useState(false);
  const searchVoice = useCompanionVoice(text => setQuery(text));
  const [applied, setApplied] = useState({ view: "all", year: "", query: "" });
  const filtersChanged = view !== applied.view || year !== applied.year || query.trim() !== applied.query;
  const [selected, setSelected] = useState<AlbumPhoto | null>(null);
  const [consent, setConsent] = useState<TimeConsent | null>(null);
  const [question, setQuestion] = useState<TimeQuestion | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [changes, setChanges] = useState<DateChange[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [dateInput, setDateInput] = useState("");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [spokenDraft, setSpokenDraft] = useState("");
  const voice = useCompanionVoice(text => setSpokenDraft(text));
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
    const page = await photoApi.list(filters.view, filters.year, append ? cursor ?? "" : "", filters.query);
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

  async function applyFilters(next: typeof applied) {
    if (Array.from(next.query).length > 100) { setError("搜索文字请不超过 100 字。"); return; }
    searchVoice.stopAll(); voice.stopAll();
    await run(async () => {
      setSpokenDraft(""); setSelected(null); setQuestion(null); setConfirmation(null);
      await load(false, next);
      if (alive.current) { setApplied(next); setQuery(next.query); }
    });
  }

  function applyDate(annotation: PhotoDateAnnotation) {
    if (!alive.current || !selected) return;
    setSelected({ ...selected, date: annotation });
    setDateInput(annotation.date?.value.slice(0, 10) ?? "");
    setSpokenDraft("");
    setPhotos(old => old.map(p => p.photo_id === selected.photo_id ? { ...p, date: annotation } : p));
  }
  async function open(photo: AlbumPhoto) {
    searchVoice.stopAll(); voice.stopAll(); setSpokenDraft("");
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
  function proposeDate(suggestion: DateSuggestion) {
    if (!selected || !consent?.granted) return;
    voice.stopAll();
    setError(""); setDateInput(suggestion.value);
    setConfirmation({ kind: "date", photoId: selected.photo_id, expectedRevision: selected.date.revision,
      consentVersion: consent.consent_version, ...suggestion });
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
    voice.stopAll();
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
        if (alive.current) { voice.stopAll(); setSpokenDraft(""); setConsent(status); setMessage("已停止后续整理，此前结果和原照片保留。"); }
      } else {
        if (pending.kind === "date" && (pending.photoId !== selected.photo_id
          || pending.expectedRevision !== selected.date.revision || pending.consentVersion !== consent.consent_version
          || !consent.granted)) {
          if (alive.current) { setConfirmation(null); setError("照片或授权已变化，请重新核对日期。"); }
          return;
        }
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

  function speakCurrentPrompt() {
    if (!selected) return;
    const prompt = question?.text ?? (confirmation?.kind === "date" ? "按您说的，记录为 " + confirmation.value + "，可以吗？"
      : confirmation?.kind === "restore" ? "恢复到第 " + confirmation.revision + " 版的日期？历史仍保留。"
      : confirmation?.kind === "revoke" ? "停止这批照片的后续时间整理？此前结果和原照片会保留。"
      : "这张照片的拍摄时间：" + dateLabel(selected.date) + "。如果记得，可以只告诉我年份；不记得可以跳过。");
    voice.speak(prompt, true);
  }

  return <main className={styles.shell} aria-busy={busy}>
    <a href={`${process.env.NEXT_PUBLIC_COMPANION_BASE_PATH || ""}/companion`}>返回陪伴首页</a>
    <h1>我的生活相册</h1>
    <p>留住照片，慢慢说说照片里的故事。</p>
    <p className={styles.note}>照片 Demo · 支持单张、批量上传与后台时间整理。照片保存在当前服务端；人物分析需在上传批次中单独允许，候选由您核对。</p>
    <PeopleAlbums />
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
        await load(false, { view: "all", year: "", query: "" });
        if (alive.current) { setView("all"); setYear(""); setQuery(""); setApplied({ view: "all", year: "", query: "" }); }
      })}>上传照片</button>
    </section>

    <BatchUpload onUploaded={() => { void run(() => load()); }} />
    <section className={styles.panel} aria-label="相册浏览">
      <h2>看看照片</h2>
      <div className={styles.filters}>
        <label>查看范围<select value={view} disabled={busy} onChange={e => { setView(e.target.value); setYear(""); }}>
          <option value="all">全部照片</option><option value="pending">时间待确认 / 尚未整理</option>
        </select></label>
        <label>年份（可不填）<input inputMode="numeric" maxLength={4} value={year} disabled={busy || view === "pending"} onChange={e => setYear(e.target.value)} /></label>
      </div>
      <label htmlFor="photo-search">找照片（输入讲述或描述中的词）</label>
      <input id="photo-search" value={query} maxLength={100} disabled={busy || searchVoice.listening || searchVoice.finishing} onChange={event => setQuery(event.target.value)} aria-describedby="photo-search-help" />
      <p id="photo-search-help" className={styles.note}>只搜索已保存的最新讲述和已确认的画面描述，按连续文字匹配。可以试试“公园”。不会搜索未确认的 AI 描述，不调用模型。</p>
      <details>
        <summary>也可以说出要找的词</summary>
        <p>听写可能由浏览器语音服务处理，不保存录音。听到的话只填入上方输入框，请修改后点击查找；查询会发送到当前相册服务，不作为长期记忆保存。</p>
        <label className={styles.check}><input type="checkbox" checked={searchVoiceConsent} disabled={busy} onChange={event => {
          setSearchVoiceConsent(event.target.checked); if (!event.target.checked) searchVoice.stopAll();
        }} />本次允许听写搜索词</label>
        <button disabled={busy || !searchVoiceConsent || searchVoice.finishing} aria-pressed={searchVoice.listening} onClick={searchVoice.toggleListening}>
          {searchVoice.finishing ? "正在结束搜索听写" : searchVoice.listening ? "停止搜索听写" : "说出搜索词"}
        </button>
        <p role="status">{searchVoice.notice}</p>
      </details>
      <button disabled={busy || searchVoice.listening || searchVoice.finishing} onClick={() => void applyFilters({ view, year, query: query.trim() })}>查找照片</button>
      <button disabled={busy || searchVoice.listening || searchVoice.finishing} onClick={() => void applyFilters({ view, year, query: query.trim() })}>刷新相册</button>
      {(applied.query || query) && <button disabled={busy || searchVoice.listening || searchVoice.finishing} onClick={() => void applyFilters({ view, year, query: "" })}>清除搜索词</button>}
      {filtersChanged && <p>条件已更改，请点“查找照片”或“刷新相册”查看。</p>}
      {applied.query && <p role="status">当前结果：包含“{applied.query}”的照片。匹配讲述不代表内容已核实。</p>}
      <div className={styles.grid}>
        {photos.map((photo, index) => <button key={photo.photo_id} className={styles.photo} disabled={busy} aria-label={`查看照片 ${index + 1}`} aria-pressed={selected?.photo_id === photo.photo_id} onClick={() => void open(photo)}>
          <PhotoImage id={photo.photo_id} /><span>{dateLabel(photo.date)}</span>
          {photo.search_matches?.map(match => <span key={match.source}>
            {match.source === "story" ? "讲述" : "已确认描述"}第 {match.revision} 版：…{match.excerpt}…
          </span>)}
        </button>)}
      </div>
      {!photos.length && !busy && <p>{applied.query ? "没有找到匹配照片。可缩短关键词，或清除搜索词。" : "这里还没有照片。可以先上传一张，或更换查看范围。"}</p>}
      {cursor && <button disabled={busy || filtersChanged || searchVoice.listening || searchVoice.finishing} onClick={() => void run(() => load(true))}>再看一些照片</button>}
    </section>

    {selected && <section className={styles.panel} aria-label="当前照片">
      <h2 ref={detailHeading} tabIndex={-1}>这张照片</h2><PhotoImage id={selected.photo_id} large />
      <PhotoContent key={selected.photo_id} photoId={selected.photo_id} />
      <PhotoStory key={`story-${selected.photo_id}`} photoId={selected.photo_id} />
      <p>{dateLabel(selected.date)}</p>
      <p>{consent?.granted ? "您已允许按时间整理。" : "当前未授权整理。"}</p>
      <p className={styles.note}>授权针对这张照片所属批次；下方整理按钮只处理当前照片，尚不自动整理整批。</p>
      <button disabled={busy || voice.listening || voice.finishing} onClick={speakCurrentPrompt}>{voice.speaking ? "停止朗读" : "读出当前提示"}</button>
      {!question && !confirmation && <>
        <button disabled={busy || !consent} onClick={() => void requestOrganization()}>按时间整理</button>
        {consent?.granted && <>
          <label htmlFor="photo-date">拍摄时间</label>
          <input id="photo-date" value={dateInput} disabled={busy} onChange={e => setDateInput(e.target.value)} placeholder="例如 1985 或 1985-06" aria-describedby="photo-date-help" />
          <p id="photo-date-help" className={styles.note}>只记得年份也可以；还可填写 1985-06 或 1985-06-07。不记得可以跳过。</p>
          <button disabled={busy || !dateInput} onClick={() => {
            const suggestion = parseSpokenPhotoDate(dateInput);
            if (!suggestion || !/^[0-9-]+$/.test(dateInput.trim())) {
              setError("请填写有效的四位年份、年月或完整日期，例如 1985。"); return;
            }
            proposeDate(suggestion);
          }}>核对日期</button>
          <section className={styles.voice} aria-label="语音核对日期">
            <h3>也可以说出拍摄时间</h3>
            <p id="photo-voice-disclosure" className={styles.note}>听写可能由浏览器语音服务处理音频。识别文字只在本页供您核对；本 Demo 不保存录音或原话，也不会自动修改照片。</p>
            <label className={styles.check}><input type="checkbox" checked={voiceConsent} onChange={event => {
              setVoiceConsent(event.target.checked); if (!event.target.checked) voice.stopAll();
            }} />本次允许使用浏览器听写</label>
            <button disabled={busy || !voiceConsent || voice.finishing} aria-pressed={voice.listening} aria-describedby="photo-voice-disclosure" onClick={voice.toggleListening}>
              {voice.finishing ? "正在结束听写" : voice.listening ? "停止听写" : "点一下，说日期"}
            </button>
            <p role="status">{voice.notice}</p>
            <label htmlFor="photo-spoken-draft">听到的话（可修改）</label>
            <textarea id="photo-spoken-draft" rows={2} value={spokenDraft} disabled={busy || voice.listening || voice.finishing} onChange={event => setSpokenDraft(event.target.value)} />
            <button disabled={busy || voice.listening || voice.finishing || !spokenDraft.trim()} onClick={() => {
              const suggestion = parseSpokenPhotoDate(spokenDraft);
              if (!suggestion) { setError("没有识别出明确日期。请修改听写文字，或在上方直接填写年份、年月或日期。"); return; }
              proposeDate(suggestion);
            }}>核对语音日期</button>
          </section>
          <button disabled={busy} onClick={() => { voice.stopAll(); setConfirmation({ kind: "revoke" }); }}>停止后续整理</button>
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
