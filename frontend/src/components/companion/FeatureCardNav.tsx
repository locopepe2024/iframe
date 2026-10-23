"use client";

import { BookOpen, Image, MessageCircle, Settings } from "lucide-react";
import styles from "./companion.module.css";

type FeatureCardNavProps = { onSelect: (target: "chat" | "diary" | "photos" | "more") => void };

const cards = [
  { target: "chat" as const, title: "聊天", detail: "说说今天的事", Icon: MessageCircle },
  { target: "photos" as const, title: "相册", detail: "看看图片和视频", Icon: Image },
  { target: "diary" as const, title: "回忆", detail: "整理生活故事", Icon: BookOpen },
  { target: "more" as const, title: "我的", detail: "调整使用习惯", Icon: Settings },
];

export default function FeatureCardNav({ onSelect }: FeatureCardNavProps) {
  return <section className={styles.featureNav} aria-labelledby="feature-nav-title">
    <h2 id="feature-nav-title">您想做什么？</h2>
    <div className={styles.featureGrid}>
      {cards.map(({ target, title, detail, Icon }) => <button type="button" className={styles.featureCard} key={target} onClick={() => onSelect(target)}>
        <Icon aria-hidden="true" /><strong>{title}</strong><span>{detail}</span>
      </button>)}
    </div>
  </section>;
}
