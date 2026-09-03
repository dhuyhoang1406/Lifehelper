import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { DeviceSessionRepository, IdentityUnitOfWork, RefreshTokenRepository } from "../../../../application/repositories/identity.repositories";
import { DEVICE_SESSION_REPOSITORY, IDENTITY_UNIT_OF_WORK, REFRESH_TOKEN_REPOSITORY } from "../../../../application/repositories/identity.repositories";
import { RefreshToken } from "../../domain/entities/refresh-token.entity";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";
import type { TokenService } from "../ports/auth.ports";
import { TOKEN_SERVICE } from "../ports/auth.ports";

@Injectable()
export class RefreshAccessTokenUseCase {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(DEVICE_SESSION_REPOSITORY) private readonly sessions: DeviceSessionRepository,
    @Inject(IDENTITY_UNIT_OF_WORK) private readonly unitOfWork: IdentityUnitOfWork,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}
  async execute(rawToken: string) {
    const current = await this.refreshTokens.findByTokenHash(this.tokens.hashRefreshToken(rawToken));
    if (!current)
      throw new IdentityApplicationError(IdentityErrorCode.REFRESH_TOKEN_INVALID, "Refresh token is invalid", 401);
    const session = await this.sessions.findById(current.state.deviceSessionId);
    if (!session?.isActive())
      throw new IdentityApplicationError(IdentityErrorCode.SESSION_REVOKED, "Session has been revoked", 401);
    if (current.state.usedAt || current.state.revokedAt) {
      session.revoke();
      await this.sessions.save(session);
      throw new IdentityApplicationError(IdentityErrorCode.REFRESH_TOKEN_INVALID, "Refresh token reuse detected", 401);
    }
    if (current.isExpired())
      throw new IdentityApplicationError(IdentityErrorCode.REFRESH_TOKEN_EXPIRED, "Refresh token has expired", 401);
    const now = new Date();
    const generated = this.tokens.createRefreshToken();
    const replacement = RefreshToken.create({ id: randomUUID(), userId: current.state.userId, deviceSessionId: current.state.deviceSessionId, tokenHash: generated.hash, tokenFamilyId: current.state.tokenFamilyId, expiresAt: new Date(now.getTime() + this.config.getOrThrow<number>("REFRESH_TOKEN_TTL_SECONDS") * 1000), createdAt: now });
    current.use(replacement.state.id, now);
    session.recordActivity(now);
    const accessToken = await this.tokens.createAccessToken({ sub: current.state.userId, sessionId: current.state.deviceSessionId, tokenType: "access" });
    await this.unitOfWork.run(async ({ refreshTokens, sessions }) => {
      await refreshTokens.save(current);
      await refreshTokens.save(replacement);
      await sessions.save(session);
    });
    return {
      accessToken,
      refreshToken: generated.raw,
    };
  }
}
