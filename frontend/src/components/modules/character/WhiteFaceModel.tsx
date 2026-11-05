"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { api, type AssetLibraryReference } from "@/lib/api";
import { FACE_BASE_PRESETS, faceBaseShape, faceShapePrompt, normalizeFaceShape, type FaceBasePreset, type FaceShape } from "@/lib/whiteFaceShape";
import { faceShellGeometry, type WhiteFaceMeshData } from "@/lib/whiteFaceMesh";

const CONTROL_GROUPS: Array<[string, Array<[keyof FaceShape, string, number, number]>]> = [
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

export default function WhiteFaceModel({ characterName, initialShape, onSaved, standalone = false }: {
    characterName: string;
    initialShape?: Partial<FaceShape>;
    onSaved: (reference: AssetLibraryReference, prompt: string, shape: FaceShape) => void;
    standalone?: boolean;
}) {
    const [shape, setShape] = useState<FaceShape>(normalizeFaceShape(initialShape));
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [meshData, setMeshData] = useState<WhiteFaceMeshData | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setShape(normalizeFaceShape(initialShape));
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
            .catch(cause => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "面部白模加载失败");
            });
        return () => controller.abort();
    }, [open, meshData]);

    const save = async () => {
        const canvas = stageRef.current?.querySelector("canvas");
        if (!canvas) { setError("白模预览尚未就绪"); return; }
        setSaving(true);
        setError("");
        try {
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("无法导出白模图")), "image/png"));
            const uploaded = await api.uploadLibraryImage(new File([blob], "white-face-reference.png", { type: "image/png" }));
            const asset = await api.createLibraryAsset("prop", {
                name: `${characterName} · 面部比例白模`,
                description: faceShapePrompt(shape),
                image_url: uploaded.image_url,
                image_origin: "upload",
            });
            const variant = asset.image_asset?.variants?.[0];
            if (!asset.id || !variant?.id) throw new Error("白模图没有产生可引用的资产版本");
            onSaved({ asset_type: "prop", asset_id: asset.id, variant_id: variant.id, application_mode: "reference_only", applied_fields: ["face_geometry"] }, faceShapePrompt(shape), shape);
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
            }} className="mt-1 min-h-9 w-full rounded border border-glass-border bg-surface px-2 text-xs text-foreground">
                {Object.entries(FACE_BASE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
            </select>
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
                <div className="mb-1 text-xs text-text-secondary">基础脸型 · 正面 / 侧面</div>
                <div className="aspect-[2/1] w-full overflow-hidden rounded bg-[#28302f]" aria-label="基础脸型正面与侧面预览">
                    {meshData ? <FacePreview shape={faceBaseShape(shape.basePreset)} data={meshData} /> : null}
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
                        <input aria-label={label} type="range" min={min} max={max} value={shape[key]} onChange={event => setShape(current => ({ ...current, [key]: Number(event.target.value) }))} className="w-full" />
                    </label>)}
                </div>
            </details>)}
        </div>
        <button type="button" disabled={saving || !meshData} onClick={() => void save()} className="min-h-10 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">{saving ? "保存中…" : "保存骨相参数"}</button>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </>}
    </section>;
}
