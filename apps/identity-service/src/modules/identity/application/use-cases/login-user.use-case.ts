import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  DeviceSessionRepository,
  IdentityUnitOfWork,
  UserRepository,
} from "../../../../application/repositories/identity.repositories";
import {
  DEVICE_SESSION_REPOSITORY,
  IDENTITY_UNIT_OF_WORK,
  USER_REPOSITORY,
} from "../../../../application/repositories/identity.repositories";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { RefreshToken } from "../../domain/entities/refresh-token.entity";
import type { AuthResult, DeviceInput } from "../auth.types";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";
import type { PasswordHasher, TokenService } from "../ports/auth.ports";
import { PASSWORD_HASHER, TOKEN_SERVICE } from "../ports/auth.ports";

/** Fixed Argon2id hash (default cost) verified against whenever the account is missing or has no password, keeping response time constant and preventing user enumeration. */
export const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,p=4,t=3$0VePKzMXb931yegjonqj7g$GU/R09OL9REO7clkk695ODS6ARUx+9dzQ8aeWvGZ0Nw";

@Injectable()
export class LoginUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(DEVICE_SESSION_REPOSITORY) private readonly sessions: DeviceSessionRepository,
    @Inject(IDENTITY_UNIT_OF_WORK)
    private readonly unitOfWork: IdentityUnitOfWork,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}
  async execute(input: { email: string; password: string; device: DeviceInput }): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());
    const passwordHash = user?.state.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordValid = await this.passwords.verify(input.password, passwordHash);
    if (!user || !user.state.passwordHash || !passwordValid || !user.canAuthenticate())
      throw new IdentityApplicationError(IdentityErrorCode.INVALID_CREDENTIALS, "Invalid credentials", 401);
    const now = new Date();
    let session = await this.sessions.findByUserAndDevice(user.state.id, input.device.deviceId);
    if (session) session.resume(now);
    else session = DeviceSession.create({ id: randomUUID(), userId: user.state.id, ...input.device, createdAt: now });
    user.recordLogin(now);
    const generated = this.tokens.createRefreshToken();
    const refresh = RefreshToken.create({ id: randomUUID(), userId: user.state.id, deviceSessionId: session.state.id, tokenHash: generated.hash, tokenFamilyId: randomUUID(), expiresAt: new Date(now.getTime() + this.config.getOrThrow<number>("REFRESH_TOKEN_TTL_SECONDS") * 1000), createdAt: now });
    await this.unitOfWork.run(async ({ users, sessions, refreshTokens }) => {
      await users.save(user);
      await sessions.save(session);
      await refreshTokens.save(refresh);
    });
    return {
      user: { id: user.state.id, email: user.state.email, displayName: user.state.displayName, avatarUrl: user.state.avatarUrl },
      accessToken: await this.tokens.createAccessToken({ sub: user.state.id, sessionId: session.state.id, tokenType: "access" }),
      refreshToken: generated.raw,
      session: { id: session.state.id, deviceId: session.state.deviceId, deviceName: session.state.deviceName, platform: session.state.platform },
    };
  }
}
