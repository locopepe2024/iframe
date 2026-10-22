"use client";

import { useEffect, useRef, useState } from "react";
import { photoApi, type DescriptionReview as Review } from "@/lib/photoApi";
import { useCompanionVoice } from "../useCompanionVoice";

export default function DescriptionReview({ photoId, original }: { photoId: string; original: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [mode, setMode] = useState<"idle" | "edit" | "confirm" | "later">("idle");
  const [pending, setPending] = useState<{ description: string; expected_revision: number; operation_id: string } | null>(null);
  const [history, setHistory] = useState<Review[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true), locked = useRef(false);
  const voice = useCompanionVoice(text => setTranscript(text));
  const current = review?.description ?? original;
  useEffect(() => {
    alive.current = true;
    photoApi.description(photoId).then(value => { if (alive.current) { setReview(value); setLoaded(true); } })
      .catch(() => { if (alive.current) setError("描述核对记录读取失败，请重新打开照片。"); });
    return () => { alive.current = false; };
  }, [photoId]);
  function propose(text: string) {
    if (!text.trim() || text.trim().length > 1600) { setError("请填写 1 到 1600 字的描述。"); return; }
    voice.stopAll(); setError(""); setDraft(text.trim());
    setPending({ description: text.trim(), expected_revision: review?.revision ?? 0, operation_id: crypto.randomUUID() });
    setMode("confirm");
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作失败，请重试。"); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section aria-label="核对照片描述" aria-busy={busy}>
    <h3>{review ? "您确认的描述" : "核对这段画面描述"}</h3>
    {review && <p>{review.description}</p>}
    <p>这里只核对画面描述，不会确认拍摄日期、人物姓名或亲属关系。</p>
    {error && <p role="alert">{error}</p>}
    {loaded && <>
      <button disabled={busy || voice.listening || voice.finishing} onClick={() => voice.speak(mode === "confirm" ? pending!.description + "。请核对后点击确认保存。" : current, true)}>{voice.speaking ? "停止读描述" : "读出这段描述"}</button>
      {mode === "idle" && <>
        <button disabled={busy} onClick={() => propose(current)}>描述正确</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setDraft(current); setMode("edit"); }}>改一下</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setTranscript(""); setMode("later"); }}>以后再说</button>
        <p>听写可能由浏览器语音服务处理。不保存录音，听到“同意”也不会自动保存。</p>
        <label><input type="checkbox" checked={allowed} onChange={event => { setAllowed(event.target.checked); if (!event.target.checked) voice.stopAll(); }} />本次允许听写描述核对</label>
        <button disabled={busy || !allowed || voice.finishing} onClick={voice.toggleListening}>{voice.finishing ? "正在结束描述听写" : voice.listening ? "停止描述听写" : "说话确认"}</button>
        <p role="status">{voice.notice}</p>
        {transcript && <>
          <label htmlFor="description-transcript">听到的核对意见（可修改）</label>
          <textarea id="description-transcript" value={transcript} disabled={voice.listening || voice.finishing} onChange={event => setTranscript(event.target.value)} />
          <button disabled={busy || voice.listening || voice.finishing} onClick={() => {
            const text = transcript.trim().replace(/[，。！!\s]/g, "");
            if (["对", "对的", "正确", "描述正确", "同意", "确认"].includes(text)) propose(current);
            else setError("请核对听到的话；要修改描述，可选择“用这些话修改描述”，也可以点击“描述正确”。");
          }}>核对语音意见</button>
          <button disabled={busy || voice.listening || voice.finishing} onClick={() => { voice.stopAll(); setDraft(transcript); setMode("edit"); }}>用这些话修改描述</button>
        </>}
      </>}
      {mode === "edit" && <>
        <label htmlFor="description-draft">修改后的完整描述</label>
        <textarea id="description-draft" rows={5} value={draft} maxLength={1600} disabled={busy} onChange={event => setDraft(event.target.value)} />
        <button disabled={busy || !draft.trim()} onClick={() => propose(draft)}>核对修改</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setMode("idle"); }}>取消修改</button>
      </>}
      {mode === "confirm" && pending && <div role="region" aria-label="描述保存确认">
        <p>将保存下面这段描述，请再看一遍：</p><p>{pending.description}</p>
        <button disabled={busy} onClick={() => void run(async () => {
          const value = await photoApi.confirmDescription(photoId, pending);
          if (alive.current) { voice.stopAll(); setReview(value); setPending(null); setTranscript(""); setMode("idle"); setHistory(null); }
        })}>{busy ? "正在保存描述…" : "确认保存描述"}</button>
        <button disabled={busy} onClick={() => { voice.stopAll(); setPending(null); setMode("idle"); }}>暂不保存</button>
      </div>}
      {mode === "later" && <><p>这次先不核对，原描述仍保留。</p><button onClick={() => setMode("idle")}>继续核对描述</button></>}
      <button disabled={busy} onClick={() => void run(async () => {
        const page = await photoApi.descriptionHistory(photoId);
        if (alive.current) { setHistory(page.changes); setCursor(page.next_after_revision); }
      })}>查看描述修改历史</button>
      {history && <section aria-label="描述修改历史">{!history.length && <p>还没有确认记录。</p>}{history.map(item => <p key={item.revision}>第 {item.revision} 版：{item.description}</p>)}
        {cursor !== null && <button disabled={busy} onClick={() => void run(async () => {
          const page = await photoApi.descriptionHistory(photoId, cursor);
          if (alive.current) { setHistory(old => [...old!, ...page.changes]); setCursor(page.next_after_revision); }
        })}>更多描述记录</button>}
      </section>}
    </>}
  </section>;
}
