import type { UUID } from "@lifehelper/shared-types";
import { IdentityDomainError } from "../errors/identity-domain.error";
import { UserStatus } from "../enums/identity.enums";

export const USER_EMAIL_MAX_LENGTH = 255;
export const USER_DISPLAY_NAME_MAX_LENGTH = 120;

export interface UserProps {
  id: UUID;
  email: string;
  passwordHash: string | null;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export type CreateUserProps = Pick<UserProps, "id" | "email" | "displayName"> &
  Partial<
    Pick<
      UserProps,
      | "passwordHash"
      | "avatarUrl"
      | "status"
      | "emailVerifiedAt"
      | "lastLoginAt"
      | "createdAt"
    >
  >;

export class User {
  private constructor(private props: UserProps) {}
  static create(input: CreateUserProps): User {
    if (!input.email.trim() || input.email.length > USER_EMAIL_MAX_LENGTH)
      throw new IdentityDomainError("Invalid user email");
    if (
      !input.displayName.trim() ||
      input.displayName.length > USER_DISPLAY_NAME_MAX_LENGTH
    )
      throw new IdentityDomainError("Invalid display name");
    const now = input.createdAt ?? new Date();
    return new User({
      ...input,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash ?? null,
      avatarUrl: input.avatarUrl ?? null,
      status: input.status ?? UserStatus.ACTIVE,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      lastLoginAt: input.lastLoginAt ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }
  static restore(props: UserProps): User {
    return new User(props);
  }
  get state(): Readonly<UserProps> {
    return this.props;
  }
  recordLogin(at = new Date()): void {
    this.props.lastLoginAt = at;
    this.touch(at);
  }
  canAuthenticate(): boolean {
    return this.props.status === UserStatus.ACTIVE && !this.props.deletedAt;
  }
  verifyEmail(at = new Date()): void {
    this.props.emailVerifiedAt = at;
    this.touch(at);
  }
  suspend(at = new Date()): void {
    this.props.status = UserStatus.SUSPENDED;
    this.touch(at);
  }
  delete(at = new Date()): void {
    this.props.status = UserStatus.DELETED;
    this.props.deletedAt = at;
    this.touch(at);
  }
  private touch(at: Date): void {
    this.props.updatedAt = at;
  }
}
