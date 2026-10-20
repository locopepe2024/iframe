"use client";

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { api, type AssetLibraryReference } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import AssetWorkbenchLayout from "@/components/shared/AssetWorkbenchLayout";

export type SceneImageSource = {
    key: string;
    label: string;
    url: string;
    variantId: string;
    tool?: SceneToolParams;
    sourceVariantId?: string;
};

export type LightingReference = { key: string; label: string; url: string; reference: AssetLibraryReference };
export type SceneToolParams =
    | { kind: "lighting"; view_mode: "perspective" | "front"; intelligent: boolean; brightness: number; color: string; light_side: "left" | "top" | "right" | "front" | "bottom" | "back"; rim_light: boolean; preset: string | null; extra: string }
    | { kind: "camera"; preset: string; yaw: number; pitch: number; zoom: number; focus: boolean; focus_x: number; focus_y: number; focus_radius: number; prompt_enabled: boolean; extra: string };

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
const LIGHT_SIDE_LABELS: Record<"left" | "top" | "right" | "front" | "bottom" | "back", string> = {
    left: "左侧", top: "顶部", right: "右侧", front: "前方", bottom: "底部", back: "后方",
};
const distances = ["远景", "中远景", "中景", "近景", "特写"] as const;

export function containedImageBounds(image: HTMLImageElement) {
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || !image.naturalWidth || !image.naturalHeight) return null;
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}

export function buildSceneToolPrompt(params: SceneToolParams, hasLightingReference = false): string {
    if (params.kind === "lighting") {
        const side = { left: "左侧", top: "顶部", right: "右侧", front: "前方", bottom: "底部", back: "后方" }[params.light_side];
        const guide = params.brightness >= 75 ? "受光区域明显，但高光不要过曝。" : params.brightness >= 45 ? "保持自然明暗层次和稳定反差。" : "阴影占比更高，整体照度克制。";
        const preset = params.preset ? ({ nolan_cool_gray: "电影级冷灰色调，克制主光和干净阴影，保留主体材质细节。", golden_hour: "低角度暖阳，琥珀金高光，柔和阴影和傍晚余晖层次。", mystic_shadow: "百叶窗切割式局部受光，背景克制，明暗对比鲜明。", cyberpunk: "冷暖霓虹边缘光和环境反射光，主体轮廓清晰。", blue_rim: "蓝色逆光勾勒主体，正面仍可辨识。", expired_film: "轻微偏色、暖黄褪色和高光泛雾，保留清晰结构。", cinematic_portrait: "柔和主光与轻微轮廓光，压住杂光，保留空间层次。", studio_softbox: "柔光箱近距离补光，减弱硬阴影，照明均匀干净。" } as Record<string, string>)[params.preset] : "";
        return ["任务目标：仅重塑来源场景图片的打光与光影氛围。保持主体、材质、结构、构图、物体位置和镜头语言连续；不要新增物体。", `观察模式：${params.view_mode === "front" ? "正面" : "透视"}。主光从${side}进入，受光方向必须与阴影方向一致。`, `主光颜色 ${params.color}，亮度 ${params.brightness}%。${guide}`, params.rim_light ? "增加克制的轮廓光。" : "不额外增加明显轮廓光。", params.intelligent ? preset : "仅根据结构化灯位、光色和亮度重塑光照。", params.intelligent ? params.extra.trim() : "", hasLightingReference ? "第二张图片仅供参考灯位、明暗分布、色温及氛围；场景内容必须来自第一张图片。" : "", "结果应呈现真实受光面、阴影面与空间层次，不要只做整体滤镜变色。"].filter(Boolean).join("\n");
    }
    const preset = ({ custom: "自定义", fisheye: "鱼眼视角", tilted: "倾斜视角", front_top_down: "正面俯拍", front_bottom_up: "正面仰拍", panoramic_top_down: "全景俯拍", rear_view: "背面视角" } as Record<string, string>)[params.preset];
    return ["基于来源场景图片重定位相机视角。保持同一场景的主体、材质、结构、物体位置关系和核心风格；不要生成新场景。", `预设视角：${preset}；水平环绕 ${params.yaw}°；垂直俯仰 ${params.pitch}°；景别 ${distances[params.zoom]}。`, params.focus ? `对焦点：图片坐标 x=${params.focus_x}%、y=${params.focus_y}%，影响半径约 ${params.focus_radius}%；保持该区域清晰稳定。` : "", params.prompt_enabled ? params.extra.trim() : ""].filter(Boolean).join("\n");
}

export function SceneImageTools({ kind, sources, sceneAssetId, lightingReferences = [], busy, onGenerate }: {
    kind: "lighting" | "camera";
    sources: SceneImageSource[];
    sceneAssetId?: string;
    lightingReferences?: LightingReference[];
    busy: boolean;
    onGenerate: (source: SceneImageSource, params: SceneToolParams, compiledPrompt: string, lightingReference?: AssetLibraryReference) => void;
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
    const [uploadedLightingReference, setUploadedLightingReference] = useState<LightingReference | null>(null);
    const [uploadingLightingReference, setUploadingLightingReference] = useState(false);
    const [lightingReferenceError, setLightingReferenceError] = useState("");
    const [reviewedPrompt, setReviewedPrompt] = useState("");
    const [cameraPreset, setCameraPreset] = useState<(typeof cameraPresets)[number]["key"]>("custom");
    const [yaw, setYaw] = useState(0);
    const [pitch, setPitch] = useState(0);
    const [distance, setDistance] = useState(2);
    const [focus, setFocus] = useState(false);
    const [focusX, setFocusX] = useState(50);
    const [focusY, setFocusY] = useState(50);
    const [focusRadius, setFocusRadius] = useState(18);
    const imageRef = useRef<HTMLImageElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [focusImageBounds, setFocusImageBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [cameraPromptEnabled, setCameraPromptEnabled] = useState(false);
    const [extra, setExtra] = useState("");
    const source = sources.find((item) => item.key === sourceKey) ?? sources[0];
    const allLightingReferences = uploadedLightingReference ? [uploadedLightingReference, ...lightingReferences] : lightingReferences;
    const lightingReference = allLightingReferences.find((item) => item.key === lightingReferenceKey);
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
        const params: SceneToolParams = kind === "lighting" ? {
            kind, view_mode: viewMode, intelligent, brightness, color,
            light_side: ({ 左侧: "left", 顶部: "top", 右侧: "right", 前方: "front", 底部: "bottom", 后方: "back" } as const)[lightSide],
            rim_light: rimLight, preset: intelligent && lightPreset ? lightPreset === "cool_gray" ? "nolan_cool_gray" : lightPreset : null, extra: intelligent ? extra.trim() : "",
        } : {
            kind, preset: cameraPreset, yaw, pitch, zoom: distance, focus,
            focus_x: focusX, focus_y: focusY, focus_radius: focusRadius,
            prompt_enabled: cameraPromptEnabled, extra: cameraPromptEnabled ? extra.trim() : "",
        };
        const compiledPrompt = buildSceneToolPrompt(params, Boolean(kind === "lighting" && activeLightingReference));
        if (reviewedPrompt !== compiledPrompt) {
            setReviewedPrompt(compiledPrompt);
            return;
        }
        onGenerate(source, params, compiledPrompt, kind === "lighting" ? activeLightingReference?.reference : undefined);
    }

    async function uploadLightingReference(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
            setLightingReferenceError("请选择不超过 10 MB 的图片文件");
            return;
        }
        setUploadingLightingReference(true);
        setLightingReferenceError("");
        try {
            const uploaded = await api.uploadLibraryImage(file);
            const asset = await api.createLibraryAsset("prop", {
                name: `光影参考 · ${file.name}`, image_url: uploaded.image_url, image_origin: "upload",
            });
            const variant = asset.image_asset?.variants?.[0];
            if (!variant?.id || !variant?.url) throw new Error("上传图片没有产生可引用版本");
            const reference: LightingReference = {
                key: `prop:${asset.id}:${variant.id}`, label: asset.name,
                url: getAssetUrl(variant.url),
                reference: { asset_type: "prop", asset_id: asset.id, variant_id: variant.id },
            };
            setUploadedLightingReference(reference);
            setLightingReferenceKey(reference.key);
        } catch (error) {
            setLightingReferenceError(error instanceof Error ? error.message : "上传光影参考图失败");
        } finally {
            setUploadingLightingReference(false);
        }
    }

    function measureFocusImage() {
        const image = imageRef.current;
        const stage = stageRef.current;
        if (!image || !stage) return null;
        const imageBounds = containedImageBounds(image);
        if (!imageBounds) return null;
        const stageBounds = stage.getBoundingClientRect();
        setFocusImageBounds({ left: imageBounds.left - stageBounds.left, top: imageBounds.top - stageBounds.top,
            width: imageBounds.width, height: imageBounds.height });
        return imageBounds;
    }

    function updateFocus(event: PointerEvent<HTMLDivElement>, allowOutside = false) {
        if (!focus) return false;
        const bounds = measureFocusImage();
        if (!bounds) return false;
        if (!allowOutside && (event.clientX < bounds.left || event.clientX > bounds.left + bounds.width
            || event.clientY < bounds.top || event.clientY > bounds.top + bounds.height)) return false;
        setFocusX(Math.round(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * 100));
        setFocusY(Math.round(Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) * 100));
        return true;
    }

    useEffect(() => {
        const update = () => { measureFocusImage(); };
        update();
        window.addEventListener("resize", update);
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        if (stageRef.current) observer?.observe(stageRef.current);
        return () => { window.removeEventListener("resize", update); observer?.disconnect(); };
    }, [source?.url]);

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

    return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={kind === "lighting" ? "光影工具" : "镜头工具"}>
        <AssetWorkbenchLayout controls={<div className="space-y-5 p-4 sm:p-5">
                <h3 className="text-base font-semibold text-foreground">{kind === "lighting" ? "光影效果" : "镜头视角"}</h3>
                <p className="text-sm text-text-secondary">选择已保存的场景图片作为本次生成来源。结果将成为该场景的新候选。</p>
                <label className="block text-sm text-text-secondary" htmlFor={`${kind}-source`}>来源图片</label>
                <select id={`${kind}-source`} className={`${control} w-full`} value={source?.key ?? ""} onChange={(event) => setSourceKey(event.target.value)} disabled={!sources.length}>
                    {!sources.length && <option value="">暂无可用场景图片</option>}
                    {sources.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
                {source?.tool && <details className="rounded-md border border-glass-border bg-surface-inset px-3 py-2 text-xs text-text-secondary">
                    <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">此候选的生成参数 · {source.tool.kind === "lighting" ? "光影" : "镜头"}</summary>
                    <p className="mt-2">来源版本：{sources.find((item) => item.variantId === source.sourceVariantId)?.label ?? source.sourceVariantId ?? "未知"}</p>
                    {source.tool.kind === "lighting" ? <p className="mt-1">方向 {LIGHT_SIDE_LABELS[source.tool.light_side]} · 亮度 {source.tool.brightness}% · 颜色 {source.tool.color} · {source.tool.rim_light ? "有轮廓光" : "无轮廓光"}</p>
                        : <p className="mt-1">{cameraPresets.find((item) => item.key === source.tool?.preset)?.label} · 水平 {source.tool.yaw}° · 俯仰 {source.tool.pitch}° · {distances[source.tool.zoom]}</p>}
                </details>}

                <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-glass-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
                    <button type="button" onClick={() => { setReviewedPrompt(""); reset(); }} className={option}>重置参数</button>
                    <button type="button" aria-label={busy ? "生成中…" : reviewedPrompt ? "确认并生成" : "查看并确认提示词"} disabled={!source || busy} onClick={submit} className="min-h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        {busy ? "生成中…" : reviewedPrompt ? "提交到生成审核" : "查看并确认提示词"}
                    </button>
                    <span className="basis-full text-xs text-text-muted">
                        {reviewedPrompt ? "下一步：核对完整提示词、来源图和参数，再点击“确认并生成”。" : "先查看完整提示词；确认后才会进入生成审核。"}
                    </span>
                </div>
                {kind === "lighting" ? <>
                    <fieldset className="space-y-2"><legend className="text-sm font-medium text-foreground">观察模式</legend><div className="flex gap-2"><button type="button" className={option} aria-pressed={viewMode === "perspective"} onClick={() => setViewMode("perspective")}>透视</button><button type="button" className={option} aria-pressed={viewMode === "front"} onClick={() => setViewMode("front")}>正面</button></div></fieldset>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={intelligent} onChange={(event) => setIntelligent(event.target.checked)} className="accent-primary" />智能模式</label>
                    <fieldset disabled={!intelligent} className="space-y-2 disabled:opacity-50"><legend className="text-sm font-medium text-foreground">光影预设</legend><div className="flex flex-wrap gap-2">{lightPresets.map((item) => <button type="button" key={item.key} className={option} aria-pressed={lightPreset === item.key} onClick={() => setLightPreset(item.key)}>{item.label}</button>)}</div></fieldset>
                    <label className="block text-sm text-text-secondary" htmlFor="lighting-reference">光影参考图（可选）</label>
                    <select id="lighting-reference" className={`${control} w-full`} value={activeLightingReference?.key ?? ""} onChange={(event) => setLightingReferenceKey(event.target.value)} disabled={!intelligent || !allLightingReferences.length}>
                        <option value="">不使用附加参考图</option>{allLightingReferences.filter((item) => !(item.reference.asset_type === "scene" && item.reference.asset_id === sceneAssetId && item.reference.variant_id === source?.variantId)).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                    <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-glass-border px-3 text-sm text-text-secondary hover:bg-hover-bg focus-within:outline focus-within:outline-2 focus-within:outline-primary">
                        {uploadingLightingReference ? "上传中…" : "上传光影参考图"}
                        <input type="file" accept="image/*" className="sr-only" disabled={!intelligent || uploadingLightingReference || busy} onChange={uploadLightingReference} />
                    </label>
                    {lightingReferenceError && <p role="alert" className="text-sm text-red-400">{lightingReferenceError}</p>}
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
                {reviewedPrompt && <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3"><p className="text-xs font-medium text-foreground">提交前提示词核对</p><pre className="max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-text-secondary">{reviewedPrompt}</pre><p className="text-xs text-text-muted">确认后将提交上面这份完整文本。</p></div>}

        </div>} preview={<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
                <div ref={stageRef} className="relative flex min-h-52 items-center justify-center overflow-hidden rounded-lg border border-glass-border bg-surface-inset sm:min-h-72" onPointerDown={(event) => { if (kind === "camera" && updateFocus(event)) event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerMove={(event) => { if (kind === "camera" && event.buttons && event.currentTarget.hasPointerCapture?.(event.pointerId)) updateFocus(event, true); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
                    {source ? <img ref={imageRef} onLoad={() => measureFocusImage()} src={source.url} alt={`来源图片：${source.label}`} className="max-h-[48vh] w-full object-contain" /> : <p className="px-4 text-center text-sm text-text-muted">先生成或上传场景图片</p>}
                    {kind === "camera" && source && focus && focusImageBounds && <span aria-label="镜头对焦点" className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/20 shadow-lg" style={{ left: focusImageBounds.left + focusImageBounds.width * focusX / 100, top: focusImageBounds.top + focusImageBounds.height * focusY / 100 }} />}
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

        </div>} />
    </section>;
}
