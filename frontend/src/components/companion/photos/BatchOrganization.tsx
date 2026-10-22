"use client";

import { useState } from "react";
import PeopleTasks from "./PeopleTasks";
import TimeTasks from "./TimeTasks";
import styles from "./photos.module.css";

type Choice = "time" | "people" | "both" | "later";
const names: Record<Choice, string> = { time: "按时间整理", people: "按人物整理", both: "都整理", later: "暂时不用" };

export default function BatchOrganization({ batchId, disabled }: { batchId: string; disabled?: boolean }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [step, setStep] = useState<"time" | "people">("time");
  const [generation, setGeneration] = useState(0);
  return <section aria-label="选择本批整理方式" className={styles.voice}>
    <h3>需要我帮您整理这些照片吗？原照片会保留。</h3>
    <p>先选想了解的整理方式，再分别确认授权、建立任务。只点下面的选项不会启动整理。</p>
    <div role="group" aria-label="整理方式">
      {(Object.keys(names) as Choice[]).map(value => <button key={value} disabled={disabled} aria-pressed={choice === value} onClick={() => {
        setChoice(value); setStep(value === "people" ? "people" : "time"); setGeneration(old => old + 1);
      }}>{names[value]}</button>)}
    </div>
    {choice && <p role="status">当前查看方式：{names[choice]}。这不代表已授权或已整理。</p>}
    {choice === "later" && <p>本次不启动新的整理。已有后台任务会继续，既有授权也不会自动撤回。如需停止或清理，请展开下方对应的管理区。</p>}
    {choice === "both" && <p>先了解时间整理，再了解人物整理。两项需要分别确认；可以只允许其中一项。</p>}
    <div key={generation}>
      <details open={choice !== null && choice !== "later" && step === "time"}>
        <summary>时间整理与任务管理</summary>
        <TimeTasks batchId={batchId} />
      </details>
      {choice === "both" && step === "time" && <button disabled={disabled} onClick={() => { setStep("people"); setGeneration(old => old + 1); }}>继续了解人物整理</button>}
      <details open={choice !== null && choice !== "later" && step === "people"}>
        <summary>人物整理（需单独允许）</summary>
        <PeopleTasks batchId={batchId} />
      </details>
    </div>
  </section>;
}
