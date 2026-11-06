"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Undo2 } from "lucide-react";
import { API_URL, api, authenticatedFetch, type AssetLibraryReference } from "@/lib/api";
import { DEFAULT_FACE_SHAPE, FACE_BASE_PRESETS, SELECTABLE_FACE_PRESETS, faceBaseShape, faceShapePrompt, normalizeFaceShape, type FaceBasePreset, type FaceShape, type FaceShapeNumbers } from "@/lib/whiteFaceShape";
import { FACE_FIT_MARKS, FACE_FIT_LANDMARK_CONVENTION, FACE_FIT_OBJECTIVE, FIT_METRIC_LABELS, fitFaceToLandmarks, type FaceFitLandmarks, type FaceFitPoint } from "@/lib/whiteFaceFit";
import { autoMarkThreeView } from "@/lib/whiteFaceAutoLandmarks";
import { FACE_FIT_IMAGE_SPEC, type FaceImagePreparation, type PreparedFaceInfo, type FaceFitSource, type FrontFaceReference as FrontReference, type FrontReferenceRegion } from "@/lib/whiteFaceImage";
import { resolveAssetVariantDelivery } from "@/lib/mediaDelivery";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";
import FrontFaceReference from "./FrontFaceReference";

const CONTROL_GROUPS: Array<[string, Array<[keyof FaceShapeNumbers, string, number, number]>]> = [
    ["头部轮廓", [["faceLength", "脸部长度", 80, 120], ["faceWidth", "脸部宽度", 80, 120], ["foreheadWidth", "额头宽度", 80, 120], ["cheekWidth", "颧部宽度", 80, 120], ["cheekHeight", "颧部高度", 75, 125], ["jawWidth", "下颌宽度", 75, 125], ["jawHeight", "下颌高度", 75, 125], ["chinWidth", "下巴宽度", 75, 125], ["chinProjection", "下巴前突", 75, 125]]],
    ["鼻部", [["noseBridgeHeight", "鼻梁高度", 75, 125], ["noseBridgeWidth", "鼻梁宽度", 75, 125], ["noseProjection", "鼻尖突出度", 75, 125], ["noseTipHeight", "鼻尖高度", 75, 125], ["noseTipWidth", "鼻尖宽度", 75, 125], ["nostrilWidth", "鼻翼宽度", 75, 125]]],
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

function NoseCamera({ side }: { side: boolean }) {
    const { camera, size, invalidate } = useThree();
    useEffect(() => {
        const x = side ? 0.85 : 0;
        const z = side ? 0 : 0.6;
        const distance = Math.max(2, 0.35 / (Math.tan(Math.PI / 18) * (size.width / size.height)));
        camera.position.set(x, -0.18, z + distance);
        camera.lookAt(x, -0.18, z);
        camera.updateProjectionMatrix();
        invalidate();
    }, [camera, side, size.width, size.height, invalidate]);
    return null;
}

function NosePreview({ shape, data, side }: { shape: FaceShape; data: WhiteFaceMeshData; side: boolean }) {
    return <Canvas frameloop="demand" camera={{ position: [0, 0, 3], fov: 20 }}>
        <NoseCamera side={side} />
        <color attach="background" args={["#28302f"]} />
        <ambientLight intensity={1.5} />
        <directionalLight position={[2, 3, 5]} intensity={2} />
        <Head shape={shape} data={data} x={0} side={side} />
    </Canvas>;
}

function matchesSource(stored: NonNullable<FaceShape["calibration"]>["source"] | undefined, source: FaceFitSource | undefined): boolean {
    return !!(stored && source && stored.asset_id === source.assetId && stored.variant_id === source.variantId
        && (!stored.source_scope || stored.source_scope === source.scope)
        && (!stored.source_container_id || stored.source_container_id === source.containerId));
}

export default function WhiteFaceModel({ characterName, initialShape, fitSource, portraitSource, onSaved, standalone = false }: {
    characterName: string;
    initialShape?: Partial<FaceShape>;
    fitSource?: FaceFitSource;
    portraitSource?: FaceFitSource;
    onSaved: (reference: AssetLibraryReference, prompt: string, shape: FaceShape) => void | Promise<void>;
    standalone?: boolean;
}) {
    const [shape, setShape] = useState<FaceShape>(normalizeFaceShape(initialShape));
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedShape, setSavedShape] = useState<string>("");
    const [showNose, setShowNose] = useState(false);
    const [error, setError] = useState("");
    const [meshData, setMeshData] = useState<WhiteFaceMeshData | null>(null);
    const [fitImageUrl, setFitImageUrl] = useState("");
    const [fitPoints, setFitPoints] = useState<Partial<FaceFitLandmarks>>({});
    const [fitReviewed, setFitReviewed] = useState(false);
    const [sheetDetecting, setSheetDetecting] = useState(false);
    const [portraitDetecting, setPortraitDetecting] = useState(false);
    const detecting = sheetDetecting || portraitDetecting;
    const [usePortrait, setUsePortrait] = useState(!!initialShape?.calibration?.frontReference);
    const [frontRegion, setFrontRegion] = useState<FrontReferenceRegion>(initialShape?.calibration?.frontReference?.region || "whole");
    const [frontReference, setFrontReference] = useState<FrontReference>();
    const [selectedMark, setSelectedMark] = useState<keyof FaceFitLandmarks | null>(null);
    const [autoMarkMessage, setAutoMarkMessage] = useState("");
    const [preparedFaces, setPreparedFaces] = useState<Array<PreparedFaceInfo & { preview: string }>>([]);
    const [imagePreparation, setImagePreparation] = useState<FaceImagePreparation>();
    const stageRef = useRef<HTMLDivElement>(null);
    const fitImageRef = useRef<HTMLImageElement>(null);
    const sheetGeneration = useRef(0);
    const sourceKey = JSON.stringify([fitSource?.scope, fitSource?.containerId, fitSource?.assetId, fitSource?.variantId,
        portraitSource?.scope, portraitSource?.containerId, portraitSource?.assetId, portraitSource?.variantId]);
    const previousSourceKey = useRef(sourceKey);

    useEffect(() => {
        setShape(normalizeFaceShape(initialShape));
        const front = initialShape?.calibration?.frontReference;
        setUsePortrait(!!front);
        setFrontRegion(front?.region || "whole");
        setFrontReference(front && matchesSource(front.source, portraitSource) ? front : undefined);
        const sourcesMatch = matchesSource(initialShape?.calibration?.source, fitSource)
            && (!front || matchesSource(front.source, portraitSource));
        setFitPoints(sourcesMatch && initialShape?.calibration?.landmarkConvention === FACE_FIT_LANDMARK_CONVENTION
            ? initialShape?.calibration?.landmarks as Partial<FaceFitLandmarks> : {});
        setFitReviewed(!!(sourcesMatch && initialShape?.calibration?.landmarkConvention === FACE_FIT_LANDMARK_CONVENTION
            && initialShape.calibration.fitObjective === FACE_FIT_OBJECTIVE
            && initialShape.calibration.reviewed));
    }, [initialShape]);

    const clearReferences = () => {
        sheetGeneration.current++;
        setSheetDetecting(false);
        setFitPoints({});
        setFitReviewed(false);
        setSelectedMark(null);
        setPreparedFaces([]);
        setImagePreparation(undefined);
        setFrontReference(undefined);
        setAutoMarkMessage("");
    };
    useEffect(() => {
        if (previousSourceKey.current !== sourceKey) {
            previousSourceKey.current = sourceKey;
            clearReferences();
        }
    }, [sourceKey]);

    useEffect(() => {
        if (!open || !fitSource) return;
        const controller = new AbortController();
        let objectUrl = "";
        setFitImageUrl("");
        sheetGeneration.current++;
        setSheetDetecting(false);
        setAutoMarkMessage("");
        setPreparedFaces([]);
        setImagePreparation(undefined);
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
        return () => { controller.abort(); sheetGeneration.current++; if (objectUrl) URL.revokeObjectURL(objectUrl); };
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
    const calibrationCurrent = !!(shape.calibration && fitSource
        && shape.calibration.landmarkConvention === FACE_FIT_LANDMARK_CONVENTION
        && shape.calibration.fitObjective === FACE_FIT_OBJECTIVE
        && matchesSource(shape.calibration.source, fitSource)
        && (usePortrait ? !!(frontReference && matchesSource(frontReference.source, portraitSource)
            && frontReference.region === frontRegion && matchesSource(shape.calibration.frontReference?.source, portraitSource)
            && shape.calibration.frontReference?.region === frontRegion
            && shape.calibration.frontReference.sourceWidth === frontReference.sourceWidth
            && shape.calibration.frontReference.sourceHeight === frontReference.sourceHeight)
            : !shape.calibration.frontReference)
        && FACE_FIT_MARKS.every(([key]) => fitPoints[key]
            && fitPoints[key]?.x === shape.calibration?.landmarks[key]?.x
            && fitPoints[key]?.y === shape.calibration?.landmarks[key]?.y));
    const detect = async (image: HTMLImageElement) => {
        const request = ++sheetGeneration.current;
        const imageSource = image.currentSrc || image.src;
        const current = () => sheetGeneration.current === request && fitImageRef.current === image && (image.currentSrc || image.src) === imageSource;
        setSheetDetecting(true);
        setFitPoints(points => usePortrait ? Object.fromEntries(Object.entries(points).filter(([key]) => key.startsWith("front"))) : {});
        setFitReviewed(false);
        setPreparedFaces(faces => usePortrait ? faces.filter(face => face.view === "front") : []);
        setImagePreparation(undefined);
        setAutoMarkMessage("正在裁剪和标准化人脸，再识别标记…");
        try {
            const points = await autoMarkThreeView(image, { onPrepared: images => {
                if (!current()) return;
                const previews = images.map(({ canvas, ...info }) => ({ ...info, preview: canvas.toDataURL("image/png") }));
                setPreparedFaces(faces => [...(usePortrait ? faces.filter(face => face.view === "front") : []), ...previews]);
                setImagePreparation({
                    version: FACE_FIT_IMAGE_SPEC.version, size: FACE_FIT_IMAGE_SPEC.size,
                    sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight,
                    views: images.map(({ canvas: ignored, ...info }) => { void ignored; return info; }),
                });
            }, ...(usePortrait ? { views: ["side"] as const } : {}) });
            if (!current()) return;
            setFitPoints(existing => ({ ...(usePortrait ? existing : {}), ...points }));
            setSelectedMark(null);
            setFitReviewed(false);
            setAutoMarkMessage(usePortrait ? "侧面点位来自三视图；正面点位请在头像原图核对。" : points.frontLeftCheek && points.sideEye
                ? "已自动标记正面和侧面，请核对点位；点击标记名称可重新定位。"
                : points.frontLeftCheek ? "已自动标记正面，请手动补齐侧面点位。" : "已自动标记侧面，请手动补齐正面点位。");
            setError("");
        } catch (cause) {
            if (current()) setAutoMarkMessage(cause instanceof Error ? cause.message : "自动标记失败，请手动标记");
        } finally {
            if (current()) setSheetDetecting(false);
        }
    };
    const markImage = (event: React.MouseEvent<HTMLImageElement>, view?: "front" | "side") => {
        if (detecting) return;
        const mark = selectedMark || FACE_FIT_MARKS.find(([key]) => !fitPoints[key] && (!view || key.startsWith(view)))?.[0];
        if (!mark) return;
        if (view && !mark.startsWith(view)) { setError(`请在${view === "front" ? "三视图" : "头像正脸图"}上标记所选点位。`); return; }
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

    useEffect(() => {
        const image = fitImageRef.current;
        if (open && image?.naturalWidth && !Object.keys(fitPoints).length) void detect(image);
    }, [usePortrait, frontRegion]);

    const fit = () => {
        if (detecting) return;
        if (!fitImageUrl || !fitImageRef.current || !fitSource) { setError("三视图尚未加载完成。"); return; }
        if (usePortrait && (!frontReference || !matchesSource(frontReference.source, portraitSource)
            || frontReference.region !== frontRegion)) { setError("头像正脸原图尚未加载完成。"); return; }
        if (!meshData) { setError("面部白模尚未加载完成。"); return; }
        if (nextMark) { setError(`请先在三视图上标记 ${nextMark[1]}（${markedCount + 1}/${FACE_FIT_MARKS.length}）。`); return; }
        try {
            const image = fitImageRef.current;
            const { shape: baselineShape, residual, diagnostics } = fitFaceToLandmarks(
                fitPoints as FaceFitLandmarks, meshData, shape.basePreset, usePortrait && frontReference
                    ? { front: frontReference.sourceWidth / frontReference.sourceHeight, side: image.naturalWidth / image.naturalHeight }
                    : image.naturalWidth / image.naturalHeight,
            );
            const { basePreset, calibration: ignored, ...baseline } = baselineShape;
            void ignored;
            setShape({ ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
                schema: "iframe.white-face-fit.v1",
                landmarkConvention: FACE_FIT_LANDMARK_CONVENTION,
                fitObjective: FACE_FIT_OBJECTIVE,
                fitDiagnostics: diagnostics,
                imagePreparation,
                ...(usePortrait ? { frontReference } : {}),
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
        if (detecting || (usePortrait && !shape.calibration) || (shape.calibration && (!calibrationCurrent || !fitReviewed))) {
            setError("骨相基准或标记点已变更，请重新拟合并核对。");
            return;
        }
        const canvas = stageRef.current?.querySelector("canvas");
        if (!canvas) { setError("白模预览尚未就绪"); return; }
        setSaving(true);
        setSavedShape("");
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
            await onSaved({ asset_type: "prop", asset_id: asset.id, variant_id: variant.id, application_mode: "reference_only", applied_fields: ["face_geometry"] }, faceShapePrompt(savedShape), savedShape);
            setShape(savedShape);
            setSavedShape(JSON.stringify(savedShape));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存白模参考失败");
        } finally {
            setSaving(false);
        }
    };

    return <section aria-label="面部比例白模" className={`space-y-3 rounded border border-glass-border ${standalone ? "p-5 lg:p-6" : "p-3"}`}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="min-h-10 w-full text-left text-xs font-medium text-foreground">面部比例白模</button>
        {open && <fieldset disabled={saving} className="space-y-3">
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
            <div className="text-xs text-text-secondary">拟合参考 · {usePortrait ? "头像正脸 + 三视图侧面" : "三视图"}</div>
            {(portraitSource || usePortrait) && <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
                <label>正面参考
                    <select aria-label="正面参考" value={usePortrait ? "portrait" : "sheet"} onChange={event => {
                        clearReferences(); setUsePortrait(event.target.value === "portrait"); setError("");
                    }} className="ml-2 min-h-9 rounded border border-glass-border bg-surface px-2">
                        <option value="sheet">三视图正面</option>
                        <option value="portrait" disabled={!portraitSource}>当前选中头像</option>
                    </select>
                </label>
                {usePortrait && <label>正脸所在区域
                    <select aria-label="正脸所在区域" value={frontRegion} onChange={event => {
                        clearReferences(); setFrontRegion(event.target.value as FrontReferenceRegion); setError("");
                    }} className="ml-2 min-h-9 rounded border border-glass-border bg-surface px-2">
                        <option value="whole">整张图（单张正脸）</option>
                        <option value="left">左半图</option>
                        <option value="right">右半图</option>
                    </select>
                </label>}
            </div>}
            {usePortrait && (portraitSource ? <FrontFaceReference key={`${sourceKey}:${frontRegion}`} source={portraitSource}
                region={frontRegion} characterName={characterName} points={fitPoints} onReady={setFrontReference}
                onBusy={setPortraitDetecting} onMark={event => markImage(event, "front")}
                onPoints={(points, reference) => {
                    setFitPoints(existing => ({ ...Object.fromEntries(Object.entries(existing).filter(([key]) => !key.startsWith("front"))), ...points }));
                    setFrontReference(reference); setFitReviewed(false);
                    if (!Object.keys(points).length) setPreparedFaces(faces => faces.filter(face => face.view !== "front"));
                }} onPrepared={images => setPreparedFaces(faces => [...faces.filter(face => face.view !== "front"),
                    ...images.map(({ canvas, ...info }) => ({ ...info, preview: canvas.toDataURL("image/png") }))])}
            /> : <p role="status" className="text-xs text-amber-300">已保存的头像来源不可用，请重新选择正面参考并拟合。</p>)}
            <p className="text-xs text-text-secondary">自动标记后请核对正面与侧面点位。可选择标记名称，再点击图像校正位置。</p>
            <p className="text-xs text-text-muted">眼中心取内外眼角中点；侧面下巴取前端，正面下巴取最低点。</p>
            <details className="text-xs text-text-secondary">
                <summary className="cursor-pointer">人脸参考图规范 · 先处理，再拟合</summary>
                <p className="mt-1">三视图按正面、侧面、背面从左到右排列。使用同一角色的清晰正脸和正侧脸，保持自然表情、头部水平，露出眼睛、鼻尖和下巴。</p>
                <p className="mt-1">推荐提供头部三视图 3072 × 1024，每个视图 1024 × 1024。现有全身三视图也可处理，以原始人脸清晰度为准。</p>
                <p className="mt-1">原图中每张脸从额头到下巴建议至少 {FACE_FIT_IMAGE_SPEC.recommendedFaceHeight} 像素。系统裁出人脸并保留边距，等比缩放为 {FACE_FIT_IMAGE_SPEC.size} × {FACE_FIT_IMAGE_SPEC.size}；放大不会增加原图细节。</p>
            </details>
            {preparedFaces.length > 0 && <div className="grid grid-cols-2 gap-2" aria-label="标准化人脸预览">
                {preparedFaces.map(face => <div key={face.view} className="min-w-0 space-y-1 text-xs text-text-secondary">
                    <img src={face.preview} alt={`${face.view === "front" ? "正面" : "侧面"}标准化人脸`} width={512} height={512} className="aspect-square w-full max-w-[256px] rounded" />
                    <div>{face.view === "front" ? "正面" : "侧面"} · 512 × 512 · 原始脸高约 {Math.round(face.sourceFaceHeight)} 像素</div>
                    {face.sourceFaceHeight < FACE_FIT_IMAGE_SPEC.minimumFaceHeight
                        ? <p role="status" className="text-amber-300">原始人脸小于 128 像素，细节不足，建议更换清晰原图后再拟合。</p>
                        : face.sourceFaceHeight < FACE_FIT_IMAGE_SPEC.recommendedFaceHeight
                            ? <p className="text-text-muted">建议使用原始脸高至少 256 像素的参考图。</p> : null}
                    {!face.detected && <p role="status" className="text-amber-300">处理后识别未成功，请核对裁剪图并手动补齐点位。</p>}
                </div>)}
            </div>}
            {fitImageUrl ? <div className="max-h-[600px] w-full overflow-auto rounded border border-glass-border">
                <div className="relative w-full min-w-[760px] max-w-[1223px]">
                <img ref={fitImageRef} src={fitImageUrl} alt={`${characterName}三视图拟合参考`} className="block h-auto w-full cursor-crosshair" onLoad={event => {
                    if (usePortrait ? !fitPoints.sideEye : !Object.keys(fitPoints).length) void detect(event.currentTarget);
                }} onClick={event => markImage(event, usePortrait ? "side" : undefined)} />
                {FACE_FIT_MARKS.filter(([key]) => !usePortrait || key.startsWith("side")).map(([key, label]) => {
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
                <button type="button" disabled={detecting || !fitImageUrl} onClick={() => { if (fitImageRef.current) void detect(fitImageRef.current); }} className="min-h-9 rounded border border-glass-border px-2 text-foreground disabled:opacity-50">{detecting ? "识别中…" : usePortrait ? "重新标记侧面" : "重新自动标记"}</button>
                <button type="button" disabled={detecting} onClick={fit} className="min-h-9 rounded border border-glass-border px-2 text-foreground hover:bg-hover-bg disabled:opacity-50">拟合白模</button>
            </div>
            {shape.calibration?.source.variant_id === fitSource.variantId &&
                <div className="space-y-1 text-xs text-text-secondary">
                    <div>拟合初稿 · 归一化残差 {shape.calibration.residual.toFixed(3)} · 当前滑杆以此脸型为 100%</div>
                    {shape.calibration.fitDiagnostics && <>
                        <details>
                            <summary className="cursor-pointer">查看初稿各部位比例</summary>
                            <p className="mt-1 text-text-muted">高度以对应视角的眼至下巴距离为 1。请同时核对点位和轮廓，比例接近不代表整体面容相似。</p>
                            <dl className="mt-1 space-y-1">
                                {shape.calibration.fitDiagnostics.metrics.map(metric => <div key={metric.key} className="flex flex-wrap justify-between gap-x-3">
                                    <dt>{FIT_METRIC_LABELS[metric.key]}</dt>
                                    <dd>参考 {metric.target.toFixed(3)} · 白模 {metric.actual.toFixed(3)}</dd>
                                </div>)}
                            </dl>
                        </details>
                        {shape.calibration.fitDiagnostics.metrics.some(metric => Math.abs(metric.error) > 0.15) &&
                            <div role="status" className="text-amber-300">局部比例仍有偏差：{shape.calibration.fitDiagnostics.metrics
                                .filter(metric => Math.abs(metric.error) > 0.15).map(metric => FIT_METRIC_LABELS[metric.key]).join("、")}。</div>}
                        {shape.calibration.fitDiagnostics.atLimits.length > 0 && <div role="status" className="text-amber-300">
                            拟合参数已达调节边界：{shape.calibration.fitDiagnostics.atLimits.map(key =>
                                CONTROL_GROUPS.flatMap(([, controls]) => controls).find(([control]) => control === key)?.[1] || key).join("、")}。请核对对应轮廓。
                        </div>}
                    </>}
                    {shape.calibration.residual > 0.15 && <div role="status" className="text-amber-300">拟合偏差较大，请检查标记点和白模轮廓。</div>}
                    {!calibrationCurrent && <div role="status" className="text-amber-300">拟合方法或标记点已变更，请重新拟合并核对。</div>}
                    <label className="flex items-center gap-2"><input type="checkbox" disabled={detecting || !calibrationCurrent} checked={fitReviewed && calibrationCurrent} onChange={event => setFitReviewed(event.target.checked)} />已核对正面与侧面白模</label>
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
        <label className="flex min-h-10 items-center gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={showNose} onChange={event => setShowNose(event.target.checked)} />显示鼻部放大对比
        </label>
        {showNose && <section aria-label="鼻部放大对比" className="space-y-2">
            <p className="text-xs text-text-secondary">鼻梁高度控制向前隆起，请看侧面；鼻梁宽度、鼻尖宽度请看正面。100% 为当前基准。</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {([false, true] as const).flatMap(side => ([false, true] as const).map(current => {
                    const label = `${current ? "当前" : "基准"}鼻部${side ? "侧面" : "正面"}放大预览`;
                    const baseline = shape.calibration ? { ...DEFAULT_FACE_SHAPE, basePreset: shape.basePreset, calibration: shape.calibration } : faceBaseShape(shape.basePreset);
                    return <div key={label} className="min-w-0">
                        <p className="mb-1 text-xs text-text-secondary">{current ? "当前调整" : "基准"} · {side ? "侧面" : "正面"}</p>
                        <div aria-label={label} className="aspect-square overflow-hidden rounded bg-[#28302f]">
                            {meshData && <NosePreview shape={current ? shape : baseline} data={meshData} side={side} />}
                        </div>
                    </div>;
                }))}
            </div>
        </section>}
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
        <button type="button" disabled={saving || detecting || !meshData || (usePortrait && !shape.calibration) || !!(shape.calibration && (!fitReviewed || !calibrationCurrent))} onClick={() => void save()} className="min-h-10 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">{saving ? "保存中…" : "保存骨相参数"}</button>
        {savedShape === JSON.stringify(shape) && <p role="status" className="text-xs text-green-400">骨相参数已保存到角色</p>}
        {shape.calibration && (!fitSource || shape.calibration.source.asset_id !== fitSource.assetId || shape.calibration.source.variant_id !== fitSource.variantId) &&
            <p role="status" className="text-xs text-amber-300">骨相基准的三视图已变更，请重新拟合。</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </fieldset>}
    </section>;
}
