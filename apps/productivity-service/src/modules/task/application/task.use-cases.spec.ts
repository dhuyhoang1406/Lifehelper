import type {
  SubtaskRepository,
  TagRepository,
  TaskRepository,
  TaskTagRepository,
} from "../../../application/repositories/productivity.repositories";
import { ProductivityErrorCode } from "../../../application/errors/productivity.errors";
import { Task } from "../domain/entities/task.entity";
import { Tag } from "../domain/entities/tag.entity";
import { TaskUseCases } from "./task.use-cases";

describe("TaskUseCases", () => {
  const build = (overrides: Partial<TagRepository> = {}) => {
    const tags = {
      findByNormalizedName: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as TagRepository;
    return {
      tags,
      useCases: new TaskUseCases(
        { save: jest.fn() } as unknown as TaskRepository,
        {} as SubtaskRepository,
        tags,
        {} as TaskTagRepository,
      ),
    };
  };

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

  it("returns task state instead of exposing domain entities in list responses", async () => {
    const task = Task.create({
      id: "task-1",
      userId: "user-1",
      title: "Listed",
    });
    const tasks = {
      findPageByUserId: jest.fn().mockResolvedValue({
        items: [task],
        total: 1,
        page: 1,
        limit: 20,
      }),
    } as unknown as TaskRepository;
    const useCases = new TaskUseCases(
      tasks,
      {} as SubtaskRepository,
      {} as TagRepository,
      {} as TaskTagRepository,
    );

    await expect(
      useCases.list("user-1", { page: 1, limit: 20 }),
    ).resolves.toEqual({
      items: [task.state],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  it("normalizes case and whitespace when checking a new tag", async () => {
    const { tags, useCases } = build();

    const result = await useCases.createTag("user-1", "  Work  ");

    expect(tags.findByNormalizedName).toHaveBeenCalledWith("user-1", "work");
    expect(result.name).toBe("Work");
    expect(tags.save).toHaveBeenCalledTimes(1);
  });

  it("rejects a case-insensitive duplicate tag", async () => {
    const existing = Tag.create({
      id: "tag-1",
      userId: "user-1",
      name: "Work",
    });
    const { tags, useCases } = build({
      findByNormalizedName: jest.fn().mockResolvedValue(existing),
    });

    await expect(useCases.createTag("user-1", " work ")).rejects.toMatchObject({
      code: ProductivityErrorCode.TAG_ALREADY_EXISTS,
      statusCode: 409,
    });
    expect(tags.save).not.toHaveBeenCalled();
  });

  it("rejects renaming a tag to another normalized name", async () => {
    const current = Tag.create({ id: "tag-1", userId: "user-1", name: "Home" });
    const duplicate = Tag.create({
      id: "tag-2",
      userId: "user-1",
      name: "Work",
    });
    const { tags, useCases } = build({
      findByIdAndUserId: jest.fn().mockResolvedValue(current),
      findByNormalizedName: jest.fn().mockResolvedValue(duplicate),
    });

    await expect(
      useCases.renameTag("user-1", "tag-1", " WORK "),
    ).rejects.toMatchObject({
      code: ProductivityErrorCode.TAG_ALREADY_EXISTS,
      statusCode: 409,
    });
    expect(tags.save).not.toHaveBeenCalled();
  });
});
