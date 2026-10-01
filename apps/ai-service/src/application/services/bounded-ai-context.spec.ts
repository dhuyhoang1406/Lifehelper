import { boundedAIContext } from "./bounded-ai-context";
import { MessageRole as Role } from "../../modules/ai/domain/enums/ai.enums";
import type { AIRequestMessage } from "../ports/ai-provider.port";

const system: AIRequestMessage = { role: Role.SYSTEM, content: "rules" };
const assistant: AIRequestMessage = {
  role: Role.ASSISTANT,
  content: "",
  toolCalls: [
    { id: "a", name: "list_tasks", arguments: {} },
    { id: "b", name: "list_tasks", arguments: {} },
  ],
};
const replies: AIRequestMessage[] = [
  { role: Role.TOOL, content: "[]", toolCallId: "a" },
  { role: Role.TOOL, content: "[]", toolCallId: "b" },
];
const user: AIRequestMessage = { role: Role.USER, content: "continue" };

describe("bounded AI context", () => {
  it("preserves the system instruction and complete parallel tool exchanges", () => {
    expect(boundedAIContext([system, assistant, ...replies, user], 4)).toEqual([
      system,
      assistant,
      ...replies,
      user,
    ]);
  });
  it("drops orphan tool replies after trimming", () => {
    expect(boundedAIContext([system, assistant, ...replies, user], 3)).toEqual([
      system,
      user,
    ]);
  });
  it("drops incomplete, duplicate and mismatched replies", () => {
    for (const invalid of [
      [replies[0]],
      [replies[0], replies[0]],
      [replies[0], user],
    ]) {
      const result = boundedAIContext(
        [system, assistant, ...invalid, user],
        10,
      );
      expect(result).not.toContain(assistant);
      expect(result.some((message) => message.role === Role.TOOL)).toBe(false);
    }
  });
});
