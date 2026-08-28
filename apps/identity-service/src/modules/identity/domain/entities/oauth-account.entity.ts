import type { UUID } from "@lifehelper/shared-types";
import { OAuthProvider } from "../enums/identity.enums";
import { IdentityDomainError } from "../errors/identity-domain.error";

export interface OAuthAccountProps {
  id: UUID;
  userId: UUID;
  provider: OAuthProvider;
  providerUserId: string;
  providerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export class OAuthAccount {
  private constructor(private readonly props: OAuthAccountProps) {}
  static create(
    input: Omit<
      OAuthAccountProps,
      "providerEmail" | "createdAt" | "updatedAt"
    > &
      Partial<Pick<OAuthAccountProps, "providerEmail" | "createdAt">>,
  ): OAuthAccount {
    if (!input.providerUserId.trim())
      throw new IdentityDomainError("Provider user id is required");
    const now = input.createdAt ?? new Date();
    return new OAuthAccount({
      ...input,
      providerUserId: input.providerUserId.trim(),
      providerEmail: input.providerEmail ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  static restore(props: OAuthAccountProps): OAuthAccount {
    return new OAuthAccount(props);
  }
  get state(): Readonly<OAuthAccountProps> {
    return this.props;
  }
}
