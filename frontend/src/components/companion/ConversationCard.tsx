"use client";

import styles from "./companion.module.css";

export type ConversationCardData =
  | { kind: "text"; title: string; body: string }
  | { kind: "image"; title: string; src: string; alt: string; action?: string }
  | { kind: "video"; title: string; poster?: string; src: string; action?: string }
  | { kind: "memory"; title: string; body: string; source?: string }
  | { kind: "status"; title: string; body: string };

export default function ConversationCard({ card, onAction }: { card: ConversationCardData; onAction?: () => void }) {
  return <article className={styles.conversationCard} aria-label={card.title}>
    <h3>{card.title}</h3>
    {card.kind === "text" && <p>{card.body}</p>}
    {card.kind === "memory" && <><p className={styles.preserve}>{card.body}</p>{card.source && <p className={styles.eyebrow}>来源：{card.source}</p>}</>}
    {card.kind === "status" && <p role="status">{card.body}</p>}
    {card.kind === "image" && <><img className={styles.conversationMedia} src={card.src} alt={card.alt} />{card.action && <button type="button" onClick={onAction}>{card.action}</button>}</>}
    {card.kind === "video" && <><video className={styles.conversationMedia} controls preload="metadata" poster={card.poster}><source src={card.src} /></video>{card.action && <button type="button" onClick={onAction}>{card.action}</button>}</>}
  </article>;
}
