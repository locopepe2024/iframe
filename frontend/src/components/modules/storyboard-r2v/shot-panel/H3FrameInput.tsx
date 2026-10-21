"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import PreviewImage from "@/components/shared/preview/PreviewImage";

interface Props {
    mode: "i2v" | "f2v";
    lastFrameUrl?: string;
    candidates: string[];
    onChange: (mode: "i2v" | "f2v", lastFrameUrl?: string) => void;
}

export default function H3FrameInput({ mode, lastFrameUrl, candidates, onChange }: Props) {
    const t = useTranslations("storyboardR2V");
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");
    const latest = useRef({ mode, onChange });
    latest.current = { mode, onChange };

    const upload = async (file?: File) => {
        if (!file || uploading) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
            setError(t("frameUploadInvalid"));
            return;
        }
        setUploading(true);
        setError("");
        try {
            const result = await api.uploadFile(file);
            if (!result.url) throw new Error("Missing uploaded image URL");
            latest.current.onChange(latest.current.mode, result.url);
        } catch {
            setError(t("frameUploadFailed"));
        } finally {
            setUploading(false);
        }
    };

    return <div className="space-y-3">
        <div role="group" aria-label={t("frameMode")} className="flex gap-2">
            {(["i2v", "f2v"] as const).map(value => <button key={value} type="button"
                aria-pressed={mode === value} onClick={() => onChange(value, lastFrameUrl)}
                className={`min-h-11 rounded-lg border px-3 text-sm ${mode === value ? "border-primary text-primary" : "border-glass-border text-text-secondary"}`}>
                {t(value === "i2v" ? "firstFrameMode" : "firstLastFrameMode")}
            </button>)}
        </div>
        {mode === "f2v" && <div className="space-y-2">
            <label className="block text-sm text-text-secondary">{t("lastFrame")}
                <select aria-label={t("lastFrame")} value={lastFrameUrl ?? ""}
                    onChange={event => onChange(mode, event.target.value || undefined)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-glass-border bg-surface-inset px-2">
                    <option value="">{t("chooseLastFrame")}</option>
                    {lastFrameUrl && !candidates.includes(lastFrameUrl) && <option value={lastFrameUrl}>{t("uploadedLastFrame")}</option>}
                    {Array.from(new Set(candidates)).map((url, index) => <option key={url} value={url}>{t("frameCandidate", { index: index + 1 })}</option>)}
                </select>
            </label>
            {lastFrameUrl && <div className="h-24 w-40 overflow-hidden rounded-lg"><PreviewImage src={lastFrameUrl} alt={t("lastFrame")} className="h-full w-full object-contain" /></div>}
            <label className="block text-sm text-text-secondary">{t("uploadLastFrame")}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading}
                    aria-label={t("uploadLastFrame")} className="mt-1 block min-h-11 w-full text-xs"
                    onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {uploading && <p role="status" className="text-xs text-text-muted">{t("frameUploading")}</p>}
        </div>}
        <p className="text-xs text-text-muted">{t("frameRatioAutomatic")}</p>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>;
}
