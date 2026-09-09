import { Inject, Injectable } from "@nestjs/common";
import type { DeviceSessionRepository, IdentityUnitOfWork } from "../../../../application/repositories/identity.repositories";
import { DEVICE_SESSION_REPOSITORY, IDENTITY_UNIT_OF_WORK } from "../../../../application/repositories/identity.repositories";
import type { AuthenticatedUser } from "../auth.types";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";

abstract class SessionAction {
  constructor(protected readonly unitOfWork: IdentityUnitOfWork) {}
  protected revoke(sessionId: string, userId: string): Promise<void> {
    return this.unitOfWork.run(async ({ sessions, refreshTokens }) => {
      const session = await sessions.findById(sessionId);
      if (!session || session.state.userId !== userId)
        throw new IdentityApplicationError(IdentityErrorCode.SESSION_NOT_FOUND, "Session not found", 404);
      const now = new Date();
      if (session.isActive()) {
        session.revoke(now);
        await sessions.save(session);
      }
      for (const token of await refreshTokens.findBySessionId(sessionId)) {
        if (token.isActive(now)) {
          token.revoke(now);
          await refreshTokens.save(token);
        }
      }
    });
  }
}

@Injectable()
export class LogoutUseCase extends SessionAction {
  constructor(@Inject(IDENTITY_UNIT_OF_WORK) unitOfWork: IdentityUnitOfWork) { super(unitOfWork); }
  execute(auth: AuthenticatedUser): Promise<void> { return this.revoke(auth.sessionId, auth.userId); }
}
@Injectable()
export class RevokeDeviceSessionUseCase extends SessionAction {
  constructor(@Inject(IDENTITY_UNIT_OF_WORK) unitOfWork: IdentityUnitOfWork) { super(unitOfWork); }
  execute(auth: AuthenticatedUser, sessionId: string): Promise<void> { return this.revoke(sessionId, auth.userId); }
}
@Injectable()
export class LogoutAllSessionsUseCase {
  constructor(@Inject(IDENTITY_UNIT_OF_WORK) private readonly unitOfWork: IdentityUnitOfWork) {}
  execute(userId: string): Promise<void> {
    return this.unitOfWork.run(async ({ sessions, refreshTokens }) => {
      const now = new Date();
      for (const session of await sessions.findByUserId(userId)) {
        if (session.isActive()) {
          session.revoke(now);
          await sessions.save(session);
        }
      }
      for (const token of await refreshTokens.findByUserId(userId)) {
        if (token.isActive(now)) {
          token.revoke(now);
          await refreshTokens.save(token);
        }
      }
    });
  }
}
@Injectable()
export class ListDeviceSessionsUseCase {
  constructor(@Inject(DEVICE_SESSION_REPOSITORY) private readonly sessions: DeviceSessionRepository) {}
  async execute(userId: string) {
    return (await this.sessions.findByUserId(userId)).map((session) => ({ id: session.state.id, deviceId: session.state.deviceId, deviceName: session.state.deviceName, platform: session.state.platform, lastActiveAt: session.state.lastActiveAt, revokedAt: session.state.revokedAt }));
  }
}
