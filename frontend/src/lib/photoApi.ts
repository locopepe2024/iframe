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
  search_matches?: { source: "story" | "description" | "facts"; revision: number; excerpt: string }[];
}
export interface PhotoPersonFact { reference: string; name: string; age: number | null; gender: "unknown" | "female" | "male" | "other" }
export interface PhotoFacts { people: PhotoPersonFact[]; scene: string; lighting: string; location: string; latitude: number | null; longitude: number | null; capture_time: string; notes: string }
export interface PhotoAnnotations { revision: number; facts: PhotoFacts; actor: string; updated_at: string }
export interface PhotoAnalysis {
  model: string; provider: "qwen"; status: "needs_review"; created_at: string;
  observation: { people?: {reference: string; position: string; appearance: string; clothing: string; activity: string}[]; scene?: string; lighting?: string; time_clues?: string; objects?: string[]; relationships?: string[]; visible_summary: string; visible_text: string[]; uncertainties: string[]; story_question: string };
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
export interface PendingPeopleReview {
  task_id: string; batch_id: string; consent_version: number;
  pending_groups: number; deferred_groups: number; photo_count: number;
}
export interface PeopleTask {
  task_id: string; consent_version: number; status: string;
  counts: { pending: number; running: number; detected: number; no_faces: number; failed: number; cancelled: number; cleared: number };
}
export type FaceBox = [number, number, number, number];
export interface PeopleGroup {
  group_id: string; revision: number; status: "pending" | "deferred" | "confirmed" | "split" | "corrected";
  person_id: string | null; members: { face_id: string; photo_id: string; box: FaceBox }[];
}
export interface PersonAlbum { person_id: string; label: string; photo_count: number }
export interface PersonFace { task_id: string; face_id: string; box: FaceBox }
export interface PersonPhoto { photo_id: string; boxes: FaceBox[]; members: PersonFace[] }
export interface PeopleCorrectionSelection {
  action: "remove" | "split" | "merge" | "undo_batch";
  person_id?: string; target_id?: string; batch_id?: string; label?: string;
  members?: { task_id: string; face_id: string }[];
}
export interface PeopleCorrectionPreview {
  preview_token: string; selection: PeopleCorrectionSelection;
  counts: { members: number; photos: number; preserve: number };
  people: { person_id: string; label: string; members: { task_id: string; face_id: string; photo_id: string; box: string }[] }[];
  affected: { person_id: string; task_id: string; face_id: string; photo_id: string; box: string }[];
}
export interface PeopleCorrectionReceipt {
  operation_id: string; action: PeopleCorrectionSelection["action"]; person_id: string | null;
  counts: PeopleCorrectionPreview["counts"]; created_at: number;
}
export interface PeopleCorrectionRequest extends PeopleCorrectionSelection {
  operation_id: string; preview_token: string; method: "button";
}
export interface PeopleReviewRequest {
  operation_id: string; expected_revision: number; consent_version: number;
  action: "confirm" | "split" | "defer"; label: string;
}
export interface PeopleConsentRequest {
  operation_id: string; expected_version: number; granted: boolean;
  question_id?: string; clear?: boolean; method: "button";
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
    if (path.includes("people-corrections") && response.status === 409) throw new Error("人物关系已变化，请返回并重新预览。若上次提交未收到回执，请先用原确认按钮重试。");
    if (path.includes("people-corrections") && response.status === 422) throw new Error("请选择要调整的人脸；拆分时需为原人物保留至少一张人脸。");
    if (path.includes("people") && response.status === 503) throw new Error("人物整理暂不可用，请稍后刷新；不会自动提交确认。");
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
  annotations: (id: string) => request<PhotoAnnotations>(`/${encodeURIComponent(id)}/annotations`),
  saveAnnotations: (id: string, body: {operation_id: string; expected_revision: number; facts: PhotoFacts}) => request<PhotoAnnotations>(`/${encodeURIComponent(id)}/annotations`, "POST", body),
  deletePhoto: (id: string, operation_id: string) => request<{photo_id: string; status: "deleted"}>(`/${encodeURIComponent(id)}/delete`, "POST", {operation_id, confirmed: true}),
  peopleCorrectionPreview: (body: PeopleCorrectionSelection) => request<PeopleCorrectionPreview>("/people-corrections/preview", "POST", body),
  correctPeople: (body: PeopleCorrectionRequest) => request<PeopleCorrectionReceipt>("/people-corrections", "POST", body),
  peopleCorrectionHistory: (after = 0) => request<{ changes: PeopleCorrectionReceipt[]; next_after: number | null }>(`/people-corrections/history?after=${after}`),
  pendingPeopleReviews: (after = "") => request<{ reviews: PendingPeopleReview[]; next_after_id: string | null }>(`/people-reviews?${new URLSearchParams({ after_id: after })}`),
  peopleStatus: (id: string) => request<TimeConsent & { enabled: boolean }>(`/batches/${encodeURIComponent(id)}/people`),
  peopleQuestion: (id: string) => request<TimeQuestion & { consent_version: number }>(`/batches/${encodeURIComponent(id)}/people-question`, "POST"),
  peopleConsent: (id: string, body: PeopleConsentRequest) => request<TimeConsent>(`/batches/${encodeURIComponent(id)}/people-consent`, "POST", body),
  peopleTasks: (id: string) => request<PeopleTask[]>(`/batches/${encodeURIComponent(id)}/people-tasks`),
  createPeopleTask: (id: string, body: { operation_id: string; consent_version: number; retry_task_id?: string }) => request<PeopleTask>(`/batches/${encodeURIComponent(id)}/people-tasks`, "POST", body),
  peopleGroups: (id: string) => request<{ ready: boolean; groups: PeopleGroup[] }>(`/people-tasks/${encodeURIComponent(id)}/groups`),
  reviewPeopleGroup: (id: string, body: PeopleReviewRequest) => request<{ status: string; revision: number; person_id: string | null }>(`/people-groups/${encodeURIComponent(id)}/review`, "POST", body),
  peopleAlbums: (after = "") => request<{ people: PersonAlbum[]; next_after_id: string | null }>(`/people-albums?${new URLSearchParams({ after_id: after })}`),
  personPhotos: (id: string, after = "") => request<{ photos: PersonPhoto[]; next_after_id: string | null }>(`/people-albums/${encodeURIComponent(id)}?${new URLSearchParams({ after_id: after })}`),
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
  list: (view: string, year: string, after = "", query = "", filters?: {date_prefix?: string; date_from?: string; date_to?: string; order?: "id" | "recent"}) => request<{ photos: AlbumPhoto[]; next_after_id: string | null }>(
    `/albums?${new URLSearchParams({ view, ...(year ? { year } : {}), ...(query ? { query } : {}), ...(filters?.date_prefix ? {date_prefix: filters.date_prefix} : {}), ...(filters?.date_from ? {date_from: filters.date_from} : {}), ...(filters?.date_to ? {date_to: filters.date_to} : {}), ...(filters?.order ? {order: filters.order} : {}), after_id: after, limit: "20" })}`),
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
  image: async (id: string, original = false) => {
    const response = await authenticatedFetch(`${base}/${encodeURIComponent(id)}/${original ? "original" : "thumbnail"}`, {
      credentials: "include", cache: "no-store",
    });
    if (!response.ok) throw serviceError(response.status);
    return response.blob();
  },
};
