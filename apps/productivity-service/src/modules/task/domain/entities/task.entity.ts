import type { UUID } from "@lifehelper/shared-types";
import { TaskPriority, TaskStatus } from "../enums/task.enums";
import { TaskDomainError } from "../errors/task-domain.error";
export interface TaskProps {
  id: UUID;
  userId: UUID;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export class Task {
  private constructor(private props: TaskProps) {}
  static create(
    input: Pick<TaskProps, "id" | "userId" | "title"> &
      Partial<
        Pick<
          TaskProps,
          | "description"
          | "priority"
          | "dueAt"
          | "estimatedMinutes"
          | "createdAt"
        >
      >,
  ): Task {
    if (!input.title.trim())
      throw new TaskDomainError("Task title is required");
    if (input.estimatedMinutes != null && input.estimatedMinutes <= 0)
      throw new TaskDomainError("Estimated minutes must be positive");
    const now = input.createdAt ?? new Date();
    return new Task({
      ...input,
      title: input.title.trim(),
      description: input.description ?? null,
      status: TaskStatus.TODO,
      priority: input.priority ?? TaskPriority.MEDIUM,
      dueAt: input.dueAt ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(props: TaskProps): Task {
    if (
      (props.status === TaskStatus.COMPLETED) !==
      (props.completedAt !== null)
    )
      throw new TaskDomainError("Completed state and timestamp must agree");
    return new Task(props);
  }
  get state(): Readonly<TaskProps> {
    return this.props;
  }
  start(at = new Date()): void {
    if (this.props.status !== TaskStatus.TODO)
      throw new TaskDomainError("Only todo tasks can start");
    this.props.status = TaskStatus.IN_PROGRESS;
    this.props.updatedAt = at;
  }
  complete(at = new Date()): void {
    if (
      this.props.status !== TaskStatus.TODO &&
      this.props.status !== TaskStatus.IN_PROGRESS
    )
      throw new TaskDomainError(
        "Only todo or in-progress tasks can be completed",
      );
    this.props.status = TaskStatus.COMPLETED;
    this.props.completedAt = at;
    this.props.updatedAt = at;
  }
  reopen(at = new Date()): void {
    if (this.props.status !== TaskStatus.COMPLETED)
      throw new TaskDomainError("Only completed tasks can reopen");
    this.props.status = TaskStatus.TODO;
    this.props.completedAt = null;
    this.props.updatedAt = at;
  }
  cancel(at = new Date()): void {
    if (this.props.status === TaskStatus.COMPLETED)
      throw new TaskDomainError("Completed task cannot be cancelled");
    this.props.status = TaskStatus.CANCELLED;
    this.props.completedAt = null;
    this.props.updatedAt = at;
  }
  updateDueDate(dueAt: Date | null, at = new Date()): void {
    this.props.dueAt = dueAt;
    this.props.updatedAt = at;
  }
  delete(at = new Date()): void {
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
}
