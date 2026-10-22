import { describe, expect, it } from "vitest";
import { TrialAgent } from "./agent";
import { SAMPLE_BATCH_ID, TrialScenario } from "./scenario";

describe("deterministic AG-UI protocol fixture", () => {
  it.each([ ["说慢一点", "slow"], ["恢复普通语速", "normal"] ])("proposes %s without changing settings", async (content, speed) => {
    const scenario = new TrialScenario();
    const agent = new TrialAgent(scenario);
    agent.addMessage({ id: "request", role: "user", content });
    await agent.runAgent();
    const assistant = agent.messages.find(message => message.role === "assistant" && message.toolCalls?.length);
    if (assistant?.role !== "assistant") throw new Error("Missing speech-speed tool message");
    const tool = assistant.toolCalls![0];
    expect(tool.function.name).toBe("confirm_speech_speed");
    expect(JSON.parse(tool.function.arguments)).toEqual({ speed });
    expect(scenario.getSnapshot()).toMatchObject({ speechSpeed: "slow", question: null, consent: "none" });
    agent.addMessage({ id: "result", role: "tool", toolCallId: tool.id, content: JSON.stringify({ status: "confirmed" }) });
    await agent.runAgent();
    expect(agent.messages.filter(message => message.role === "assistant" && message.toolCalls?.length)).toHaveLength(1);
  });
  it("emits a schema-valid time tool and follows up only once after its result", async () => {
    const scenario = new TrialScenario();
    const agent = new TrialAgent(scenario);
    agent.addMessage({ id: "request", role: "user", content: "按时间整理" });
    await agent.runAgent();
    const assistant = agent.messages.find(message => message.role === "assistant" && message.toolCalls?.length);
    if (assistant?.role !== "assistant") throw new Error("Missing actual AG-UI tool message");
    const tool = assistant.toolCalls![0];
    expect(tool.function.name).toBe("confirm_time_batch");
    expect(JSON.parse(tool.function.arguments)).toEqual({ batchId: SAMPLE_BATCH_ID, revision: 1, scope: "time" });
    expect(scenario.getSnapshot()).toMatchObject({ question: null, task: "idle", consent: "none" });
    agent.addMessage({ id: "result", role: "tool", toolCallId: tool.id, content: JSON.stringify({ status: "declined" }) });
    await agent.runAgent();
    expect(agent.messages.filter(message => message.role === "assistant" && message.toolCalls?.length)).toHaveLength(1);
    expect(agent.messages.at(-1)?.content).toContain("实际状态");
  });
});
