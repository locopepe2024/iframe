"use client";

import { useEffect, useRef, useState } from "react";
import { api, API_URL, authenticatedFetch, type AssetLibraryReference } from "@/lib/api";
import { resolveAssetVariantDelivery } from "@/lib/mediaDelivery";
import { createFaceGeometryGuide, type FaceGeometryGuide as Guide } from "@/lib/createFaceGeometryGuide";
import type { FaceShape } from "@/lib/whiteFaceShape";
import type { FaceFitSource, FrontReferenceRegion } from "@/lib/whiteFaceImage";

export default function FaceGeometryGuide({ characterName, shape, source, onApplied }: {
    characterName: string; shape?: FaceShape; source?: FaceFitSource;
    onApplied: (reference: AssetLibraryReference, shapeKey: string) => void;
}) {
    const [region, setRegion] = useState<FrontReferenceRegion>("whole");
    const [originalUrl, setOriginalUrl] = useState("");
    const [guideUrl, setGuideUrl] = useState("");
    const [guide, setGuide] = useState<Guide | null>(null);
    const [reviewed, setReviewed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [applied, setApplied] = useState(false);
    const serial = useRef(0);
    const image = useRef<HTMLImageElement>(null);
    const shapeKey = JSON.stringify(shape);
    const sourceKey = JSON.stringify(source);
    const inputKey = `${sourceKey}:${shapeKey}:${region}`;
    const currentInput = useRef(inputKey); currentInput.current = inputKey;
    const savedReference = useRef<{ key: string; reference: AssetLibraryReference } | null>(null);

    useEffect(() => {
        const controller = new AbortController(); let objectUrl = "";
        setOriginalUrl(""); setGuide(null); setError(""); setMessage("");
        if (source) void resolveAssetVariantDelivery({ scope: source.scope, containerId: source.containerId,
            assetType: "character", assetId: source.assetId, variantId: source.variantId }).then(async url => {
            if (controller.signal.aborted) return;
            const sameOrigin = new URL(url, window.location.href).origin === new URL(API_URL, window.location.href).origin;
            const response = await (sameOrigin ? authenticatedFetch : fetch)(url, { signal: controller.signal });
            if (!response.ok) throw new Error("正脸原图加载失败");
            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) throw new Error("正脸素材不是图片");
            if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setOriginalUrl(objectUrl); }
        }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "正脸原图加载失败"); });
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [sourceKey]);

    useEffect(() => {
        serial.current++; setGuide(null); setReviewed(false); setApplied(false); setBusy(false); setMessage("");
        savedReference.current = null;
    }, [inputKey]);
    useEffect(() => {
        if (!guide) { setGuideUrl(""); return; }
        const url = URL.createObjectURL(guide.blob); setGuideUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [guide]);
    useEffect(() => {
        currentInput.current = inputKey;
        return () => { serial.current++; currentInput.current = ""; };
    }, []);

    const preview = async () => {
        if (!shape || !image.current?.naturalWidth || busy || saving) return;
        const request = ++serial.current, key = inputKey;
        setBusy(true); setError(""); setGuide(null); setReviewed(false); setApplied(false); savedReference.current = null;
        try {
            const result = await createFaceGeometryGuide(image.current, shape, region, text => {
                if (request === serial.current && currentInput.current === key) setMessage(text);
            });
            if (request !== serial.current || currentInput.current !== key) return;
            setGuide(result); setMessage(result.verified ? "正面比例复核通过，请检查轮廓和五官是否自然。" : "比例复核未通过，请调整参数或更换参考图后重试。");
        } catch (cause) {
            if (request === serial.current && currentInput.current === key) setError(cause instanceof Error ? cause.message : "制作骨相引导图失败");
        } finally { if (request === serial.current) setBusy(false); }
    };
    const apply = async () => {
        if (!guide?.verified || !reviewed || saving || !shape || !source) return;
        const key = inputKey;
        setSaving(true); setError("");
        try {
            let reference = savedReference.current?.key === key ? savedReference.current.reference : undefined;
            if (!reference) {
                const upload = await api.uploadLibraryImage(new File([guide.blob], "face-geometry-guide.png", { type: "image/png" }));
                if (currentInput.current !== key) return;
                const asset = await api.createLibraryAsset("prop", {
                    name: `${characterName} · 正面骨相引导图`, image_url: upload.image_url, image_origin: "upload",
                    description: JSON.stringify({ schema: "iframe.face-geometry-guide.v1", source, region, shape,
                        checks: guide.checks, omitted: guide.omitted, sourceFaceHeight: guide.sourceFaceHeight }),
                });
                const variant = asset.image_asset?.variants?.[0];
                if (!asset.id || !variant?.id) throw new Error("骨相引导图未产生可引用的版本");
                reference = { asset_type: "prop", asset_id: asset.id, variant_id: variant.id, source_scope: "shared", application_mode: "reference_only" };
                savedReference.current = { key, reference };
            }
            if (currentInput.current !== key) return;
            onApplied(reference, shapeKey); setApplied(true);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "应用骨相引导图失败"); }
        finally { setSaving(false); }
    };

    return <section aria-label="正面骨相引导图" className="mt-5 space-y-3 rounded border border-glass-border p-4">
        <h3 className="text-sm font-medium">正面骨相引导图</h3>
        <p className="text-xs text-text-secondary">先调整参考脸的像素，再用引导图细化头像。覆盖脸长、颧宽、下颌宽、眼距及颧部和下颌位置；鼻部深度、眼型和嘴唇等其他参数暂不处理。</p>
        {!shape ? <p className="text-xs text-text-muted">请先保存骨相参数。</p> : !source ? <p className="text-xs text-text-muted">请先在头像中选择一张清晰的正面原图，再回到这里制作引导图。</p> : <>
            <label className="block text-xs text-text-secondary">原图中的正脸区域
                <select aria-label="引导图正脸区域" value={region} disabled={busy || saving} onChange={event => setRegion(event.target.value as FrontReferenceRegion)} className="ml-2 min-h-10 rounded border border-glass-border bg-surface px-2">
                    <option value="whole">整张图（单人正脸）</option><option value="left">左半图</option><option value="right">右半图</option>
                </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
                <figure>{originalUrl && <img ref={image} src={originalUrl} alt="骨相引导原始头像" className="max-h-96 w-full rounded object-contain" />}<figcaption className="mt-1 text-xs text-text-muted">原始头像</figcaption></figure>
                {guideUrl && <figure><img src={guideUrl} alt="局部变形后的骨相引导图" className="max-h-96 w-full rounded object-contain" /><figcaption className="mt-1 text-xs text-text-muted">局部变形结果 · 未调用图像模型</figcaption></figure>}
            </div>
            <button type="button" disabled={!originalUrl || busy || saving} onClick={() => void preview()} className="min-h-11 rounded border border-glass-border px-4 text-xs disabled:opacity-50">{busy ? "正在制作并复核…" : "制作本地引导预览"}</button>
            {guide && <div className="space-y-2 text-xs text-text-secondary">
                <p>原始人脸高约 {Math.round(guide.sourceFaceHeight)} 像素{guide.sourceFaceHeight < 256 ? " · 建议使用人脸高256像素以上的原图" : ""}。以下各项以原图比例为100；复核误差须在5%以内。</p>
                <table aria-label="骨相引导比例复核" className="w-full text-left"><thead><tr><th>比例</th><th>目标</th><th>重新识别</th></tr></thead><tbody>{guide.checks.map(item => <tr key={item.key}><td>{item.label}</td><td>{item.target.toFixed(2)}</td><td>{item.observed.toFixed(2)}</td></tr>)}</tbody></table>
                {guide.omitted.length > 0 && <details><summary className="min-h-9 cursor-pointer">未应用的其他测量目标（{guide.omitted.length}项）</summary><p>{guide.omitted.join("、")}</p></details>}
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={reviewed} disabled={saving || !guide.verified} onChange={event => setReviewed(event.target.checked)} />已检查变形后的轮廓、五官和发际边缘</label>
                <p>应用会保存这张引导图到素材库，替换头像参考图和头像提示词；提交前仍可完整核对。后续细化能否保持比例，需要再检查实际生成结果。</p>
                <button type="button" disabled={!reviewed || !guide.verified || saving || applied} onClick={() => void apply()} className="min-h-11 rounded bg-primary px-4 text-white disabled:opacity-50">{saving ? "正在保存引导图…" : applied ? "已应用到头像生成" : "使用引导图细化头像"}</button>
            </div>}
        </>}
        {message && <p role="status" className="text-xs text-text-secondary">{message}</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </section>;
}
