"use client";

import { useEffect, useState } from "react";
import { photoApi, type PhotoAnalysis } from "@/lib/photoApi";

export default function PhotoContent({ photoId }: { photoId: string }) {
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    photoApi.analysis(photoId).then(result => { if (active) setAnalysis(result); })
      .catch(() => { if (active) setError("照片描述暂时读取失败，请重新打开照片。"); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [photoId]);

  async function analyze() {
    if (!allowed || busy) return;
    setBusy(true); setError("");
    try { setAnalysis(await photoApi.analyze(photoId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "照片分析暂不可用，请稍后重试。照片和日期仍保留。"); }
    finally { setBusy(false); }
  }
  return <section aria-label="照片内容描述" aria-busy={busy}>
    <h3>一起看看这张照片</h3>
    {!loaded && <p role="status">正在读取照片描述…</p>}
    {loaded && !analysis && <>
      <p>可以让 Qwen 看看画面，帮您开始讲故事。会将去除照片信息的缩略图发送给配置的外部 Qwen 服务，描述保存在本相册。不识别人物身份，不修改拍摄日期。</p>
      <label><input type="checkbox" checked={allowed} disabled={busy} onChange={e => setAllowed(e.target.checked)} />本次允许 Qwen 分析这张照片</label>
      <button disabled={!allowed || busy || !!error} onClick={() => void analyze()}>{busy ? "正在看照片…" : "看看照片内容"}</button>
      {error && <button disabled={busy} onClick={() => { setError(""); }}>准备重试</button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {analysis && <>
      <p>AI 看图描述，尚待您核对</p>
      <p>{analysis.observation.visible_summary}</p>
      {!!analysis.observation.visible_text.length && <><h3>看见的文字（可能有误）</h3><ul>{analysis.observation.visible_text.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
      {!!analysis.observation.uncertainties.length && <><h3>还不确定的地方</h3><ul>{analysis.observation.uncertainties.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
      <p>{analysis.observation.story_question}</p><p>不想说也可以，下次再聊。</p>
    </>}
  </section>;
}
