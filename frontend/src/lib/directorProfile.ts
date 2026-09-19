import axios from "axios";

export type DirectorProfileDraft = Record<string, unknown>;

interface DirectorProfileJob {
    id: string;
    /** The API currently uses running/completed/failed. Keep the client
     * tolerant of older workers that expose a more specific queued state. */
    status: string;
    result: { profile: DirectorProfileDraft } | null;
    error?: string;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const transient = (error: unknown) => axios.isAxiosError(error) &&
    (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));

const hasProfile = (job: DirectorProfileJob | undefined): job is DirectorProfileJob & {
    result: { profile: DirectorProfileDraft };
} => Boolean(job?.result?.profile);

const isPending = (job: DirectorProfileJob | undefined) => {
    if (!job || hasProfile(job)) return false;
    return ["running", "queued", "pending", "processing", "started", "in_progress"].includes(
        job.status.toLowerCase(),
    );
};

async function runJob(endpoint: string, pollBase: string, payload?: unknown) {
    const response = await axios.post<DirectorProfileJob>(endpoint, payload ?? {}, { timeout: 15000 });
    let job = response.data;
    let failures = 0;
    if (!job?.id) throw new Error("Invalid director analysis task response");
    // A worker can persist the result just before its status update becomes
    // visible to the polling request. The result is the durable completion
    // signal, so stop waiting as soon as it is present.
    while (isPending(job)) {
        await pause(2000);
        try {
            const next = (await axios.get<DirectorProfileJob>(`${pollBase}/${job.id}`, { timeout: 15000 })).data;
            if (!next || next.id !== job.id) throw new Error("Invalid director analysis task response");
            job = next;
            failures = 0;
        } catch (error) {
            if (!transient(error) || ++failures >= 5) throw error;
        }
    }
    if (hasProfile(job)) {
        return job.result.profile;
    }
    if (["failed", "error"].includes(job.status.toLowerCase())) {
        throw new Error(job.error || "Director analysis failed");
    }
    throw new Error(job.error || "Director analysis did not return a profile");
}

export function analyzeDirectorProfile(baseUrl: string, projectId: string) {
    const base = `${baseUrl}/projects/${projectId}/director-profile-jobs`;
    return runJob(base, base);
}

export function refineDirectorProfile(
    baseUrl: string,
    projectId: string,
    draft: DirectorProfileDraft,
    instructions: string[],
) {
    const base = `${baseUrl}/projects/${projectId}/director-profile-jobs`;
    return runJob(`${base}/refine`, base, { draft, instructions });
}
