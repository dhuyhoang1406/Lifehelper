import { Subtask } from "./subtask.entity";

describe("Subtask", () => {
  const input = { id: "subtask-id", taskId: "task-id", title: "Step" };

  it("rejects a negative position", () => {
    expect(() => Subtask.create({ ...input, position: -1 })).toThrow(
      "cannot be negative",
    );
  });

  it("keeps completion state and timestamp consistent", () => {
    const subtask = Subtask.create(input);
    const completedAt = new Date("2026-01-01T00:00:00Z");
    subtask.complete(completedAt);
    expect(subtask.state).toMatchObject({ isCompleted: true, completedAt });
    subtask.reopen();
    expect(subtask.state).toMatchObject({
      isCompleted: false,
      completedAt: null,
    });
  });
});
