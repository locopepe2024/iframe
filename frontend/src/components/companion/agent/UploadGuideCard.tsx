"use client";

import { Images, Plus } from "lucide-react";
import styles from "./chat.module.css";

export default function UploadGuideCard({ onUpload, onAlbum }: { onUpload: () => void; onAlbum: () => void }) {
  return <article className={styles.guideCard} aria-label="上传素材引导">
    <h2>怎么加入照片或视频？</h2>
    <p>可以从手机选择文件，也可以从生活相册里挑选。</p>
    <button type="button" onClick={onUpload}><Plus size={20} aria-hidden="true" />上传照片或视频</button>
    <button type="button" onClick={onAlbum}><Images size={20} aria-hidden="true" />从相册选择</button>
  </article>;
}
