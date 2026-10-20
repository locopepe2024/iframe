"use client";

import type { ReactNode } from "react";

/** Shared interaction order: author controls first, then inspect the result. */
export default function AssetWorkbenchLayout({ controls, preview }: { controls: ReactNode; preview: ReactNode }) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(320px,min(38%,480px))_minmax(0,1fr)] lg:overflow-hidden">
        <div aria-label="参数与提示词" className="relative min-w-0 shrink-0 border-b border-glass-border bg-surface lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            {controls}
        </div>
        <div aria-label="主显示" className="relative flex min-h-[360px] min-w-0 shrink-0 flex-col bg-surface lg:min-h-0 lg:overflow-hidden">
            {preview}
        </div>
    </div>;
}
