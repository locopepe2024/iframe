"use client";

import { useEffect, useState } from "react";
import { photoApi, type PhotoAnalysis } from "@/lib/photoApi";
import PhotoDelete from "./PhotoDelete";
import PhotoFactsEditor from "./PhotoFactsEditor";

export default function PhotoContent({ photoId, onSaved }: { photoId: string; onSaved?:()=>void }) {
  const [analysis, setAnalysis] = useState<PhotoAnalysis | null>(null);
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
    if (busy) return;
    setBusy(true); setError("");
    try { setAnalysis(await photoApi.analyze(photoId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "照片分析暂不可用，请稍后重试。照片和日期仍保留。"); }
    finally { setBusy(false); }
  }
  return <section aria-label="照片内容描述" aria-busy={busy}>
    {!loaded && <p role="status">正在读取照片描述…</p>}
    {loaded && !analysis && <>
      <p>小安可以帮您填写画面资料，将照片缩略图发给您配置的 Qwen 服务分析。</p>
      <button disabled={busy || !!error} onClick={() => void analyze()}>{busy ? "正在分析照片…" : "允许小安分析照片"}</button>
      {error && <button disabled={busy} onClick={() => { setError(""); }}>准备重试</button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {loaded && <PhotoFactsEditor photoId={photoId} analysis={analysis} onSaved={onSaved} />}
    {loaded && !onSaved && <details><summary>更多操作</summary><PhotoDelete photoId={photoId}/></details>}
  </section>;
}
