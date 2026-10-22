"use client";

import { useEffect, useState } from "react";
import { photoApi } from "@/lib/photoApi";
import styles from "./photos.module.css";

export default function PhotoImage({ id, large = false }: { id: string; large?: boolean }) {
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
