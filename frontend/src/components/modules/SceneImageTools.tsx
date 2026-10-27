"use client";

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import dynamic from "next/dynamic";
import { describeSceneDirection } from "@/lib/sceneDirection";
import { api, type AssetLibraryReference } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import SceneAtmosphereTemplates from "@/components/shared/SceneAtmosphereTemplates";
import ScenePromptLayersPanel from "@/components/shared/ScenePromptLayersPanel";
import { compileScenePromptLayers, type ScenePromptLayers } from "@/lib/scenePromptLayers";
import AssetWorkbenchLayout from "@/components/shared/AssetWorkbenchLayout";

const SceneDirectionSphere = dynamic(() => import("@/components/shared/SceneDirectionSphere"), { ssr: false });

export type SceneImageSource = {
    key: string;
    label: string;
    url: string;
    variantId: string;
    tool?: SceneToolParams;
    sourceVariantId?: string;
};

export type LightingReference = { key: string; label: string; url: string; reference: AssetLibraryReference; tool?: Extract<SceneToolParams, { kind: "lighting" }> };
export type SceneToolParams = { panel_settings?: ScenePromptLayers } & (
    | { kind: "lighting"; view_mode: "perspective" | "front"; intelligent: boolean; brightness: number; color: string; light_side: "left" | "top" | "right" | "front" | "bottom" | "back"; azimuth?: number; elevation?: number; rim_light: boolean; preset: string | null; extra: string }
    | { kind: "camera"; preset: string; yaw: number; pitch: number; zoom: number; focus: boolean; focus_x: number; focus_y: number; focus_radius: number; prompt_enabled: boolean; extra: string });

const cameraPresets = [
    { key: "custom", label: "自定义" }, { key: "fisheye", label: "鱼眼视角" },
    { key: "tilted", label: "倾斜视角" }, { key: "front_top_down", label: "正面俯拍" },
    { key: "front_bottom_up", label: "正面仰拍" }, { key: "panoramic_top_down", label: "全景俯拍" },
    { key: "rear_view", label: "背面视角" },
] as const;
const lightSides = ["左侧", "顶部", "右侧", "前方", "底部", "后方"] as const;
const LIGHT_SIDE_LABELS: Record<"left" | "top" | "right" | "front" | "bottom" | "back", (typeof lightSides)[number]> = {
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
        const side = params.azimuth != null && params.elevation != null ? describeSceneDirection(params.azimuth, params.elevation) : { left: "左侧", top: "顶部", right: "右侧", front: "前方", bottom: "底部", back: "后方" }[params.light_side];
        const guide = params.brightness >= 75 ? "受光区域明显，但高光不要过曝。" : params.brightness >= 45 ? "保持自然明暗层次和稳定反差。" : "阴影占比更高，整体照度克制。";
        const preset = params.preset ? ({ nolan_cool_gray: "电影级冷灰色调，克制主光和干净阴影，保留主体材质细节。", golden_hour: "低角度暖阳，琥珀金高光，柔和阴影和傍晚余晖层次。", mystic_shadow: "百叶窗切割式局部受光，背景克制，明暗对比鲜明。", cyberpunk: "冷暖霓虹边缘光和环境反射光，主体轮廓清晰。", blue_rim: "蓝色逆光勾勒主体，正面仍可辨识。", expired_film: "轻微偏色、暖黄褪色和高光泛雾，保留清晰结构。", cinematic_portrait: "柔和主光与轻微轮廓光，压住杂光，保留空间层次。", studio_softbox: "柔光箱近距离补光，减弱硬阴影，照明均匀干净。" } as Record<string, string>)[params.preset] : "";
        return ["任务目标：仅重塑来源场景图片的打光与光影氛围。保持主体、材质、结构、构图、物体位置和镜头语言连续；不要新增物体。", `观察模式：${params.view_mode === "front" ? "正面" : "透视"}。主光从${side}进入，受光方向必须与阴影方向一致。`, params.azimuth != null && params.elevation != null ? `主光方位角 ${params.azimuth}°，仰角 ${params.elevation}°；坐标系 Z 向上，方位 0° 为前方、90° 为右侧。` : "", `主光颜色 ${params.color}，亮度 ${params.brightness}%。${guide}`, params.panel_settings ? "" : params.rim_light ? "增加克制的轮廓光。" : "不额外增加明显轮廓光。", params.intelligent ? preset : "仅根据结构化灯位、光色和亮度重塑光照。", params.intelligent ? params.extra.trim() : "", params.panel_settings ? compileScenePromptLayers(params.panel_settings) : "", hasLightingReference ? "第二张图片仅供参考灯位、明暗分布、色温及氛围；场景内容必须来自第一张图片。" : "", "结果应呈现真实受光面、阴影面与空间层次，不要只做整体滤镜变色。"].filter(Boolean).join("\n");
    }
    const preset = ({ custom: "自定义", fisheye: "鱼眼视角", tilted: "倾斜视角", front_top_down: "正面俯拍", front_bottom_up: "正面仰拍", panoramic_top_down: "全景俯拍", rear_view: "背面视角" } as Record<string, string>)[params.preset];
    return ["基于来源场景图片重定位相机视角。保持同一场景的主体、材质、结构、物体位置关系和核心风格；不要生成新场景。", `${params.panel_settings ? "镜头设置" : `预设视角：${preset}`}；水平环绕 ${params.yaw}°；垂直俯仰 ${params.pitch}°；景别 ${distances[params.zoom]}。`, params.focus ? `对焦点：图片坐标 x=${params.focus_x}%、y=${params.focus_y}%，影响半径约 ${params.focus_radius}%；保持该区域清晰稳定。` : "", params.prompt_enabled ? params.extra.trim() : "", params.panel_settings ? compileScenePromptLayers(params.panel_settings) : ""].filter(Boolean).join("\n");
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
    const [lightAngles, setLightAngles] = useState<{ azimuth: number; elevation: number } | null>(null);
    const [panelSettings, setPanelSettings] = useState<ScenePromptLayers | undefined>({});
    const [rimLight, setRimLight] = useState(false);
    const [lightingPreset, setLightingPreset] = useState<string | null>(null);
    const [lightingReferenceKey, setLightingReferenceKey] = useState("");
    const [uploadedLightingReference, setUploadedLightingReference] = useState<LightingReference | null>(null);
    const [uploadingLightingReference, setUploadingLightingReference] = useState(false);
    const [lightingReferenceError, setLightingReferenceError] = useState("");
    const [reviewedPrompt, setReviewedPrompt] = useState("");
    const manualLightingSettings = useRef<{
        brightness: number; viewMode: "perspective" | "front"; color: string;
        lightSide: (typeof lightSides)[number]; lightAngles: { azimuth: number; elevation: number } | null;
        panelSettings: ScenePromptLayers | undefined; rimLight: boolean; lightingPreset: string | null; extra: string;
    } | null>(null);
    const copiedLightingReferenceKey = useRef<string | null>(null);
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
    const control = "min-h-10 rounded-md border border-glass-border bg-surface px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
    const option = "min-h-10 rounded-md border border-glass-border px-3 text-sm text-text-secondary hover:bg-hover-bg aria-pressed:border-primary aria-pressed:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

    function selectLightingReference(key: string, reference = allLightingReferences.find((item) => item.key === key)) {
        setLightingReferenceKey(key);
        setReviewedPrompt("");
        setLightingReferenceError("");
        if (reference?.tool) {
            if (!copiedLightingReferenceKey.current) {
                manualLightingSettings.current = { brightness, viewMode, color, lightSide, lightAngles, panelSettings, rimLight, lightingPreset, extra };
            }
            const tool = reference.tool;
            setBrightness(tool.brightness);
            setViewMode(tool.view_mode);
            setColor(tool.color);
            setLightSide(LIGHT_SIDE_LABELS[tool.light_side]);
            setLightAngles(tool.azimuth != null && tool.elevation != null ? { azimuth: tool.azimuth, elevation: tool.elevation } : null);
            setPanelSettings(tool.panel_settings ?? undefined);
            setRimLight(tool.rim_light);
            setLightingPreset(tool.preset);
            setExtra(tool.extra);
            copiedLightingReferenceKey.current = key;
        } else if (copiedLightingReferenceKey.current) {
            const previous = manualLightingSettings.current;
            if (previous) {
                setBrightness(previous.brightness); setViewMode(previous.viewMode); setColor(previous.color);
                setLightSide(previous.lightSide); setLightAngles(previous.lightAngles);
                setPanelSettings(previous.panelSettings); setRimLight(previous.rimLight);
                setLightingPreset(previous.lightingPreset); setExtra(previous.extra);
            }
            copiedLightingReferenceKey.current = null;
            manualLightingSettings.current = null;
        }
    }

    function submit() {
        if (!source || busy) return;
        const params: SceneToolParams = kind === "lighting" ? {
            kind, view_mode: viewMode, intelligent, brightness, color,
            light_side: ({ 左侧: "left", 顶部: "top", 右侧: "right", 前方: "front", 底部: "bottom", 后方: "back" } as const)[lightSide],
            ...(lightAngles ?? {}), rim_light: rimLight, preset: lightingPreset, panel_settings: panelSettings, extra: intelligent ? extra.trim() : "",
        } : {
            kind, preset: "custom", panel_settings: panelSettings, yaw, pitch, zoom: distance, focus,
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
            selectLightingReference(reference.key, reference);
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
            setLightSide("前方"); setLightAngles(null); setPanelSettings({}); setLightingReferenceKey("");
            setRimLight(false); setLightingPreset(null);
            copiedLightingReferenceKey.current = null; manualLightingSettings.current = null;
        } else {
            setCameraPreset("custom"); setPanelSettings({}); setYaw(0); setPitch(0); setDistance(2);
            setFocus(false); setFocusX(50); setFocusY(50); setFocusRadius(18); setCameraPromptEnabled(false);
        }
        setExtra("");
    }

    return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={kind === "lighting" ? "光影工具" : "镜头工具"}>
        <AssetWorkbenchLayout controls={<div className="space-y-5 p-4 sm:p-5">
                <h3 className="text-base font-semibold text-foreground">{kind === "lighting" ? "光影效果" : "镜头视角"}</h3>
                <p className="text-sm text-text-secondary">选择已保存的场景图片作为本次生成来源。结果将成为该场景的新候选。</p>
                <label className="block text-sm text-text-secondary" htmlFor={`${kind}-source`}>来源图片</label>
                <select id={`${kind}-source`} className={`${control} w-full`} value={source?.key ?? ""} onChange={(event) => { setSourceKey(event.target.value); setReviewedPrompt(""); }} disabled={!sources.length}>
                    {!sources.length && <option value="">暂无可用场景图片</option>}
                    {sources.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
                {source?.tool && <details className="rounded-md border border-glass-border bg-surface-inset px-3 py-2 text-xs text-text-secondary">
                    <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">此候选的生成参数 · {source.tool.kind === "lighting" ? "光影" : "镜头"}</summary>
                    <p className="mt-2">来源版本：{sources.find((item) => item.variantId === source.sourceVariantId)?.label ?? source.sourceVariantId ?? "未知"}</p>
                    {source.tool.kind === "lighting" ? <p className="mt-1">方向 {source.tool.azimuth != null && source.tool.elevation != null ? `${describeSceneDirection(source.tool.azimuth, source.tool.elevation)} · ${source.tool.azimuth}°/${source.tool.elevation}°` : LIGHT_SIDE_LABELS[source.tool.light_side]} · 亮度 {source.tool.brightness}% · 颜色 {source.tool.color} · {source.tool.rim_light ? "有轮廓光" : "无轮廓光"}</p>
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
                    <label className="block text-sm text-text-secondary" htmlFor="lighting-reference">光影参考图（可选）</label>
                    <select id="lighting-reference" className={`${control} w-full`} value={activeLightingReference?.key ?? ""} onChange={(event) => selectLightingReference(event.target.value)} disabled={!intelligent || !allLightingReferences.length}>
                        <option value="">不使用附加参考图</option>{allLightingReferences.filter((item) => !(item.reference.asset_type === "scene" && item.reference.asset_id === sceneAssetId && item.reference.variant_id === source?.variantId)).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                    <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-glass-border px-3 text-sm text-text-secondary hover:bg-hover-bg focus-within:outline focus-within:outline-2 focus-within:outline-primary">
                        {uploadingLightingReference ? "上传中…" : "上传光影参考图"}
                        <input type="file" accept="image/*" className="sr-only" disabled={!intelligent || uploadingLightingReference || busy} onChange={uploadLightingReference} />
                    </label>
                    {lightingReferenceError && <p role="alert" className="text-sm text-red-400">{lightingReferenceError}</p>}
                    {activeLightingReference && <img src={activeLightingReference.url} alt={`光影参考图：${activeLightingReference.label}`} className="h-24 w-24 rounded-md border border-glass-border object-cover" />}
                    {activeLightingReference && <p className="text-xs text-text-muted">{activeLightingReference.tool ? "已读取参考图保存的光影参数，可继续调整。" : "这张图没有保存可复制的光影参数，仅作视觉参考。"}</p>}
                    <label className="block text-sm text-text-secondary">亮度 · {brightness}%<input type="range" min="0" max="100" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="flex items-center gap-3 text-sm text-text-secondary">主光颜色<input type="color" aria-label="主光颜色" value={color} onChange={(event) => setColor(event.target.value)} className="h-10 w-14 cursor-pointer rounded border border-glass-border bg-surface" /></label>
                    <fieldset className="space-y-2"><legend className="text-sm font-medium text-foreground">主光方向</legend><div className="flex flex-wrap gap-2">{lightSides.map((side) => <button type="button" key={side} className={option} aria-pressed={!lightAngles && lightSide === side} onClick={() => { setLightSide(side); setLightAngles(null); }}>{side}</button>)}</div></fieldset>
                </> : <>
                    <label className="block text-sm text-text-secondary">水平环绕 · {yaw}°<input type="range" min="-180" max="180" value={yaw} onChange={(event) => setYaw(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="block text-sm text-text-secondary">垂直俯仰 · {pitch}°<input type="range" min="-90" max="90" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="block text-sm text-text-secondary">景别缩放 · {distances[distance]}<input type="range" min="0" max="4" value={distance} onChange={(event) => setDistance(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={focus} onChange={(event) => setFocus(event.target.checked)} className="accent-primary" />指定对焦点</label>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={cameraPromptEnabled} onChange={(event) => setCameraPromptEnabled(event.target.checked)} className="accent-primary" />启用补充提示词</label>
                    {focus && <div className="grid gap-3 sm:grid-cols-3"><label className="block text-sm text-text-secondary">水平位置 · {focusX}%<input type="range" min="0" max="100" value={focusX} onChange={(event) => setFocusX(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label><label className="block text-sm text-text-secondary">垂直位置 · {focusY}%<input type="range" min="0" max="100" value={focusY} onChange={(event) => setFocusY(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label><label className="block text-sm text-text-secondary">对焦范围 · {focusRadius}%<input type="range" min="6" max="42" value={focusRadius} onChange={(event) => setFocusRadius(Number(event.target.value))} className="mt-2 w-full accent-primary" /></label></div>}
                </>}
                {kind === "lighting" && <SceneAtmosphereTemplates onApply={template => {
                    const { angles, direction: _direction, color: _color, ...lighting } = structuredClone(template.settings.lighting || {});
                    setPanelSettings({ lighting }); setRimLight(false); setLightingPreset(null);
                    setLightAngles(angles || null); setLightSide("前方");
                    setColor(template.color); setBrightness(template.brightness); setIntelligent(true);
                    setExtra(_color ? `光色关系：${_color}` : ""); setReviewedPrompt("");
                }} />}
                <ScenePromptLayersPanel value={panelSettings ?? {}} onChange={value => { setPanelSettings(value); setRimLight(false); setLightingPreset(null); setReviewedPrompt(""); }}
                    fields={kind === "lighting" ? { lighting: ["season", "time_of_day", "source", "quality", "fill", "contrast", "shadow", "rim", "mood", "air"] }
                        : { camera: ["focal_length", "depth_of_field"], composition: ["frame_orientation", "subject_position", "spatial_layers", "leading_relation"] }} />
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
                    <SceneDirectionSphere mode={kind === "lighting" ? "light" : "camera"} disabled={busy} color={color}
                        azimuth={kind === "camera" ? yaw : lightAngles?.azimuth ?? ({ 左侧: -90, 顶部: 0, 右侧: 90, 前方: 0, 底部: 0, 后方: 180 } as const)[lightSide]}
                        elevation={kind === "camera" ? -pitch : lightAngles?.elevation ?? (lightSide === "顶部" ? 90 : lightSide === "底部" ? -90 : 0)}
                        onChange={(azimuth, elevation) => { setReviewedPrompt(""); if (kind === "lighting") setLightAngles({ azimuth, elevation }); else { setYaw(azimuth); setPitch(-elevation); setCameraPreset("custom"); } }} />
                    {kind === "lighting" ? <div data-testid="lighting-preview" className="mt-3 space-y-2">
                        <p className="text-xs text-text-secondary">{viewMode === "front" ? "正面观察" : "透视观察"} · {lightAngles ? describeSceneDirection(lightAngles.azimuth, lightAngles.elevation) : lightSide}</p>
                        <label className="block text-sm text-text-secondary">光源方位角
                            <input aria-label="光源方位角" type="range" min={-180} max={180} value={lightAngles?.azimuth ?? ({ 左侧: -90, 顶部: 0, 右侧: 90, 前方: 0, 底部: 0, 后方: 180 } as const)[lightSide]}
                                disabled={busy} onChange={event => { setReviewedPrompt(""); setLightAngles({ azimuth: Number(event.target.value), elevation: lightAngles?.elevation ?? (lightSide === "顶部" ? 90 : lightSide === "底部" ? -90 : 0) }); }} className="w-full accent-primary" />
                        </label>
                        <label className="block text-sm text-text-secondary">光源仰角
                            <input aria-label="光源仰角" type="range" min={-90} max={90} value={lightAngles?.elevation ?? (lightSide === "顶部" ? 90 : lightSide === "底部" ? -90 : 0)}
                                disabled={busy} onChange={event => { setReviewedPrompt(""); setLightAngles({ azimuth: lightAngles?.azimuth ?? ({ 左侧: -90, 顶部: 0, 右侧: 90, 前方: 0, 底部: 0, 后方: 180 } as const)[lightSide], elevation: Number(event.target.value) }); }} className="w-full accent-primary" />
                        </label>
                    </div> : <div data-testid="camera-preview" className="mt-3 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={busy} aria-label="镜头向上" onClick={() => { setPitch(value => Math.max(-90, value - 15)); setCameraPreset("custom"); }} className={option}>↑</button>
                        <button type="button" disabled={busy} aria-label="镜头向下" onClick={() => { setPitch(value => Math.min(90, value + 15)); setCameraPreset("custom"); }} className={option}>↓</button>
                        <button type="button" disabled={busy} aria-label="镜头向左" onClick={() => { setYaw(value => Math.max(-180, value - 15)); setCameraPreset("custom"); }} className={option}>←</button>
                        <button type="button" disabled={busy} aria-label="镜头向右" onClick={() => { setYaw(value => Math.min(180, value + 15)); setCameraPreset("custom"); }} className={option}>→</button>
                        <span className="text-xs text-text-secondary">水平 {yaw}° · 俯仰 {pitch}°</span>
                    </div>}
                </div>

        </div>} />
    </section>;
}
