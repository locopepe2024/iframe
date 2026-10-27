import { API_URL, authenticatedFetch } from "./api";
export interface Memory { id: string; content: string; type: string; importance: number; quote: string; source_message_id: string }
export interface UserMessage { id: string; sequence: number; text: string; turn?: Turn }
export interface Preview {
  status: "pending_confirmation" | "preview_closed"; preview_token: string; action?: "save" | "delete";
  preview?: { content?: string; quote?: string; source_text?: string; source_message_id?: string; type?: string; importance?: number; memory?: Memory; notice?: string };
}
export interface PhotoRead { kind: "photo_read"; name: string; arguments: Record<string, unknown>; photos: { photo_id: string; date: import("./photoApi").PhotoDateAnnotation; description?: import("./photoApi").DescriptionReview | null; story?: { text: string } | null; analysis?: import("./photoApi").PhotoAnalysis | null }[]; next_after_id: string | null }
export interface PhotoTask { kind: "photo_task"; task_id: string; spoken_text?: string; status: "waiting_input" | "completed" | "cancelled"; step: "select_photo" | "review_photo" | "closed" | "cancelled"; revision: number; photos: PhotoRead["photos"] }
export interface DiaryRead { kind: "diary_read"; name: string; diaries: Diary[]; open_calendar: boolean; spoken_text: string }
export interface Turn { turn_id: string; status: string; result?: (DiaryRead | PhotoTask | PhotoRead | { kind: "text"; text: string } | { kind: "upload_guide" } | ({ kind: "confirmation" } & Preview) | { kind: "read"; name: string; memories: Memory[]; next_cursor: string | null }) }
export interface MemoryPage { memories: Memory[]; next_cursor: string | null }
export interface Diary { day: string; text: string; source_turn_id: string; revision: number; updated_at: number }
const base = `${API_URL}/companion-agent-api/companion-runtime`;
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedFetch(base + path, { method, credentials: "include", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.clone().json() as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch { /* use the stable fallback below */ }
    if (response.status === 409 && detail) throw new Error(detail);
    throw new Error(response.status === 409 ? "资料已变化、请求仍在处理或达到容量上限。请保留当前请求稍后重试，或重新核对。"
    : response.status === 404 ? "这条资料或确认预览已关闭，请重新查看。"
    : response.status === 422 ? "请求未通过核对，请调整文字或在记忆列表选择具体条目。"
    : detail || "服务暂不可用。原话可能已经保存，请用原请求重试；也请检查当前用户的 UniArt 渠道。");
  }
  return response.json();
}
export const companionApi = {
  photoTaskInput: (id: string, body: {operation_id: string; expected_revision: number; action: "select" | "close" | "cancel"; photo_id?: string}) => request<PhotoTask>(`/photo-tasks/${encodeURIComponent(id)}/input`, "POST", body),
  diaries: (month: string) => request<{diaries: Diary[]}>(`/diaries?${new URLSearchParams({month})}`),
  saveDiary: (day: string, body: {operation_id: string; text: string; source_turn_id: string; expected_revision: number}) => request<Diary>(`/diaries/${encodeURIComponent(day)}`, "PUT", body),
  session: (operation_id: string) => request<{ session_id: string }>("/sessions", "POST", { operation_id }),
  messages: (id: string, after = 0) => request<{ messages: UserMessage[]; next_after: number | null }>(`/sessions/${encodeURIComponent(id)}/conversation?after=${after}`),
  chat: (id: string, body: { operation_id: string; text: string; allow_external_text: true }) => request<Turn>(`/sessions/${encodeURIComponent(id)}/chat`, "POST", body),
  turn: (id: string) => request<Turn>(`/turns/${encodeURIComponent(id)}`),
  tool: <T>(name: string, args: object) => request<T>("/tools", "POST", { name, arguments: args }),
  confirm: (preview_token: string, operation_id: string) => request<{ action: string; memory_id: string }>("/confirmations", "POST", { preview_token, operation_id, method: "button" }),
  cancel: (preview_token: string) => request<{ status: string }>("/cancel", "POST", { preview_token }),
  opentalkingBind: (session_id: string, ttl_seconds = 900) => request<{ context_token: string; expires_at: number }>("/opentalking/bind", "POST", { session_id, ttl_seconds }),
  opentalkingRelease: (context_token: string) => request<{ session_id: string; status: string }>("/opentalking/release", "POST", { context_token }),
};
