import { AbstractAgent, type RunAgentInput } from "@ag-ui/client";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { Observable } from "rxjs";
import { parseIntent, SAMPLE_BATCH_ID, type TrialScenario } from "./scenario";

/** A protocol fixture, not a language model. It never performs network requests. */
export class TrialAgent extends AbstractAgent {
  constructor(private readonly scenario: TrialScenario) {
    super({ agentId: "default", description: "Browser-only synthetic companion trial" });
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable(subscriber => {
      const emit = (event: BaseEvent) => subscriber.next(event);
      emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });
      const last = input.messages.at(-1);
      const text = (content: string) => {
        const messageId = crypto.randomUUID();
        emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: content });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      };
      if (last?.role === "tool") {
        text("已收到这次选择，请查看页面上的实际状态。");
      } else {
        const intent = parseIntent(typeof last?.content === "string" ? last.content : "");
        if (intent.tool === "help") {
          text("这是固定句式试验。可以说“字调大一点”“恢复普通字号”“说慢一点”“恢复普通语速”或“按时间整理”。我会先请您确认。");
        } else {
          const toolCallId = crypto.randomUUID();
          const args = intent.tool === "confirm_font_size" ? { size: intent.size }
            : intent.tool === "confirm_speech_speed" ? { speed: intent.speed }
              : { batchId: SAMPLE_BATCH_ID, revision: this.scenario.getSnapshot().revision, scope: "time" };
          text("请核对下面的确认卡，确认前不会调整或整理。");
          emit({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: intent.tool });
          emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(args) });
          emit({ type: EventType.TOOL_CALL_END, toolCallId });
        }
      }
      emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
      subscriber.complete();
    });
  }
}
