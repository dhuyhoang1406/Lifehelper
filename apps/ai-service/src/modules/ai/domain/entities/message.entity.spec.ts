import { Message } from "./message.entity";
import { MessageRole } from "../enums/ai.enums";

describe("Message", () => {
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
});
