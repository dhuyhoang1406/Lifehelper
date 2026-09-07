import type { UUID } from "@lifehelper/shared-types";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface AccessTokenPayload {
  sub: UUID;
  sessionId: UUID;
  tokenType: "access";
}

export interface TokenService {
  createAccessToken(payload: AccessTokenPayload): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenPayload>;
  createRefreshToken(): { raw: string; hash: string };
  hashRefreshToken(raw: string): string;
}

export interface OAuthIdentity {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface OAuthIdentityProvider {
  verifyToken(token: string): Promise<OAuthIdentity>;
}

export const PASSWORD_HASHER = Symbol("PASSWORD_HASHER");
export const TOKEN_SERVICE = Symbol("TOKEN_SERVICE");
export const OAUTH_IDENTITY_PROVIDER = Symbol("OAUTH_IDENTITY_PROVIDER");
