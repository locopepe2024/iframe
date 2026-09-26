import axios from "axios";

export interface DirectorPlanLighting {
    key_source: string;
    color_tone: string;
    contrast: string;
    practical_sources: string[];
}

export interface DirectorPlanDialogueLine {
    speaker: string;
    line: string;
}

export interface DirectorPlanShot {
    shot_id: string;
    order: number;
    title: string;
    visual_intent: string;
    performance_action: string;
    action_physics: string;
    shot_size: string;
    camera_angle: string;
    composition: string;
    camera_movement: string;
    lighting: DirectorPlanLighting;
    duration_seconds: number | null;
    dialogue: DirectorPlanDialogueLine[];
    ambient_sound: string;
    character_ids: string[];
    prop_ids: string[];
}

export interface DirectorPlanBeat {
    beat_id: string;
    order: number;
    title: string;
    dramatic_purpose: string;
    emotional_change: string;
    duration_seconds: number | null;
    keep_with_next: boolean;
    source_chunk_refs: string[];
    story_event_ids: string[];
    shots: DirectorPlanShot[];
}

export interface DirectorPlanScene {
    scene_id: string;
    order: number;
    scene_ref: string;
    heading: string;
    location: string;
    time_anchor: string;
    continues_previous_scene: boolean;
    continuity_in: string;
    continuity_out: string;
    duration_seconds: number | null;
    environment_atmosphere: string;
    unresolved_questions: string[];
    source_chunk_refs: string[];
    prop_ids: string[];
    beats: DirectorPlanBeat[];
}

export interface DirectorShootingPlan {
    schema_version: 1;
    source_revision: number;
    source_revision_id: string;
    director_profile_revision: number;
    director_profile_hash: string;
    effective_style_hash: string;
    scenes: DirectorPlanScene[];
    unresolved_questions: string[];
    generated_at: number | null;
}

export interface DirectorShootingPlanCounts {
    scene_count: number;
    beat_count: number;
    shot_count: number;
    duration_seconds: number;
}

export interface DirectorShootingPlanRevisionSummary extends DirectorShootingPlanCounts {
    revision: number;
    content_hash: string;
    confirmed_at: number;
    source_revision: number;
    source_revision_id: string;
    director_profile_revision: number;
    director_profile_hash: string;
    effective_style_hash: string;
}

export interface DirectorShootingPlanSourceChunk {
    source_ref: string;
    char_start: number;
    char_end: number;
}

export interface DirectorShootingPlanState {
    project_id: string;
    draft_revision: number;
    draft_updated_at: number | null;
    draft: DirectorShootingPlan | null;
    current_revision: number;
    current: DirectorShootingPlanRevisionSummary | null;
    current_lineage: Record<string, unknown> | null;
    readiness_error: string | null;
    draft_stale: boolean;
    current_stale: boolean;
    source_chunks: DirectorShootingPlanSourceChunk[];
}

export interface DirectorShootingPlanJob {
    id: string;
    status: string;
    result: { plan: DirectorShootingPlan } | null;
    error?: string | null;
    progress?: { completed: number; total: number } | null;
}

export type DirectorShootingPlanJobListener = (job: DirectorShootingPlanJob) => void;

export interface DirectorShootingPlanDraftSaveResult {
    project_id: string;
    draft_revision: number;
    draft_updated_at: number | null;
    draft: DirectorShootingPlan | null;
}

export interface DirectorShootingPlanConfirmResult {
    project_id: string;
    current_revision: number;
    current: DirectorShootingPlanRevisionSummary;
    draft_revision: number;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const transient = (error: unknown) => axios.isAxiosError(error) &&
    (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));
const pending = (job: DirectorShootingPlanJob | undefined) => Boolean(job && !job.result?.plan &&
    ["running", "queued", "pending", "processing", "started", "in_progress"].includes(job.status.toLowerCase()));

async function runJob(
    baseUrl: string,
    projectId: string,
    onStatus?: DirectorShootingPlanJobListener,
): Promise<DirectorShootingPlan> {
    const base = `${baseUrl}/projects/${projectId}/director-shooting-plan-jobs`;
    let job = (await axios.post<DirectorShootingPlanJob>(base, {}, { timeout: 15000 })).data;
    if (!job?.id) throw new Error("Invalid Director shooting-plan task response");
    onStatus?.(job);
    let failures = 0;
    while (pending(job)) {
        await pause(2000);
        try {
            const next = (await axios.get<DirectorShootingPlanJob>(`${base}/${job.id}`, { timeout: 15000 })).data;
            if (!next || next.id !== job.id) throw new Error("Invalid Director shooting-plan task response");
            job = next;
            onStatus?.(job);
            failures = 0;
        } catch (error) {
            if (!transient(error) || ++failures >= 5) throw error;
        }
    }
    if (job.result?.plan) {
        onStatus?.({ ...job, status: "completed" });
        return job.result.plan;
    }
    if (["failed", "error", "superseded"].includes(job.status.toLowerCase())) {
        throw new Error(job.error || "Director shooting-plan analysis failed");
    }
    throw new Error(job.error || "Director shooting-plan task did not return a plan");
}

export function generateDirectorShootingPlan(
    baseUrl: string,
    projectId: string,
    onStatus?: DirectorShootingPlanJobListener,
) {
    return runJob(baseUrl, projectId, onStatus);
}

export async function getDirectorShootingPlan(baseUrl: string, projectId: string) {
    const response = await axios.get<DirectorShootingPlanState>(
        `${baseUrl}/projects/${projectId}/director-shooting-plan`,
    );
    return response.data;
}

export async function saveDirectorShootingPlanDraft(
    baseUrl: string,
    projectId: string,
    sourceRevision: number,
    expectedDraftRevision: number,
    plan: DirectorShootingPlan,
) {
    const response = await axios.put<DirectorShootingPlanDraftSaveResult>(
        `${baseUrl}/projects/${projectId}/director-shooting-plan/draft`,
        {
            source_revision: sourceRevision,
            expected_draft_revision: expectedDraftRevision,
            plan,
        },
    );
    return response.data;
}

export async function confirmDirectorShootingPlan(
    baseUrl: string,
    projectId: string,
    expectedCurrentRevision: number,
    expectedDraftRevision: number,
    plan: DirectorShootingPlan,
) {
    const response = await axios.post<DirectorShootingPlanConfirmResult>(
        `${baseUrl}/projects/${projectId}/director-shooting-plan/confirm`,
        {
            expected_current_revision: expectedCurrentRevision,
            expected_draft_revision: expectedDraftRevision,
            plan,
        },
    );
    return response.data;
}

export async function listDirectorShootingPlanRevisions(baseUrl: string, projectId: string) {
    const response = await axios.get<DirectorShootingPlanRevisionSummary[]>(
        `${baseUrl}/projects/${projectId}/director-shooting-plan/revisions`,
    );
    return response.data;
}

export async function getDirectorShootingPlanRevision(baseUrl: string, projectId: string, revision: number) {
    const response = await axios.get<DirectorShootingPlanRevisionSummary & { plan: DirectorShootingPlan }>(
        `${baseUrl}/projects/${projectId}/director-shooting-plan/revisions/${revision}`,
    );
    return response.data;
}

export async function restoreDirectorShootingPlanRevision(
    baseUrl: string,
    projectId: string,
    revision: number,
    expectedDraftRevision: number,
) {
    const response = await axios.post<DirectorShootingPlanDraftSaveResult>(
        `${baseUrl}/projects/${projectId}/director-shooting-plan/revisions/${revision}/restore`,
        { expected_draft_revision: expectedDraftRevision },
    );
    return response.data;
}
