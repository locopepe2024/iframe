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

export interface SeriesDirectorAnalysisResult {
  profile: SeriesDirectorDraft;
  sourceAudit?: {
    source_mode?: string;
    source_char_count?: number;
    chunk_count?: number;
    chunk_ranges?: Array<{ source_ref?: string; char_start?: number; char_end?: number }>;
    raw_response_received?: boolean;
    admission_status?: string;
  };
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
  let pollFailures = 0;
  while (!current.result?.profile && !["completed", "failed", "error"].includes(String(current.status).toLowerCase())) {
    await pause(2000);
    try {
      current = (await axios.get(`${baseUrl}/series/${seriesId}/director-profile-jobs/${job.id}`, { timeout: 15000 })).data;
      onStatus?.(current.status);
      pollFailures = 0;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const transient = !status || [408, 429, 502, 503, 504].includes(status);
      if (!transient || ++pollFailures >= 5) throw error;
    }
  }
  // The durable result is authoritative even if an older worker writes it one
  // poll before updating the visible status.
  if (current.result?.profile) return {
    profile: current.result.profile as SeriesDirectorDraft,
    sourceAudit: current.result.source_audit,
  } satisfies SeriesDirectorAnalysisResult;
  throw new Error(current.error || "Series Director analysis failed");
}
