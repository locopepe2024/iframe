export const STORAGE_KEY = "iframe-companion-demo-v1";
export type Message = { id: string; content: string; role: "user" | "assistant" };
export type Diary = { id: string; date: string; text: string; sourceIds: string[] };
export type Feedback = {
  id: string; date: string; text: string; sourceIds: string[];
  evidence: "explicit"; hypothesis: string; consentAt: string;
  status: "pending-review"; version: "h5-demo-v1";
};
export type SavedData = { diaries: Diary[]; feedback: Feedback[] };
export const emptyData = (): SavedData => ({ diaries: [], feedback: [] });
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
export function readSaved(): SavedData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyData();
  const data = JSON.parse(raw) as SavedData;
  if (!data || !Array.isArray(data.diaries) || !Array.isArray(data.feedback) ||
    !data.diaries.every(item => item && typeof item.id === "string" && typeof item.text === "string" && typeof item.date === "string" && strings(item.sourceIds)) ||
    !data.feedback.every(item => item && typeof item.id === "string" && typeof item.text === "string" && typeof item.date === "string" && strings(item.sourceIds) && item.evidence === "explicit" && typeof item.hypothesis === "string" && typeof item.consentAt === "string" && item.status === "pending-review" && item.version === "h5-demo-v1")) {
    throw new Error("Invalid companion data");
  }
  return data;
}
export function writeSaved(data: SavedData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
