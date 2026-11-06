"use client";

import { useEffect, useRef, useState } from "react";
import { api, API_URL, authenticatedFetch } from "@/lib/api";
import { resolveAssetVariantDelivery } from "@/lib/mediaDelivery";
import { autoMarkFacePhoto } from "@/lib/whiteFaceAutoLandmarks";
import { FACE_FIT_MARKS, type FaceFitLandmarks, type FaceFitMark, type FaceFitPoint } from "@/lib/whiteFaceFit";
import type { FacePhotoReference, FacePhotoSource } from "@/lib/whiteFaceImage";

export default function FacePhotoInput({ view, characterName, initial, portrait, points, onChange, onMark, onBusy }: {
    view: "front" | "side"; characterName: string; initial?: FacePhotoReference; portrait?: FacePhotoSource;
    points: Partial<FaceFitLandmarks>; onChange: (reference?: FacePhotoReference, points?: Partial<FaceFitLandmarks>) => void;
    onMark: (key: FaceFitMark, point: FaceFitPoint) => void; onBusy: (busy: boolean) => void;
}) {
    const label = view === "front" ? "正面" : "侧脸";
    const [url, setUrl] = useState("");
    const [crop, setCrop] = useState("");
    const [reference, setReference] = useState<FacePhotoReference>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState<FaceFitMark>();
    const sequence = useRef(0), objectUrl = useRef("");
    const loadedSource = useRef("");
    const callbacks = useRef({ onChange, onMark, onBusy }); callbacks.current = { onChange, onMark, onBusy };
    const replaceUrl = (next: string) => {
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = next; setUrl(next);
    };
    const load = async (source?: FacePhotoSource, file?: File, restoring?: FacePhotoReference) => {
        const request = ++sequence.current;
        const current = () => request === sequence.current;
        setBusy(true); callbacks.current.onBusy(true); if (!restoring) callbacks.current.onChange();
        setError(""); setReference(undefined); setCrop(""); setSelected(undefined); replaceUrl("");
        try {
            let blob: Blob;
            if (file) {
                if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请使用PNG、JPG或WebP静态图片");
                if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过20MB");
                blob = file;
            } else {
                if (!source) throw new Error("参考图来源不可用，请重新上传");
                const delivery = await resolveAssetVariantDelivery({ scope: source.source_scope, containerId: source.source_container_id || "",
                    assetType: source.asset_type, assetId: source.asset_id, variantId: source.variant_id });
                if (!current()) return;
                const sameOrigin = new URL(delivery, window.location.href).origin === new URL(API_URL, window.location.href).origin;
                const response = await (sameOrigin ? authenticatedFetch : fetch)(delivery);
                if (!response.ok) throw new Error("参考原图加载失败，请重试");
                blob = await response.blob();
            }
            if (!current()) return;
            const nextUrl = URL.createObjectURL(blob); replaceUrl(nextUrl);
            const image = new Image(); image.src = nextUrl; await image.decode();
            if (!current()) return;
            const result = await autoMarkFacePhoto(image, view);
            if (!current()) return;
            const { canvas, ...preparation } = result.prepared;
            setCrop(canvas.toDataURL("image/png"));
            let ownedSource = source;
            if (file) {
                const uploaded = await api.uploadLibraryImage(file);
                if (!current()) return;
                const asset = await api.createLibraryAsset("prop", { name: `${characterName} · ${label}拟合原图`,
                    image_url: uploaded.image_url, image_origin: "upload", description: `${label}独立人脸参考原图` });
                if (!current()) return;
                const variant = asset.image_asset?.variants?.[0];
                if (!asset.id || !variant?.id) throw new Error("参考图未产生可引用版本，请重新上传");
                ownedSource = { asset_type: "prop", asset_id: asset.id, variant_id: variant.id, source_scope: "global" };
            }
            if (!ownedSource) throw new Error("参考图来源不可用");
            const next: FacePhotoReference = { source: ownedSource, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
                view, preparation };
            loadedSource.current = JSON.stringify(next.source);
            if (restoring) {
                if (restoring.sourceWidth !== image.naturalWidth || restoring.sourceHeight !== image.naturalHeight) throw new Error("参考原图尺寸与保存记录不一致，请重新拟合");
                setReference(restoring);
            } else { setReference(next); callbacks.current.onChange(next, result.points); }
        } catch (cause) {
            if (current()) { setError(cause instanceof Error ? cause.message : "参考图处理失败"); callbacks.current.onChange(); }
        } finally {
            if (current()) { setBusy(false); callbacks.current.onBusy(false); }
        }
    };
    const initialKey = JSON.stringify(initial?.source);
    useEffect(() => {
        if (initial && loadedSource.current !== JSON.stringify(initial.source)) void load(initial.source, undefined, initial);
        return () => { sequence.current++; callbacks.current.onBusy(false); };
    }, [initialKey]);
    useEffect(() => () => { sequence.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
    const marks = FACE_FIT_MARKS.filter(([key]) => key.startsWith(view));
    return <section aria-label={`${label}参考原图`} className="min-w-0 space-y-2 rounded border border-glass-border p-3">
        <h4 className="text-sm font-medium">{label}照 · 必填</h4>
        <p className="text-xs text-text-secondary">{view === "front" ? "单人平视镜头，双眼、鼻部和下巴完整。" : "单人接近90°侧脸，只露出一侧眼睛，鼻尖与下巴轮廓清楚；朝左、朝右均可。"}</p>
        <label className="block text-xs text-text-secondary">上传{label}照
            <input aria-label={`上传${label}照`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
                className="mt-1 block min-h-11 w-full max-w-full rounded border border-glass-border p-2 text-xs"
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(undefined, file); }} />
        </label>
        {view === "front" && portrait && <button type="button" disabled={busy} onClick={() => void load(portrait)} className="min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded border border-glass-border px-3 text-xs disabled:opacity-50">使用当前头像作为正面照</button>}
        {url && <div className="relative w-full">
            <img src={url} alt={`${characterName}${label}拟合原图`} className="block h-auto w-full rounded" onClick={event => {
                if (!reference || busy || !selected) return;
                const rect = event.currentTarget.getBoundingClientRect();
                callbacks.current.onMark(selected, { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }); setSelected(undefined);
            }} />
            {reference && marks.map(([key, name]) => points[key] ? <span key={key} title={name} className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-lime-300" style={{ left: `${points[key]!.x * 100}%`, top: `${points[key]!.y * 100}%` }} /> : null)}
        </div>}
        {busy && <p role="status" className="text-xs text-text-secondary">正在裁剪、检查{label}并识别点位…</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        {reference && <>
            <p role="status" className="text-xs text-text-secondary">{label}照已通过检查 · 原始脸高约{Math.round(reference.preparation.sourceFaceHeight)}像素{reference.preparation.sourceFaceHeight < 256 ? "；建议使用256像素以上的脸部原图" : ""}</p>
            <details><summary className="min-h-11 cursor-pointer text-xs">查看512×512标准化裁剪和校正点位</summary>
                {crop && <img src={crop} alt={`${label}标准化人脸`} width={512} height={512} className="w-full max-w-64 rounded" />}
                <div className="mt-2 flex flex-wrap gap-2">{marks.map(([key, name]) => <button type="button" key={key} aria-pressed={selected === key} disabled={busy}
                    onClick={() => setSelected(key)} className="min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded border border-glass-border px-2 text-xs aria-pressed:border-primary">{name}</button>)}</div>
                {selected && <p role="status" className="text-xs text-text-secondary">点击上方原图，校正所选点位。</p>}
            </details>
        </>}
    </section>;
}
