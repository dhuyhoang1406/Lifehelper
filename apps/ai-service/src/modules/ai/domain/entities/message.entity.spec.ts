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

it("validates source locators and assistant-only citation metadata", () => {
  const citation = {
    reference: 1,
    documentId: "00000000-0000-4000-8000-000000000001",
    chunkId: "00000000-0000-4000-8000-000000000002",
    generation: 1,
    filename: "notes.txt",
    lineStart: 1,
    lineEnd: 2,
  };
  const message = {
    id: "message",
    conversationId: "conversation",
    role: MessageRole.ASSISTANT,
    content: "Fact [1]",
  };
  expect(
    Message.create({ ...message, citations: [citation] }).state.citations,
  ).toEqual([citation]);
  expect(() =>
    Message.create({
      ...message,
      role: MessageRole.USER,
      citations: [citation],
    }),
  ).toThrow();
  expect(() =>
    Message.create({ ...message, citations: [{ ...citation, lineEnd: 0 }] }),
  ).toThrow();
  expect(() =>
    Message.create({
      ...message,
      citations: [{ ...citation, pageStart: 1, pageEnd: 2 }],
    }),
  ).toThrow();
  expect(() =>
    Message.create({ ...message, citations: [citation, citation] }),
  ).toThrow();
});
