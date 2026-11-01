"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { api, type AssetLibraryReference } from "@/lib/api";
import { DEFAULT_FACE_SHAPE, faceShapePrompt, type FaceShape } from "@/lib/whiteFaceShape";

const CONTROLS: Array<[keyof FaceShape, string, number, number]> = [
    ["faceLength", "脸部长度", 80, 120],
    ["faceWidth", "脸部宽度", 80, 120],
    ["cheekWidth", "颧部宽度", 80, 120],
    ["jawWidth", "下颌宽度", 75, 125],
    ["eyeSpacing", "眼距", 80, 120],
    ["noseProjection", "鼻部突出度", 75, 125],
];

function Head({ shape, side = false, x }: { shape: FaceShape; side?: boolean; x: number }) {
    const width = shape.faceWidth / 100;
    const length = shape.faceLength / 100;
    const cheek = shape.cheekWidth / 100;
    const jaw = shape.jawWidth / 100;
    const eyes = shape.eyeSpacing / 100;
    const nose = shape.noseProjection / 100;
    return <group position={[x, 0, 0]} rotation={[0, side ? Math.PI / 2 : 0, 0]}>
        <mesh scale={[0.68 * width, 0.9 * length, 0.55]}><sphereGeometry args={[1, 48, 32]} /><meshStandardMaterial color="#e3e6e5" roughness={0.92} /></mesh>
        <mesh position={[0, -0.5 * length, 0.09]} scale={[0.46 * jaw, 0.35, 0.48]}><sphereGeometry args={[1, 40, 24]} /><meshStandardMaterial color="#dee1df" roughness={0.95} /></mesh>
        {[-1, 1].map(sign => <group key={sign}>
            <mesh position={[sign * 0.5 * cheek, -0.12, 0.26]} scale={[0.19, 0.24, 0.28]}><sphereGeometry args={[1, 24, 16]} /><meshStandardMaterial color="#e6e8e7" roughness={0.95} /></mesh>
            <mesh position={[sign * 0.27 * eyes, 0.16, 0.5]} scale={[0.095, 0.045, 0.03]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#7d8586" roughness={1} /></mesh>
        </group>)}
        <mesh position={[0, -0.06, 0.57 + 0.07 * nose]} rotation={[Math.PI / 2, 0, 0]} scale={[0.105, 0.23 * nose, 0.12]}><coneGeometry args={[1, 1, 24]} /><meshStandardMaterial color="#f0f1ef" roughness={0.9} /></mesh>
        <mesh position={[0, -0.4, 0.5]} scale={[0.19, 0.025, 0.03]}><sphereGeometry args={[1, 20, 10]} /><meshStandardMaterial color="#9ca2a1" roughness={1} /></mesh>
    </group>;
}

export default function WhiteFaceModel({ characterName, initialShape, onSaved }: {
    characterName: string;
    initialShape?: FaceShape;
    onSaved: (reference: AssetLibraryReference, prompt: string, shape: FaceShape) => void;
}) {
    const [shape, setShape] = useState<FaceShape>(initialShape ?? DEFAULT_FACE_SHAPE);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const stageRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setShape(initialShape ?? DEFAULT_FACE_SHAPE);
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

    return <section aria-label="面部比例白模" className="space-y-3 rounded border border-glass-border p-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="min-h-10 w-full text-left text-xs font-medium text-foreground">面部比例白模</button>
        {open && <>
        <div ref={stageRef} className="aspect-[2/1] w-full overflow-hidden rounded bg-[#28302f]">
            <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [0, 0, 5], fov: 40 }}>
                <color attach="background" args={["#28302f"]} />
                <ambientLight intensity={1.5} />
                <directionalLight position={[2, 3, 5]} intensity={2} />
                <Head shape={shape} x={-1.1} />
                <Head shape={shape} x={1.1} side />
            </Canvas>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CONTROLS.map(([key, label, min, max]) => <label key={key} className="text-xs text-text-secondary">
                <span className="flex justify-between"><span>{label}</span><span>{shape[key]}%</span></span>
                <input type="range" min={min} max={max} value={shape[key]} onChange={event => setShape(current => ({ ...current, [key]: Number(event.target.value) }))} className="w-full" />
            </label>)}
        </div>
        <button type="button" disabled={saving} onClick={() => void save()} className="min-h-10 rounded border border-glass-border px-3 text-xs text-foreground hover:bg-hover-bg disabled:opacity-50">{saving ? "保存中…" : "保存骨相参数"}</button>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </>}
    </section>;
}
