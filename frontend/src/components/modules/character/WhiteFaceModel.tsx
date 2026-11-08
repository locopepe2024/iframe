"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { api, type AssetLibraryReference } from "@/lib/api";
import { DEFAULT_FACE_SHAPE, FACE_BASE_PRESETS, SELECTABLE_FACE_PRESETS, faceBaseShape, faceShapePrompt, faceShapeMeasurements, normalizeFaceShape, type FaceBasePreset, type FaceShape, type FaceShapeNumbers } from "@/lib/whiteFaceShape";
import { faceMeasurementTargetText } from "@/lib/whiteFaceMeasurements";
import { FACE_FIT_MARKS, FACE_FIT_LANDMARK_CONVENTION, FACE_FIT_OBJECTIVE, FIT_METRIC_LABELS, fitFaceToLandmarks, type FaceFitLandmarks } from "@/lib/whiteFaceFit";
import { type FacePhotoReference, type FaceFitSource } from "@/lib/whiteFaceImage";
import { validateFaceReferencePair } from "@/lib/faceReferencePair";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";
import FacePhotoInput from "./FacePhotoInput";

const CONTROL_GROUPS: Array<[string, Array<[keyof FaceShapeNumbers, string, number, number]>]> = [
    ["头部轮廓", [["faceLength", "脸部长度", 80, 120], ["faceWidth", "脸部宽度", 80, 120], ["foreheadWidth", "额头宽度", 80, 120], ["cheekWidth", "颧部宽度", 80, 120], ["cheekHeight", "颧部高度", 75, 125], ["jawWidth", "下颌宽度", 75, 125], ["jawHeight", "下颌高度", 75, 125], ["chinWidth", "下巴宽度", 75, 125], ["chinProjection", "下巴前突", 75, 125]]],
    ["鼻部", [["noseRootHeight", "鼻根前突", 50, 150], ["noseBridgeHeight", "鼻梁高度", 75, 125], ["noseBridgeWidth", "鼻梁宽度", 75, 125], ["noseProjection", "鼻尖突出度", 75, 125], ["noseTipHeight", "鼻尖高度", 75, 125], ["noseTipWidth", "鼻尖宽度", 75, 125], ["nostrilWidth", "鼻翼宽度", 75, 125]]],
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

export default function WhiteFaceModel({ characterName, initialShape, portraitSource, onSaved, onDirtyChange, standalone = false }: {
    characterName: string;
    initialShape?: Partial<FaceShape>;
    fitSource?: FaceFitSource; // Legacy callers may supply it; the sheet is never used for new fitting.
    portraitSource?: FaceFitSource;
    onSaved: (reference: AssetLibraryReference, prompt: string, shape: FaceShape) => void | Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
    standalone?: boolean;
}) {
    const [shape, setShape] = useState<FaceShape>(normalizeFaceShape(initialShape));
    const shapeKey = JSON.stringify(shape), initialShapeKey = JSON.stringify(normalizeFaceShape(initialShape));
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedShape, setSavedShape] = useState<string>("");
    const [showNose, setShowNose] = useState(false);
    const measurements = useMemo(() => faceShapeMeasurements(shape), [shape]);
    const [error, setError] = useState("");
    const [meshData, setMeshData] = useState<WhiteFaceMeshData | null>(null);
    const [fitPoints, setFitPoints] = useState<Partial<FaceFitLandmarks>>(initialShape?.calibration?.referencePair ? initialShape.calibration.landmarks : {});
    const [fitReviewed, setFitReviewed] = useState(!!initialShape?.calibration?.referencePair && !!initialShape.calibration.reviewed);
    const [front, setFront] = useState<FacePhotoReference | undefined>(initialShape?.calibration?.referencePair?.front);
    const [side, setSide] = useState<FacePhotoReference | undefined>(initialShape?.calibration?.referencePair?.side);
    const [frontBusy, setFrontBusy] = useState(false), [sideBusy, setSideBusy] = useState(false);
    const detecting = frontBusy || sideBusy;
    const stageRef = useRef<HTMLDivElement>(null);
    const initialPair = initialShape?.calibration?.referencePair;
    const pair = front && side ? { schema: "iframe.face-reference-pair.v1" as const, front, side } : undefined;
    const pairKey = JSON.stringify(pair);
    const calibrationCurrent = !!(shape.calibration?.referencePair && pair
        && JSON.stringify(shape.calibration.referencePair) === pairKey
        && FACE_FIT_MARKS.every(([key]) => key === "sideNoseRoot" || (fitPoints[key]
            && fitPoints[key]?.x === shape.calibration?.landmarks[key]?.x
            && fitPoints[key]?.y === shape.calibration?.landmarks[key]?.y)));
    const referenceDraft = !!(front || side) && (!initialPair || JSON.stringify(initialPair) !== pairKey
        || FACE_FIT_MARKS.some(([key]) => fitPoints[key]?.x !== initialShape?.calibration?.landmarks[key]?.x
            || fitPoints[key]?.y !== initialShape?.calibration?.landmarks[key]?.y));
    useEffect(() => { onDirtyChange?.(shapeKey !== initialShapeKey || referenceDraft || detecting); }, [shapeKey, initialShapeKey, referenceDraft, detecting, onDirtyChange]);
    const referenceChange = (view: "front" | "side", reference?: FacePhotoReference, points?: Partial<FaceFitLandmarks>) => {
        if (view === "front") setFront(reference); else setSide(reference);
        setFitReviewed(false);
        setFitPoints(current => ({ ...Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(view))), ...points }));
    };
    useEffect(() => {
        setShape(normalizeFaceShape(initialShape));
        setFitReviewed(!!initialShape?.calibration?.referencePair && !!initialShape.calibration.reviewed);
        setFront(initialShape?.calibration?.referencePair?.front);
        setSide(initialShape?.calibration?.referencePair?.side);
        setFitPoints(initialShape?.calibration?.referencePair ? initialShape.calibration.landmarks : {});
    }, [initialShape]);
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
            .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "面部白模加载失败"); });
        return () => controller.abort();
    }, [open, meshData]);
    const fit = () => {
        if (detecting) return;
        try {
            const references = validateFaceReferencePair(front, side);
            if (!meshData) throw new Error("面部白模尚未加载完成");
            if (FACE_FIT_MARKS.some(([key]) => !fitPoints[key])) throw new Error("请先核对正面与侧脸的全部点位");
            const { shape: baselineShape, residual, diagnostics } = fitFaceToLandmarks(fitPoints as FaceFitLandmarks, meshData,
                shape.basePreset, { front: references.front.sourceWidth / references.front.sourceHeight,
                    side: references.side.sourceWidth / references.side.sourceHeight });
            const { basePreset, calibration: ignored, ...baseline } = baselineShape; void ignored;
            setShape({ ...DEFAULT_FACE_SHAPE, basePreset, calibration: {
                schema: "iframe.white-face-fit.v1", landmarkConvention: FACE_FIT_LANDMARK_CONVENTION,
                fitObjective: FACE_FIT_OBJECTIVE, fitDiagnostics: diagnostics,
                source: references.side.source, referencePair: references,
                frontReference: { source: references.front.source, region: "whole", sourceWidth: references.front.sourceWidth,
                    sourceHeight: references.front.sourceHeight, preparation: references.front.preparation },
                baseline, landmarks: fitPoints as FaceFitLandmarks, residual,
            } });
            setFitReviewed(false); setError("");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "正面与侧脸拟合失败"); }
    };

    const save = async () => {
        if (detecting || ((front || side || shape.calibration) && (!calibrationCurrent || !fitReviewed))) {
            setError("骨相基准或标记点已变更，请重新拟合并核对。");
            return;
        }
        const canvas = stageRef.current?.querySelector("canvas");
        if (!canvas) { setError("白模预览尚未就绪"); return; }
        setSaving(true);
        setSavedShape("");
        setError("");
        try {
            const savedShape = shape.calibration ? { ...shape, calibration: { ...shape.calibration, reviewed: fitReviewed,
                landmarks: { ...shape.calibration.landmarks, ...fitPoints } } } : shape;
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
                setFitReviewed(false);
            }} className="mt-1 min-h-9 w-full rounded border border-glass-border bg-surface px-2 text-xs text-foreground">
                {(shape.basePreset === "middle_aged" ? [...SELECTABLE_FACE_PRESETS, "middle_aged" as const] : SELECTABLE_FACE_PRESETS)
                    .map(key => <option key={key} value={key}>{FACE_BASE_PRESETS[key].label}</option>)}
            </select>
        </label>
        <section aria-label="正面与侧脸参考规范" className="space-y-3">
            <p className="text-sm text-text-secondary">拟合需要同一角色的两张独立原图：一张正面照、一张约90°侧脸照。自然表情、头部水平，五官和下巴完整；不接受拼图或多人排版。</p>
            <p className="text-xs text-text-muted">PNG、JPG或WebP，每张不超过20MB。推荐1024×1024头肩照，原始脸高至少128像素，建议256像素以上。系统等比裁剪至512×512；放大不会增加细节。</p>
            <p className="text-xs text-text-muted">上传后先在本地检查，通过才保存到素材库。视角识别是近似检查，仍需人工确认同一角色及侧脸角度。图片上传不等于骨相参数已保存。</p>
            {shape.calibration && !shape.calibration.referencePair && <p role="status" className="text-xs text-amber-400">旧骨相数值已保留。重新拟合时请提供独立正面照和侧脸照各一张。</p>}
            <div className="grid gap-3 md:grid-cols-2">
                <FacePhotoInput view="front" characterName={characterName} initial={initialPair?.front}
                    portrait={portraitSource ? { asset_type: "character", asset_id: portraitSource.assetId, variant_id: portraitSource.variantId,
                        source_scope: portraitSource.scope, source_container_id: portraitSource.containerId } : undefined}
                    points={fitPoints} onBusy={setFrontBusy} onChange={(reference, points) => referenceChange("front", reference, points)}
                    onMark={(key, point) => { setFitPoints(current => ({ ...current, [key]: point })); if (key !== "sideNoseRoot") setFitReviewed(false); }} />
                <FacePhotoInput view="side" characterName={characterName} initial={initialPair?.side} points={fitPoints}
                    onBusy={setSideBusy} onChange={(reference, points) => referenceChange("side", reference, points)}
                    onMark={(key, point) => { setFitPoints(current => ({ ...current, [key]: point })); if (key !== "sideNoseRoot") setFitReviewed(false); }} />
            </div>
            <button type="button" disabled={detecting || !front || !side || !meshData} onClick={fit} className="min-h-11 rounded border border-glass-border px-3 text-xs disabled:opacity-50">拟合白模</button>
            {shape.calibration && <div className="space-y-2 text-xs text-text-secondary">
                <p>拟合残差 {shape.calibration.residual.toFixed(3)} · 当前滑杆以拟合基准为100。</p>
                {shape.calibration.fitDiagnostics && <details><summary className="min-h-11 cursor-pointer">查看拟合比例</summary>
                    <p>请同时核对点位和轮廓，比例接近不代表整体面容相似。</p>
                    {shape.calibration.fitDiagnostics.metrics.map(metric => <p key={metric.key}>{FIT_METRIC_LABELS[metric.key]}：参考{metric.target.toFixed(3)} · 白模{metric.actual.toFixed(3)}</p>)}
                </details>}
                {!calibrationCurrent && <p role="status" className="text-amber-400">参考图或点位与当前拟合不一致，请重新拟合并核对。</p>}
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={detecting || !calibrationCurrent} checked={fitReviewed && calibrationCurrent} onChange={event => setFitReviewed(event.target.checked)} />已核对正面与侧面白模及同一角色身份</label>
            </div>}
        </section>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
                <div className="mb-1 text-xs text-text-secondary">{shape.calibration ? "双图拟合基准" : "基础脸型"} · 正面 / 侧面</div>
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
            <p className="text-xs text-text-secondary">鼻根前突控制山根：向左降低、向右抬高，100 为当前基准；请看侧面额头与鼻梁之间的凹陷变化。鼻梁高度控制中段向前隆起；鼻梁宽度、鼻尖宽度请看正面。</p>
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
            <p className="text-xs text-text-secondary">滑杆显示白模控制值；参考图的测量基准和出图目标见下方测量表。</p>
            {CONTROL_GROUPS.map(([group, controls]) => <details key={group} open={group === "头部轮廓"} className="rounded border border-glass-border/60 p-2">
                <summary className="cursor-pointer text-xs font-medium text-text-secondary">{group}</summary>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {controls.map(([key, label, min, max]) => <label key={key} className="text-xs text-text-secondary">
                        <span className="flex justify-between"><span>{label}{key === "faceLength" ? "（眼线至下巴）" : key === "noseBridgeHeight" ? "（向前隆起）" : key === "eyeSize" ? "（睁开高度）" : ""}</span><span>控制值 {shape[key]}</span></span>
                        <input aria-label={label} type="range" min={shape.calibration && key !== "noseRootHeight" ? Math.max(min, 90) : min} max={shape.calibration && key !== "noseRootHeight" ? Math.min(max, 110) : max} value={shape[key]} onChange={event => { setShape(current => ({ ...current, [key]: Number(event.target.value) })); setFitReviewed(false); }} className="w-full" />
                        {key === "noseRootHeight" && <span className="flex justify-between"><span>低平山根</span><span>突出山根</span></span>}
                    </label>)}
                </div>
            </details>)}
        </div>
        <details className="rounded border border-glass-border p-3">
            <summary className="min-h-8 cursor-pointer text-xs font-medium text-foreground">查看出图测量定义、参考基准与目标值</summary>
            <p className="mt-2 text-xs text-text-secondary">当前长度指标是眼线至下巴，不是发际线至下巴。滑杆数值是变形输入，下表目标由{shape.calibration ? "拟合基准" : "所选基础脸型"}与当前白模的同一点位测量换算，用作参考图的相对编辑目标。</p>
            <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs text-text-secondary">
                    <caption className="sr-only">出图测量目标</caption>
                    <thead><tr><th scope="col" className="p-2">项目与测量定义</th><th scope="col" className="p-2">参考基准与目标</th></tr></thead>
                    <tbody>{measurements.map(item => <tr key={item.key} className="border-t border-glass-border">
                        <th scope="row" className="p-2 font-normal">{item.label} · {item.view}<br />{item.definition}</th>
                        <td className="p-2">{faceMeasurementTargetText(item)}</td>
                    </tr>)}</tbody>
                </table>
            </div>
        </details>
        <button type="button" disabled={saving || detecting || !meshData || !!((front || side || shape.calibration) && (!fitReviewed || !calibrationCurrent))} onClick={() => void save()} className="min-h-10 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">{saving ? "保存中…" : "保存骨相参数"}</button>
        {savedShape === JSON.stringify(shape) && <p role="status" className="text-xs text-green-400">骨相参数已保存到角色</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </fieldset>}
    </section>;
}
