"use client";

import { useState, type PointerEvent } from "react";
import type { AssetLibraryReference } from "@/lib/api";

export type SceneImageSource = {
    key: string;
    label: string;
    url: string;
    variantId: string;
};

export type LightingReference = { key: string; label: string; url: string; reference: AssetLibraryReference };

const cameraPresets = [
    { key: "custom", label: "自定义" }, { key: "fisheye", label: "鱼眼视角" },
    { key: "tilted", label: "倾斜视角" }, { key: "front_top_down", label: "正面俯拍" },
    { key: "front_bottom_up", label: "正面仰拍" }, { key: "panoramic_top_down", label: "全景俯拍" },
    { key: "rear_view", label: "背面视角" },
] as const;
const lightPresets = [
    { key: "cool_gray", label: "诺兰冷灰", prompt: "冷灰色调，主光克制，阴影干净" },
    { key: "golden_hour", label: "黄金时刻", prompt: "低角度暖阳，琥珀金高光，柔和阴影" },
    { key: "mystic_shadow", label: "神秘暗调", prompt: "局部受光，背景克制，明暗对比鲜明" },
    { key: "cyberpunk", label: "霓虹光影", prompt: "冷暖霓虹边缘光，主体轮廓清晰" },
    { key: "blue_rim", label: "蓝色逆光", prompt: "蓝色逆光勾勒主体，正面仍可辨识" },
    { key: "expired_film", label: "过期胶片", prompt: "轻微偏色、暖黄褪色、高光泛雾，保留清晰的场景结构" },
    { key: "cinematic_portrait", label: "电影感", prompt: "柔和主光与轻微轮廓光，压住杂光，保留空间层次" },
    { key: "studio_softbox", label: "柔光棚拍", prompt: "柔光箱近距离补光，减弱硬阴影，照明均匀干净" },
] as const;
const lightSides = ["左侧", "顶部", "右侧", "前方", "底部", "后方"] as const;
const distances = ["远景", "中远景", "中景", "近景", "特写"] as const;

export function SceneImageTools({ kind, sources, sceneAssetId, lightingReferences = [], busy, onGenerate }: {
    kind: "lighting" | "camera";
    sources: SceneImageSource[];
    sceneAssetId?: string;
    lightingReferences?: LightingReference[];
    busy: boolean;
    onGenerate: (source: SceneImageSource, prompt: string, lightingReference?: AssetLibraryReference) => void;
}) {
    const [sourceKey, setSourceKey] = useState("");
    const [brightness, setBrightness] = useState(50);
    const [viewMode, setViewMode] = useState<"perspective" | "front">("perspective");
    const [intelligent, setIntelligent] = useState(true);
    const [color, setColor] = useState("#f3f4f6");
    const [lightSide, setLightSide] = useState<(typeof lightSides)[number]>("前方");
    const [rimLight, setRimLight] = useState(false);
    const [lightPreset, setLightPreset] = useState<string>("");
    const [lightingReferenceKey, setLightingReferenceKey] = useState("");
    const [cameraPreset, setCameraPreset] = useState<(typeof cameraPresets)[number]["key"]>("custom");
    const [yaw, setYaw] = useState(0);
    const [pitch, setPitch] = useState(0);
    const [distance, setDistance] = useState(2);
    const [focus, setFocus] = useState(false);
    const [focusX, setFocusX] = useState(50);
    const [focusY, setFocusY] = useState(50);
    const [focusRadius, setFocusRadius] = useState(18);
    const [cameraPromptEnabled, setCameraPromptEnabled] = useState(false);
    const [extra, setExtra] = useState("");
    const source = sources.find((item) => item.key === sourceKey) ?? sources[0];
    const lightingReference = lightingReferences.find((item) => item.key === lightingReferenceKey);
    const activeLightingReference = intelligent && !(lightingReference?.reference.asset_type === "scene" && lightingReference.reference.asset_id === sceneAssetId && lightingReference.reference.variant_id === source?.variantId)
        ? lightingReference : undefined;
    const lightPosition: Record<(typeof lightSides)[number], { left: string; top: string }> = {
        左侧: { left: "18%", top: "50%" }, 顶部: { left: "50%", top: "15%" },
        右侧: { left: "82%", top: "50%" }, 前方: { left: "35%", top: "26%" },
        底部: { left: "50%", top: "85%" }, 后方: { left: "70%", top: "22%" },
    };
    const control = "min-h-10 rounded-md border border-glass-border bg-surface px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
    const option = "min-h-10 rounded-md border border-glass-border px-3 text-sm text-text-secondary hover:bg-hover-bg aria-pressed:border-primary aria-pressed:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

    function submit() {
        if (!source || busy) return;
        const brightnessGuide = brightness >= 75 ? "受光区域明显，但高光不要过曝。" : brightness >= 45
            ? "保持自然明暗层次和稳定反差。" : "阴影占比更高，整体照度克制。";
        const prompt = kind === "lighting" ? [
            "基于参考图片仅调整场景打光与光影，保持场景结构、主体、物体位置和构图；不要替换主体或新增物体。",
            `观察模式：${viewMode === "front" ? "正面" : "透视"}。`,
            `主光从${lightSide}进入，亮度约 ${brightness}%，主光颜色 ${color}；受光面和阴影方向应一致。${brightnessGuide}`,
            rimLight ? "增加克制的轮廓光。" : "不额外增加明显轮廓光。",
            intelligent ? lightPresets.find((item) => item.key === lightPreset)?.prompt : "以结构化灯位、光色和亮度为主，只做克制的光照重塑。",
            intelligent ? extra.trim() : "",
            activeLightingReference ? "附加光影参考图只用于主光方向、明暗分布与色温；场景内容以来源图片为准。" : "",
        ] : [
            "基于参考图片调整观察镜头，保持同一场景的空间结构、主体、物体位置关系和核心风格；不要生成新场景。",
            `视角：${cameraPresets.find((item) => item.key === cameraPreset)?.label}；水平环绕 ${yaw}°，垂直俯仰 ${pitch}°，景别 ${distances[distance]}。`,
            focus ? `以画面坐标 x=${focusX}%、y=${focusY}% 的主体区域为对焦中心，影响半径约 ${focusRadius}%，保持该区域清晰。` : "",
            cameraPromptEnabled ? extra.trim() : "",
        ];
        onGenerate(source, prompt.filter(Boolean).join("\n"), kind === "lighting" ? activeLightingReference?.reference : undefined);
    }

    function updateFocus(event: PointerEvent<HTMLDivElement>) {
        if (!focus) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        setFocusX(Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 100));
        setFocusY(Math.round(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 100));
    }

    function reset() {
        if (kind === "lighting") {
            setViewMode("perspective"); setIntelligent(true); setBrightness(50); setColor("#f3f4f6");
            setLightSide("前方"); setRimLight(false); setLightPreset(""); setLightingReferenceKey("");
        } else {
            setCameraPreset("custom"); setYaw(0); setPitch(0); setDistance(2);
            setFocus(false); setFocusX(50); setFocusY(50); setFocusRadius(18); setCameraPromptEnabled(false);
        }
        setExtra("");
    }

    return <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-label={kind === "lighting" ? "光影工具" : "镜头工具"}>
        <div className="mx-auto grid max-w-6xl gap-6 xl:grid-cols-[minmax(260px,1fr)_minmax(320px,1.1fr)]">
            <div className="min-w-0 space-y-3">
                <h3 className="text-base font-semibold text-foreground">{kind === "lighting" ? "光影效果" : "镜头视角"}</h3>
                <p className="text-sm text-text-secondary">选择已保存的场景图片作为本次生成来源。结果将成为该场景的新候选。</p>
                <label className="block text-sm text-text-secondary" htmlFor={`${kind}-source`}>来源图片</label>
                <select id={`${kind}-source`} className={`${control} w-full`} value={source?.key ?? ""} onChange={(event) => setSourceKey(event.target.value)} disabled={!sources.length}>
                    {!sources.length && <option value="">暂无可用场景图片</option>}
                    {sources.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
                <div className="relative flex min-h-52 items-center justify-center overflow-hidden rounded-lg border border-glass-border bg-surface-inset sm:min-h-72" onPointerDown={(event) => { if (kind === "camera" && focus) { updateFocus(event); event.currentTarget.setPointerCapture?.(event.pointerId); } }} onPointerMove={(event) => { if (kind === "camera" && focus && event.buttons) updateFocus(event); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
                    {source ? <img src={source.url} alt={`来源图片：${source.label}`} className="max-h-[48vh] w-full object-contain" /> : <p className="px-4 text-center text-sm text-text-muted">先生成或上传场景图片</p>}
                    {kind === "camera" && source && focus && <span aria-label="镜头对焦点" className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/20 shadow-lg" style={{ left: `${focusX}%`, top: `${focusY}%` }} />}
                </div>
                <div className="rounded-lg border border-glass-border bg-surface-inset p-4" aria-label={kind === "lighting" ? "光影参数示意" : "镜头参数示意"}>
                    <div className="mb-3 flex items-center justify-between gap-2 text-xs text-text-secondary"><span>参数示意</span><span>{kind === "lighting" ? `${lightSide}主光 · ${brightness}%` : `${cameraPresets.find((item) => item.key === cameraPreset)?.label} · ${distances[distance]}`}</span></div>
                    {kind === "lighting" ? <div className="relative mx-auto flex h-48 max-w-sm items-center justify-center overflow-hidden rounded-md border border-glass-border bg-background" data-testid="lighting-preview">
                        <span className="absolute h-32 w-32 rounded-full opacity-20 blur-3xl" style={{ left: lightPosition[lightSide].left, top: lightPosition[lightSide].top, backgroundColor: color }} />
                        <span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg" style={{ left: lightPosition[lightSide].left, top: lightPosition[lightSide].top, backgroundColor: color, boxShadow: `0 0 20px ${color}` }} aria-label={`${lightSide}主光位置`} />
                        <span className="relative h-28 w-28 rounded-full border border-glass-border" style={{ background: `radial-gradient(circle at ${lightSide === "右侧" ? "78% 45%" : lightSide === "底部" ? "50% 80%" : lightSide === "左侧" ? "22% 45%" : "40% 25%"}, ${color} ${Math.max(5, Math.round(brightness / 4))}%, #344054 85%, #111827 100%)`, boxShadow: rimLight ? `0 0 22px ${color}` : "none" }} />
                        <span className="absolute bottom-2 text-[11px] text-text-muted">{viewMode === "front" ? "正面观察" : "透视观察"}{rimLight ? " · 轮廓光" : ""}</span>
                    </div> : <div className="relative mx-auto flex h-48 max-w-sm items-center justify-center rounded-md border border-glass-border bg-background" data-testid="camera-preview">
                        <span className="absolute h-32 w-32 rounded-full border border-dashed border-glass-border" />
                        <button type="button" aria-label="镜头向上" onClick={() => setPitch((value) => Math.max(-90, value - 15))} className="absolute left-1/2 top-1 -translate-x-1/2 rounded px-3 py-1 text-text-secondary hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">↑</button>
                        <button type="button" aria-label="镜头向下" onClick={() => setPitch((value) => Math.min(90, value + 15))} className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded px-3 py-1 text-text-secondary hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">↓</button>
                        <button type="button" aria-label="镜头向左" onClick={() => setYaw((value) => Math.max(-180, value - 15))} className="absolute left-1 top-1/2 -translate-y-1/2 rounded px-3 py-1 text-text-secondary hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">←</button>
                        <button type="button" aria-label="镜头向右" onClick={() => setYaw((value) => Math.min(180, value + 15))} className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-3 py-1 text-text-secondary hover:bg-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">→</button>
                        <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-primary/50 bg-primary/10 text-xs text-text-secondary" style={{ transform: `perspective(600px) rotateY(${yaw / 3}deg) rotateX(${-pitch / 3}deg) scale(${0.75 + distance * 0.12})` }}>场景</div>
                        <span className="absolute bottom-2 text-[11px] text-text-muted">水平 {yaw}° · 俯仰 {pitch}°</span>
                    </div>}
                </div>
            </div>
            <div className="min-w-0 space-y-5">
                {kind === "lighting" ? <>
                    <fieldset className="space-y-2"><legend className="text-sm font-medium text-foreground">观察模式</legend><div className="flex gap-2"><button type="button" className={option} aria-pressed={viewMode === "perspective"} onClick={() => setViewMode("perspective")}>透视</button><button type="button" className={option} aria-pressed={viewMode === "front"} onClick={() => setViewMode("front")}>正面</button></div></fieldset>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={intelligent} onChange={(event) => setIntelligent(event.target.checked)} className="accent-primary" />智能模式</label>
                    <fieldset disabled={!intelligent} className="space-y-2 disabled:opacity-50"><legend className="text-sm font-medium text-foreground">光影预设</legend><div className="flex flex-wrap gap-2">{lightPresets.map((item) => <button type="button" key={item.key} className={option} aria-pressed={lightPreset === item.key} onClick={() => setLightPreset(item.key)}>{item.label}</button>)}</div></fieldset>
                    <label className="block text-sm text-text-secondary" htmlFor="lighting-reference">光影参考图（可选）</label>
                    <select id="lighting-reference" className={`${control} w-full`} value={activeLightingReference?.key ?? ""} onChange={(event) => setLightingReferenceKey(event.target.value)} disabled={!intelligent || !lightingReferences.length}>
                        <option value="">不使用附加参考图</option>{lightingReferences.filter((item) => !(item.reference.asset_type === "scene" && item.reference.asset_id === sceneAssetId && item.reference.variant_id === source?.variantId)).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                    {activeLightingReference && <img src={activeLightingReference.url} alt={`光影参考图：${activeLightingReference.label}`} className="h-24 w-24 rounded-md border border-glass-border object-cover" />}
                    <label className="block text-sm text-text-secondary">亮度 · {brightness}%<input type="range" min="0" max="100" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="flex items-center gap-3 text-sm text-text-secondary">主光颜色<input type="color" aria-label="主光颜色" value={color} onChange={(event) => setColor(event.target.value)} className="h-10 w-14 cursor-pointer rounded border border-glass-border bg-surface" /></label>
                    <fieldset className="space-y-2"><legend className="text-sm font-medium text-foreground">主光方向</legend><div className="flex flex-wrap gap-2">{lightSides.map((side) => <button type="button" key={side} className={option} aria-pressed={lightSide === side} onClick={() => setLightSide(side)}>{side}</button>)}</div></fieldset>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={rimLight} onChange={(event) => setRimLight(event.target.checked)} className="accent-primary" />轮廓光</label>
                </> : <>
                    <fieldset className="space-y-2"><legend className="text-sm font-medium text-foreground">镜头预设</legend><div className="flex flex-wrap gap-2">{cameraPresets.map((item) => <button type="button" key={item.key} className={option} aria-pressed={cameraPreset === item.key} onClick={() => setCameraPreset(item.key)}>{item.label}</button>)}</div></fieldset>
                    <label className="block text-sm text-text-secondary">水平环绕 · {yaw}°<input type="range" min="-180" max="180" value={yaw} onChange={(event) => setYaw(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="block text-sm text-text-secondary">垂直俯仰 · {pitch}°<input type="range" min="-90" max="90" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="block text-sm text-text-secondary">景别缩放 · {distances[distance]}<input type="range" min="0" max="4" value={distance} onChange={(event) => setDistance(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={focus} onChange={(event) => setFocus(event.target.checked)} className="accent-primary" />指定对焦点</label>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={cameraPromptEnabled} onChange={(event) => setCameraPromptEnabled(event.target.checked)} className="accent-primary" />启用补充提示词</label>
                    {focus && <div className="grid gap-3 sm:grid-cols-3"><label className="block text-sm text-text-secondary">水平位置 · {focusX}%<input type="range" min="0" max="100" value={focusX} onChange={(event) => setFocusX(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label><label className="block text-sm text-text-secondary">垂直位置 · {focusY}%<input type="range" min="0" max="100" value={focusY} onChange={(event) => setFocusY(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label><label className="block text-sm text-text-secondary">对焦范围 · {focusRadius}%<input type="range" min="6" max="42" value={focusRadius} onChange={(event) => setFocusRadius(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label></div>}
                </>}
                <label className="block text-sm text-text-secondary" htmlFor={`${kind}-extra`}>补充提示词</label>
                <textarea id={`${kind}-extra`} value={extra} onChange={(event) => setExtra(event.target.value)} onFocus={() => { if (kind === "camera") setCameraPromptEnabled(true); }} disabled={kind === "lighting" && !intelligent} rows={3} className={`${control} w-full py-2 disabled:opacity-50`} placeholder={kind === "lighting" ? "补充想要的光影氛围" : "补充镜头位置或构图要求"} />
                <div className="flex flex-wrap gap-2"><button type="button" onClick={reset} className={option}>重置参数</button><button type="button" disabled={!source || busy} onClick={submit} className="min-h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{busy ? "生成中…" : kind === "lighting" ? "生成光影候选" : "生成镜头候选"}</button></div>
            </div>
        </div>
    </section>;
}
