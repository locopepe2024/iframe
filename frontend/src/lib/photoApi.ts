import { API_URL, authenticatedFetch } from "./api";

export interface PhotoDateAnnotation {
  date: { value: string; precision: "year" | "month" | "day" | "second"; utc_offset: string | null } | null;
  status: "pending_confirmation" | "parsed" | "confirmed";
  reason: "not_processed" | "missing" | "invalid" | "conflict" | null;
  source: "exif" | "user" | "none";
  revision: number;
}
export interface AlbumPhoto {
  photo_id: string; batch_id: string; date: PhotoDateAnnotation;
  search_matches?: { source: "story" | "description"; revision: number; excerpt: string }[];
}
export interface PhotoAnalysis {
  model: string; provider: "qwen"; status: "needs_review"; created_at: string;
  observation: { visible_summary: string; visible_text: string[]; uncertainties: string[]; story_question: string };
}
export interface TimeConsent { granted: boolean; consent_version: number }
export interface UploadManifestItem { item_id: string; filename: string; size: number; sha256: string }
export interface UploadBatch {
  batch_id: string;
  items: (UploadManifestItem & { status: "pending" | "uploaded" | "failed"; photo_id: string | null; error_code: string | null })[];
  counts: { pending: number; uploaded: number; failed: number };
}
export interface PhotoTimeTask {
  task_id: string; batch_id: string; status: "queued" | "running" | "completed" | "needs_confirmation" | "partial_failed" | "failed" | "cancelled";
  consent_version: number; created_at: string;
  counts: { pending: number; completed: number; needs_confirmation: number; failed: number; cancelled: number };
  items: { photo_id: string; expected_revision: number; status: string; error_code: string | null; result: PhotoDateAnnotation | null }[];
}
export interface DescriptionReview { revision: number; description: string; actor: string; created_at: string }
export interface BatchUndoPreview {
  batch_id: string; preview_token: string; counts: { undo: number; preserve: number };
  items: { photo_id: string; action: "undo" | "preserve"; current: PhotoDateAnnotation; target: PhotoDateAnnotation }[];
}
export interface BatchUndoReceipt {
  operation_id: string; created_at: string; counts: { undo: number; preserve: number };
}
export interface PhotoStory { revision: number; text: string; actor: string; created_at: string }
export interface TimeQuestion { question_id: string; text: string }
export interface DateChange {
  revision: number; after: PhotoDateAnnotation; kind: string; created_at: string;
}
interface Mutation { operation_id: string; expected_revision: number; consent_version: number }
const base = `${API_URL}/photo-demo-api/photos`;

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedFetch(`${base}${path}`, {
    method, credentials: "include", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (path.endsWith("/undo-time") && response.status === 409) throw new Error("照片或授权已变化，请重新预览后再确认撤销。");
    if (path.endsWith("/analysis") && response.status === 409) throw new Error("请先在 iFrame 创作台为当前用户配置 UniArt 渠道，再回来重试。");
    if (path.endsWith("/analysis") && response.status === 502) throw new Error("当前用户的 UniArt 渠道拒绝访问，请在创作台检查配置后重试。");
    throw serviceError(response.status);
  }
  return response.json();
}
function serviceError(status: number) {
  return new Error(status === 409 ? "资料已变化，请刷新照片后再确认。"
    : status === 403 ? "整理授权已失效，请重新确认。"
    : status === 413 ? "照片太大，请选择不超过 10 MB、2000 万像素的照片。"
    : status === 422 ? "资料格式不正确，请核对日期或选择静态 JPEG、PNG、WebP 照片。"
    : status === 404 ? "暂时找不到这张照片，请刷新相册。"
    : "服务暂不可用，请稍后重试。");
}
export const photoApi = {
  undoPreview: (id: string) => request<BatchUndoPreview>(`/batches/${encodeURIComponent(id)}/undo-time-preview`),
  undoBatch: (id: string, body: { operation_id: string; preview_token: string }) => request<BatchUndoReceipt>(`/batches/${encodeURIComponent(id)}/undo-time`, "POST", body),
  undoHistory: (id: string, after = 0) => request<{ changes: BatchUndoReceipt[]; next_after: number | null }>(`/batches/${encodeURIComponent(id)}/undo-time/history?after=${after}`),
  timeTasks: (id: string) => request<PhotoTimeTask[]>(`/batches/${encodeURIComponent(id)}/time-tasks`),
  createTimeTask: (id: string, body: { operation_id: string; consent_version: number; retry_task_id?: string }) => request<PhotoTimeTask>(`/batches/${encodeURIComponent(id)}/time-tasks`, "POST", body),
  fingerprint: async (file: File) => {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  },
  uploadBatches: (after = "") => request<{ batches: UploadBatch[]; next_after_id: string | null }>(`/upload-batches?${new URLSearchParams({ after_id: after, limit: "10" })}`),
  uploadBatch: (id: string) => request<UploadBatch>(`/upload-batches/${encodeURIComponent(id)}`),
  createUploadBatch: (id: string, items: UploadManifestItem[]) => request<UploadBatch>(`/upload-batches/${encodeURIComponent(id)}`, "PUT", { items }),
  uploadBatchItem: async (batch: string, item: string, file: File) => {
    const response = await authenticatedFetch(`${base}/upload-batches/${encodeURIComponent(batch)}/items/${encodeURIComponent(item)}`, {
      method: "PUT", body: file, credentials: "include", cache: "no-store",
    });
    if (!response.ok) throw serviceError(response.status);
    return response.json() as Promise<{ photo_id: string; batch_id: string; created: boolean }>;
  },
  story: (id: string) => request<PhotoStory | null>(`/${encodeURIComponent(id)}/story`),
  saveStory: (id: string, body: { text: string; expected_revision: number; operation_id: string }) => request<PhotoStory>(`/${encodeURIComponent(id)}/story`, "POST", body),
  storyHistory: (id: string, after = 0) => request<{ changes: PhotoStory[]; next_after_revision: number | null }>(`/${encodeURIComponent(id)}/story/history?after_revision=${after}`),
  description: (id: string) => request<DescriptionReview | null>(`/${encodeURIComponent(id)}/description`),
  confirmDescription: (id: string, body: { description: string; expected_revision: number; operation_id: string }) => request<DescriptionReview>(`/${encodeURIComponent(id)}/description`, "POST", body),
  descriptionHistory: (id: string, after = 0) => request<{ changes: DescriptionReview[]; next_after_revision: number | null }>(`/${encodeURIComponent(id)}/description/history?after_revision=${after}`),
  analysis: (id: string) => request<PhotoAnalysis | null>(`/${encodeURIComponent(id)}/analysis`),
  analyze: (id: string) => request<PhotoAnalysis>(`/${encodeURIComponent(id)}/analysis`, "POST", { allow_external_analysis: true }),
  list: (view: string, year: string, after = "", query = "") => request<{ photos: AlbumPhoto[]; next_after_id: string | null }>(
    `/albums?${new URLSearchParams({ view, ...(year ? { year } : {}), ...(query ? { query } : {}), after_id: after, limit: "20" })}`),
  batch: (id: string) => request<TimeConsent>(`/batches/${encodeURIComponent(id)}`),
  question: (id: string) => request<TimeQuestion>(`/batches/${encodeURIComponent(id)}/time-question`, "POST"),
  answer: (id: string, question: string, granted: boolean) => request<TimeConsent>(
    `/batches/${encodeURIComponent(id)}/time-consent`, "POST", { question_id: question, granted, method: "button" }),
  organize: (id: string, body: Mutation) => request<PhotoDateAnnotation>(`/${encodeURIComponent(id)}/organize-time`, "POST", body),
  correct: (id: string, body: Mutation & { value: string; precision: "year" | "month" | "day" }) =>
    request<PhotoDateAnnotation>(`/${encodeURIComponent(id)}/date`, "PATCH", body),
  history: (id: string, after = 0) => request<{ changes: DateChange[]; next_after_revision: number | null }>(
    `/${encodeURIComponent(id)}/date/history?after_revision=${after}&limit=20`),
  restore: (id: string, body: Mutation & { target_revision: number }) =>
    request<PhotoDateAnnotation>(`/${encodeURIComponent(id)}/date/restore`, "POST", body),
  revoke: (id: string, version: number) => request<TimeConsent>(
    `/batches/${encodeURIComponent(id)}/revoke-time`, "POST", { expected_consent_version: version }),
  upload: async (key: string, file: File) => {
    const response = await authenticatedFetch(`${base}/uploads/${encodeURIComponent(key)}`, {
      method: "POST", body: file, credentials: "include", cache: "no-store",
    });
    if (!response.ok) throw serviceError(response.status);
    return response.json() as Promise<{ photo_id: string; batch_id: string; created: boolean }>;
  },
  image: async (id: string) => {
    const response = await authenticatedFetch(`${base}/${encodeURIComponent(id)}/thumbnail`, {
      credentials: "include", cache: "no-store",
    });
    if (!response.ok) throw serviceError(response.status);
    return response.blob();
  },
};
