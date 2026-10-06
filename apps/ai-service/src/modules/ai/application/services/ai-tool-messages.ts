import type {
  AIRequestMessage,
  AIToolCall,
  AIJsonObject,
} from "../ports/ai-provider.port";
import { MessageRole } from "../../domain/enums/ai.enums";
import type { Message } from "../../domain/entities/message.entity";

export function assistantToolPayload(calls: readonly AIToolCall[]) {
  return {
    kind: "tool_calls",
    calls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: { ...call.arguments },
    })),
  };
}

export function toolResultPayload(call: AIToolCall) {
  return { kind: "tool_result", id: call.id, name: call.name };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toProviderMessage(message: Message): AIRequestMessage {
  const { role, content, toolPayload } = message.state;
  if (
    role === MessageRole.ASSISTANT &&
    object(toolPayload) &&
    toolPayload.kind === "tool_calls" &&
    Array.isArray(toolPayload.calls)
  )
    return {
      role,
      content,
      toolCalls: toolPayload.calls as unknown as AIToolCall[],
    };
  if (
    role === MessageRole.TOOL &&
    object(toolPayload) &&
    toolPayload.kind === "tool_result" &&
    typeof toolPayload.id === "string" &&
    typeof toolPayload.name === "string"
  )
    return {
      role,
      content,
      toolCallId: toolPayload.id,
      toolName: toolPayload.name,
    };
  return { role, content };
}

export function toolResultContent(result: AIJsonObject): string {
  return JSON.stringify(result);
}
