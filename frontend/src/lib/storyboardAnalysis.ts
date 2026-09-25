import axios from "axios";

export type StoryboardDraftFrame = Record<string, any>;

export interface StoryboardAnalysisLineage {
    status: "pinned" | "legacy_unpinned";
    source_revision?: number | null;
    source_revision_id?: string | null;
    director_profile_revision?: number | null;
    director_profile_hash?: string | null;
    fact_ledger_revision?: number | null;
    fact_ledger_source_revision_id?: string | null;
    fact_ledger_status: "none" | "current" | "stale" | "unavailable";
    fact_ids: string[];
    source_ranges: { start: number; end: number }[];
}

export interface StoryboardAnalysisDraft {
    frames: StoryboardDraftFrame[];
    lineage: StoryboardAnalysisLineage;
}

interface StoryboardJob {
    id: string;
    status: "queued" | "running" | "completed" | "failed" | "superseded";
    result: StoryboardAnalysisDraft | null;
    error?: string;
    progress?: { completed: number; total: number } | null;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const transient = (error: unknown) => axios.isAxiosError(error) &&
    (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));

async function runStoryboardJob(endpoint: string, pollBase: string, payload: unknown,
                                onProgress?: (completed: number, total: number) => void): Promise<StoryboardAnalysisDraft> {
    let submitted: StoryboardJob | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            submitted = (await axios.post<StoryboardJob>(endpoint, payload, { timeout: 15000 })).data;
            break;
        } catch (error) {
            if (attempt === 2 || !transient(error)) throw error;
            await pause(2000);
        }
    }
    if (!submitted?.id) throw new Error("Invalid storyboard analysis task response");
    let job = submitted;
    if (job.progress) onProgress?.(job.progress.completed, job.progress.total);
    let failures = 0;
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (job.status === "running" || job.status === "queued") {
        if (Date.now() >= deadline) throw new Error("Storyboard analysis timed out. Please retry.");
        await pause(2000);
        try {
            const next = (await axios.get<StoryboardJob>(`${pollBase}/${job.id}`, { timeout: 15000 })).data;
            if (!next || next.id !== job.id) throw new Error("Invalid storyboard analysis task response");
            job = next;
            if (job.progress) onProgress?.(job.progress.completed, job.progress.total);
            failures = 0;
        } catch (error) {
            if (!transient(error) || ++failures >= 5) throw error;
        }
    }
    if (job.status !== "completed" || !job.result?.frames) {
        throw new Error(job.error || "Storyboard analysis failed");
    }
    return {
        frames: job.result.frames,
        lineage: job.result.lineage ?? {
            status: "legacy_unpinned",
            fact_ledger_status: "none",
            fact_ids: [],
            source_ranges: [],
        },
    };
}

export function analyzeStoryboardPreview(baseUrl: string, projectId: string, text: string,
                                         onProgress?: (completed: number, total: number) => void) {
    const base = `${baseUrl}/projects/${projectId}/storyboard-analysis-jobs`;
    return runStoryboardJob(base, base, { text }, onProgress);
}

export async function applyStoryboardDraft(
    baseUrl: string,
    projectId: string,
    text: string,
    draft: StoryboardDraftFrame[],
    lineage: StoryboardAnalysisLineage,
) {
    const response = await axios.post(
        `${baseUrl}/projects/${projectId}/storyboard-analysis/apply`,
        { text, draft, lineage },
    );
    return response.data;
}

/** Compatibility flow for callers that still expect generation + apply in one call. */
export async function analyzeAndApplyStoryboard(
    baseUrl: string,
    projectId: string,
    text: string,
) {
    const draft = await analyzeStoryboardPreview(baseUrl, projectId, text);
    return applyStoryboardDraft(baseUrl, projectId, text, draft.frames, draft.lineage);
}

export function refineStoryboardPreview(
    baseUrl: string,
    projectId: string,
    text: string,
    draft: StoryboardDraftFrame[],
    instructions: string[],
    lineage: StoryboardAnalysisLineage,
) {
    const base = `${baseUrl}/projects/${projectId}/storyboard-analysis-jobs`;
    return runStoryboardJob(`${base}/refine`, base, { text, draft, instructions, lineage });
}
