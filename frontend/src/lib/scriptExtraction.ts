import axios from 'axios';

interface ExtractionJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  result: { characters: any[]; scenes: any[]; props: any[] } | null;
  error?: string;
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const transient = (error: unknown) => axios.isAxiosError(error) &&
  (!error.response || [408, 429, 502, 503, 504].includes(error.response.status));

/** Retry short transport failures, never resubmit model execution while polling. */
export async function extractScriptPreview(baseUrl: string, projectId: string, text: string) {
  const endpoint = `${baseUrl}/projects/${projectId}/extraction-jobs`;
  let submitted: ExtractionJob | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      submitted = (await axios.post<ExtractionJob>(endpoint, { text }, { timeout: 15000 })).data;
      break;
    } catch (error) {
      if (attempt === 2 || !transient(error)) throw error;
      await pause(2000);
    }
  }
  if (!submitted?.id) throw new Error('Invalid analysis task response');
  let job: ExtractionJob = submitted;
  let failures = 0;
  while (job.status === 'running') {
    await pause(2000);
    try {
      const next: ExtractionJob = (await axios.get<ExtractionJob>(`${endpoint}/${job.id}`, { timeout: 15000 })).data;
      if (!next || next.id !== job.id) throw new Error('Invalid analysis task response');
      job = next;
      failures = 0;
    } catch (error) {
      if (!transient(error) || ++failures >= 5) throw error;
    }
  }
  if (job.status !== 'completed' || !job.result) throw new Error(job.error || '剧本分析失败，请重试。');
  return job.result;
}
