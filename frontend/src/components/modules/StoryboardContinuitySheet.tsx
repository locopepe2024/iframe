"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

type Sheet = Awaited<ReturnType<typeof api.getStoryboardContinuitySheet>>;
type Row = Sheet["rows"][number];

const FIELD_LABELS: Record<string, string> = {
    story_time: "叙事时间", daylight_phase: "日光阶段", weather: "天气", shadow_direction: "阴影方向",
    key_source: "主光来源", color_tone: "色调", contrast: "对比", practical_sources: "实景光源",
    direction: "光线方向", quality: "光线质感", color_temp: "色温", ambient_lighting: "环境光",
    location: "地点", reference_viewpoint: "空间视角", reference_framing: "空间取景",
    shot_size: "景别", camera_angle: "机位", composition: "构图", camera_movement: "运镜",
    lighting_override: "局部光覆盖", style: "风格", aspect_ratio: "画幅",
    duration: "时长", transition_hint: "转场",
};
const SOURCE_LABELS: Record<string, string> = {
    scene_asset: "场景资产", scene_design: "场景设计", plan_scene: "拍摄计划场景",
    plan_baseline: "拍摄计划光线", plan_shot: "拍摄计划镜头", frame: "本镜头",
    selected_reference: "已确认参考", art_direction: "美术方向", project: "项目", model_settings: "模型设置",
};

function valueText(value: unknown): string {
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join("、");
    if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${valueText(item)}`).join("; ");
    return value == null ? "未确认" : String(value).replace(/\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\b/gi, "已关联对象");
}

export default function StoryboardContinuitySheet({ projectId, revisionKey, focusedFrameId, focusVersion, onOpenFrame, openFrameLabel = "编辑分镜首帧" }: {
    projectId: string; revisionKey: string; focusedFrameId?: string | null; focusVersion?: number; onOpenFrame: (frameId: string) => void; openFrameLabel?: string;
}) {
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [sceneFilter, setSceneFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [openRow, setOpenRow] = useState<string | null>(null);
    const [refreshCount, setRefreshCount] = useState(0);
    const focusedRowRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!focusedFrameId) return;
        setSceneFilter("");
        setStatusFilter("all");
        setOpenRow(focusedFrameId);
    }, [focusedFrameId, focusVersion]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        api.getStoryboardContinuitySheet(projectId)
            .then(result => { if (active) setSheet(result); })
            .catch(() => { if (active) setError("一致性表读取失败，请重试。"); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [projectId, revisionKey, refreshCount]);

    const sceneOptions = useMemo(() => Array.from(new Map((sheet?.rows || []).map(row => [row.scene_id, row.scene_name])).entries()), [sheet]);
    const rows = useMemo(() => (sheet?.rows || []).filter(row => {
        const issues = sheet?.issues.filter(issue => issue.frame_ids.includes(row.frame_id)) || [];
        return (!sceneFilter || row.scene_id === sceneFilter) &&
            (statusFilter === "all" || (statusFilter === "issues" && issues.length > 0) ||
                (statusFilter === "unresolved" && row.continuity_status === "unresolved") ||
                (statusFilter === "clear" && row.continuity_status === "confirmed" && issues.length === 0));
    }), [sheet, sceneFilter, statusFilter]);
    useEffect(() => {
        if (focusedFrameId && sheet?.rows.some(row => row.frame_id === focusedFrameId)) {
            focusedRowRef.current?.scrollIntoView?.({ block: "nearest" });
        }
    }, [focusedFrameId, focusVersion, sheet, rows]);
    const frameNumbers = useMemo(() => new Map((sheet?.rows || []).map((row, index) => [row.frame_id, index + 1])), [sheet]);

    return <section aria-label="分镜结构化一致性表" className="border-b border-border-subtle bg-surface/70 px-4 py-3 md:px-8">
        <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">结构化一致性</h2>
                    {sheet && <span className="text-xs text-text-muted">{sheet.rows.length} 镜 · {sheet.issues.length} 项差异</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select aria-label="筛选场景" value={sceneFilter} onChange={event => setSceneFilter(event.target.value)} className="rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                        <option value="">所有场景</option>
                        {sceneOptions.map(([id, name], index) => <option key={id} value={id}>{name || `未命名场景 ${index + 1}`}</option>)}
                    </select>
                    <select aria-label="筛选一致性状态" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded border border-glass-border bg-surface px-2 py-1 text-xs text-foreground">
                        <option value="all">全部</option><option value="issues">有差异</option>
                        <option value="unresolved">无法判断</option><option value="clear">无已知差异</option>
                    </select>
                    <button type="button" title="刷新一致性表" aria-label="刷新一致性表" onClick={() => setRefreshCount(value => value + 1)} className="rounded p-1.5 text-text-secondary hover:bg-hover-bg hover:text-foreground"><RefreshCw size={15} /></button>
                </div>
            </div>
            <p className="mt-1 text-xs text-text-muted">这里展示已保存字段的来源与差异；图片和视频的实际提交内容以各自生成预览为准。</p>
            {loading && <p role="status" className="mt-3 text-xs text-text-muted">正在读取一致性表…</p>}
            {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
            {!loading && !error && sheet && <div className="mt-3 max-h-72 overflow-auto border-t border-border-subtle">
                {!rows.length && <p className="py-4 text-xs text-text-muted">当前筛选没有镜头。</p>}
                {rows.map(row => {
                    const issues = sheet.issues.filter(issue => issue.frame_ids.includes(row.frame_id));
                    const expanded = openRow === row.frame_id;
                    return <div key={row.frame_id} ref={row.frame_id === focusedFrameId ? focusedRowRef : undefined} className={`border-b border-border-subtle ${row.frame_id === focusedFrameId ? "bg-primary/10" : ""}`}>
                        <button type="button" aria-expanded={expanded} onClick={() => setOpenRow(expanded ? null : row.frame_id)} className="flex w-full items-center gap-3 py-2 text-left text-xs hover:bg-hover-bg/50">
                            {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                            <span className="w-20 shrink-0 text-text-secondary">分镜 {frameNumbers.get(row.frame_id)}</span>
                            <span className="min-w-0 flex-1 truncate text-foreground">{row.scene_name || "未命名场景"}</span>
                            <span className="hidden text-text-muted sm:inline">{row.fields.story_time ? valueText(row.fields.story_time.value) : "时间未确认"} · {row.fields.aspect_ratio ? valueText(row.fields.aspect_ratio.value) : "画幅未确认"}</span>
                            {row.continuity_status === "unresolved" ? <span className="text-text-muted">无法判断</span> : issues.length ? <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={13} />{issues.length} 项</span> : <span className="flex items-center gap-1 text-emerald-400"><Check size={13} />无已知差异</span>}
                        </button>
                        {expanded && <div className="pb-3 pl-7 text-xs">
                            <p className="mb-2 text-text-muted">地点连续性：{row.place_continuity_id ? "已确认" : "未确认"} · 时间连续性：{row.time_continuity_id ? "已确认" : "未确认"} · 计划版本 {row.plan_revision || "未确认"} · 场景设计版本 {row.scene_design_revision || "未确认"}</p>
                            <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                                {Object.entries(row.fields).map(([key, field]) => <div key={key} className="min-w-0 border-l border-glass-border pl-2">
                                    <span className="text-text-muted">{FIELD_LABELS[key] || key} · {SOURCE_LABELS[field.source_kind] || field.source_kind}{field.source_revision ? ` r${field.source_revision}` : ""}</span>
                                    <p className="break-words text-foreground">{valueText(field.value)}</p>
                                </div>)}
                            </div>
                            {row.reference && <p className="mt-2 text-text-muted">参考图：{row.reference.source_variant_id ? "已绑定" : "未确认"} · 来源设计版本 {row.reference.source_design_revision || "未确认"} · 已勾选：{row.reference.selected_fields.join("、") || "仅参考图"}</p>}
                            {issues.map((issue, index) => <p key={`${issue.field}-${index}`} className="mt-2 text-amber-300">{FIELD_LABELS[issue.field] || issue.field}：{issue.values.map(item => valueText(item.value)).join(" / ")} · {issue.status === "explicit_override" ? "镜头显式覆盖，需审阅" : "跨镜差异，需审阅"}</p>)}
                            <button type="button" onClick={() => onOpenFrame(row.frame_id)} className="mt-2 text-primary hover:underline">{openFrameLabel}</button>
                        </div>}
                    </div>;
                })}
            </div>}
        </div>
    </section>;
}
