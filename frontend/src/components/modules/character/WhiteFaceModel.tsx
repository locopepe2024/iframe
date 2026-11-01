"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { api, type AssetLibraryReference } from "@/lib/api";
import { faceShapePrompt, normalizeFaceShape, type FaceShape } from "@/lib/whiteFaceShape";

const CONTROL_GROUPS: Array<[string, Array<[keyof FaceShape, string, number, number]>]> = [
    ["头部轮廓", [["faceLength", "脸部长度", 80, 120], ["faceWidth", "脸部宽度", 80, 120], ["foreheadWidth", "额头宽度", 80, 120], ["cheekWidth", "颧部宽度", 80, 120], ["jawWidth", "下颌宽度", 75, 125], ["chinWidth", "下巴宽度", 75, 125], ["chinProjection", "下巴前突", 75, 125]]],
    ["鼻部", [["noseBridgeHeight", "鼻梁高度", 75, 125], ["noseBridgeWidth", "鼻梁宽度", 75, 125], ["noseProjection", "鼻尖突出度", 75, 125], ["noseTipWidth", "鼻尖宽度", 75, 125], ["nostrilWidth", "鼻翼宽度", 75, 125]]],
    ["眼眉", [["eyeSpacing", "眼距", 80, 120], ["eyeSize", "眼睛大小", 80, 120], ["eyeDepth", "眼窝深度", 80, 120], ["eyeTilt", "眼尾倾斜", 80, 120], ["browEyeDistance", "眉眼距离", 80, 120]]],
    ["嘴唇与下巴", [["mouthWidth", "嘴宽", 80, 120], ["upperLipThickness", "上唇厚度", 75, 125], ["lowerLipThickness", "下唇厚度", 75, 125], ["philtrumLength", "人中长度", 80, 120], ["mouthCornerTilt", "嘴角倾斜", 80, 120]]],
];

function Head({ shape, side = false, x }: { shape: FaceShape; side?: boolean; x: number }) {
    shape = normalizeFaceShape(shape);
    const width = shape.faceWidth / 100;
    const length = shape.faceLength / 100;
    const forehead = shape.foreheadWidth / 100;
    const cheek = shape.cheekWidth / 100;
    const jaw = shape.jawWidth / 100;
    const chin = shape.chinWidth / 100;
    const chinProjection = shape.chinProjection / 100;
    const eyes = shape.eyeSpacing / 100;
    const eyeSize = shape.eyeSize / 100;
    const eyeDepth = shape.eyeDepth / 100;
    const eyeTilt = (shape.eyeTilt - 100) / 100;
    const browEyeDistance = shape.browEyeDistance / 100;
    const bridgeHeight = shape.noseBridgeHeight / 100;
    const bridgeWidth = shape.noseBridgeWidth / 100;
    const nose = shape.noseProjection / 100;
    const noseTip = shape.noseTipWidth / 100;
    const nostril = shape.nostrilWidth / 100;
    const mouth = shape.mouthWidth / 100;
    const upperLip = shape.upperLipThickness / 100;
    const lowerLip = shape.lowerLipThickness / 100;
    const philtrum = shape.philtrumLength / 100;
    const cornerTilt = (shape.mouthCornerTilt - 100) / 100;
    return <group position={[x, 0, 0]} rotation={[0, side ? Math.PI / 2 : 0, 0]}>
        <mesh scale={[0.68 * width, 0.9 * length, 0.55]}><sphereGeometry args={[1, 48, 32]} /><meshStandardMaterial color="#e3e6e5" roughness={0.92} /></mesh>
        <mesh position={[0, 0.34 * length, 0.02]} scale={[0.48 * forehead, 0.34 * length, 0.49]}><sphereGeometry args={[1, 32, 20]} /><meshStandardMaterial color="#e1e4e2" roughness={0.95} /></mesh>
        <mesh position={[0, -0.5 * length, 0.09 + 0.035 * chinProjection]} scale={[0.46 * jaw, 0.35, 0.48]}><sphereGeometry args={[1, 40, 24]} /><meshStandardMaterial color="#dee1df" roughness={0.95} /></mesh>
        <mesh position={[0, -0.72 * length, 0.13 + 0.07 * chinProjection]} scale={[0.22 * chin, 0.18, 0.18 * chinProjection]}><sphereGeometry args={[1, 32, 20]} /><meshStandardMaterial color="#d9dddb" roughness={0.95} /></mesh>
        {[-1, 1].map(sign => <group key={sign}>
            <mesh position={[sign * 0.5 * cheek, -0.12, 0.26]} scale={[0.19, 0.24, 0.28]}><sphereGeometry args={[1, 24, 16]} /><meshStandardMaterial color="#e6e8e7" roughness={0.95} /></mesh>
            <mesh position={[sign * 0.27 * eyes, 0.16, 0.5 - 0.04 * eyeDepth]} rotation={[0, 0, sign * eyeTilt]} scale={[0.095 * eyeSize, 0.045 * eyeSize, 0.03 * eyeDepth]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#7d8586" roughness={1} /></mesh>
            <mesh position={[sign * 0.27 * eyes, 0.24 + 0.07 * browEyeDistance, 0.48 - 0.02 * eyeDepth]} rotation={[0, 0, sign * eyeTilt * 0.65]} scale={[0.13 * eyeSize, 0.025, 0.025]}><sphereGeometry args={[1, 20, 10]} /><meshStandardMaterial color="#b5bab8" roughness={1} /></mesh>
        </group>)}
        <mesh position={[0, 0.08, 0.57 + 0.035 * bridgeHeight + 0.07 * nose]} rotation={[Math.PI / 2, 0, 0]} scale={[0.055 * bridgeWidth, 0.15 * bridgeHeight, 0.07 * nose]}><coneGeometry args={[1, 1, 20]} /><meshStandardMaterial color="#e9ecea" roughness={0.9} /></mesh>
        <mesh position={[0, -0.06, 0.59 + 0.07 * nose]} rotation={[Math.PI / 2, 0, 0]} scale={[0.105 * noseTip, 0.23 * nose, 0.12 * nostril]}><coneGeometry args={[1, 1, 24]} /><meshStandardMaterial color="#f0f1ef" roughness={0.9} /></mesh>
        <mesh position={[0, -0.27 - 0.06 * philtrum, 0.51 + 0.02 * nose]} scale={[0.19 * mouth, 0.018 * upperLip, 0.03]}><sphereGeometry args={[1, 20, 10]} /><meshStandardMaterial color="#9ca2a1" roughness={1} /></mesh>
        <mesh position={[0, -0.33 - 0.08 * philtrum, 0.51 + 0.02 * nose]} scale={[0.19 * mouth, 0.018 * lowerLip, 0.03]}><sphereGeometry args={[1, 20, 10]} /><meshStandardMaterial color="#a8adab" roughness={1} /></mesh>
        {[-1, 1].map(sign => <mesh key={`mouth-corner-${sign}`} position={[sign * 0.17 * mouth, -0.3 - 0.07 * philtrum + 0.08 * cornerTilt, 0.52 + 0.02 * nose]} scale={[0.035, 0.02, 0.025]}><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#9ca2a1" roughness={1} /></mesh>)}
    </group>;
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
    const stageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setShape(normalizeFaceShape(initialShape));
    }, [initialShape]);

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
        <div ref={stageRef} className={`${standalone ? "aspect-[16/7] min-h-[360px]" : "aspect-[2/1]"} w-full overflow-hidden rounded bg-[#28302f]`}>
            <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [0, 0, 5], fov: 40 }}>
                <color attach="background" args={["#28302f"]} />
                <ambientLight intensity={1.5} />
                <directionalLight position={[2, 3, 5]} intensity={2} />
                <Head shape={shape} x={-1.1} />
                <Head shape={shape} x={1.1} side />
            </Canvas>
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
        <button type="button" disabled={saving} onClick={() => void save()} className="min-h-10 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">{saving ? "保存中…" : "保存骨相参数"}</button>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </>}
    </section>;
}
