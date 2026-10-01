import type { AIRequestMessage } from "../ports/ai-provider.port";

/** Keep complete tool exchanges when the oldest context messages are trimmed. */
export function boundedAIContext(
  input: readonly AIRequestMessage[],
  limit: number,
): AIRequestMessage[] {
  const system = input.find((message) => message.role === "SYSTEM");
  const recent = input
    .filter((message) => message.role !== "SYSTEM")
    .slice(-limit);
  const result: AIRequestMessage[] = [];
  for (let index = 0; index < recent.length; index++) {
    const message = recent[index];
    if (message.role === "TOOL") continue;
    if (message.role === "ASSISTANT" && message.toolCalls?.length) {
      const ids = new Set(message.toolCalls.map((call) => call.id));
      const replies = recent.slice(index + 1, index + 1 + ids.size);
      if (ids.size !== message.toolCalls.length || replies.length !== ids.size)
        continue;
      const remaining = new Set(ids);
      for (const reply of replies) {
        if (
          reply.role !== "TOOL" ||
          !reply.toolCallId ||
          !remaining.delete(reply.toolCallId)
        )
          break;
      }
      if (remaining.size) continue;
      result.push(message, ...replies);
      index += replies.length;
    } else result.push(message);
  }
  return system ? [system, ...result] : result;
}
