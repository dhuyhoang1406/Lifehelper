import { Task } from "./task.entity";
import { TaskPriority, TaskStatus } from "../enums/task.enums";
describe("Task", () => {
  const base = { id: "task-id", userId: "user-id", title: "Write tests" };
  it("creates a valid task with domain defaults", () => {
    const task = Task.create(base);
    expect(task.state).toMatchObject({
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      completedAt: null,
    });
  });
  it("rejects non-positive estimated time", () => {
    expect(() => Task.create({ ...base, estimatedMinutes: 0 })).toThrow(
      "positive",
    );
  });
  it("completes and reopens consistently", () => {
    const task = Task.create(base);
    const completedAt = new Date("2026-01-01T00:00:00Z");
    task.complete(completedAt);
    expect(task.state).toMatchObject({
      status: TaskStatus.COMPLETED,
      completedAt,
    });
    task.reopen();
    expect(task.state).toMatchObject({
      status: TaskStatus.TODO,
      completedAt: null,
    });
  });
  it("does not cancel a completed task", () => {
    const task = Task.create(base);
    task.complete();
    expect(() => task.cancel()).toThrow("cannot be cancelled");
  });
});
