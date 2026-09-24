import type { UUID } from "@lifehelper/shared-types";
import { AIDomainError } from "../errors/ai-domain.error";

const normalizeTitle = (title: string | null | undefined): string | null => {
  if (title == null) return null;
  const normalized = title.trim();
  if (!normalized) return null;
  if (normalized.length > 255)
    throw new AIDomainError("Conversation title cannot exceed 255 characters");
  return normalized;
};

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
      title: normalizeTitle(input.title),
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
    if (this.props.deletedAt)
      throw new AIDomainError("Deleted conversation cannot be renamed");
    this.props.title = normalizeTitle(title);
    this.props.updatedAt = at;
  }
  delete(at = new Date()): void {
    if (this.props.deletedAt) return;
    this.props.deletedAt = at;
    this.props.updatedAt = at;
  }
}
