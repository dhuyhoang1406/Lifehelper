import type { UUID } from "@lifehelper/shared-types";
import { TaskDomainError } from "../errors/task-domain.error";
export interface SubtaskProps {
  id: UUID;
  taskId: UUID;
  title: string;
  position: number;
  isCompleted: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export class Subtask {
  private constructor(private props: SubtaskProps) {}
  static create(
    input: Pick<SubtaskProps, "id" | "taskId" | "title"> &
      Partial<Pick<SubtaskProps, "position" | "createdAt">>,
  ): Subtask {
    if (!input.title.trim())
      throw new TaskDomainError("Subtask title is required");
    if ((input.position ?? 0) < 0)
      throw new TaskDomainError("Subtask position cannot be negative");
    const now = input.createdAt ?? new Date();
    return new Subtask({
      ...input,
      title: input.title.trim(),
      position: input.position ?? 0,
      isCompleted: false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  static restore(p: SubtaskProps): Subtask {
    return new Subtask(p);
  }
  get state(): Readonly<SubtaskProps> {
    return this.props;
  }
  complete(at = new Date()): void {
    this.props.isCompleted = true;
    this.props.completedAt = at;
    this.props.updatedAt = at;
  }
  reopen(at = new Date()): void {
    this.props.isCompleted = false;
    this.props.completedAt = null;
    this.props.updatedAt = at;
  }
}
