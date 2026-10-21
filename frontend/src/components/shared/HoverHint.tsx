"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Portals keep contextual help readable inside scrolling panels. */
export default function HoverHint({ text, children, className = "", focusable = false }: {
    text: string;
    children: ReactNode;
    className?: string;
    focusable?: boolean;
}) {
    const id = useId();
    const anchor = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
    const open = position !== null;
    useEffect(() => {
        if (!open) return;
        const dismiss = () => setPosition(null);
        window.addEventListener("scroll", dismiss, true);
        window.addEventListener("resize", dismiss);
        return () => {
            window.removeEventListener("scroll", dismiss, true);
            window.removeEventListener("resize", dismiss);
        };
    }, [open]);
    const show = () => {
        const rect = anchor.current?.getBoundingClientRect();
        if (!rect) return;
        const above = rect.bottom > window.innerHeight - 180;
        setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(320, window.innerWidth - 24) - 12)), top: above ? rect.top - 8 : rect.bottom + 8, above });
    };
    return <div ref={anchor} className={className} tabIndex={focusable ? 0 : undefined}
        aria-describedby={position ? id : undefined}
        onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null); }}
        onKeyDown={event => { if (event.key === "Escape") setPosition(null); }}>
        {children}
        {position && createPortal(<span id={id} role="tooltip" className="pointer-events-none fixed z-[10000] w-80 max-w-[calc(100vw-24px)] whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-xs font-normal leading-5 text-foreground shadow-xl"
            style={{ left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined }}>{text}</span>, document.body)}
    </div>;
}
