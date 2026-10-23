import { API_URL, authenticatedFetch } from "./api";
export interface Memory { id: string; content: string; type: string; importance: number; quote: string; source_message_id: string }
export interface UserMessage { id: string; sequence: number; text: string; turn?: Turn }
export interface Preview {
  status: "pending_confirmation" | "preview_closed"; preview_token: string; action?: "save" | "delete";
  preview?: { content?: string; quote?: string; source_text?: string; source_message_id?: string; type?: string; importance?: number; memory?: Memory; notice?: string };
}
export interface Turn { turn_id: string; status: string; result?: ({ kind: "text"; text: string } | ({ kind: "confirmation" } & Preview) | { kind: "read"; name: string; memories: Memory[]; next_cursor: string | null }) }
export interface MemoryPage { memories: Memory[]; next_cursor: string | null }
const base = `${API_URL}/companion-agent-api/companion-runtime`;
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedFetch(base + path, { method, credentials: "include", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(response.status === 409 ? "资料已变化、请求仍在处理或达到容量上限。请保留当前请求稍后重试，或重新核对。"
    : response.status === 404 ? "这条资料或确认预览已关闭，请重新查看。"
    : response.status === 422 ? "请求未通过核对，请调整文字或在记忆列表选择具体条目。"
    : "服务暂不可用。原话可能已经保存，请用原请求重试；也请检查当前用户的 UniArt 渠道。");
  return response.json();
}
export const companionApi = {
  session: (operation_id: string) => request<{ session_id: string }>("/sessions", "POST", { operation_id }),
  messages: (id: string, after = 0) => request<{ messages: UserMessage[]; next_after: number | null }>(`/sessions/${encodeURIComponent(id)}/conversation?after=${after}`),
  chat: (id: string, body: { operation_id: string; text: string; allow_external_text: true }) => request<Turn>(`/sessions/${encodeURIComponent(id)}/chat`, "POST", body),
  turn: (id: string) => request<Turn>(`/turns/${encodeURIComponent(id)}`),
  tool: <T>(name: string, args: object) => request<T>("/tools", "POST", { name, arguments: args }),
  confirm: (preview_token: string, operation_id: string) => request<{ action: string; memory_id: string }>("/confirmations", "POST", { preview_token, operation_id, method: "button" }),
  cancel: (preview_token: string) => request<{ status: string }>("/cancel", "POST", { preview_token }),
};
