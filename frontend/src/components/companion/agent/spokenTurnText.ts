import type { Turn } from "@/lib/companionApi";

export type SpokenTurnMeta = { text: string; announcementKey?: string; reason: "chat" | "task_transition" | "question" };

/** Describe the result that actually exists; a proposal is never a saved outcome. */
export function spokenTurnText(result: Turn["result"]): string | undefined {
  if (!result) return undefined;
  switch (result.kind) {
    case "silent": return undefined;
    case "text": return result.text;
    case "media_draft": case "photo_task": case "diary_read": case "album_guide": case "photo_action":
      return result.spoken_text;
    case "upload_guide": return "可以从手机添加照片或视频，也可以从相册选择。请在卡片里选择。";
    case "photo_read": return result.photos.length
      ? `这一页找到 ${result.photos.length} 张照片，可以在卡片里查看。`
      : "这次没有找到匹配的照片，可以换个时间、人物称呼或地点再找。";
    case "read": return result.memories.length
      ? `这一页找到 ${result.memories.length} 条已确认的记忆，可以在卡片里查看。`
      : "这次没有找到匹配的已保存记忆。";
    case "confirmation": return result.status === "pending_confirmation"
      ? "这项操作还没有执行，请核对卡片内容，再确认是否执行。"
      : "这项操作的确认已关闭。";
  }
}

/**
 * Return the short voice line and the durable state key used for announcement
 * de-duplication. A new turn is not automatically a new task state: retries
 * and polling can produce multiple turns for the same task revision.
 */
export function spokenTurnMeta(result: Turn["result"]): SpokenTurnMeta | undefined {
  const text = spokenTurnText(result);
  if (!text || !result) return undefined;
  if (result.kind === "media_draft" || result.kind === "photo_task") {
    return { text, reason: "task_transition", announcementKey: `${result.kind}:${result.task_id}:${result.revision}:${result.status}:${result.step}` };
  }
  if (result.kind === "text" && "operation_status" in result && typeof result.operation_status === "string") {
    const diaryResult = result as typeof result & { day?: unknown };
    const day = typeof diaryResult.day === "string" ? diaryResult.day : "";
    return { text, reason: "task_transition", announcementKey: `diary:${day}:${result.operation_status}` };
  }
  return { text, reason: result.kind === "text" ? "chat" : "question" };
}
