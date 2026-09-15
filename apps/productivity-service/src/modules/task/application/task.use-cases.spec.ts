import type {
  SubtaskRepository,
  TagRepository,
  TaskRepository,
  TaskTagRepository,
} from "../../../application/repositories/productivity.repositories";
import type { Task } from "../domain/entities/task.entity";
import { TaskUseCases } from "./task.use-cases";

describe("TaskUseCases", () => {
  it("does not allow input properties to override the authenticated owner", async () => {
    let saved: Task | undefined;
    const tasks = {
      save: jest.fn(async (task: Task) => {
        saved = task;
      }),
    } as unknown as TaskRepository;
    const useCases = new TaskUseCases(
      tasks,
      {} as SubtaskRepository,
      {} as TagRepository,
      {} as TaskTagRepository,
    );
    const untrustedInput = {
      title: "Owned task",
      userId: "00000000-0000-4000-8000-000000000099",
      id: "00000000-0000-4000-8000-000000000098",
    } as unknown as Parameters<TaskUseCases["create"]>[1];

    const result = await useCases.create(
      "00000000-0000-4000-8000-000000000001",
      untrustedInput,
    );

    expect(result.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(result.id).not.toBe("00000000-0000-4000-8000-000000000098");
    expect(saved?.state).toEqual(result);
  });
});
