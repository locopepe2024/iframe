"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type PhotoStory as Story } from "@/lib/photoApi";
import { useCompanionVoice } from "../useCompanionVoice";
import styles from "./photos.module.css";

// The parent keys this component by photo ID so unsaved stories and voice stay scoped.
export default function PhotoStory({ photoId }: { photoId: string }) {
  const [story, setStory] = useState<Story | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"idle" | "edit" | "confirm">("idle");
  const [allowed, setAllowed] = useState(false);
  const [pending, setPending] = useState<{ text: string; expected_revision: number; operation_id: string } | null>(null);
  const [history, setHistory] = useState<Story[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true), locked = useRef(false);
  const preview = useRef<HTMLDivElement>(null);
  const voice = useCompanionVoice(text => { setDraft(text); setError(""); });
  useEffect(() => {
    alive.current = true;
    photoApi.story(photoId).then(value => { if (alive.current) { setStory(value); setLoaded(true); } })
      .catch(() => { if (alive.current) setError("讲述读取失败，请重新打开照片。"); });
    return () => { alive.current = false; };
  }, [photoId]);
  useEffect(() => { if (mode === "confirm") preview.current?.focus(); }, [mode]);
  function propose(text: string) {
    if (!text.trim() || Array.from(text.trim()).length > 4000) { setError("请填写 1 到 4000 字的讲述。"); return; }
    voice.stopAll(); setError(""); setNotice(""); setDraft(text.trim());
    setPending({ text: text.trim(), expected_revision: story?.revision ?? 0, operation_id: crypto.randomUUID() });
    setMode("confirm");
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  const textToRead = mode === "confirm" ? pending?.text : mode === "edit" ? draft : story?.text;
  return <section aria-label="我的照片讲述" aria-busy={busy} className={styles.voice}>
    <h3>我的讲述</h3>
    <p>写下或说说照片背后的回忆。不记得也没关系，下次再说。</p>
    <p>这是您讲述的记录，与 AI 画面描述分开保存，不会自动修改照片日期或人物资料。</p>
    {story && <p className={styles.storyText}>{story.text}</p>}
    {!loaded && !error && <p role="status">正在读取讲述…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loaded && <>
      {mode === "idle" && <button disabled={busy} onClick={() => {
        voice.stopAll(); setDraft(story?.text ?? ""); setNotice(""); setMode("edit");
      }}>{story ? "修改我的讲述" : "讲讲这张照片"}</button>}
      {mode === "edit" && <>
        <label htmlFor="photo-story-draft">我的讲述草稿（可修改）</label>
        <textarea id="photo-story-draft" rows={6} value={draft} disabled={busy || voice.listening || voice.finishing} onChange={event => setDraft(event.target.value)} />
        <p>最多 4000 字。未保存的草稿在切换照片后会清除。</p>
        <p>听写可能由浏览器语音服务处理。不保存录音；说“同意”不会自动保存。听写结果会替换当前草稿。</p>
        <label className={styles.check}><input type="checkbox" checked={allowed} disabled={busy} onChange={event => {
          setAllowed(event.target.checked); if (!event.target.checked) voice.stopAll();
        }} />本次允许听写照片讲述</label>
        <button disabled={busy || !allowed || voice.finishing} aria-pressed={voice.listening} onClick={voice.toggleListening}>
          {voice.finishing ? "正在结束讲述听写" : voice.listening ? "停止讲述听写" : "说说这张照片"}
        </button>
        <p role="status">{voice.notice}</p>
        <button disabled={busy || voice.listening || voice.finishing || !draft.trim()} onClick={() => propose(draft)}>核对我的讲述</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setDraft(""); setError(""); setMode("idle"); }}>取消讲述</button>
      </>}
      {mode === "confirm" && pending && <div ref={preview} tabIndex={-1} role="region" aria-label="讲述保存确认" className={styles.confirm}>
        <p>将为这张照片保存下面的讲述，请再核对一遍：</p>
        <p className={styles.storyText}>{pending.text}</p>
        <button disabled={busy} onClick={() => void run(async () => {
          const saved = await photoApi.saveStory(photoId, pending);
          if (alive.current) {
            voice.stopAll(); setStory(saved); setPending(null); setDraft(""); setMode("idle"); setHistory(null);
            setNotice("讲述已保存。");
          }
        })}>{busy ? "正在保存讲述…" : "确认保存讲述"}</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setPending(null); setMode("edit"); setError(""); }}>返回修改讲述</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setPending(null); setDraft(""); setMode("idle"); setError(""); }}>暂不保存讲述</button>
      </div>}
      {textToRead && <button disabled={busy || voice.listening || voice.finishing} onClick={() => voice.speak(textToRead, true)}>{voice.speaking ? "停止读讲述" : "读出我的讲述"}</button>}
      {mode === "idle" && <button disabled={busy} onClick={() => void run(async () => {
        const page = await photoApi.storyHistory(photoId);
        if (alive.current) { setHistory(page.changes); setCursor(page.next_after_revision); }
      })}>查看讲述修改历史</button>}
      {history && mode === "idle" && <section aria-label="讲述修改历史">
        {!history.length && <p>还没有保存过讲述。</p>}
        {history.map(item => <div key={item.revision} className={styles.history}>
          <p className={styles.storyText}>第 {item.revision} 版：{item.text}</p>
          <button disabled={busy || item.revision === story?.revision} onClick={() => propose(item.text)}>使用第 {item.revision} 版讲述</button>
        </div>)}
        {cursor !== null && <button disabled={busy} onClick={() => void run(async () => {
          const page = await photoApi.storyHistory(photoId, cursor);
          if (alive.current) { setHistory(old => [...old!, ...page.changes]); setCursor(page.next_after_revision); }
        })}>更多讲述记录</button>}
      </section>}
    </>}
  </section>;
}
