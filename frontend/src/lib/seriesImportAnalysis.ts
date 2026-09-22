import axios from "axios";

interface ImportPreviewJob<T> {
    id: string;
    status: "running" | "completed" | "failed";
    result: T | null;
    error?: string;
}

export interface SeriesImportPreview {
    filename: string;
    text_length: number;
    suggested_episodes: number;
    episodes: Array<{
        episode_number: number;
        title: string;
        summary: string;
        estimated_duration?: string;
        start_marker?: string;
        end_marker?: string;
    }>;
    import_id: string;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const transient = (error: unknown) => axios.isAxiosError(error) &&
    (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));

export async function runImportPreview<T>(
    baseUrl: string,
    file: File,
    suggestedEpisodes: number,
): Promise<T> {
    const formData = new FormData();
    formData.append("file", file);
    let job: ImportPreviewJob<T> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            job = (await axios.post<ImportPreviewJob<T>>(
                `${baseUrl}/series/import/preview?suggested_episodes=${suggestedEpisodes}`,
                formData,
                { headers: { "Content-Type": "multipart/form-data" }, timeout: 15000 },
            )).data;
            break;
        } catch (error) {
            if (attempt === 2 || !transient(error)) throw error;
            await pause(2000);
        }
    }
    if (!job?.id) throw new Error("Invalid import analysis task response");
    let current: ImportPreviewJob<T> = job;
    let failures = 0;
    while (current.status === "running") {
        await pause(2000);
        try {
            const next: ImportPreviewJob<T> = (await axios.get<ImportPreviewJob<T>>(
                `${baseUrl}/series/import/preview-jobs/${current.id}`,
                { timeout: 15000 },
            )).data;
            if (!next || next.id !== current.id) throw new Error("Invalid import analysis task response");
            current = next;
            failures = 0;
        } catch (error) {
            if (!transient(error) || ++failures >= 5) throw error;
        }
    }
    if (current.status !== "completed" || !current.result) {
        throw new Error(current.error || "Import analysis failed");
    }
    return current.result;
}
