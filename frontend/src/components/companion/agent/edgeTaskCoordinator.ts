"use client";

export type CoordinatorDecision = { focus: "chat" | "diary" | "album"; action: string; need_clarification: boolean; question?: string };
const MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
let enginePromise: Promise<import("@mlc-ai/web-llm").MLCEngineInterface> | null = null;
async function engine() { if (!enginePromise) enginePromise = import("@mlc-ai/web-llm").then(({ CreateMLCEngine }) => CreateMLCEngine(MODEL_ID)); return enginePromise; }
export async function coordinateOnDevice(input: string, context: string): Promise<CoordinatorDecision> {
  const llm = await engine();
  const response = await llm.chat.completions.create({ messages: [
    { role: "system", content: "你是任务协调器。只输出 JSON：{focus:'chat|diary|album',action:string,need_clarification:boolean,question?:string}。不执行任务，不编造照片ID，不声称保存成功。" },
    { role: "user", content: JSON.stringify({ input: input.slice(0, 1000), context: context.slice(0, 4000) }) },
  ], temperature: 0, max_tokens: 160 });
  const text = response.choices[0]?.message?.content?.trim() || "";
  const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) as CoordinatorDecision;
  if (!["chat", "diary", "album"].includes(parsed.focus) || typeof parsed.action !== "string" || typeof parsed.need_clarification !== "boolean") throw new Error("端侧协调器返回格式无效");
  return parsed;
}
export function edgeCoordinatorModel() { return MODEL_ID; }
