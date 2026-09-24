import axios from "axios";
import { API_URL } from "./api";

export interface CutEvidence { pts: number; before_pts: number; before_url: string; after_url: string; before_preview_url?: string; after_preview_url?: string; source: string }
export interface SourceAnalysis {
  manual_evidence?: Record<string, CutEvidence>;
  time_base: string; start_pts: number; end_pts: number; frame_pts: number[];
  duration_seconds: number; width: number; height: number; audio_streams: number;
  candidates: CutEvidence[]; contact_sheet_url: string; contact_sheet_preview_url?: string;
  samples?: { pts: number; url: string; preview_url?: string }[];
  analyzer?: string; scene_threshold?: number; source_fingerprint?: string;
}
export interface RecreationProject {
  id: string; title: string; source_url: string; revision: number; analysis_id: string;
  source_media_id?: string; source_fingerprint?: string;
  status: "registered" | "queued" | "analyzing" | "review" | "confirmed" | "failed" | "cancelled";
  error: string | null; analysis: SourceAnalysis | null;
  timeline: { cuts: { pts: number; source: string }[]; shots: RecreationShot[] } | null;
}

export interface RecreationShot {
  id?: string; start_pts: number; end_pts: number;
  reference_media_id?: string | null; replacement_media_id?: string | null; instruction?: string; description?: string; instruction_refs?: { media_id: string; token: string }[];
}

export function seconds(analysis: SourceAnalysis, pts: number): number {
  const [n, d = 1] = analysis.time_base.split("/").map(Number);
  return (pts - analysis.start_pts) * n / d;
}

export function importCuts(text: string, analysis: SourceAnalysis): number[] {
  const times = text.trim().split(/[\s,;]+/).filter(Boolean).map(Number);
  if (times.length > 120 || times.some(t => !Number.isFinite(t) || t <= 0 || t >= analysis.duration_seconds)) {
    throw new Error("invalidTimeline");
  }
  const cuts = times.map(t => {
    const nearest = analysis.frame_pts.slice(1).reduce((a, b) =>
      Math.abs(seconds(analysis, a) - t) <= Math.abs(seconds(analysis, b) - t) ? a : b);
    // Six-decimal timestamp exports may round, but never snap a cut to a different frame.
    if (Math.abs(seconds(analysis, nearest) - t) > 0.00000051) throw new Error("invalidTimeline");
    return nearest;
  });
  if (cuts.some((p, i) => i > 0 && p <= cuts[i - 1])) throw new Error("invalidTimeline");
  return cuts;
}

export type RecreationMediaKind = "source_video" | "contact_sheet" | "sample_frame" | "evidence_frame" | "reference_image" | "replacement_image" | "generated_video" | "final_video";
export interface RecreationMedia {
  media_id: string; project_id: string; kind: RecreationMediaKind; display_name: string;
  storage_path: string; preview_url?: string; sha256: string; created_at: number;
  metadata: { parent_media_id?: string; analysis_id?: string; pts?: number | null; time_base?: string; role?: string; extraction_method?: string; note?: string };
}
export interface RecreationMediaPage { items: RecreationMedia[]; next_cursor: number | null }

export const RECREATION_FRAME_MANIFEST_SCHEMA_VERSION = "recreation.frame-manifest.v1" as const;
export type RecreationFrameManifestReviewState = "draft" | "reviewed";

export interface RecreationFrameManifestFrame {
  frame_id: string;
  source_pts: number;
  source_seconds: number;
  evidence_media_id: string;
  evidence_media_path: string;
  width: number;
  height: number;
  extraction_method: string;
  note?: string;
}

export interface RecreationFrameManifest {
  schema_version: typeof RECREATION_FRAME_MANIFEST_SCHEMA_VERSION;
  manifest_id: string;
  source_media_id: string;
  source_checksum: string;
  analysis_id: string;
  time_base: string;
  source_start_pts: number;
  source_end_pts: number;
  duration_seconds: number;
  review_state: RecreationFrameManifestReviewState;
  frames: RecreationFrameManifestFrame[];
}

export interface RecreationFrameManifestBuildInput {
  manifest_id: string;
  analysis_id: string;
  analysis: SourceAnalysis;
  source_media: Pick<RecreationMedia, "media_id" | "project_id" | "kind" | "sha256">;
  frames: readonly RecreationMedia[];
  review_state?: RecreationFrameManifestReviewState;
}

const frameManifestError = (reason: string): Error => new Error(`invalidFrameManifest:${reason}`);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function parseTimeBase(timeBase: string): [number, number] {
  if (typeof timeBase !== "string") throw frameManifestError("timeBase");
  const parts = timeBase.split("/");
  if (parts.length !== 2) throw frameManifestError("timeBase");
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1]);
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator <= 0 || denominator <= 0) {
    throw frameManifestError("timeBase");
  }
  return [numerator, denominator];
}

function validateSourceAnalysisForFrameManifest(analysis: SourceAnalysis): void {
  const [numerator, denominator] = parseTimeBase(analysis.time_base);
  if (!isInteger(analysis.start_pts) || !isInteger(analysis.end_pts) || analysis.end_pts <= analysis.start_pts) {
    throw frameManifestError("analysisBounds");
  }
  if (!isFiniteNumber(analysis.duration_seconds) || analysis.duration_seconds <= 0) throw frameManifestError("analysisDuration");
  if (!isInteger(analysis.width) || !isInteger(analysis.height) || analysis.width <= 0 || analysis.height <= 0) {
    throw frameManifestError("analysisDimensions");
  }
  if (!Array.isArray(analysis.frame_pts) || analysis.frame_pts.length === 0 || analysis.frame_pts.some((pts) => !isInteger(pts))) {
    throw frameManifestError("analysisFrames");
  }
  if (analysis.frame_pts.some((pts, index, points) => pts < analysis.start_pts || pts >= analysis.end_pts || (index > 0 && pts <= points[index - 1]))) {
    throw frameManifestError("analysisFrames");
  }
  // Parse the base here as well as in seconds() so malformed source metadata
  // cannot produce NaN frame timestamps in the exported contract.
  if (!Number.isFinite((analysis.end_pts - analysis.start_pts) * numerator / denominator)) throw frameManifestError("analysisTime");
}

function validateManifestFrameShape(frame: RecreationFrameManifestFrame, previousPts: number | null, validPts: ReadonlySet<number> | null, manifest: RecreationFrameManifest): void {
  if (!frame || typeof frame !== "object" || typeof frame.frame_id !== "string" || !frame.frame_id.trim()) throw frameManifestError("frameId");
  if (!isInteger(frame.source_pts) || frame.source_pts < manifest.source_start_pts || frame.source_pts >= manifest.source_end_pts || (validPts && !validPts.has(frame.source_pts))) throw frameManifestError("frameOutOfRange");
  if (previousPts !== null && frame.source_pts <= previousPts) throw frameManifestError("frameOrder");
  if (!isFiniteNumber(frame.source_seconds) || frame.source_seconds < 0 || frame.source_seconds > manifest.duration_seconds + 0.000001) {
    throw frameManifestError("frameSeconds");
  }
  if (typeof frame.evidence_media_id !== "string" || !frame.evidence_media_id.trim() || typeof frame.evidence_media_path !== "string" || !frame.evidence_media_path.trim()) {
    throw frameManifestError("frameMedia");
  }
  if (!isInteger(frame.width) || !isInteger(frame.height) || frame.width <= 0 || frame.height <= 0) throw frameManifestError("frameDimensions");
  if (typeof frame.extraction_method !== "string" || !frame.extraction_method.trim()) throw frameManifestError("frameExtractionMethod");
  if (frame.note !== undefined && typeof frame.note !== "string") throw frameManifestError("frameNote");
}

/**
 * Validate a serialized, read-only frame manifest. If an analysis is supplied,
 * every PTS must also be an exact frame from that analysis; no timestamp
 * snapping or nearest-frame matching occurs here.
 */
export function validateRecreationFrameManifest(value: unknown, analysis?: SourceAnalysis): RecreationFrameManifest {
  if (!value || typeof value !== "object") throw frameManifestError("object");
  const manifest = value as Partial<RecreationFrameManifest>;
  if (manifest.schema_version !== RECREATION_FRAME_MANIFEST_SCHEMA_VERSION) throw frameManifestError("schemaVersion");
  for (const field of ["manifest_id", "source_media_id", "source_checksum", "analysis_id", "time_base"] as const) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) throw frameManifestError(field);
  }
  if (manifest.review_state !== "draft" && manifest.review_state !== "reviewed") throw frameManifestError("reviewState");
  if (!isInteger(manifest.source_start_pts) || !isInteger(manifest.source_end_pts) || manifest.source_end_pts <= manifest.source_start_pts) throw frameManifestError("bounds");
  if (!isFiniteNumber(manifest.duration_seconds) || manifest.duration_seconds <= 0) throw frameManifestError("duration");
  parseTimeBase(manifest.time_base!);
  if (!Array.isArray(manifest.frames)) throw frameManifestError("frames");
  const validPts = analysis ? new Set(analysis.frame_pts) : null;
  if (analysis) {
    validateSourceAnalysisForFrameManifest(analysis);
    if (manifest.time_base !== analysis.time_base || manifest.source_start_pts !== analysis.start_pts || manifest.source_end_pts !== analysis.end_pts) {
      throw frameManifestError("analysisMismatch");
    }
  }
  let previousPts: number | null = null;
  const frames = manifest.frames as RecreationFrameManifestFrame[];
  for (const frame of frames) {
    validateManifestFrameShape(frame, previousPts, validPts, manifest as RecreationFrameManifest);
    if (analysis) {
      const expectedSeconds = seconds(analysis, frame.source_pts);
      if (Math.abs(expectedSeconds - frame.source_seconds) > 0.000000001) throw frameManifestError("frameSeconds");
    }
    previousPts = frame.source_pts;
  }
  return manifest as RecreationFrameManifest;
}

/**
 * Build a deterministic frame-evidence handoff from indexed recreation media.
 * The input rows are sorted by their exact source PTS for stable export; the
 * source bytes, analysis identity, and media identity are kept unchanged.
 */
export function buildRecreationFrameManifest(input: RecreationFrameManifestBuildInput): RecreationFrameManifest {
  if (!input || typeof input !== "object") throw frameManifestError("input");
  const { analysis, source_media: sourceMedia } = input;
  validateSourceAnalysisForFrameManifest(analysis);
  if (typeof input.manifest_id !== "string" || !input.manifest_id.trim()) throw frameManifestError("manifestId");
  if (typeof input.analysis_id !== "string" || !input.analysis_id.trim()) throw frameManifestError("analysisId");
  if (!sourceMedia || sourceMedia.kind !== "source_video" || typeof sourceMedia.media_id !== "string" || !sourceMedia.media_id.trim()) {
    throw frameManifestError("sourceMedia");
  }
  if (typeof sourceMedia.sha256 !== "string" || !sourceMedia.sha256.trim()) throw frameManifestError("sourceChecksum");
  if (analysis.source_fingerprint !== undefined && analysis.source_fingerprint !== sourceMedia.sha256) {
    throw frameManifestError("sourceChecksumMismatch");
  }
  if (input.review_state !== undefined && input.review_state !== "draft" && input.review_state !== "reviewed") throw frameManifestError("reviewState");
  if (!Array.isArray(input.frames)) throw frameManifestError("frames");
  const validPts = new Set(analysis.frame_pts);
  const rows = input.frames.map((media) => {
    if (!media || media.kind !== "sample_frame" && media.kind !== "evidence_frame") throw frameManifestError("frameMediaKind");
    if (sourceMedia.project_id && media.project_id !== sourceMedia.project_id) throw frameManifestError("projectMismatch");
    const metadata = media.metadata ?? {};
    if (metadata.parent_media_id !== sourceMedia.media_id) throw frameManifestError("sourceMediaMismatch");
    if (metadata.analysis_id !== input.analysis_id) throw frameManifestError("analysisMismatch");
    if (metadata.time_base !== undefined && metadata.time_base !== analysis.time_base) throw frameManifestError("timeBaseMismatch");
    if (!isInteger(metadata.pts) || !validPts.has(metadata.pts)) throw frameManifestError("frameOutOfRange");
    return { media, pts: metadata.pts };
  }).sort((a, b) => a.pts - b.pts);
  if (rows.some((row, index) => index > 0 && row.pts === rows[index - 1].pts)) throw frameManifestError("duplicatePts");
  const manifest: RecreationFrameManifest = {
    schema_version: RECREATION_FRAME_MANIFEST_SCHEMA_VERSION,
    manifest_id: input.manifest_id,
    source_media_id: sourceMedia.media_id,
    source_checksum: sourceMedia.sha256,
    analysis_id: input.analysis_id,
    time_base: analysis.time_base,
    source_start_pts: analysis.start_pts,
    source_end_pts: analysis.end_pts,
    duration_seconds: analysis.duration_seconds,
    review_state: input.review_state ?? "draft",
    frames: rows.map(({ media, pts }) => ({
      frame_id: `frame-${media.media_id}`,
      source_pts: pts,
      source_seconds: seconds(analysis, pts),
      evidence_media_id: media.media_id,
      evidence_media_path: media.storage_path,
      width: analysis.width,
      height: analysis.height,
      extraction_method: media.metadata.extraction_method ?? media.metadata.role ?? media.kind,
      ...(media.metadata.note !== undefined ? { note: media.metadata.note } : {}),
    })),
  };
  return validateRecreationFrameManifest(manifest, analysis);
}

// Alias reads naturally at call sites that treat the result as an export.
export const exportRecreationFrameManifest = buildRecreationFrameManifest;

export interface RecreationKeyframeTask {
  task_id: string; project_id?: string; shot_id?: string; revision?: number; analysis_id?: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  model?: string;
  created_at?: number; updated_at?: number;
  output_media: RecreationMedia | null; error: string | null;
}

export interface RecreationModelOption {
  id: string;
  display_name: string;
  description?: string;
  family?: string;
  capabilities: string[];
  duration?: Record<string, unknown> | null;
  params?: Record<string, unknown>;
  inputs?: Record<string, { max?: number }>;
}

export interface RecreationModelOptions {
  provider: "uniart";
  source: "live" | "static";
  defaults: { image_model: string; video_model: string };
  image_models: RecreationModelOption[];
  video_models: RecreationModelOption[];
}

export interface RecreationPlan {
  revision: number; ready: boolean; submission_enabled?: boolean; model?: string; model_family?: "minimax_h3" | "seedance"; mapping_strategy?: string;
  source_video?: { media_id: string; sha256: string; label: "<Video 1>" };
  blockers: { shot_id: string; shot_number: number; reasons: string[] }[];
  shots: { shot_id: string; shot_number: number; target_duration: string; prompt: string | null;
    images: { media_id: string; label: string }[] }[];
}
export interface RecreationGenerationTask {
  task_id: string; generation_id: string; project_id: string; shot_id: string; shot_number: number;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  revision?: number; analysis_id?: string; created_at?: number; updated_at?: number;
  model: string; duration: number; generate_audio: boolean; provider_task_id?: string | null;
  source_media_id?: string; source_fingerprint?: string;
  output_media: RecreationMedia | null; error: string | null;
}
export interface RecreationGenerationSubmission {
  generation_id: string; project_id: string; revision: number; analysis_id: string;
  model: string; audio_policy: string; tasks: RecreationGenerationTask[];
}
export interface RecreationAssemblyTask {
  task_id: string; project_id: string; generation_id: string; revision: number;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  analysis_id?: string; created_at?: number; updated_at?: number;
  audio_policy: string; output_media: RecreationMedia | null; error: string | null;
}
export const recreationApi = {
  models: (): Promise<RecreationModelOptions> => axios.get(`${API_URL}/recreation/models`).then(r => r.data),
  generationPlan: (project: RecreationProject, model = "uniart/minimax-h3-vip", options: { audio_policy: string; soundscape: string; generation_durations: Record<string, number> } = { audio_policy: "silent", soundscape: "", generation_durations: {} }): Promise<RecreationPlan> => axios.post(`${API_URL}/recreation/projects/${project.id}/generation-plan`, { revision: project.revision, model, ...options }).then(r => r.data),
  media: (id: string): Promise<RecreationMedia> => axios.get(`${API_URL}/recreation/media/${id}`).then(r => r.data),
  uploadImage: (projectId: string, file: File, kind: "reference_image" | "replacement_image", parentId?: string): Promise<RecreationMedia> => {
    const data = new FormData(); data.append("file", file); data.append("kind", kind);
    if (parentId) data.append("parent_media_id", parentId);
    return axios.post(`${API_URL}/recreation/projects/${projectId}/images`, data).then(r => r.data);
  },
  createKeyframeTask: (project: RecreationProject, shotId: string, referenceMediaId: string, replacementMediaId: string, instruction: string, acceptCost: boolean, model = "uniart/gpt-image-2"): Promise<RecreationKeyframeTask> =>
    axios.post(`${API_URL}/recreation/projects/${project.id}/shots/${shotId}/keyframe-tasks`, {
      revision: project.revision, analysis_id: project.analysis_id, reference_media_id: referenceMediaId,
      replacement_media_id: replacementMediaId, instruction, model, accept_cost: acceptCost,
    }).then(r => r.data),
  keyframeTask: (taskId: string): Promise<RecreationKeyframeTask> =>
    axios.get(`${API_URL}/recreation/keyframe-tasks/${taskId}`).then(r => r.data),
  keyframeTasks: (projectId: string, shotId?: string): Promise<RecreationKeyframeTask[]> =>
    axios.get(`${API_URL}/recreation/projects/${projectId}/keyframe-tasks`, { params: shotId ? { shot_id: shotId } : undefined }).then(r => r.data),
  cancelKeyframeTask: (taskId: string): Promise<RecreationKeyframeTask> =>
    axios.post(`${API_URL}/recreation/keyframe-tasks/${taskId}/cancel`).then(r => r.data),
  submitGeneration: (project: RecreationProject, model: string, options: { audio_policy: string; soundscape: string; generation_durations: Record<string, number>; accept_cost: boolean; seed?: number | null }): Promise<RecreationGenerationSubmission> =>
    axios.post(`${API_URL}/recreation/projects/${project.id}/generation-tasks`, { revision: project.revision, model, ...options }).then(r => r.data),
  generationTasks: (projectId: string, generationId?: string): Promise<RecreationGenerationTask[]> =>
    axios.get(`${API_URL}/recreation/projects/${projectId}/generation-tasks`, { params: generationId ? { generation_id: generationId } : undefined }).then(r => r.data),
  cancelGenerationTask: (taskId: string): Promise<RecreationGenerationTask> =>
    axios.post(`${API_URL}/recreation/generation-tasks/${taskId}/cancel`).then(r => r.data),
  retryGenerationTask: (taskId: string, acceptCost: boolean): Promise<RecreationGenerationTask> =>
    axios.post(`${API_URL}/recreation/generation-tasks/${taskId}/retry`, { accept_cost: acceptCost }).then(r => r.data),
  submitAssembly: (project: RecreationProject, generationId: string): Promise<RecreationAssemblyTask> =>
    axios.post(`${API_URL}/recreation/projects/${project.id}/assembly-tasks`, { revision: project.revision, generation_id: generationId }).then(r => r.data),
  assemblyTask: (taskId: string): Promise<RecreationAssemblyTask> =>
    axios.get(`${API_URL}/recreation/assembly-tasks/${taskId}`).then(r => r.data),
  assemblyTasks: (projectId: string, generationId?: string): Promise<RecreationAssemblyTask[]> =>
    axios.get(`${API_URL}/recreation/projects/${projectId}/assembly-tasks`, { params: generationId ? { generation_id: generationId } : undefined }).then(r => r.data),
  cancelAssemblyTask: (taskId: string): Promise<RecreationAssemblyTask> =>
    axios.post(`${API_URL}/recreation/assembly-tasks/${taskId}/cancel`).then(r => r.data),
  retryAssemblyTask: (taskId: string): Promise<RecreationAssemblyTask> =>
    axios.post(`${API_URL}/recreation/assembly-tasks/${taskId}/retry`).then(r => r.data),
  bindShot: (project: RecreationProject, shotId: string, binding: Pick<RecreationShot, "reference_media_id" | "replacement_media_id" | "instruction" | "description" | "instruction_refs">): Promise<RecreationProject> =>
    axios.put(`${API_URL}/recreation/projects/${project.id}/shots/${shotId}/references`, {
      revision: project.revision, analysis_id: project.analysis_id, ...binding,
    }).then(r => r.data),
  searchMedia: (params: { q?: string; kind?: string; project_id?: string; limit?: number; cursor?: number } = {}): Promise<RecreationMediaPage> =>
    axios.get(`${API_URL}/recreation/media`, { params }).then(r => r.data),
  list: (): Promise<RecreationProject[]> => axios.get(`${API_URL}/recreation/projects`).then(r => {
    if (!Array.isArray(r.data)) throw new Error("Invalid recreation project list response");
    return r.data;
  }),
  get: (id: string): Promise<RecreationProject> => axios.get(`${API_URL}/recreation/projects/${id}`).then(r => r.data),
  upload: (file: File): Promise<RecreationProject> => {
    const data = new FormData(); data.append("file", file);
    return axios.post(`${API_URL}/recreation/projects`, data).then(r => r.data);
  },
  analyze: (project: RecreationProject): Promise<RecreationProject> =>
    axios.post(`${API_URL}/recreation/projects/${project.id}/analyze`, { revision: project.revision }).then(r => r.data),
  cancelAnalysis: (project: RecreationProject): Promise<RecreationProject> =>
    axios.post(`${API_URL}/recreation/projects/${project.id}/analyze/${project.analysis_id}/cancel`, { revision: project.revision }).then(r => r.data),
  confirm: (project: RecreationProject, cuts: number[]): Promise<RecreationProject> =>
    axios.put(`${API_URL}/recreation/projects/${project.id}/timeline`, {
      revision: project.revision, analysis_id: project.analysis_id, cut_pts: cuts,
    }).then(r => r.data),
  evidence: (project: RecreationProject, pts: number): Promise<CutEvidence> =>
    axios.post(`${API_URL}/recreation/projects/${project.id}/evidence`, { analysis_id: project.analysis_id, pts }).then(r => r.data),
};
