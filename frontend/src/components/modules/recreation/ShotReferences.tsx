"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Pencil, Save, Search, Sparkles, Upload, X } from "lucide-react";
import { API_URL } from "@/lib/api";
import { recreationApi, RecreationAssemblyTask, RecreationGenerationTask, RecreationKeyframeTask, RecreationMedia, RecreationModelOption, RecreationModelOptions, RecreationProject, RecreationShot, RecreationPlan, seconds } from "@/lib/recreation";

import MaterialInstruction from "./MaterialInstruction";

const ImageEditor = dynamic(() => import("@/components/shared/image-editor/ImageEditor"), { ssr: false });
const url = (path: string) => path.startsWith("/") ? `${API_URL}${path}` : path;
type Role = "reference" | "replacement";
const terminalTask = (status: string) => status === "completed" || status === "failed" || status === "cancelled";
const DEFAULT_VIDEO_MODEL = "uniart/minimax-h3-vip";
const DEFAULT_IMAGE_MODEL = "uniart/gpt-image-2";
type RunStatus = "pending" | "active" | "complete" | "failed";
type RunProgress = { generation: RunStatus; assembly: RunStatus };
const FALLBACK_VIDEO_MODEL: RecreationModelOption = {
  id: DEFAULT_VIDEO_MODEL, display_name: "UniArt Minimax H3 VIP", description: "", capabilities: ["r2v"],
};
const FALLBACK_IMAGE_MODEL: RecreationModelOption = {
  id: DEFAULT_IMAGE_MODEL, display_name: "UniArt GPT Image 2", description: "", capabilities: ["i2i"],
};

function Picker({ onSelect, onClose }: { onSelect: (item: RecreationMedia) => void; onClose: () => void }) {
  const t = useTranslations("shotReferences");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("evidence_frame");
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState<{ items: RecreationMedia[]; next_cursor: number | null }>({ items: [], next_cursor: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(false);
    recreationApi.searchMedia({ q: search, kind, cursor, limit: 12 }).then(result => { if (active) setPage(result); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [search, kind, cursor, retry]);
  return <section aria-label={t("choose")} className="border-y border-border py-4 space-y-3">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setCursor(0); setSearch(query); }}>
      <input className="glass-input min-w-0 flex-1" aria-label={t("search")} value={query} onChange={e => setQuery(e.target.value)} />
      <button className="glass-button" title={t("search")} aria-label={t("search")}><Search size={16} /></button>
      <select className="glass-input max-w-full" aria-label={t("kind")} value={kind} onChange={e => { setKind(e.target.value); setCursor(0); }}>
        {["evidence_frame", "sample_frame", "contact_sheet", "reference_image", "replacement_image"].map(k => <option key={k} value={k}>{t(k)}</option>)}
      </select>
      <button type="button" className="glass-button" title={t("close")} aria-label={t("close")} onClick={onClose}><X size={16} /></button>
    </form>
    {error ? <div role="alert">{t("failed")} <button className="glass-button" onClick={() => setRetry(n => n + 1)}>{t("retry")}</button></div>
      : busy ? <p role="status">{t("loading")}</p> : <>
        {!page.items.length && <p>{t("empty")}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{page.items.map(item => <button type="button" key={item.media_id} className="min-w-0 rounded-lg border border-border overflow-hidden text-left" onClick={() => onSelect(item)}>
          <img loading="lazy" src={url(item.storage_path)} alt="" className="aspect-video w-full object-contain" /><span className="block p-2 text-sm truncate">{item.display_name}</span>
        </button>)}</div>
      </>}
    <div className="flex gap-2">
      <button className="glass-button" disabled={busy || cursor === 0} onClick={() => setCursor(n => Math.max(0, n - 12))}>{t("previous")}</button>
      <button className="glass-button" disabled={busy || error || page.next_cursor === null} onClick={() => setCursor(page.next_cursor!)}>{t("next")}</button>
    </div>
  </section>;
}

export default function ShotReferences({ project, disabled, stage, onProgress, onSaved }: { project: RecreationProject; disabled: boolean; stage?: "split" | "parse" | "analyze" | "replace" | "submit" | "assemble"; onProgress?: (progress: RunProgress) => void; onSaved: (project: RecreationProject) => void }) {
  const t = useTranslations("shotReferences");
  const recreationT = useTranslations("recreation");
  const [shotId, setShotId] = useState(project.timeline?.shots[0]?.id);
  const shot = project.timeline?.shots.find(s => s.id === shotId);
  const [plan, setPlan] = useState<RecreationPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState(false);
  const [audioPolicy, setAudioPolicy] = useState("silent");
  const [soundscape, setSoundscape] = useState("");
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [modelOptions, setModelOptions] = useState<RecreationModelOptions | null>(null);
  const [videoModel, setVideoModel] = useState(DEFAULT_VIDEO_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [modelLoadError, setModelLoadError] = useState(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [generationTasks, setGenerationTasks] = useState<RecreationGenerationTask[]>([]);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [costAccepted, setCostAccepted] = useState(false);
  const [assemblyTask, setAssemblyTask] = useState<RecreationAssemblyTask | null>(null);
  const [assemblyBusy, setAssemblyBusy] = useState(false);
  const [assemblyError, setAssemblyError] = useState("");
  const generationIdRef = useRef<string | null>(null);
  const revision = useRef(project.revision);
  const progressCallback = useRef(onProgress);
  progressCallback.current = onProgress;
  const generationTasksRef = useRef(generationTasks);
  generationTasksRef.current = generationTasks;
  const assemblyTaskRef = useRef(assemblyTask);
  assemblyTaskRef.current = assemblyTask;
  const planKey = JSON.stringify([project.revision, videoModel, audioPolicy, soundscape, durations]);
  const activePlan = useRef(planKey);
  activePlan.current = planKey;
  revision.current = project.revision;
  const reportProgress = (generation: RecreationGenerationTask[], assembly: RecreationAssemblyTask | null) => {
    const generationStatus: RunStatus = generation.some(task => task.status === "failed")
      ? "failed"
      : generation.length > 0 && generation.every(task => task.status === "completed")
        ? "complete"
        : generation.some(task => task.status === "pending" || task.status === "processing") ? "active" : "pending";
    const assemblyStatus: RunStatus = !assembly ? "pending"
      : assembly.status === "completed" ? "complete"
        : assembly.status === "failed" ? "failed"
          : assembly.status === "pending" || assembly.status === "processing" ? "active" : "pending";
    progressCallback.current?.({ generation: generationStatus, assembly: assemblyStatus });
  };
  useEffect(() => {
    let active = true;
    recreationApi.models().then(options => {
      if (!active) return;
      setModelOptions(options);
      setVideoModel(current => options.video_models.some(item => item.id === current) ? current : options.defaults.video_model);
      setImageModel(current => options.image_models.some(item => item.id === current) ? current : options.defaults.image_model);
      setModelLoadError(false);
    }).catch(() => { if (active) setModelLoadError(true); });
    return () => { active = false; };
  }, [project.id]);
  const videoModels = modelOptions ? modelOptions.video_models : [FALLBACK_VIDEO_MODEL];
  const imageModels = modelOptions ? modelOptions.image_models : [FALLBACK_IMAGE_MODEL];
  useEffect(() => {
    setPlan(null); setPlanError(false); setCostAccepted(false); generationIdRef.current = null;
    setGenerationId(null); setGenerationTasks([]); setGenerationError(""); setAssemblyTask(null); setAssemblyError("");
  }, [planKey]);
  useEffect(() => {
    let active = true;
    Promise.all([recreationApi.generationTasks(project.id), recreationApi.assemblyTasks(project.id)]).then(([allGenerationTasks, allAssemblyTasks]) => {
      if (!active || generationIdRef.current) return;
      const currentGenerationTasks = allGenerationTasks.filter(task =>
        (task.revision === undefined || task.revision === project.revision) &&
        (task.analysis_id === undefined || task.analysis_id === project.analysis_id),
      );
      const groups = new Map<string, RecreationGenerationTask[]>();
      for (const task of currentGenerationTasks) groups.set(task.generation_id, [...(groups.get(task.generation_id) || []), task]);
      const latestGeneration = Array.from(groups.values()).sort((a: RecreationGenerationTask[], b: RecreationGenerationTask[]) =>
        Math.max(...b.map(task => task.created_at || 0)) - Math.max(...a.map(task => task.created_at || 0)),
      )[0] || [];
      const restoredGenerationId = latestGeneration[0]?.generation_id || null;
      if (restoredGenerationId) {
        generationIdRef.current = restoredGenerationId;
        setGenerationId(restoredGenerationId);
        setGenerationTasks([...latestGeneration].sort((a, b) => a.shot_number - b.shot_number));
      }
      const currentAssemblyTasks = allAssemblyTasks.filter(task =>
        task.revision === project.revision &&
        (!task.analysis_id || task.analysis_id === project.analysis_id) &&
        (!restoredGenerationId || task.generation_id === restoredGenerationId),
      );
      const latestAssembly = [...currentAssemblyTasks].sort((a, b) =>
        (b.created_at || 0) - (a.created_at || 0),
      )[0] || null;
      setAssemblyTask(latestAssembly);
      reportProgress(latestGeneration, latestAssembly);
    }).catch(error => {
      if (active) setGenerationError(error instanceof Error ? error.message : t("generationFailed"));
    });
    return () => { active = false; };
  }, [project.id, project.revision, project.analysis_id, t]);
  useEffect(() => {
    if (!generationId) return;
    let active = true;
    let timer: number | undefined;
    const poll = () => recreationApi.generationTasks(project.id, generationId).then(tasks => {
      if (!active) return;
      setGenerationTasks(tasks);
      reportProgress(tasks, assemblyTaskRef.current);
      if (tasks.length > 0 && tasks.every(task => terminalTask(task.status)) && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    }).catch(error => {
      if (active) setGenerationError(error instanceof Error ? error.message : t("generationFailed"));
    });
    void poll();
    timer = window.setInterval(poll, 2500);
    return () => { active = false; if (timer !== undefined) window.clearInterval(timer); };
  }, [generationId, project.id, t]);
  useEffect(() => {
    if (!assemblyTask?.task_id || assemblyTask.status === "completed" || assemblyTask.status === "failed" || assemblyTask.status === "cancelled") return;
    let active = true;
    const poll = () => recreationApi.assemblyTask(assemblyTask.task_id).then(task => {
      if (active) { setAssemblyTask(task); reportProgress(generationTasksRef.current, task); }
    }).catch(error => {
      if (active) setAssemblyError(error instanceof Error ? error.message : t("assemblyFailed"));
    });
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [assemblyTask?.task_id, assemblyTask?.status, t]);
  return <section className="border-t border-border py-5 space-y-4">
    <h3 className="font-semibold">{stage ? recreationT(`steps.${stage}`) : t("title")}</h3>
    {(stage === "replace" || !stage) && <>
    {disabled && <p role="status">{t("confirmFirst")}</p>}
    <select aria-label={t("shot")} className="glass-input max-w-full" value={shotId || ""} onChange={e => setShotId(e.target.value)}>
      {project.timeline?.shots.map((s, i) => <option key={s.id} value={s.id}>{t("shot")} {i + 1} · {seconds(project.analysis!, s.start_pts).toFixed(6)} - {seconds(project.analysis!, s.end_pts).toFixed(6)} s</option>)}
    </select>
    {shot?.id && <ReferenceForm key={`${project.id}:${shot.id}`} project={project} shot={shot} disabled={disabled} imageModel={imageModel} imageModels={imageModels} onImageModelChange={setImageModel} onSaved={onSaved} />}
    </>}
    {(stage === "submit" || !stage) && <>
    {modelLoadError && <p role="status" className="text-sm">{t("modelCatalogFallback")}</p>}
    <label className="block text-sm">{t("videoModel")}<select aria-label={t("videoModel")} className="glass-input block" value={videoModel} disabled={disabled || !videoModels.length} onChange={e => { setVideoModel(e.target.value); setPlan(null); setPlanError(false); }}>
      {videoModels.map(model => <option key={model.id} value={model.id}>{model.display_name} · {model.id}</option>)}
    </select></label>
    <label className="block text-sm">{t("audioPolicy")}<select className="glass-input block" value={audioPolicy} onChange={e => setAudioPolicy(e.target.value)}>
      <option value="silent">{t("silent")}</option><option value="generated">{t("generatedAudio")}</option><option value="preserve_source">{t("preserveAudio")}</option>
    </select></label>
    {audioPolicy === "generated" && <label className="block text-sm">{t("soundRequirements")}<textarea className="glass-input block w-full" maxLength={2000} value={soundscape} onChange={e => setSoundscape(e.target.value)} /></label>}
    <div className="flex flex-wrap gap-3">{project.timeline?.shots.map((s, i) => <label key={s.id} className="text-sm">{t("shot")} {i + 1} · {t("generationSeconds")}
      <input type="number" min={4} max={15} step={1} className="glass-input block w-24" value={durations[s.id!] ?? ""} onChange={e => setDurations(all => ({ ...all, [s.id!]: Number(e.target.value) }))} />
    </label>)}</div>
    <button className="glass-button" disabled={disabled || planBusy || !videoModels.length} onClick={async () => {
      const current = planKey; setPlanBusy(true); setPlanError(false);
      try { const result = await recreationApi.generationPlan(project, videoModel, { audio_policy: audioPolicy, soundscape, generation_durations: durations }); if (activePlan.current === current) setPlan(result); }
      catch { if (activePlan.current === current) setPlanError(true); } finally { setPlanBusy(false); }
    }}>{t("checkPlan")}</button>
    {planError && <p role="alert">{t("failed")}</p>}
    {!plan && !disabled && (generationTasks.length > 0 || assemblyTask) && <div className="border-t border-border pt-3 space-y-2 text-sm">
      {generationTasks.map(task => <p key={task.task_id}>{t("shot")} {task.shot_number} · {t(`generationStatus.${task.status}`)}</p>)}
    </div>}
    {plan && !disabled && <div className="space-y-3">
      <p role="status">{t(plan.ready ? "planReady" : "planBlocked")}</p>
      {plan.blockers.map(block => <p key={block.shot_id}>{t("shot")} {block.shot_number}: {block.reasons.map(reason => t(reason)).join(" / ")}</p>)}
      {plan.shots.map(item => <details key={item.shot_id} className="border-t border-border py-2">
        <summary>{t("shot")} {item.shot_number} · {item.target_duration} s</summary>
        {item.images.map((image, i) => <p key={`${image.media_id}:${i}`} className="text-xs break-all">{image.label} · {image.media_id}</p>)}
        {item.prompt && <pre className="whitespace-pre-wrap break-words text-sm mt-2">{item.prompt}</pre>}
      </details>)}
      {plan.ready && <div className="border-t border-border pt-3 space-y-2">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={costAccepted} onChange={e => setCostAccepted(e.target.checked)} />{t("acceptCost")}</label>
        <button className="glass-button" disabled={!costAccepted || generationBusy} onClick={async () => {
          setGenerationBusy(true); setGenerationError("");
          try {
            const result = await recreationApi.submitGeneration(project, videoModel, { audio_policy: audioPolicy, soundscape, generation_durations: durations, accept_cost: costAccepted });
            generationIdRef.current = result.generation_id; setGenerationId(result.generation_id); setGenerationTasks(result.tasks);
            reportProgress(result.tasks, assemblyTaskRef.current);
          } catch (error) { setGenerationError(error instanceof Error ? error.message : t("generationFailed")); }
          finally { setGenerationBusy(false); }
        }}>{generationBusy ? t("submittingGeneration") : t("submitGeneration")}</button>
        {generationError && <p role="alert" className="text-sm text-red-500 break-words">{generationError}</p>}
        {generationTasks.length > 0 && <ul className="space-y-1 text-sm">{generationTasks.map(task => <li key={task.task_id} className="flex items-center gap-2"><span>{t("shot")} {task.shot_number}</span><span>{t(`generationStatus.${task.status}`)}</span>{(task.status === "pending" || task.status === "processing") && <button type="button" className="glass-button" onClick={async () => { try { const cancelled = await recreationApi.cancelGenerationTask(task.task_id); setGenerationTasks(all => all.map(item => item.task_id === cancelled.task_id ? cancelled : item)); } catch (error) { setGenerationError(error instanceof Error ? error.message : t("generationFailed")); } }}>{t("cancelGeneration")}</button>}{task.status === "failed" && <button type="button" className="glass-button" disabled={!costAccepted} onClick={async () => { try { const retried = await recreationApi.retryGenerationTask(task.task_id, costAccepted); setGenerationTasks(all => all.map(item => item.task_id === retried.task_id ? retried : item)); } catch (error) { setGenerationError(error instanceof Error ? error.message : t("generationFailed")); } }}>{t("retryGeneration")}</button>}</li>)}</ul>}
    </div>}
    </div>}
    </>}
    {(stage === "assemble" || !stage) && <div className="space-y-3">
      {!generationTasks.length || !generationTasks.every(task => task.status === "completed")
        ? <p role="status" className="text-sm text-text-muted">{t("assemblyNeedsGeneration")}</p>
        : !assemblyTask && <button type="button" className="glass-button min-h-11" disabled={assemblyBusy} onClick={async () => {
          if (!generationId) return;
          setAssemblyBusy(true); setAssemblyError("");
          try { const task = await recreationApi.submitAssembly(project, generationId); setAssemblyTask(task); reportProgress(generationTasksRef.current, task); }
          catch (error) { setAssemblyError(error instanceof Error ? error.message : t("assemblyFailed")); }
          finally { setAssemblyBusy(false); }
        }}>{assemblyBusy ? t("assembling") : t("assembleVideo")}</button>}
      {assemblyError && <p role="alert" className="text-sm text-red-500 break-words">{assemblyError}</p>}
      {assemblyTask && <div className="space-y-2 text-sm"><p role="status">{t(`assemblyStatus.${assemblyTask.status}`)}</p>{(assemblyTask.status === "pending" || assemblyTask.status === "processing") && <button type="button" className="glass-button min-h-11" onClick={async () => { try { const task = await recreationApi.cancelAssemblyTask(assemblyTask.task_id); setAssemblyTask(task); reportProgress(generationTasksRef.current, task); } catch (error) { setAssemblyError(error instanceof Error ? error.message : t("assemblyFailed")); } }}>{t("cancelAssembly")}</button>}{assemblyTask.status === "failed" && <button type="button" className="glass-button min-h-11" onClick={async () => { try { const task = await recreationApi.retryAssemblyTask(assemblyTask.task_id); setAssemblyTask(task); reportProgress(generationTasksRef.current, task); } catch (error) { setAssemblyError(error instanceof Error ? error.message : t("assemblyFailed")); } }}>{t("retryAssembly")}</button>}{assemblyTask.error && <p role="alert" className="text-red-500 break-words">{assemblyTask.error}</p>}{assemblyTask.output_media && <><video controls src={url(assemblyTask.output_media.storage_path)} className="w-full max-h-[420px] bg-black object-contain" /><a className="glass-button inline-flex min-h-11 items-center" href={url(assemblyTask.output_media.storage_path)} download>{recreationT("download")}</a></>}</div>}
    </div>}
  </section>;
}

function ReferenceForm({ project, shot, disabled, imageModel, imageModels, onImageModelChange, onSaved }: { project: RecreationProject; shot: RecreationShot; disabled: boolean; imageModel: string; imageModels: RecreationModelOption[]; onImageModelChange: (model: string) => void; onSaved: (project: RecreationProject) => void }) {
  const t = useTranslations("shotReferences");
  const recreationT = useTranslations("recreation");
  const [selected, setSelected] = useState<Partial<Record<Role, RecreationMedia>>>({});
  const [description, setDescription] = useState(shot.description || "");
  const [instruction, setInstruction] = useState(shot.instruction || "");
  const [picker, setPicker] = useState<Role | null>(null);
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState(false);
  const [keyframeBusy, setKeyframeBusy] = useState(false);
  const [keyframeTaskId, setKeyframeTaskId] = useState<string | null>(null);
  const [keyframeTask, setKeyframeTask] = useState<RecreationKeyframeTask | null>(null);
  const [keyframeCostAccepted, setKeyframeCostAccepted] = useState(false);
  const [keyframeError, setKeyframeError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setBusy(true); setFailed(false);
    setKeyframeError("");
    Promise.all([
      Promise.all((["reference", "replacement"] as Role[]).map(async role => {
        const id = shot[`${role}_media_id`]; return [role, id ? await recreationApi.media(id) : undefined] as const;
      })),
      recreationApi.keyframeTasks(project.id, shot.id),
    ]).then(([entries, tasks]) => {
      if (!active) return;
      const currentTasks = tasks.filter(task =>
        (task.revision === undefined || task.revision === project.revision) &&
        (task.analysis_id === undefined || task.analysis_id === project.analysis_id),
      );
      const latest = currentTasks[0] || null;
      const saved = Object.fromEntries(entries) as Partial<Record<Role, RecreationMedia>>;
      if (latest?.status === "completed" && latest.output_media) saved.reference = latest.output_media;
      setSelected(saved); setKeyframeTask(latest);
      setKeyframeError(latest?.status === "failed" ? latest.error || t("keyframeFailed") : "");
      setKeyframeTaskId(latest && !terminalTask(latest.status) ? latest.task_id : null);
      setKeyframeBusy(Boolean(latest && !terminalTask(latest.status))); setLoaded(true);
    })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // Draft fields stay local until explicitly saved; revisions do not reset them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);
  const activeKeyframeTaskId = keyframeTask?.task_id;
  const activeKeyframeTaskStatus = keyframeTask?.status;
  useEffect(() => {
    if (!activeKeyframeTaskId || !activeKeyframeTaskStatus || terminalTask(activeKeyframeTaskStatus)) return;
    let active = true;
    const poll = () => recreationApi.keyframeTask(activeKeyframeTaskId).then(task => {
      if (!active) return;
      setKeyframeTask(task);
      if (task.status === "completed" && task.output_media) {
        setSelected(all => ({ ...all, reference: task.output_media! }));
        setKeyframeBusy(false); setKeyframeTaskId(null); setKeyframeCostAccepted(false);
      } else if (task.status === "failed" || task.status === "cancelled") {
        setKeyframeBusy(false); setKeyframeTaskId(null); setKeyframeCostAccepted(false);
        if (task.status === "failed") setKeyframeError(task.error || t("keyframeFailed"));
      }
    }).catch(error => {
      if (active) setKeyframeError(error instanceof Error ? error.message : t("keyframeFailed"));
    });
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeKeyframeTaskId, activeKeyframeTaskStatus, t]);
  const choose = (role: Role, item?: RecreationMedia) => { setSelected(all => ({ ...all, [role]: item })); setSaved(false); setKeyframeCostAccepted(false); setKeyframeError(""); };
  async function upload(file: File, role: Role, parentId?: string) {
    if (file.size > 25 * 1024 * 1024) throw new Error("Image exceeds 25 MiB");
    const item = await recreationApi.uploadImage(project.id, file, role === "reference" ? "reference_image" : "replacement_image", parentId);
    if (alive.current) choose(role, item);
  }
  async function generateCorrected() {
    if (!selected.reference || !selected.replacement || !shot.id || !keyframeCostAccepted) return;
    setKeyframeBusy(true); setKeyframeError(""); setSaved(false);
    try {
      const task = await recreationApi.createKeyframeTask(
        project, shot.id, selected.reference.media_id, selected.replacement.media_id, instruction, keyframeCostAccepted, imageModel,
      );
      if (alive.current) {
        setKeyframeTask(task); setKeyframeTaskId(task.task_id);
        if (task.status === "completed" && task.output_media) {
          setSelected(all => ({ ...all, reference: task.output_media! }));
          setKeyframeBusy(false); setKeyframeTaskId(null); setKeyframeCostAccepted(false);
        } else if (terminalTask(task.status)) {
          setKeyframeBusy(false); setKeyframeTaskId(null); setKeyframeCostAccepted(false);
          if (task.status === "failed") setKeyframeError(task.error || t("keyframeFailed"));
        }
      }
    } catch (error) {
      if (alive.current) { setKeyframeError(error instanceof Error ? error.message : t("keyframeFailed")); setKeyframeBusy(false); setKeyframeTaskId(null); }
    }
  }
  async function cancelCorrected() {
    if (!keyframeTaskId) return;
    try {
      const cancelled = await recreationApi.cancelKeyframeTask(keyframeTaskId);
      if (alive.current) { setKeyframeTask(cancelled); setKeyframeError(t("keyframeCancelled")); }
    } catch (error) {
      if (alive.current) setKeyframeError(error instanceof Error ? error.message : t("keyframeFailed"));
    } finally {
      if (alive.current) { setKeyframeBusy(false); setKeyframeTaskId(null); setKeyframeCostAccepted(false); }
    }
  }
  return <div className="space-y-4">
    {failed && <div role="alert">{t("failed")}{!loaded && <button className="glass-button" onClick={() => setRetry(n => n + 1)}>{t("retry")}</button>}</div>}
    {saved && <p role="status">{t("saved")}</p>}
    <fieldset disabled={disabled || busy || !loaded} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">{(["reference", "replacement"] as Role[]).map(role => <div key={role} className="min-w-0">
        <h4 className="text-sm font-medium mb-2">{t(role)}</h4>
        {selected[role] && <><img src={url(selected[role]!.storage_path)} alt={t(role)} className="aspect-video w-full object-contain bg-black" /><p className="text-sm break-words">{selected[role]!.display_name}</p></>}
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" className="glass-button" onClick={() => setPicker(role)}>{t("choose")}</button>
          <label className="glass-button flex items-center gap-2 cursor-pointer"><Upload size={16} />{t("upload")}
            <input type="file" aria-label={t(role) + " " + t("upload")} accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async e => {
              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
              setBusy(true); setFailed(false);
              try { await upload(file, role); } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); }
            }} /></label>
          {selected[role] && <button type="button" className="glass-button" title={t("detach")} aria-label={t("detach") + " " + t(role)} onClick={() => choose(role)}><X size={16} /></button>}
          {role === "reference" && selected.reference && <button type="button" className="glass-button" title={t("edit")} aria-label={t("edit")} onClick={() => setEditor(true)}><Pencil size={16} /></button>}
        </div>
      </div>)}</div>
      {selected.reference && selected.replacement && <>
        <label className="block text-sm">{t("keyframeImageModel")}<select aria-label={t("keyframeImageModel")} className="glass-input block" value={imageModel} disabled={keyframeBusy || !imageModels.length} onChange={e => onImageModelChange(e.target.value)}>
          {imageModels.map(model => <option key={model.id} value={model.id}>{model.display_name} · {model.id}</option>)}
        </select></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={recreationT("keyframeAcceptCost")} checked={keyframeCostAccepted} onChange={e => setKeyframeCostAccepted(e.target.checked)} />{recreationT("keyframeAcceptCost")}</label>
        <button type="button" className="glass-button flex items-center gap-2" disabled={keyframeBusy || !imageModels.length || !keyframeCostAccepted || !instruction.replace(/@\{[a-f0-9]{32}\}/g, "").trim()} aria-label={t("generateCorrected")} onClick={generateCorrected}>
          <Sparkles size={16} />{keyframeBusy ? t("generatingCorrected") : t("generateCorrected")}
        </button>
      </>}
      {keyframeBusy && keyframeTaskId && <button type="button" className="glass-button" onClick={() => void cancelCorrected()}>{t("cancelGeneration")}</button>}
      {keyframeError && <p role="alert" className="text-sm text-red-500 break-words">{keyframeError}</p>}
      {picker && <Picker onClose={() => setPicker(null)} onSelect={item => { choose(picker, item); setPicker(null); }} />}
      <label className="block text-sm">{t("description")}<textarea className="glass-input block w-full mt-2" rows={4} maxLength={6000} value={description} onChange={e => { setDescription(e.target.value); setSaved(false); }} /></label>
      <MaterialInstruction value={instruction} onChange={text => { setInstruction(text); setSaved(false); setKeyframeCostAccepted(false); }} materials={(["reference", "replacement"] as Role[]).flatMap(role => selected[role] ? [{ role, media: selected[role]! }] : [])} />
      <button type="button" className="glass-button flex items-center gap-2" onClick={async () => {
        setBusy(true); setFailed(false); setSaved(false);
        try {
          const instruction_refs = Array.from(instruction.matchAll(/@\{([a-f0-9]{32})\}/g)).map(match => ({ media_id: match[1], token: match[0] }));
          const result = await recreationApi.bindShot(project, shot.id!, { reference_media_id: selected.reference?.media_id || null, replacement_media_id: selected.replacement?.media_id || null, instruction, description, instruction_refs });
          if (alive.current) { onSaved(result); setSaved(true); }
        } catch { if (alive.current) setFailed(true); } finally { if (alive.current) setBusy(false); }
      }}><Save size={16} />{t("save")}</button>
    </fieldset>
    {editor && selected.reference && <ImageEditor source={url(selected.reference.storage_path)} title={selected.reference.display_name} onClose={() => setEditor(false)} onSave={async file => {
      await upload(file, "reference", selected.reference!.media_id); if (alive.current) setEditor(false);
    }} />}
  </div>;
}
