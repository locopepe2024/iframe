"use client";

import { useEffect, useRef, useState } from "react";
import { api, API_URL, authenticatedFetch, type AssetLibraryReference } from "@/lib/api";
import { resolveAssetVariantDelivery } from "@/lib/mediaDelivery";
import { createFaceGeometryGuide, type FaceGeometryGuide as Guide } from "@/lib/createFaceGeometryGuide";
import { faceShapeMeasurements, type FaceShape } from "@/lib/whiteFaceShape";
import { createSideFaceGeometryGuide } from "@/lib/createSideFaceGeometryGuide";
import { SIDE_GUIDE_KEYS } from "@/lib/sideFaceGeometryGuide";
import { GUIDE_KEYS } from "@/lib/faceGeometryGuide";
import type { FaceFitSource, FrontReferenceRegion } from "@/lib/whiteFaceImage";

export default function FaceGeometryGuide({ characterName, shape, source, onApplied, editingPending = false, view = "front" }: {
    characterName: string; shape?: FaceShape; source?: FaceFitSource; view?: "front" | "side";
    editingPending?: boolean;
    onApplied: (reference: AssetLibraryReference, shapeKey: string) => void;
}) {
    const region: FrontReferenceRegion = "whole";
    const side = view === "side", label = side ? "侧面" : "正面";
    const supportedKeys = side ? SIDE_GUIDE_KEYS : GUIDE_KEYS;
    const [originalUrl, setOriginalUrl] = useState("");
    const [guideUrl, setGuideUrl] = useState("");
    const [noseUrls, setNoseUrls] = useState<string[]>([]);
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
    const inputKey = `${sourceKey}:${shapeKey}:${region}:${view}:${editingPending}`;
    const measurements = shape ? faceShapeMeasurements(shape) : [];
    const unsupported = measurements.filter(item => item.target !== item.baseline && !supportedKeys.includes(item.key));
    const supported = measurements.some(item => supportedKeys.includes(item.key) && item.target !== item.baseline);
    const currentInput = useRef(inputKey); currentInput.current = inputKey;
    const savedReference = useRef<{ key: string; reference: AssetLibraryReference } | null>(null);

    useEffect(() => {
        const controller = new AbortController(); let objectUrl = "";
        setOriginalUrl(""); setGuide(null); setError(""); setMessage("");
        if (source) void resolveAssetVariantDelivery({ scope: source.scope, containerId: source.containerId,
            assetType: source.assetType || "character", assetId: source.assetId, variantId: source.variantId }).then(async url => {
            if (controller.signal.aborted) return;
            const sameOrigin = new URL(url, window.location.href).origin === new URL(API_URL, window.location.href).origin;
            const response = await (sameOrigin ? authenticatedFetch : fetch)(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`${label}原图加载失败`);
            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) throw new Error(`${label}素材不是图片`);
            if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setOriginalUrl(objectUrl); }
        }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : `${label}原图加载失败`); });
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [sourceKey]);

    useEffect(() => {
        serial.current++; setGuide(null); setReviewed(false); setApplied(false); setBusy(false); setMessage("");
        savedReference.current = null;
    }, [inputKey]);
    useEffect(() => {
        if (!guide) { setGuideUrl(""); setNoseUrls([]); return; }
        const url = URL.createObjectURL(guide.blob); setGuideUrl(url);
        const crops = guide.noseComparison ? [guide.noseComparison.original, guide.noseComparison.guide].map(blob => URL.createObjectURL(blob)) : [];
        setNoseUrls(crops);
        return () => { URL.revokeObjectURL(url); crops.forEach(crop => URL.revokeObjectURL(crop)); };
    }, [guide]);
    useEffect(() => {
        currentInput.current = inputKey;
        return () => { serial.current++; currentInput.current = ""; };
    }, []);

    const preview = async () => {
        if (!shape || !image.current?.naturalWidth || busy || saving || editingPending || !supported) return;
        const request = ++serial.current, key = inputKey;
        setBusy(true); setError(""); setGuide(null); setReviewed(false); setApplied(false); savedReference.current = null;
        try {
            const progress = (text: string) => { if (request === serial.current && currentInput.current === key) setMessage(text); };
            const result = side ? await createSideFaceGeometryGuide(image.current, shape, progress)
                : await createFaceGeometryGuide(image.current, shape, region, progress);
            if (request !== serial.current || currentInput.current !== key) return;
            setGuide(result); setMessage(result.pixelCheckPassed === false ? `${side ? "侧面" : "鼻部"}纹理核对未通过，暂不能应用；请换用纹理清晰的原图或减小幅度。` : result.verified ? `${label}比例复核通过，请检查轮廓和五官是否自然。` : "比例复核未通过，请调整参数或更换参考图后重试。");
        } catch (cause) {
            if (request === serial.current && currentInput.current === key) setError(cause instanceof Error ? cause.message : "制作骨相引导图失败");
        } finally { if (request === serial.current) setBusy(false); }
    };
    const apply = async () => {
        if (!guide?.verified || !reviewed || saving || !shape || !source || editingPending) return;
        const key = inputKey;
        setSaving(true); setError("");
        try {
            let reference = savedReference.current?.key === key ? savedReference.current.reference : undefined;
            if (!reference) {
                const upload = await api.uploadLibraryImage(new File([guide.blob], "face-geometry-guide.png", { type: "image/png" }));
                if (currentInput.current !== key) return;
                const asset = await api.createLibraryAsset("prop", {
                    name: `${characterName} · ${label}骨相引导图`, image_url: upload.image_url, image_origin: "upload",
                    description: JSON.stringify({ schema: "iframe.face-geometry-guide.v1", source, region, view, shape,
                        checks: guide.checks, omitted: guide.omitted, sourceFaceHeight: guide.sourceFaceHeight,
                        verification: { nose: side ? "profile-original-texture-v1" : "original-texture-v1", pixelCheckPassed: guide.pixelCheckPassed, textureChecks: guide.textureChecks } }),
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

    return <section aria-label={`${label}骨相引导图`} className="mt-5 space-y-3 rounded border border-glass-border p-4">
        <h3 className="text-sm font-medium">{label}骨相引导图</h3>
        <p className="text-xs text-text-secondary">{side ? "使用已保存的独立侧脸原图，调整鼻根前突、鼻梁向前隆起、鼻尖突出及上下位置、下巴前突；朝左、朝右均可。" : "使用已保存的骨相参数调整参考脸像素，再用引导图细化头像。支持脸长、颧宽、下颌宽、眼距、鼻梁宽、鼻尖宽、鼻翼宽及鼻尖上下位置。"}</p>
        <p className="text-xs text-text-secondary">{side ? "侧面引导图仅调整当前侧脸轮廓；请使用接近90°、只露一侧眼睛的原图。鼻梁宽、鼻翼宽等正面参数请使用正面引导图。" : "鼻根前突（山根）、鼻梁高度和鼻尖突出度均属于侧面深度，正面引导图暂不处理。调整这些参数请使用下方侧面引导图；鼻尖高度控制上下位置。"}</p>
        {editingPending && <p role="status" className="text-xs text-amber-400">骨相参数尚未保存，请先点击上方“保存骨相参数”，再制作引导图。</p>}
        {unsupported.length > 0 && <p className="text-xs text-amber-400">本次未应用：{unsupported.map(item => item.label).join("、")}。</p>}
        {shape && !supported && <p className="text-xs text-text-muted">当前没有可应用的{label}调整，无法制作新的变形引导图。</p>}
        {!shape ? <p className="text-xs text-text-muted">请先保存骨相参数。</p> : !source ? <p className="text-xs text-text-muted">{side ? "请先上传并保存独立正面与侧脸双图拟合，再制作侧面引导图。" : "请先在头像中选择一张清晰的正面原图，再回到这里制作引导图。"}</p> : <>
            <p className="text-xs text-text-muted">引导图固定使用独立{label}原图，请勿使用拼图、斜侧脸或多人照片。</p>
            <div className="grid gap-3 sm:grid-cols-2">
                <figure>{originalUrl && <img ref={image} src={originalUrl} alt={side ? "骨相引导原始侧脸" : "骨相引导原始头像"} className="max-h-96 w-full rounded object-contain" />}<figcaption className="mt-1 text-xs text-text-muted">原始头像</figcaption></figure>
                {guideUrl && <figure><img src={guideUrl} alt={side ? "局部变形后的侧面骨相引导图" : "局部变形后的骨相引导图"} className="max-h-96 w-full rounded object-contain" /><figcaption className="mt-1 text-xs text-text-muted">局部变形结果 · 未调用图像模型</figcaption></figure>}
            </div>
            {noseUrls.length === 2 && <div aria-label={side ? "侧面同倍率放大对照" : "鼻部同倍率放大对照"} className="grid grid-cols-2 gap-3">
                {noseUrls.map((url, i) => <figure key={i}><img src={url} alt={side ? (i === 0 ? "原始侧面轮廓放大" : "引导图侧面轮廓放大") : (i === 0 ? "原始鼻部放大" : "引导图鼻部放大")} className="w-full rounded object-contain" /><figcaption className="mt-1 text-xs text-text-muted">{side ? (i === 0 ? "原始侧面轮廓" : "变形后侧面轮廓") : (i === 0 ? "原始鼻部" : "变形后鼻部")} · 相同区域与倍率</figcaption></figure>)}
            </div>}
            <button type="button" disabled={!originalUrl || busy || saving || editingPending || !supported} onClick={() => void preview()} className="min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded border border-glass-border px-4 text-xs disabled:opacity-50">{busy ? "正在制作并复核…" : "制作本地引导预览"}</button>
            {guide && <div className="space-y-2 text-xs text-text-secondary">
                <p>原始人脸高约 {Math.round(guide.sourceFaceHeight)} 像素{guide.sourceFaceHeight < 256 ? " · 建议使用人脸高256像素以上的原图" : ""}。各项比例以原图为100，误差须在5%以内；{side ? "鼻根、鼻尖及下巴" : "鼻尖"}位移以原位置为0、原图眼线至下巴为100单位，误差须在1单位以内。</p>
                <p>{side ? "侧面“输出核对”通过原图纹理追踪核实实际二维变形；不把人脸模型的深度估计当作输出证据。" : "鼻部“输出核对”通过原图纹理追踪核实二维变形；“人脸点位估计”仅供参考。"}请通过同倍率放大图确认变化和自然程度。</p>
                <table aria-label={side ? "侧面骨相引导比例复核" : "骨相引导比例复核"} className="w-full text-left"><thead><tr><th>比例</th><th>目标</th><th>输出核对</th><th>人脸点位估计</th></tr></thead><tbody>{guide.checks.map(item => <tr key={item.key}><td>{item.label}</td><td>{item.target.toFixed(2)}</td><td>{item.observed.toFixed(2)}{item.detectorEstimate !== undefined ? "（纹理）" : ""}</td><td>{item.detectorEstimate?.toFixed(2) ?? "—"}</td></tr>)}</tbody></table>
                {guide.omitted.length > 0 && <details><summary className="min-h-9 cursor-pointer">未应用的其他测量目标（{guide.omitted.length}项）</summary><p>{guide.omitted.join("、")}</p></details>}
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={reviewed} disabled={saving || !guide.verified} onChange={event => setReviewed(event.target.checked)} />已检查变形后的轮廓、五官和发际边缘</label>
                <p>应用会保存这张引导图到素材库，替换头像参考图和头像提示词；提交前仍可完整核对。后续细化能否保持比例，需要再检查实际生成结果。</p>
                <button type="button" disabled={!reviewed || !guide.verified || saving || applied || editingPending} onClick={() => void apply()} className="min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded bg-primary px-4 text-white disabled:opacity-50">{saving ? "正在保存引导图…" : applied ? "已应用到头像生成" : "使用引导图细化头像"}</button>
            </div>}
        </>}
        {message && <p role="status" className="text-xs text-text-secondary">{message}</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </section>;
}
