import type { UUID } from "@lifehelper/shared-types";
import { TaskDomainError } from "../errors/task-domain.error";
export interface TagProps {
  id: UUID;
  userId: UUID;
  name: string;
  createdAt: Date;
}
export class Tag {
  private constructor(private props: TagProps) {}
  static create(
    input: Omit<TagProps, "createdAt"> & Partial<Pick<TagProps, "createdAt">>,
  ): Tag {
    if (!input.name.trim() || input.name.length > 80)
      throw new TaskDomainError("Invalid tag name");
    return new Tag({
      ...input,
      name: input.name.trim(),
      createdAt: input.createdAt ?? new Date(),
    });
  }
  static restore(p: TagProps): Tag {
    return new Tag(p);
  }
  get state(): Readonly<TagProps> {
    return this.props;
  }
  rename(name: string): void {
    if (!name.trim() || name.trim().length > 80)
      throw new TaskDomainError("Invalid tag name");
    this.props.name = name.trim();
  }
}
