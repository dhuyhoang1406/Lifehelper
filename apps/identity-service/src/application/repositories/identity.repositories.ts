import type { UUID } from "@lifehelper/shared-types";
import type { User } from "../../modules/identity/domain/entities/user.entity";
import type { OAuthAccount } from "../../modules/identity/domain/entities/oauth-account.entity";
import type { DeviceSession } from "../../modules/identity/domain/entities/device-session.entity";
import type { RefreshToken } from "../../modules/identity/domain/entities/refresh-token.entity";
export interface UserRepository {
  findById(id: UUID): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}
export interface OAuthAccountRepository {
  findByProviderIdentity(
    provider: string,
    providerUserId: string,
  ): Promise<OAuthAccount | null>;
  save(account: OAuthAccount): Promise<void>;
}
export interface DeviceSessionRepository {
  findById(id: UUID): Promise<DeviceSession | null>;
  findByUserId(userId: UUID): Promise<DeviceSession[]>;
  save(session: DeviceSession): Promise<void>;
}
export interface RefreshTokenRepository {
  findByTokenHash(hash: string): Promise<RefreshToken | null>;
  save(token: RefreshToken): Promise<void>;
}
export const USER_REPOSITORY = Symbol("USER_REPOSITORY");
export const OAUTH_ACCOUNT_REPOSITORY = Symbol("OAUTH_ACCOUNT_REPOSITORY");
export const DEVICE_SESSION_REPOSITORY = Symbol("DEVICE_SESSION_REPOSITORY");
export const REFRESH_TOKEN_REPOSITORY = Symbol("REFRESH_TOKEN_REPOSITORY");
