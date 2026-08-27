import type { UUID } from "@lifehelper/shared-types";
import { IdentityDomainError } from "../errors/identity-domain.error";

export interface RefreshTokenProps {
  id: UUID;
  userId: UUID;
  deviceSessionId: UUID;
  tokenHash: string;
  tokenFamilyId: UUID;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  replacedById: UUID | null;
  createdAt: Date;
}
export class RefreshToken {
  private constructor(private props: RefreshTokenProps) {}
  static create(
    input: Pick<
      RefreshTokenProps,
      | "id"
      | "userId"
      | "deviceSessionId"
      | "tokenHash"
      | "tokenFamilyId"
      | "expiresAt"
    > &
      Partial<Pick<RefreshTokenProps, "createdAt">>,
  ): RefreshToken {
    const createdAt = input.createdAt ?? new Date();
    if (!input.tokenHash || input.expiresAt <= createdAt)
      throw new IdentityDomainError(
        "Refresh token must have a hash and future expiry",
      );
    return new RefreshToken({
      ...input,
      createdAt,
      usedAt: null,
      revokedAt: null,
      replacedById: null,
    });
  }
  static restore(props: RefreshTokenProps): RefreshToken {
    return new RefreshToken(props);
  }
  get state(): Readonly<RefreshTokenProps> {
    return this.props;
  }
  use(replacedById: UUID, at = new Date()): void {
    if (this.props.usedAt || this.props.revokedAt || this.props.expiresAt <= at)
      throw new IdentityDomainError("Refresh token is not active");
    this.props.usedAt = at;
    this.props.replacedById = replacedById;
  }
  revoke(at = new Date()): void {
    this.props.revokedAt = at;
  }
}
