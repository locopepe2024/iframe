import axios from "axios";

export type DirectorProfileDraft = Record<string, unknown>;

interface DirectorProfileJob {
    id: string;
    status: "running" | "completed" | "failed";
    result: { profile: DirectorProfileDraft } | null;
    error?: string;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const transient = (error: unknown) => axios.isAxiosError(error) &&
    (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));

async function runJob(endpoint: string, pollBase: string, payload?: unknown) {
    const response = await axios.post<DirectorProfileJob>(endpoint, payload ?? {}, { timeout: 15000 });
    let job = response.data;
    let failures = 0;
    if (!job?.id) throw new Error("Invalid director analysis task response");
    while (job.status === "running") {
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
    if (job.status !== "completed" || !job.result?.profile) {
        throw new Error(job.error || "Director analysis failed");
    }
    return job.result.profile;
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
