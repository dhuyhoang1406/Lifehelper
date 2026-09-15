import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  SubtaskRepository,
  TagRepository,
  TaskQuery,
  TaskRepository,
  TaskTagRepository,
} from "../../../application/repositories/productivity.repositories";
import {
  SUBTASK_REPOSITORY,
  TAG_REPOSITORY,
  TASK_REPOSITORY,
  TASK_TAG_REPOSITORY,
} from "../../../application/repositories/productivity.repositories";
import { Subtask } from "../domain/entities/subtask.entity";
import { Tag } from "../domain/entities/tag.entity";
import { Task } from "../domain/entities/task.entity";
import type { TaskPriority } from "../domain/enums/task.enums";

@Injectable()
export class TaskUseCases {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepository,
    @Inject(SUBTASK_REPOSITORY) private readonly subtasks: SubtaskRepository,
    @Inject(TAG_REPOSITORY) private readonly tags: TagRepository,
    @Inject(TASK_TAG_REPOSITORY) private readonly taskTags: TaskTagRepository,
  ) {}
  async create(
    userId: string,
    input: {
      title: string;
      description?: string;
      priority?: TaskPriority;
      dueAt?: Date;
      estimatedMinutes?: number;
    },
  ) {
    const task = Task.create({ id: randomUUID(), userId, ...input });
    await this.tasks.save(task);
    return task.state;
  }
  list(userId: string, query: TaskQuery) {
    return this.tasks.findPageByUserId(userId, query);
  }
  async get(userId: string, id: string) {
    const task = await this.ownedTask(userId, id);
    return {
      ...task.state,
      subtasks: (await this.subtasks.findByTaskId(id)).map(
        (item) => item.state,
      ),
    };
  }
  async update(
    userId: string,
    id: string,
    input: Parameters<Task["update"]>[0],
  ) {
    const task = await this.ownedTask(userId, id);
    task.update(input);
    await this.tasks.save(task);
    return task.state;
  }
  async delete(userId: string, id: string) {
    const task = await this.ownedTask(userId, id);
    task.delete();
    await this.tasks.save(task);
  }
  async transition(
    userId: string,
    id: string,
    action: "complete" | "reopen" | "cancel",
  ) {
    const task = await this.ownedTask(userId, id);
    task[action]();
    await this.tasks.save(task);
    return task.state;
  }
  async createSubtask(
    userId: string,
    taskId: string,
    input: { title: string; position?: number },
  ) {
    await this.ownedTask(userId, taskId);
    const item = Subtask.create({ id: randomUUID(), taskId, ...input });
    await this.subtasks.save(item);
    return item.state;
  }
  async updateSubtask(
    userId: string,
    taskId: string,
    id: string,
    input: { title?: string; position?: number; completed?: boolean },
  ) {
    await this.ownedTask(userId, taskId);
    const item = await this.ownedSubtask(taskId, id);
    item.update(input);
    if (input.completed === true) item.complete();
    if (input.completed === false) item.reopen();
    await this.subtasks.save(item);
    return item.state;
  }
  async deleteSubtask(userId: string, taskId: string, id: string) {
    await this.ownedTask(userId, taskId);
    await this.ownedSubtask(taskId, id);
    await this.subtasks.delete(id);
  }
  async createTag(userId: string, name: string) {
    if (await this.tags.findByNormalizedName(userId, name.trim().toLowerCase()))
      throw new ConflictException("Tag already exists");
    const tag = Tag.create({ id: randomUUID(), userId, name });
    await this.tags.save(tag);
    return tag.state;
  }
  async listTags(userId: string) {
    return (await this.tags.findByUserId(userId)).map((tag) => tag.state);
  }
  async renameTag(userId: string, id: string, name: string) {
    const tag = await this.ownedTag(userId, id);
    const duplicate = await this.tags.findByNormalizedName(
      userId,
      name.trim().toLowerCase(),
    );
    if (duplicate && duplicate.state.id !== id)
      throw new ConflictException("Tag already exists");
    tag.rename(name);
    await this.tags.save(tag);
    return tag.state;
  }
  async deleteTag(userId: string, id: string) {
    await this.ownedTag(userId, id);
    await this.tags.delete(id);
  }
  async attachTag(userId: string, taskId: string, tagId: string) {
    await Promise.all([
      this.ownedTask(userId, taskId),
      this.ownedTag(userId, tagId),
    ]);
    await this.taskTags.attach(taskId, tagId);
  }
  async detachTag(userId: string, taskId: string, tagId: string) {
    await Promise.all([
      this.ownedTask(userId, taskId),
      this.ownedTag(userId, tagId),
    ]);
    await this.taskTags.detach(taskId, tagId);
  }
  private async ownedTask(userId: string, id: string) {
    const task = await this.tasks.findByIdAndUserId(id, userId);
    if (!task) throw new NotFoundException("Task not found");
    return task;
  }
  private async ownedSubtask(taskId: string, id: string) {
    const item = await this.subtasks.findByIdAndTaskId(id, taskId);
    if (!item) throw new NotFoundException("Subtask not found");
    return item;
  }
  private async ownedTag(userId: string, id: string) {
    const tag = await this.tags.findByIdAndUserId(id, userId);
    if (!tag) throw new NotFoundException("Tag not found");
    return tag;
  }
}
