"use client";

import { useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Images, NotebookPen } from "lucide-react";
import styles from "./todayPlanCards.module.css";

const plans = [
  { id: "schedule", title: "今天的安排", summary: "今天有 3 件事，下一件是下午 3 点散步。", label: "示例待办", time: "下午 3 点", action: "看看安排", question: "下午的散步，今天想按原计划出发，还是换个时间？", icon: CalendarDays },
  { id: "photos", title: "一起整理照片", summary: "还有 2 张照片，等您讲讲里面的故事。", label: "示例待处理", time: "2 张待讲述", action: "一起看看", question: "可以选一张想讲的照片，我们一起把故事记下来。", icon: Images },
  { id: "diary", title: "记录今天的生活", summary: "聊聊今天发生的事，整理成一篇日记草稿。", label: "助手建议", time: "随时可以开始", action: "聊聊今天", question: "今天有什么让您印象深刻的事？可以从一件小事说起。", icon: NotebookPen },
] as const;

/** Explicit sample plans until an authoritative schedule source is connected. */
export default function TodayPlanCards({ disabled, onPhotos, onDiary }: {
  disabled: boolean; onPhotos: () => void; onDiary: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const rail = useRef<HTMLDivElement>(null), titleRef = useRef<HTMLHeadingElement>(null);
  const context = useRef<HTMLDivElement>(null);
  const id = useId();
  function move(next: number) {
    const position = Math.max(0, Math.min(plans.length - 1, next));
    const node = rail.current, first = node?.children[0] as HTMLElement | undefined;
    const card = node?.children[position] as HTMLElement | undefined;
    if (node && first && card) node.scrollTo?.({ left: card.offsetLeft - first.offsetLeft, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setIndex(position);
  }
  function opened(next: number) { setActive(next); setIndex(next); setFeedback(""); requestAnimationFrame(() => context.current?.focus()); }
  const plan = active === null ? null : plans[active];
  return <section className={styles.section} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} ref={titleRef} tabIndex={-1}>欢迎回来</h2>
    {plan ? <>
      <div className={styles.current}><span>正在处理：{plan.title}</span><button type="button" disabled={disabled} onClick={() => {setActive(null);setFeedback("");requestAnimationFrame(()=>titleRef.current?.focus());}}>返回今日计划</button></div>
      <div className={styles.conversation} role="region" aria-label="计划对话" ref={context} tabIndex={-1}>
        <span className={styles.label}>{plan.label} · 交互演示</span><p>{plan.question}</p>
        {plan.id === "schedule" ? <><div className={styles.actions}>
          <button type="button" disabled={disabled} onClick={() => setFeedback("示例：保留原计划。尚未设置真实提醒。")}>按原计划</button>
          <button type="button" disabled={disabled} onClick={() => setFeedback("示例：稍后再提醒。尚未创建真实提醒。")}>稍后提醒</button>
          <button type="button" disabled={disabled} onClick={() => setFeedback("示例：今天跳过。没有修改真实计划。")}>今天跳过</button>
        </div><p className={styles.note}>这里先演示计划交互，不会创建或修改真实提醒。</p></> : <button type="button" disabled={disabled} onClick={plan.id === "photos" ? onPhotos : onDiary}>{plan.id === "photos" ? "从相册选择照片" : "开始记录"}</button>}
        {feedback && <p role="status">{feedback}</p>}
      </div>
    </> : <>
      <p>今天按照计划，可以从这里开始。</p><p className={styles.note}>以下为示例计划与建议，尚未读取您的真实安排。</p>
      <div ref={rail} className={styles.rail} role="region" aria-roledescription="轮播" aria-label="今日计划卡片" tabIndex={0}
        onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault();move(index + (event.key === "ArrowRight" ? 1 : -1)); } }}
        onScroll={() => {
          const node=rail.current, first=node?.children[0] as HTMLElement|undefined;
          if (!node || !first) return;
          const nearest=Array.from(node.children).reduce((best, child, i, children) => Math.abs((child as HTMLElement).offsetLeft-first.offsetLeft-node.scrollLeft)<Math.abs((children[best] as HTMLElement).offsetLeft-first.offsetLeft-node.scrollLeft)?i:best,0);
          setIndex(nearest);
        }}>
        {plans.map((item,i) => <article className={styles.card} key={item.id} aria-label={`${i+1} / ${plans.length} ${item.title}`}>
          <div className={styles.label}><item.icon size={24} aria-hidden="true"/><span>{item.label}</span></div>
          <h3>{item.title}</h3><p className={styles.summary}>{item.summary}</p><p className={styles.time}>{item.time}</p>
          <button type="button" disabled={disabled} onClick={() => opened(i)}>{item.action}</button>
        </article>)}
      </div>
      <div className={styles.paging}><button type="button" aria-label="上一张计划" disabled={index === 0} onClick={() => move(index-1)}><ChevronLeft size={24} aria-hidden="true"/></button><span aria-live="polite" aria-atomic="true">第 {index+1} / {plans.length} 张</span><button type="button" aria-label="下一张计划" disabled={index === plans.length-1} onClick={() => move(index+1)}><ChevronRight size={24} aria-hidden="true"/></button></div>
    </>}
  </section>;
}
