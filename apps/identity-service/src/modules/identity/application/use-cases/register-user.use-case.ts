import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  IdentityUnitOfWork,
  UserRepository,
} from "../../../../application/repositories/identity.repositories";
import {
  IDENTITY_UNIT_OF_WORK,
  USER_REPOSITORY,
} from "../../../../application/repositories/identity.repositories";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { RefreshToken } from "../../domain/entities/refresh-token.entity";
import { User } from "../../domain/entities/user.entity";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";
import { PASSWORD_HASHER, TOKEN_SERVICE } from "../ports/auth.ports";
import type { PasswordHasher, TokenService } from "../ports/auth.ports";
import type { AuthResult, DeviceInput } from "../auth.types";

@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_UNIT_OF_WORK)
    private readonly unitOfWork: IdentityUnitOfWork,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}
  async execute(input: { email: string; password: string; displayName: string; device: DeviceInput }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email))
      throw new IdentityApplicationError(IdentityErrorCode.EMAIL_ALREADY_EXISTS, "Email is already registered", 409);
    const now = new Date();
    const user = User.create({ id: randomUUID(), email, displayName: input.displayName, passwordHash: await this.passwords.hash(input.password), createdAt: now });
    const session = DeviceSession.create({ id: randomUUID(), userId: user.state.id, ...input.device, createdAt: now });
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
