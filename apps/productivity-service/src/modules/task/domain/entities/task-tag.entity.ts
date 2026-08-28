import type { UUID } from "@lifehelper/shared-types";
export interface TaskTagProps {
  taskId: UUID;
  tagId: UUID;
}
export class TaskTag {
  private constructor(private readonly props: TaskTagProps) {}
  static create(props: TaskTagProps): TaskTag {
    return new TaskTag(props);
  }
  get state(): Readonly<TaskTagProps> {
    return this.props;
  }
}
