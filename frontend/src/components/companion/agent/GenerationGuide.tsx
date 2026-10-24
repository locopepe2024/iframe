"use client";

import { useState } from "react";
import GenerationSubmit from "./GenerationSubmit";
import AlbumPicker from "./AlbumPicker";
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

/** Guided setup followed by explicit owner-channel submission. */
export default function GenerationGuide({ value, disabled, onChange, onEdit, onCancel }: {
  value: GenerationDraft; disabled: boolean;
  onChange: (next: GenerationDraft) => void; onEdit: () => void; onCancel: () => void;
}) {
  const [album,setAlbum] = useState(false);
  const [submitted,setSubmitted] = useState(false);
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
          <button type="button" onClick={() => setAlbum(true)}>相册</button>
          {album && <AlbumPicker disabled={disabled} onClose={() => setAlbum(false)} onPhoto={photo => { set({reference:photo.photo_id,step:"parameters"});setAlbum(false); }} />}
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
            <details><summary>更多设置</summary><p>下一步选择可用模型，分辨率使用该模型的默认设置。</p></details>
            <p>先确认设置，再选择个人渠道模型生成{video ? "视频" : "图片"}。</p>
            {value.step === "review" ? <button type="button" onClick={() => set({ step: "confirmed" })}>确认设置</button> : <p role="status">已确认本次设置，尚未开始生成。</p>}
            {value.step === "confirmed" && <GenerationSubmit key={`${value.mode}:${value.prompt}:${value.setting}:${value.reference}`} value={value} onSubmitted={setSubmitted}/> }
            <button type="button" disabled={submitted} onClick={() => set({ step: "parameters" })}>返回修改</button>
          </>}
        </>}
        <button type="button" disabled={submitted} onClick={onCancel}>取消创作</button>
      </fieldset>
    </article>
  </section>;
}
