import { Message } from "./message.entity";
import { MessageRole } from "../enums/ai.enums";

describe("Message", () => {
  it("allows empty assistant text only when it carries tool calls", () => {
    expect(() =>
      Message.create({
        id: "message-id",
        conversationId: "conversation-id",
        role: MessageRole.ASSISTANT,
        content: "",
        toolPayload: {
          kind: "tool_calls",
          calls: [{ id: "call-1", name: "get_tasks", arguments: {} }],
        },
      }),
    ).not.toThrow();
    expect(() =>
      Message.create({
        id: "message-id",
        conversationId: "conversation-id",
        role: MessageRole.ASSISTANT,
        content: "",
        toolPayload: {},
      }),
    ).toThrow("required");
  });
  it("rejects whitespace-only content", () => {
    expect(() =>
      Message.create({
        id: "message-id",
        conversationId: "conversation-id",
        role: MessageRole.USER,
        content: "   ",
      }),
    ).toThrow("required");
  });

  it("rejects unsupported roles received at runtime", () => {
    expect(() =>
      Message.create({
        id: "message-id",
        conversationId: "conversation-id",
        role: "OWNER" as MessageRole,
        content: "Hello",
      }),
    ).toThrow("Unsupported");
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid token count %p",
    (inputTokens) => {
      expect(() =>
        Message.create({
          id: "message-id",
          conversationId: "conversation-id",
          role: MessageRole.ASSISTANT,
          content: "Hello",
          provider: "ollama",
          model: "llama",
          inputTokens,
        }),
      ).toThrow("non-negative integer");
    },
  );

  it("normalizes trusted provider metadata", () => {
    const message = Message.create({
      id: "message-id",
      conversationId: "conversation-id",
      role: MessageRole.ASSISTANT,
      content: "Hello",
      provider: " ollama ",
      model: " llama3.2 ",
    });

    expect(message.state.provider).toBe("ollama");
    expect(message.state.model).toBe("llama3.2");
  });
});
