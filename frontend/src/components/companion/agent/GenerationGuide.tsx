"use client";

import { useEffect, useState } from "react";
import { photoApi, type AlbumPhoto } from "@/lib/photoApi";
import PhotoImage from "../photos/PhotoImage";
import styles from "./chat.module.css";

export type MediaMode = "image" | "video";
export type GenerationDraft = {
  mode: MediaMode;
  prompt: string;
  step: "reference" | "parameters" | "review" | "confirmed";
  reference: string | null;
  setting: string;
};

export function createGenerationDraft(mode: MediaMode, prompt: string): GenerationDraft {
  return { mode, prompt, step: "reference", reference: null, setting: mode === "image" ? "方形 1:1" : "5 秒" };
}

/** Configuration rehearsal only. No generation or quote endpoint is called here. */
export default function GenerationGuide({ value, disabled, onChange, onEdit, onCancel }: {
  value: GenerationDraft; disabled: boolean;
  onChange: (next: GenerationDraft) => void; onEdit: () => void; onCancel: () => void;
}) {
  const [photos, setPhotos] = useState<AlbumPhoto[] | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Load only when the user explicitly opens the album selector.
  useEffect(() => {
    if (!attempt) return;
    let active = true;
    setLoading(true); setError("");
    photoApi.list("all", "", "", "").then(result => { if (active) setPhotos(result.photos.slice(0, 6)); })
      .catch(() => { if (active) setError("相册暂时没有打开，请重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const video = value.mode === "video";
  const set = (patch: Partial<GenerationDraft>) => onChange({ ...value, ...patch });
  const recommended = () => set({ setting: video ? "5 秒" : "方形 1:1", step: "review" });
  return <section aria-label={video ? "视频创作引导" : "图片创作引导"}>
    <article className={styles.user}><span>我 · {video ? "视频" : "图片"}</span><p>{value.prompt}</p></article>
    <article className={styles.guideCard} aria-label="创作设置卡片">
      <fieldset disabled={disabled}>
        {value.step === "reference" ? <>
          <h2>需要参考一张照片吗？</h2>
          <p>从相册选择，或直接用文字创作。</p>
          <button type="button" onClick={() => setAttempt(n => n + 1)} disabled={loading}>从相册添加</button>
          {loading && <p role="status">正在打开相册…</p>}
          {error && <p role="alert">{error}</p>}
          {photos && <><div className={styles.referenceGrid}>{photos.map((photo, i) => <button type="button" key={photo.photo_id} aria-pressed={value.reference === photo.photo_id} onClick={() => set({ reference: photo.photo_id, step: "parameters" })}>
            <PhotoImage id={photo.photo_id} /><span>选择照片 {i + 1}</span>
          </button>)}</div>{!photos.length && <p>相册里还没有照片。</p>}<a href={`${process.env.NEXT_PUBLIC_COMPANION_BASE_PATH ?? ""}/companion/photos`}>打开完整相册</a></>}
          <button type="button" onClick={() => set({ reference: null, step: "parameters" })}>不加参考图片</button>
          <button type="button" onClick={recommended}>用推荐设置</button>
          <button type="button" onClick={onEdit}>返回修改描述</button>
        </> : <>
          <p className={styles.muted}>{value.reference ? "已选择参考照片" : "使用文字创作"}</p>
          {value.reference && <div className={styles.selectedReference}><PhotoImage id={value.reference} large /></div>}
          {value.step === "parameters" ? <>
            <h2>{video ? "想要多长的视频？" : "选择图片的形状"}</h2>
            <div className={styles.choices}>{(video ? ["5 秒", "10 秒"] : ["方形 1:1", "横向 16:9", "竖向 9:16"]).map(setting => <button type="button" key={setting} aria-pressed={setting === value.setting} onClick={() => set({ setting, step: "review" })}>{setting}</button>)}</div>
            <button type="button" onClick={recommended}>用推荐设置</button>
            <button type="button" onClick={() => set({ step: "reference" })}>返回修改</button>
          </> : <>
            <h2>{value.step === "confirmed" ? "设置已确认" : "看看完整设置"}</h2>
            <dl><dt>创作类型</dt><dd>{video ? "视频" : "图片"}</dd><dt>描述</dt><dd>{value.prompt}</dd><dt>{video ? "时长" : "比例"}</dt><dd>{value.setting}</dd><dt>参考图片</dt><dd>{value.reference ? "上方选中的照片" : "不添加"}</dd><dt>费用</dt><dd>尚未报价</dd></dl>
            <details><summary>更多设置</summary><p>模型与分辨率将在生成服务接入后提供。</p></details>
            <p>当前可预演设置流程，暂不能生成{video ? "视频" : "图片"}。</p>
            {value.step === "review" ? <button type="button" onClick={() => set({ step: "confirmed" })}>确认设置</button> : <p role="status">已确认本次设置，尚未开始生成。</p>}
            <button type="button" disabled>确认生成（暂未开放）</button>
            <button type="button" onClick={() => set({ step: "parameters" })}>返回修改</button>
          </>}
        </>}
        <button type="button" onClick={onCancel}>取消创作</button>
      </fieldset>
    </article>
  </section>;
}
