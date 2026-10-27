"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { MOUSE, TOUCH, Vector3 } from "three";
import { sceneAngles, sceneDirection } from "@/lib/sceneDirection";

class SphereBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <p role="status" className="p-4 text-sm text-text-muted">三维预览不可用，请使用下方角度控件。</p> : this.props.children; }
}

function DirectionScene({ azimuth, elevation, onChange, mode, color, disabled, observing }: SphereProps & { observing: boolean }) {
    const [dragging, setDragging] = useState(false);
    const dragPointer = useRef<number | null>(null);
    useEffect(() => {
        const stop = () => { dragPointer.current = null; setDragging(false); };
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => { window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
    }, []);
    const position = sceneDirection(azimuth, elevation);
    const markerColor = mode === "light" ? color || "#fbbf24" : "#818cf8";
    const choose = (event: ThreeEvent<PointerEvent>) => {
        const p = event.point;
        const next = sceneAngles([p.x, p.y, p.z], azimuth);
        onChange(Math.round(next.azimuth), Math.round(next.elevation));
    };
    const endDrag = () => { dragPointer.current = null; setDragging(false); };
    return <>
        <ambientLight intensity={1.1} />
        <directionalLight position={mode === "light" ? position.map(v => v * 4) as [number, number, number] : [3, -4, 5]} intensity={2} color={mode === "light" ? color : "#ffffff"} />
        <axesHelper args={[1.45]} />
        <gridHelper args={[3, 6, "#475569", "#334155"]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.1]} />
        <mesh><sphereGeometry args={[.35, 32, 24]} /><meshStandardMaterial color="#94a3b8" roughness={.8} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -.45, 0]}><coneGeometry args={[.08, .18, 12]} /><meshBasicMaterial color="#38bdf8" /></mesh>
        <Line points={[[0, 0, 0], position]} color={markerColor} lineWidth={2} />
        <mesh position={position}><sphereGeometry args={[.09, 20, 16]} /><meshBasicMaterial color={markerColor} /></mesh>
        <mesh
            onPointerDown={event => {
                if (disabled || observing || event.button !== 0) return;
                event.stopPropagation(); dragPointer.current = event.pointerId; setDragging(true); choose(event);
                (event.target as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={event => { if (dragPointer.current === event.pointerId) { event.stopPropagation(); choose(event); } }}
            onPointerUp={event => {
                if (dragPointer.current !== event.pointerId) return;
                (event.target as unknown as { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(event.pointerId);
                endDrag();
            }}
            onPointerCancel={endDrag}>
            <sphereGeometry args={[1, 40, 24]} />
            <meshBasicMaterial color="#64748b" wireframe transparent opacity={.18} />
        </mesh>
        <OrbitControls enabled={!dragging} enablePan={false} enableZoom={false}
            mouseButtons={{ LEFT: observing ? MOUSE.ROTATE : undefined, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.ROTATE }}
            touches={{ ONE: observing ? TOUCH.ROTATE : undefined, TWO: observing ? TOUCH.DOLLY_ROTATE : undefined }} target={[0, 0, 0]} />
    </>;
}

interface SphereProps {
    azimuth: number;
    elevation: number;
    mode: "light" | "camera";
    color?: string;
    disabled?: boolean;
    onChange: (azimuth: number, elevation: number) => void;
}

export default function SceneDirectionSphere(props: SphereProps) {
    const [observing, setObserving] = useState(false);
    const position = sceneDirection(props.azimuth, props.elevation);
    return <div className="space-y-2" aria-label={props.mode === "light" ? "三维光源方向" : "三维机位方向"}>
        <div className="flex gap-2" role="group" aria-label="球体交互">
            {([false, true] as const).map(value => <button key={String(value)} type="button" aria-pressed={observing === value}
                onClick={() => setObserving(value)} className="min-h-11 rounded border border-glass-border px-3 text-sm text-text-secondary aria-pressed:border-primary aria-pressed:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {value ? "旋转观察" : "设置方向"}
            </button>)}
        </div>
        <div className="h-64 overflow-hidden rounded-lg border border-glass-border bg-surface-inset" onContextMenu={event => event.preventDefault()}>
            <SphereBoundary><Canvas camera={{ position: [2.8, -4, 2.4], up: [0, 0, 1], fov: 42 }}
                fallback={<p role="status">三维预览不可用，请使用角度控件。</p>}
                onCreated={({ camera }) => { camera.up.copy(new Vector3(0, 0, 1)); camera.lookAt(0, 0, 0); }}>
                <DirectionScene {...props} observing={observing} />
            </Canvas></SphereBoundary>
        </div>
        <p className="text-xs text-text-muted">{observing ? "拖动旋转观察，不改变已选方向。" : `拖动球面设置${props.mode === "light" ? "光源" : "机位"}方向；右键旋转观察。`}蓝色箭头为前方，Z 轴向上。</p>
        <output className="block text-xs text-text-secondary">方位 {props.azimuth}° · 仰角 {props.elevation}° · X {position[0].toFixed(3)} · Y {position[1].toFixed(3)} · Z {position[2].toFixed(3)}</output>
        <p className="text-xs text-text-muted">单位球坐标用于表达方向，不代表图片中测得的米制位置。</p>
    </div>;
}
