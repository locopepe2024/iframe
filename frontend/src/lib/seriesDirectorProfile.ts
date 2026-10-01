import axios from "axios";

export type SeriesDirectorDraft = Record<string, unknown>;
export interface SeriesDirectorState {
  series_id: string;
  source_context: Record<string, unknown>;
  profile: SeriesDirectorDraft | null;
  draft: SeriesDirectorDraft | null;
  draft_revision: number;
  draft_name?: string | null;
  confirmed_revisions: Array<{ revision: number; profile: SeriesDirectorDraft }>;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function getSeriesDirectorProfile(baseUrl: string, seriesId: string) {
  return (await axios.get<SeriesDirectorState>(`${baseUrl}/series/${seriesId}/director-profile`)).data;
}
export async function saveSeriesDirectorDraft(baseUrl: string, seriesId: string, draft: SeriesDirectorDraft, draftName?: string) {
  return (await axios.put(`${baseUrl}/series/${seriesId}/director-profile/draft`, { draft, draft_name: draftName })).data;
}
export async function confirmSeriesDirectorProfile(baseUrl: string, seriesId: string) {
  return (await axios.post(`${baseUrl}/series/${seriesId}/director-profile/confirm`)).data;
}
export async function analyzeSeriesDirectorProfile(baseUrl: string, seriesId: string, onStatus?: (status: string) => void) {
  const job = (await axios.post(`${baseUrl}/series/${seriesId}/director-profile-jobs`, {}, { timeout: 60000 })).data;
  if (!job?.id) throw new Error("Invalid Series Director task response");
  onStatus?.(job.status);
  let current = job;
  while (!["completed", "failed", "error"].includes(String(current.status).toLowerCase())) {
    await pause(2000);
    current = (await axios.get(`${baseUrl}/series/${seriesId}/director-profile-jobs/${job.id}`, { timeout: 15000 })).data;
    onStatus?.(current.status);
  }
  if (current.result?.profile) return current.result.profile as SeriesDirectorDraft;
  throw new Error(current.error || "Series Director analysis failed");
}
