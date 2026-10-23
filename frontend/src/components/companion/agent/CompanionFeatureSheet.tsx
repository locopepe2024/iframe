"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import styles from "./chat.module.css";

export type CompanionFeature = "diary" | "plaza" | "mine";

const titles: Record<CompanionFeature, string> = { diary: "日记", plaza: "广场", mine: "我的" };

export default function CompanionFeatureSheet({ feature, onClose }: {
  feature: Exclude<CompanionFeature,"diary">; onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className={styles.sheetBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.featureSheet} role="dialog" aria-modal="true" aria-label={titles[feature]} onMouseDown={event => event.stopPropagation()}>
      <div className={styles.sheetHandle} aria-hidden="true" />
      <div className={styles.albumHeader}><h2>{titles[feature]}</h2><button className={styles.albumIcon} type="button" aria-label={`关闭${titles[feature]}`} onClick={onClose}><X size={24} aria-hidden="true" /></button></div>
      {feature === "plaza" && <div className={styles.featureEmpty}><p>这里会展示家人和朋友分享的生活内容。</p><p className={styles.muted}>广场内容准备中。</p></div>}
      {feature === "mine" && <div className={styles.featureEmpty}><p>在这里查看个人资料、聊天记录和设置。</p><p className={styles.muted}>个人设置准备中。</p></div>}
    </section>
  </div>;
}
