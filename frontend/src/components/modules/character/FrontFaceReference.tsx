"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, authenticatedFetch } from "@/lib/api";
import { resolveAssetVariantDelivery } from "@/lib/mediaDelivery";
import { autoMarkFrontReference } from "@/lib/whiteFaceAutoLandmarks";
import { FACE_FIT_MARKS, type FaceFitLandmarks } from "@/lib/whiteFaceFit";
import type { FaceFitSource, FrontFaceReference as Reference, FrontReferenceRegion, PreparedFaceImage } from "@/lib/whiteFaceImage";

export default function FrontFaceReference({ source, region, characterName, points, onReady, onPoints, onPrepared, onBusy, onMark }: {
    source: FaceFitSource;
    region: FrontReferenceRegion;
    characterName: string;
    points: Partial<FaceFitLandmarks>;
    onReady: (reference: Reference) => void;
    onPoints: (points: Partial<FaceFitLandmarks>, reference: Reference) => void;
    onPrepared: (images: PreparedFaceImage[]) => void;
    onBusy: (busy: boolean) => void;
    onMark: (event: React.MouseEvent<HTMLImageElement>) => void;
}) {
    const [url, setUrl] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const generation = useRef(0);
    const callbacks = useRef({ onReady, onPoints, onPrepared, onBusy });
    callbacks.current = { onReady, onPoints, onPrepared, onBusy };

    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = "";
        setUrl("");
        setMessage("");
        resolveAssetVariantDelivery({ scope: source.scope, containerId: source.containerId,
            assetType: "character", assetId: source.assetId, variantId: source.variantId,
        }).then(async sourceUrl => {
            if (controller.signal.aborted) return;
            const sourceOrigin = new URL(sourceUrl, window.location.href).origin;
            const apiOrigin = new URL(API_URL, window.location.href).origin;
            const response = await (sourceOrigin === apiOrigin ? authenticatedFetch : fetch)(sourceUrl, { signal: controller.signal });
            if (!response.ok) throw new Error("正脸原图加载失败");
            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) throw new Error("正脸源素材不是图像");
            if (!controller.signal.aborted) {
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            }
        }).catch(cause => { if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : "正脸原图加载失败"); });
        return () => {
            controller.abort();
            generation.current++;
            callbacks.current.onBusy(false);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [source.scope, source.containerId, source.assetId, source.variantId, region]);

    const referenceFor = (image: HTMLImageElement): Reference => ({
        source: { asset_type: "character", asset_id: source.assetId, variant_id: source.variantId,
            source_scope: source.scope, source_container_id: source.containerId },
        region, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
    });
    const detect = async (image: HTMLImageElement) => {
        const request = ++generation.current;
        const imageSource = image.currentSrc || image.src;
        const current = () => generation.current === request && imageRef.current === image && (image.currentSrc || image.src) === imageSource;
        let reference = referenceFor(image);
        setBusy(true);
        callbacks.current.onBusy(true);
        callbacks.current.onPoints({}, reference);
        setMessage("正在裁剪和识别头像正脸…");
        try {
            const marks = await autoMarkFrontReference(image, { region, onPrepared: images => {
                if (!current()) return;
                callbacks.current.onPrepared(images);
                const { canvas: ignored, ...info } = images[0];
                void ignored;
                reference = { ...reference, preparation: info };
                callbacks.current.onReady(reference);
            } });
            if (!current()) return;
            callbacks.current.onPoints(marks, reference);
            setMessage("已标记头像正脸，请确认使用的是正面，并核对七个点位。");
        } catch (cause) {
            if (current()) setMessage(cause instanceof Error ? cause.message : "正脸识别失败，请手动标记");
        } finally {
            if (current()) {
                setBusy(false);
                callbacks.current.onBusy(false);
            }
        }
    };

    return <div className="space-y-2" aria-label="独立正脸参考">
        <p className="text-xs text-text-secondary">头像正脸 · 请在这张图上标记正面七个点；斜侧脸不能作为正面或正侧面。</p>
        {url ? <div className="max-h-[600px] overflow-auto rounded border border-glass-border">
            <div className="relative w-full min-w-[512px] max-w-[1024px]">
                <img ref={imageRef} src={url} alt={`${characterName}头像正脸拟合参考`} className="block h-auto w-full cursor-crosshair"
                    onLoad={event => {
                        callbacks.current.onReady(referenceFor(event.currentTarget));
                        if (!FACE_FIT_MARKS.filter(([key]) => key.startsWith("front")).every(([key]) => points[key])) void detect(event.currentTarget);
                    }} onClick={onMark} />
                {FACE_FIT_MARKS.filter(([key]) => key.startsWith("front")).map(([key, label]) => {
                    const point = points[key];
                    return point ? <span key={key} title={label} className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-lime-300" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} /> : null;
                })}
            </div>
        </div> : <p className="text-xs text-text-muted">正脸原图加载中</p>}
        {message && <p role="status" className="text-xs text-text-secondary">{message}</p>}
        <button type="button" disabled={busy || !url} onClick={() => { if (imageRef.current) void detect(imageRef.current); }} className="min-h-9 rounded border border-glass-border px-2 text-xs text-foreground disabled:opacity-50">{busy ? "正脸识别中…" : "重新标记正脸"}</button>
    </div>;
}
