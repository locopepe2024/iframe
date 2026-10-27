"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./chat.module.css";

export default function FeatureDialog({ title, onClose, children, className = "" }: {title: string; onClose: () => void; children: ReactNode; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open", "");
    return () => dialog.close?.();
  }, []);
  return <dialog ref={ref} open={typeof HTMLDialogElement === "undefined" ? true : undefined} className={[styles.featureDialog, className].filter(Boolean).join(" ")} aria-label={title} onCancel={event => {event.preventDefault();onClose();}}>
    <div className={styles.sheetHandle} aria-hidden="true" />
    <header className={styles.albumHeader}><h2>{title}</h2><button type="button" className={styles.albumIcon} aria-label={`关闭${title}`} onClick={onClose}><X size={24} aria-hidden="true" /></button></header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
