"use client";

import { ArrowLeft, Images, Plus } from "lucide-react";
import styles from "./chat.module.css";

export default function UploadGuideCard({ onUpload, onAlbum, onDismiss }: { onUpload: () => void; onAlbum: () => void; onDismiss: () => void }) {
  return <article className={styles.guideCard} aria-label="上传素材引导">
    <h2>怎么加入照片或视频？</h2>
    <p>可以从手机添加新文件，也可以把已有相册素材加入当前聊天。</p>
    <button type="button" onClick={onUpload}><Plus size={20} aria-hidden="true" />从手机添加照片或视频</button>
    <button type="button" onClick={onAlbum}><Images size={20} aria-hidden="true" />从已有相册添加</button>
    <button type="button" onClick={onDismiss}><ArrowLeft size={20} aria-hidden="true" />返回聊天</button>
  </article>;
}
