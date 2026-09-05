import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DeviceSessionRepository, OAuthAccountRepository, RefreshTokenRepository, UserRepository } from "../../../../application/repositories/identity.repositories";
import { DEVICE_SESSION_REPOSITORY, OAUTH_ACCOUNT_REPOSITORY, REFRESH_TOKEN_REPOSITORY, USER_REPOSITORY } from "../../../../application/repositories/identity.repositories";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { OAuthAccount } from "../../domain/entities/oauth-account.entity";
import { RefreshToken } from "../../domain/entities/refresh-token.entity";
import { User } from "../../domain/entities/user.entity";
import { OAuthProvider } from "../../domain/enums/identity.enums";
import type { AuthResult, DeviceInput } from "../auth.types";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";
import type { OAuthIdentityProvider, TokenService } from "../ports/auth.ports";
import { OAUTH_IDENTITY_PROVIDER, TOKEN_SERVICE } from "../ports/auth.ports";

@Injectable()
export class GoogleLoginUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository, @Inject(OAUTH_ACCOUNT_REPOSITORY) private readonly accounts: OAuthAccountRepository, @Inject(DEVICE_SESSION_REPOSITORY) private readonly sessions: DeviceSessionRepository, @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository, @Inject(OAUTH_IDENTITY_PROVIDER) private readonly google: OAuthIdentityProvider, @Inject(TOKEN_SERVICE) private readonly tokens: TokenService, private readonly config: ConfigService) {}
  async execute(input: { idToken: string; device: DeviceInput }): Promise<AuthResult> {
    let identity;
    try { identity = await this.google.verifyToken(input.idToken); }
    catch { throw new IdentityApplicationError(IdentityErrorCode.OAUTH_TOKEN_INVALID, "Google token is invalid", 401); }
    let account = await this.accounts.findByProviderIdentity(OAuthProvider.GOOGLE, identity.providerUserId);
    let user = account ? await this.users.findById(account.state.userId) : null;
    const now = new Date();
    if (!account) {
      if (!identity.emailVerified) throw new IdentityApplicationError(IdentityErrorCode.OAUTH_TOKEN_INVALID, "Google email is not verified", 401);
      user = await this.users.findByEmail(identity.email);
      if (!user) { user = User.create({ id: randomUUID(), email: identity.email, displayName: identity.displayName, avatarUrl: identity.avatarUrl, emailVerifiedAt: now, createdAt: now }); await this.users.save(user); }
      account = OAuthAccount.create({ id: randomUUID(), userId: user.state.id, provider: OAuthProvider.GOOGLE, providerUserId: identity.providerUserId, providerEmail: identity.email, createdAt: now });
      await this.accounts.save(account);
    }
    if (!user?.canAuthenticate()) throw new IdentityApplicationError(IdentityErrorCode.INVALID_CREDENTIALS, "Unable to authenticate", 401);
    let session = await this.sessions.findByUserAndDevice(user.state.id, input.device.deviceId);
    if (session) session.resume(now); else session = DeviceSession.create({ id: randomUUID(), userId: user.state.id, ...input.device, createdAt: now });
    user.recordLogin(now);
    const generated = this.tokens.createRefreshToken();
    const refresh = RefreshToken.create({ id: randomUUID(), userId: user.state.id, deviceSessionId: session.state.id, tokenHash: generated.hash, tokenFamilyId: randomUUID(), expiresAt: new Date(now.getTime() + this.config.getOrThrow<number>("REFRESH_TOKEN_TTL_SECONDS") * 1000), createdAt: now });
    await this.users.save(user); await this.sessions.save(session); await this.refreshTokens.save(refresh);
    return { user: { id: user.state.id, email: user.state.email, displayName: user.state.displayName, avatarUrl: user.state.avatarUrl }, accessToken: await this.tokens.createAccessToken({ sub: user.state.id, sessionId: session.state.id, tokenType: "access" }), refreshToken: generated.raw, session: { id: session.state.id, deviceId: session.state.deviceId, deviceName: session.state.deviceName, platform: session.state.platform } };
  }
}
