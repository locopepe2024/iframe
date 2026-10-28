"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { API_URL, authenticatedFetch } from "@/lib/api";

export interface InteractionFocus {
  kind: "chat" | "photo" | "diary";
  object_id: string;
  phase: "viewing" | "editing" | "listening" | "paused";
  draft: string;
}
type VersionedFocus = InteractionFocus & {revision: number};
const chatFocus: InteractionFocus = {kind:"chat", object_id:"", phase:"viewing", draft:""};

async function focusRequest<T>(session: string, body?: unknown): Promise<T> {
  const response = await authenticatedFetch(`${API_URL}/companion-agent-api/companion-runtime/sessions/${encodeURIComponent(session)}/focus`, {
    method: body ? "PUT" : "GET", credentials:"include", cache:"no-store",
    ...(body ? {headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)} : {}),
  });
  if (!response.ok) throw new Error(response.status === 409
    ? "当前任务已在别处变化，请保留草稿并重新打开聊天。"
    : "当前编辑状态未同步，草稿仍保留，请重试原请求。");
  return response.json();
}

// One immutable request per chat operation: a lost response can safely be retried.
export function createFocusSync() {
  let pending: {session:string; operation:string; focus:InteractionFocus; body?:unknown} | undefined;
  return async (session:string, operation:string, focus:InteractionFocus) => {
    if (!pending || pending.session !== session || pending.operation !== operation)
      pending = {session, operation, focus:{...focus}};
    const request = pending;
    if (!request.body) {
      const current = await focusRequest<VersionedFocus>(session);
      request.body = {operation_id:operation, expected_revision:current.revision, focus:request.focus};
    }
    await focusRequest<VersionedFocus>(session, request.body);
  };
}

export function createInteractionFocus() {
  const editors = new Map<symbol, InteractionFocus>();
  return {
    register(token:symbol, focus:InteractionFocus) { editors.set(token,focus); },
    remove(token:symbol) { editors.delete(token); },
    current():InteractionFocus { return Array.from(editors.values()).at(-1) ?? chatFocus; },
  };
}
export const InteractionFocusContext = createContext<ReturnType<typeof createInteractionFocus> | null>(null);

// Also works outside the chat shell; standalone editors keep their existing behavior.
export function useInteractionFocus(focus:InteractionFocus | null) {
  const context = useContext(InteractionFocusContext);
  const token = useRef(Symbol("editor"));
  useLayoutEffect(()=>{
    if (focus) context?.register(token.current, focus);
    else context?.remove(token.current);
  },[context,focus?.kind,focus?.object_id,focus?.phase,focus?.draft]);
  useLayoutEffect(()=>{const id=token.current;return ()=>context?.remove(id);},[context]);
}
