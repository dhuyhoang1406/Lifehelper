import { Conversation } from "./conversation.entity";

describe("Conversation", () => {
  const createConversation = () =>
    Conversation.create({ id: "conversation-id", userId: "user-id" });

  it("normalizes its optional title", () => {
    const conversation = Conversation.create({
      id: "conversation-id",
      userId: "user-id",
      title: "  Planning  ",
    });

    expect(conversation.state.title).toBe("Planning");
  });

  it("rejects titles longer than the persistence limit", () => {
    expect(() => createConversation().rename("x".repeat(256))).toThrow("255");
  });

  it("cannot rename a soft-deleted conversation", () => {
    const conversation = createConversation();
    conversation.delete();

    expect(() => conversation.rename("Renamed")).toThrow("Deleted");
  });
});
