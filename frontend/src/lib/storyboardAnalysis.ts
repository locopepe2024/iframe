import axios from "axios";

export type StoryboardDraftFrame = Record<string, any>;

interface StoryboardJob {
    id: string;
    status: "running" | "completed" | "failed";
    result: { frames: StoryboardDraftFrame[] } | null;
    error?: string;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const transient = (error: unknown) => axios.isAxiosError(error) &&
    (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));

async function runStoryboardJob(endpoint: string, pollBase: string, payload: unknown) {
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
    let failures = 0;
    while (job.status === "running") {
        await pause(2000);
        try {
            const next = (await axios.get<StoryboardJob>(`${pollBase}/${job.id}`, { timeout: 15000 })).data;
            if (!next || next.id !== job.id) throw new Error("Invalid storyboard analysis task response");
            job = next;
            failures = 0;
        } catch (error) {
            if (!transient(error) || ++failures >= 5) throw error;
        }
    }
    if (job.status !== "completed" || !job.result?.frames) {
        throw new Error(job.error || "Storyboard analysis failed");
    }
    return job.result.frames;
}

export function analyzeStoryboardPreview(baseUrl: string, projectId: string, text: string) {
    const base = `${baseUrl}/projects/${projectId}/storyboard-analysis-jobs`;
    return runStoryboardJob(base, base, { text });
}

export function refineStoryboardPreview(
    baseUrl: string,
    projectId: string,
    text: string,
    draft: StoryboardDraftFrame[],
    instructions: string[],
) {
    const base = `${baseUrl}/projects/${projectId}/storyboard-analysis-jobs`;
    return runStoryboardJob(`${base}/refine`, base, { text, draft, instructions });
}
