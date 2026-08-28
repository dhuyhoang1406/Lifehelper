import type { UUID } from "@lifehelper/shared-types";
export interface ConversationProps {
  id: UUID;
  userId: UUID;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export class Conversation {
  private constructor(private props: ConversationProps) {}
  static create(
    input: Pick<ConversationProps, "id" | "userId"> &
      Partial<Pick<ConversationProps, "title" | "createdAt">>,
  ): Conversation {
    const now = input.createdAt ?? new Date();
    return new Conversation({
      ...input,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(p: ConversationProps): Conversation {
    return new Conversation(p);
  }
  get state(): Readonly<ConversationProps> {
    return this.props;
  }
  rename(title: string | null, at = new Date()): void {
    this.props.title = title;
    this.props.updatedAt = at;
  }
  delete(at = new Date()): void {
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
}
