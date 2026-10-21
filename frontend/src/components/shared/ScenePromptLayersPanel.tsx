"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { SCENE_LAYER_FIELDS, type SceneLayer, type SceneLayerAngles, type ScenePromptLayers } from "@/lib/scenePromptLayers";

const SceneDirectionSphere = dynamic(() => import("./SceneDirectionSphere"), { ssr: false });
const layerNames: Record<SceneLayer, string> = { lighting: "光影", camera: "镜头", composition: "构图" };

export default function ScenePromptLayersPanel({ value, onChange, fields }: {
    value: ScenePromptLayers; onChange: (value: ScenePromptLayers) => void;
    fields?: Partial<Record<SceneLayer, readonly string[]>>;
}) {
    const [openSpheres, setOpenSpheres] = useState<Partial<Record<SceneLayer, boolean>>>({});
    const update = (layer: SceneLayer, patch: Record<string, unknown>) => onChange({
        ...value, version: 1, [layer]: { ...value[layer], ...patch },
    });
    return <div className="space-y-3" aria-label="光影镜头构图">
        {(Object.keys(SCENE_LAYER_FIELDS) as SceneLayer[]).map(layer => {
            const layerFields = fields ? SCENE_LAYER_FIELDS[layer].filter(field => fields[layer]?.includes(field.key)) : SCENE_LAYER_FIELDS[layer];
            if (fields && !layerFields.length) return null;
            const selected = value[layer] as Record<string, string | SceneLayerAngles | null> | undefined;
            const angles = selected?.angles as SceneLayerAngles | null | undefined;
            const directionKey = layer === "lighting" ? "direction" : "viewpoint";
            const setAngles = (azimuth: number, elevation: number) => update(layer, { [directionKey]: "", angles: { azimuth, elevation } });
            return <details key={layer} className="rounded-lg border border-glass-border p-3">
                <summary className="min-h-11 cursor-pointer text-sm font-medium text-foreground">{layerNames[layer]}</summary>
                <div className="space-y-4 pt-2">
                    {layerFields.map(field => <fieldset key={field.key}>
                        <legend className="mb-2 text-xs text-text-secondary">{field.label}</legend>
                        <div className="grid grid-cols-3 gap-2">
                            {field.options.map(([label, text]) => <button key={text} type="button" title={text}
                                aria-pressed={selected?.[field.key] === text}
                                onClick={() => update(layer, { [field.key]: selected?.[field.key] === text ? "" : text,
                                    ...(field.key === directionKey ? { angles: null } : {}) })}
                                className="min-h-11 rounded-md border border-glass-border px-2 py-2 text-sm text-text-secondary aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                                {label}
                            </button>)}
                        </div>
                        {typeof selected?.[field.key] === "string" && selected[field.key] &&
                            <p className="mt-1 text-xs text-text-muted">{String(selected[field.key])}</p>}
                    </fieldset>)}
                    {!fields && layer === "camera" && <fieldset className="space-y-2 rounded border border-glass-border p-3">
                        <legend className="px-1 text-xs text-text-secondary">对焦</legend>
                        <label className="block text-xs text-text-secondary">对焦目标
                            <input aria-label="对焦目标" maxLength={500} value={value.camera?.focus?.target || ""}
                                placeholder="例如：门口石狮、远处山门"
                                onChange={event => {
                                    const focus = { ...value.camera?.focus, target: event.target.value };
                                    update("camera", { focus: focus.target.trim() || typeof focus.x === "number" ? focus : null });
                                }} className="mt-1 min-h-11 w-full rounded border border-glass-border bg-input-bg px-2 text-sm text-foreground" />
                        </label>
                        <label className="flex min-h-11 items-center gap-2 text-xs text-text-secondary">
                            <input type="checkbox" checked={typeof value.camera?.focus?.x === "number"}
                                onChange={event => {
                                    const target = value.camera?.focus?.target || "";
                                    update("camera", { focus: event.target.checked ? { target, x: 50, y: 50, radius: 18 }
                                        : target.trim() ? { target } : null });
                                }} />指定画面对焦位置
                        </label>
                        {typeof value.camera?.focus?.x === "number" && <>
                            <div className="grid grid-cols-3 gap-2">
                                {([ ["x", "水平位置", 0, 100], ["y", "垂直位置", 0, 100], ["radius", "清晰范围", 6, 42] ] as const).map(([key, label, min, max]) =>
                                    <label key={key} className="text-xs text-text-secondary">{label} · {value.camera?.focus?.[key]}%
                                        <input aria-label={`对焦${label}`} type="range" min={min} max={max} step={1}
                                            value={value.camera?.focus?.[key] ?? (key === "radius" ? 18 : 50)} className="mt-2 w-full"
                                            onChange={event => update("camera", { focus: { ...value.camera?.focus, [key]: Number(event.target.value) } })} />
                                    </label>)}
                            </div>
                            <p className="text-xs text-text-muted">画面左上角为原点，X 向右、Y 向下。位置与范围以画面百分比表示。</p>
                        </>}
                    </fieldset>}
                    {!fields && layer !== "composition" && <details className="rounded border border-glass-border p-2"
                        onToggle={event => { const open = event.currentTarget.open; setOpenSpheres(current => ({ ...current, [layer]: open })); }}>
                        <summary className="min-h-11 cursor-pointer text-xs text-text-secondary">三维{layer === "lighting" ? "光源" : "机位"}方向{angles ? " · 已设置" : ""}</summary>
                        {openSpheres[layer] && <SceneDirectionSphere mode={layer === "lighting" ? "light" : "camera"}
                            azimuth={angles?.azimuth ?? 0} elevation={angles?.elevation ?? 0} onChange={setAngles} />}
                        <div className="grid grid-cols-2 gap-3 py-2">
                            {(["azimuth", "elevation"] as const).map(key => <label key={key} className="text-xs text-text-secondary">
                                {key === "azimuth" ? "方位角" : "仰角"}
                                <input aria-label={`${layerNames[layer]}${key === "azimuth" ? "方位角" : "仰角"}`}
                                    type="range" min={key === "azimuth" ? -180 : -90} max={key === "azimuth" ? 180 : 90} step={1}
                                    value={angles?.[key] ?? 0} className="w-full"
                                    onChange={event => setAngles(key === "azimuth" ? Number(event.target.value) : angles?.azimuth ?? 0,
                                        key === "elevation" ? Number(event.target.value) : angles?.elevation ?? 0)} />
                            </label>)}
                        </div>
                        {angles && <button type="button" onClick={() => update(layer, { angles: null })}
                            className="min-h-11 text-xs text-text-secondary underline">清除三维方向</button>}
                    </details>}
                </div>
            </details>;
        })}
    </div>;
}
