import { Inject, Injectable } from "@nestjs/common";
import type { DeviceSessionRepository, RefreshTokenRepository } from "../../../../application/repositories/identity.repositories";
import { DEVICE_SESSION_REPOSITORY, REFRESH_TOKEN_REPOSITORY } from "../../../../application/repositories/identity.repositories";
import type { AuthenticatedUser } from "../auth.types";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";

abstract class SessionAction {
  constructor(protected readonly sessions: DeviceSessionRepository, protected readonly tokens: RefreshTokenRepository) {}
  protected async revoke(sessionId: string, userId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.state.userId !== userId)
      throw new IdentityApplicationError(IdentityErrorCode.SESSION_NOT_FOUND, "Session not found", 404);
    const now = new Date();
    session.revoke(now);
    for (const token of await this.tokens.findBySessionId(sessionId)) {
      if (token.isActive(now)) {
        token.revoke(now);
        await this.tokens.save(token);
      }
    }
    await this.sessions.save(session);
  }
}

@Injectable()
export class LogoutUseCase extends SessionAction {
  constructor(@Inject(DEVICE_SESSION_REPOSITORY) sessions: DeviceSessionRepository, @Inject(REFRESH_TOKEN_REPOSITORY) tokens: RefreshTokenRepository) { super(sessions, tokens); }
  execute(auth: AuthenticatedUser): Promise<void> { return this.revoke(auth.sessionId, auth.userId); }
}
@Injectable()
export class RevokeDeviceSessionUseCase extends SessionAction {
  constructor(@Inject(DEVICE_SESSION_REPOSITORY) sessions: DeviceSessionRepository, @Inject(REFRESH_TOKEN_REPOSITORY) tokens: RefreshTokenRepository) { super(sessions, tokens); }
  execute(auth: AuthenticatedUser, sessionId: string): Promise<void> { return this.revoke(sessionId, auth.userId); }
}
@Injectable()
export class LogoutAllSessionsUseCase {
  constructor(@Inject(DEVICE_SESSION_REPOSITORY) private readonly sessions: DeviceSessionRepository, @Inject(REFRESH_TOKEN_REPOSITORY) private readonly tokens: RefreshTokenRepository) {}
  async execute(userId: string): Promise<void> {
    const now = new Date();
    for (const session of await this.sessions.findByUserId(userId)) {
      if (session.isActive()) {
        session.revoke(now);
        await this.sessions.save(session);
      }
    }
    for (const token of await this.tokens.findByUserId(userId)) {
      if (token.isActive(now)) {
        token.revoke(now);
        await this.tokens.save(token);
      }
    }
  }
}
@Injectable()
export class ListDeviceSessionsUseCase {
  constructor(@Inject(DEVICE_SESSION_REPOSITORY) private readonly sessions: DeviceSessionRepository) {}
  async execute(userId: string) {
    return (await this.sessions.findByUserId(userId)).map((session) => ({ id: session.state.id, deviceId: session.state.deviceId, deviceName: session.state.deviceName, platform: session.state.platform, lastActiveAt: session.state.lastActiveAt, revokedAt: session.state.revokedAt }));
  }
}
