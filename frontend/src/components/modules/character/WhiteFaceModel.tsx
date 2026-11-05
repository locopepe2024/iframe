"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Undo2 } from "lucide-react";
import { API_URL, api, authenticatedFetch, type AssetLibraryReference } from "@/lib/api";
import { DEFAULT_FACE_SHAPE, FACE_BASE_PRESETS, SELECTABLE_FACE_PRESETS, faceBaseShape, faceShapePrompt, normalizeFaceShape, type FaceBasePreset, type FaceShape, type FaceShapeNumbers } from "@/lib/whiteFaceShape";
import { FACE_FIT_MARKS, fitFaceToLandmarks, type FaceFitLandmarks, type FaceFitPoint } from "@/lib/whiteFaceFit";
import { autoMarkThreeView } from "@/lib/whiteFaceAutoLandmarks";
import { resolveAssetVariantDelivery } from "@/lib/mediaDelivery";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";

const CONTROL_GROUPS: Array<[string, Array<[keyof FaceShapeNumbers, string, number, number]>]> = [
    ["头部轮廓", [["faceLength", "脸部长度", 80, 120], ["faceWidth", "脸部宽度", 80, 120], ["foreheadWidth", "额头宽度", 80, 120], ["cheekWidth", "颧部宽度", 80, 120], ["jawWidth", "下颌宽度", 75, 125], ["chinWidth", "下巴宽度", 75, 125], ["chinProjection", "下巴前突", 75, 125]]],
    ["鼻部", [["noseBridgeHeight", "鼻梁高度", 75, 125], ["noseBridgeWidth", "鼻梁宽度", 75, 125], ["noseProjection", "鼻尖突出度", 75, 125], ["noseTipWidth", "鼻尖宽度", 75, 125], ["nostrilWidth", "鼻翼宽度", 75, 125]]],
    ["眼眉", [["eyeSpacing", "眼距", 80, 120], ["eyeSize", "眼睛大小", 80, 120], ["eyeDepth", "眼窝深度", 80, 120], ["eyeTilt", "眼尾倾斜", 80, 120], ["browEyeDistance", "眉眼距离", 80, 120]]],
    ["嘴唇与下巴", [["mouthWidth", "嘴宽", 80, 120], ["upperLipThickness", "上唇厚度", 75, 125], ["lowerLipThickness", "下唇厚度", 75, 125], ["philtrumLength", "人中长度", 80, 120], ["mouthCornerTilt", "嘴角倾斜", 80, 120]]],
];

function FaceShell({ shape, data }: { shape: FaceShape; data: WhiteFaceMeshData }) {
    const geometry = useMemo(() => faceShellGeometry(shape, data), [shape, data]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    return <group>
        <mesh geometry={geometry}><meshStandardMaterial color="#e0e4e2" roughness={0.88} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} /></mesh>
        <mesh geometry={geometry}><meshBasicMaterial color="#3d5552" wireframe transparent opacity={0.22} depthWrite={false} /></mesh>
    </group>;
}

function ResponsiveCamera() {
    const { camera, size, invalidate } = useThree();
    useEffect(() => {
        const aspect = size.width / size.height;
        camera.position.z = Math.max(5, 2.1 / (Math.tan(Math.PI / 9) * aspect));
        camera.updateProjectionMatrix();
        invalidate();
    }, [camera, size.width, size.height, invalidate]);
    return null;
}

function Head({ shape, data, side = false, x }: { shape: FaceShape; data: WhiteFaceMeshData; side?: boolean; x: number }) {
    return <group position={[x, 0, 0]} rotation={[0, side ? Math.PI / 2 : 0, 0]}>
        <FaceShell shape={shape} data={data} />
    </group>;
}

function FacePreview({ shape, data }: { shape: FaceShape; data: WhiteFaceMeshData }) {
    return <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [0, 0, 5], fov: 40 }}>
        <ResponsiveCamera />
        <color attach="background" args={["#28302f"]} />
        <ambientLight intensity={1.5} />
        <directionalLight position={[2, 3, 5]} intensity={2} />
        <Head shape={shape} data={data} x={-1.1} />
        <Head shape={shape} data={data} x={1.1} side />
    </Canvas>;
}

type FitSource = {
    scope: "series" | "project";
    containerId: string;
    assetId: string;
    variantId: string;
};

export default function WhiteFaceModel({ characterName, initialShape, fitSource, onSaved, standalone = false }: {
    characterName: string;
    initialShape?: Partial<FaceShape>;
    fitSource?: FitSource;
    onSaved: (reference: AssetLibraryReference, prompt: string, shape: FaceShape) => void;
    standalone?: boolean;
}) {
    const [shape, setShape] = useState<FaceShape>(normalizeFaceShape(initialShape));
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [meshData, setMeshData] = useState<WhiteFaceMeshData | null>(null);
    const [fitImageUrl, setFitImageUrl] = useState("");
    const [fitPoints, setFitPoints] = useState<Partial<FaceFitLandmarks>>({});
    const [fitReviewed, setFitReviewed] = useState(false);
    const [detecting, setDetecting] = useState(false);
    const [selectedMark, setSelectedMark] = useState<keyof FaceFitLandmarks | null>(null);
    const [autoMarkMessage, setAutoMarkMessage] = useState("");
    const stageRef = useRef<HTMLDivElement>(null);
    const fitImageRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        setShape(normalizeFaceShape(initialShape));
        setFitPoints(fitSource && initialShape?.calibration?.source.asset_id === fitSource.assetId
            && initialShape.calibration.source.variant_id === fitSource.variantId
            ? initialShape?.calibration?.landmarks as Partial<FaceFitLandmarks> : {});
        setFitReviewed(!!(fitSource && initialShape?.calibration?.source.asset_id === fitSource.assetId
            && initialShape.calibration.source.variant_id === fitSource.variantId && initialShape.calibration.reviewed));
    }, [initialShape, fitSource?.assetId, fitSource?.variantId]);

    useEffect(() => {
        if (!open || !fitSource) return;
        const controller = new AbortController();
        let objectUrl = "";
        setFitImageUrl("");
        setDetecting(false);
        setAutoMarkMessage("");
        resolveAssetVariantDelivery({
            scope: fitSource.scope, containerId: fitSource.containerId,
            assetType: "character", assetId: fitSource.assetId, variantId: fitSource.variantId,
        }).then(async sourceUrl => {
                if (controller.signal.aborted) return;
                const sourceOrigin = new URL(sourceUrl, window.location.href).origin;
                const apiOrigin = new URL(API_URL, window.location.href).origin;
                const response = await (sourceOrigin === apiOrigin ? authenticatedFetch : fetch)(sourceUrl, { signal: controller.signal });
                if (!response.ok) throw new Error("三视图加载失败");
                const blob = await response.blob();
                if (!blob.type.startsWith("image/")) throw new Error("三视图源素材不是图像");
                if (!controller.signal.aborted) {
                    objectUrl = URL.createObjectURL(blob);
                    setFitImageUrl(objectUrl);
                }
            })
            .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "三视图加载失败"); });
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [open, fitSource?.scope, fitSource?.containerId, fitSource?.assetId, fitSource?.variantId]);

    useEffect(() => {
        if (!open || meshData) return;
        const controller = new AbortController();
        fetch("/models/character/makehuman-face-v1/head.json", { signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error("面部白模加载失败");
                return response.json() as Promise<WhiteFaceMeshData>;
            })
            .then(data => {
                if (data.schema !== "makehuman-head.v1") throw new Error("面部白模格式无效");
                setMeshData(data);
            })
            .catch(cause => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "面部白模加载失败");
            });
        return () => controller.abort();
    }, [open, meshData]);

    const nextMark = FACE_FIT_MARKS.find(([key]) => !fitPoints[key]);
    const markedCount = FACE_FIT_MARKS.filter(([key]) => !!fitPoints[key]).length;
    const detect = async (image: HTMLImageElement) => {
        const imageSource = image.currentSrc || image.src;
        setDetecting(true);
        setAutoMarkMessage("正在识别人脸标记…");
        try {
            const points = await autoMarkThreeView(image);
            if (fitImageRef.current !== image || (image.currentSrc || image.src) !== imageSource) return;
            setFitPoints(points);
            setSelectedMark(null);
            setFitReviewed(false);
            setAutoMarkMessage(points.frontLeftCheek && points.sideEye
                ? "已自动标记正面和侧面，请核对点位；点击标记名称可重新定位。"
                : points.frontLeftCheek ? "已自动标记正面，请手动补齐侧面点位。" : "已自动标记侧面，请手动补齐正面点位。");
            setError("");
        } catch (cause) {
            if (fitImageRef.current === image && (image.currentSrc || image.src) === imageSource) setAutoMarkMessage(cause instanceof Error ? cause.message : "自动标记失败，请手动标记");
        } finally {
            if (fitImageRef.current === image && (image.currentSrc || image.src) === imageSource) setDetecting(false);
        }
    };
    const markImage = (event: React.MouseEvent<HTMLImageElement>) => {
        if (detecting) return;
        const mark = selectedMark || nextMark?.[0];
        if (!mark) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const point: FaceFitPoint = {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        };
        setFitPoints(current => ({ ...current, [mark]: point }));
        setSelectedMark(null);
        setFitReviewed(false);
        setError("");
    };

    const fit = () => {
        if (!fitImageUrl || !fitImageRef.current || !fitSource) { setError("三视图尚未加载完成。"); return; }
        if (!meshData) { setError("面部白模尚未加载完成。"); return; }
        if (nextMark) { setError(`请先在三视图上标记 ${nextMark[1]}（${markedCount + 1}/${FACE_FIT_MARKS.length}）。`); return; }
        try {
            const image = fitImageRef.current;
            const { shape: baselineShape, residual } = fitFaceToLandmarks(
                fitPoints as FaceFitLandmarks, meshData, shape.basePreset, image.naturalWidth / image.naturalHeight,
            );
            const { basePreset, calibration: ignored, ...baseline } = baselineShape;
            void ignored;
            setShape({ ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
                schema: "iframe.white-face-fit.v1",
                source: { asset_type: "character", asset_id: fitSource.assetId, variant_id: fitSource.variantId,
                    source_scope: fitSource.scope, source_container_id: fitSource.containerId },
                baseline, landmarks: fitPoints as FaceFitLandmarks, residual,
            } });
            setFitReviewed(false);
            setError("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "三视图拟合失败");
        }
    };

    const save = async () => {
        if (shape.calibration && (!fitSource || shape.calibration.source.asset_id !== fitSource.assetId
            || shape.calibration.source.variant_id !== fitSource.variantId || !fitReviewed)) {
            setError("骨相基准的三视图已变更，请重新拟合并核对。");
            return;
        }
        const canvas = stageRef.current?.querySelector("canvas");
        if (!canvas) { setError("白模预览尚未就绪"); return; }
        setSaving(true);
        setError("");
        try {
            const savedShape = shape.calibration ? { ...shape, calibration: { ...shape.calibration, reviewed: fitReviewed } } : shape;
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("无法导出白模图")), "image/png"));
            const uploaded = await api.uploadLibraryImage(new File([blob], "white-face-reference.png", { type: "image/png" }));
            const asset = await api.createLibraryAsset("prop", {
                name: `${characterName} · 面部比例白模`,
                description: faceShapePrompt(savedShape),
                image_url: uploaded.image_url,
                image_origin: "upload",
            });
            const variant = asset.image_asset?.variants?.[0];
            if (!asset.id || !variant?.id) throw new Error("白模图没有产生可引用的资产版本");
            setShape(savedShape);
            onSaved({ asset_type: "prop", asset_id: asset.id, variant_id: variant.id, application_mode: "reference_only", applied_fields: ["face_geometry"] }, faceShapePrompt(savedShape), savedShape);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存白模参考失败");
        } finally {
            setSaving(false);
        }
    };

    return <section aria-label="面部比例白模" className={`space-y-3 rounded border border-glass-border ${standalone ? "p-5 lg:p-6" : "p-3"}`}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="min-h-10 w-full text-left text-xs font-medium text-foreground">面部比例白模</button>
        {open && <>
        <label className="block text-xs text-text-secondary">基础脸型
            <select aria-label="基础脸型" value={shape.basePreset} onChange={event => {
                const preset = event.target.value as FaceBasePreset;
                setShape(faceBaseShape(preset));
                setFitPoints({});
            }} className="mt-1 min-h-9 w-full rounded border border-glass-border bg-surface px-2 text-xs text-foreground">
                {(shape.basePreset === "middle_aged" ? [...SELECTABLE_FACE_PRESETS, "middle_aged" as const] : SELECTABLE_FACE_PRESETS)
                    .map(key => <option key={key} value={key}>{FACE_BASE_PRESETS[key].label}</option>)}
            </select>
        </label>
        {fitSource && <div className="space-y-2">
            <div className="text-xs text-text-secondary">拟合参考 · 三视图</div>
            <p className="text-xs text-text-secondary">自动标记后请核对正面与侧面点位。可选择标记名称，再点击图像校正位置。</p>
            {fitImageUrl ? <div className="max-h-[600px] w-full overflow-auto rounded border border-glass-border">
                <div className="relative w-full min-w-[760px] max-w-[1223px]">
                <img ref={fitImageRef} src={fitImageUrl} alt={`${characterName}三视图拟合参考`} className="block h-auto w-full cursor-crosshair" onLoad={event => {
                    if (!Object.keys(fitPoints).length) void detect(event.currentTarget);
                }} onClick={markImage} />
                {FACE_FIT_MARKS.map(([key, label]) => {
                    const point = fitPoints[key];
                    return point ? <span key={key} title={label} className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-lime-300" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} /> : null;
                })}
                </div>
            </div> : <div className="text-xs text-text-muted">三视图加载中</div>}
            {autoMarkMessage && <p role="status" className="text-xs text-text-secondary">{autoMarkMessage}</p>}
            <div className="flex flex-wrap gap-1">
                {FACE_FIT_MARKS.map(([key, label]) => <button key={key} type="button" aria-pressed={selectedMark === key}
                    onClick={() => setSelectedMark(key)} className={`min-h-8 rounded border px-2 text-xs ${selectedMark === key ? "border-lime-300 text-lime-200" : "border-glass-border text-text-secondary"}`}>
                    {fitPoints[key] ? "✓ " : "○ "}{label}
                </button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <span role="status">{nextMark ? `已标记 ${markedCount}/${FACE_FIT_MARKS.length} · 下一点：${nextMark[1]}` : `已标记 ${FACE_FIT_MARKS.length}/${FACE_FIT_MARKS.length} · 可以拟合`}</span>
                <button type="button" title="撤回上一个标记" aria-label="撤回上一个标记" disabled={Object.keys(fitPoints).length === 0} onClick={() => setFitPoints(current => {
                    const last = [...FACE_FIT_MARKS].reverse().find(([key]) => current[key]);
                    if (!last) return current;
                    const next = { ...current }; delete next[last[0]]; return next;
                })} className="flex size-9 items-center justify-center rounded border border-glass-border text-foreground disabled:opacity-50"><Undo2 size={15} /></button>
                <button type="button" onClick={() => { setFitPoints({}); setError(""); }} className="min-h-9 rounded border border-glass-border px-2 text-foreground">重置标记</button>
                <button type="button" disabled={detecting || !fitImageUrl} onClick={() => { if (fitImageRef.current) void detect(fitImageRef.current); }} className="min-h-9 rounded border border-glass-border px-2 text-foreground disabled:opacity-50">{detecting ? "识别中…" : "重新自动标记"}</button>
                <button type="button" onClick={fit} className="min-h-9 rounded border border-glass-border px-2 text-foreground hover:bg-hover-bg">拟合白模</button>
            </div>
            {shape.calibration?.source.variant_id === fitSource.variantId &&
                <div className="space-y-1 text-xs text-text-secondary">
                    <div>拟合初稿 · 归一化残差 {shape.calibration.residual.toFixed(3)} · 当前滑杆以此脸型为 100%</div>
                    {shape.calibration.residual > 0.15 && <div role="status" className="text-amber-300">拟合偏差较大，请检查标记点和白模轮廓。</div>}
                    <label className="flex items-center gap-2"><input type="checkbox" checked={fitReviewed} onChange={event => setFitReviewed(event.target.checked)} />已核对正面与侧面白模</label>
                </div>}
        </div>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
                <div className="mb-1 text-xs text-text-secondary">{shape.calibration ? "三视图基准" : "基础脸型"} · 正面 / 侧面</div>
                <div className="aspect-[2/1] w-full overflow-hidden rounded bg-[#28302f]" aria-label="基础脸型正面与侧面预览">
                    {meshData ? <FacePreview shape={shape.calibration ? { ...DEFAULT_FACE_SHAPE, basePreset: shape.basePreset, calibration: shape.calibration } : faceBaseShape(shape.basePreset)} data={meshData} /> : null}
                </div>
            </div>
            <div className="min-w-0">
                <div className="mb-1 text-xs text-text-secondary">当前调整 · 正面 / 侧面</div>
                <div ref={stageRef} className="aspect-[2/1] w-full overflow-hidden rounded bg-[#28302f]" aria-label="当前调整正面与侧面预览">
                    {meshData ? <FacePreview shape={shape} data={meshData} /> : null}
                </div>
            </div>
        </div>
        <div className="space-y-2">
            {CONTROL_GROUPS.map(([group, controls]) => <details key={group} open={group === "头部轮廓"} className="rounded border border-glass-border/60 p-2">
                <summary className="cursor-pointer text-xs font-medium text-text-secondary">{group}</summary>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {controls.map(([key, label, min, max]) => <label key={key} className="text-xs text-text-secondary">
                        <span className="flex justify-between"><span>{label}</span><span>{shape[key]}%</span></span>
                        <input aria-label={label} type="range" min={shape.calibration ? Math.max(min, 90) : min} max={shape.calibration ? Math.min(max, 110) : max} value={shape[key]} onChange={event => { setShape(current => ({ ...current, [key]: Number(event.target.value) })); setFitReviewed(false); }} className="w-full" />
                    </label>)}
                </div>
            </details>)}
        </div>
        <button type="button" disabled={saving || !meshData || !!(shape.calibration && (!fitReviewed || !fitSource || shape.calibration.source.asset_id !== fitSource.assetId || shape.calibration.source.variant_id !== fitSource.variantId))} onClick={() => void save()} className="min-h-10 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">{saving ? "保存中…" : "保存骨相参数"}</button>
        {shape.calibration && (!fitSource || shape.calibration.source.asset_id !== fitSource.assetId || shape.calibration.source.variant_id !== fitSource.variantId) &&
            <p role="status" className="text-xs text-amber-300">骨相基准的三视图已变更，请重新拟合。</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </>}
    </section>;
}
