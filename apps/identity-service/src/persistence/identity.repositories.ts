import {
  Prisma,
  type OAuthProvider as PrismaOAuthProvider,
} from "../../generated/client";
import { PrismaService } from "../prisma.service";
import { IdentityApplicationError, IdentityErrorCode } from "../modules/identity/application/errors/identity.errors";
import type {
  UserRepository,
  OAuthAccountRepository,
  DeviceSessionRepository,
  RefreshTokenRepository,
  IdentityTransactionRepositories,
  IdentityUnitOfWork,
} from "../application/repositories/identity.repositories";
import type { User } from "../modules/identity/domain/entities/user.entity";
import type { OAuthAccount } from "../modules/identity/domain/entities/oauth-account.entity";
import type { DeviceSession } from "../modules/identity/domain/entities/device-session.entity";
import type { RefreshToken } from "../modules/identity/domain/entities/refresh-token.entity";
import {
  UserMapper,
  OAuthAccountMapper,
  DeviceSessionMapper,
  RefreshTokenMapper,
} from "./identity.mappers";
type IdentityDatabase = Pick<
  Prisma.TransactionClient,
  "user" | "oAuthAccount" | "deviceSession" | "refreshToken"
>;
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: IdentityDatabase) {}
  async findById(id: string) {
    const r = await this.db.user.findUnique({ where: { id } });
    return r ? UserMapper.toDomain(r) : null;
  }
  async findByEmail(email: string) {
    const r = await this.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    return r ? UserMapper.toDomain(r) : null;
  }
  async save(e: User) {
    const data = UserMapper.toPersistence(e);
    try {
      await this.db.user.upsert({
        where: { id: e.state.id },
        create: data,
        update: data,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.map(String) : [String(target)];
        if (fields.includes("email")) {
          throw new IdentityApplicationError(IdentityErrorCode.EMAIL_ALREADY_EXISTS, "Email is already registered", 409);
        }
      }
      throw error;
    }
  }
}
export class PrismaOAuthAccountRepository implements OAuthAccountRepository {
  constructor(private readonly db: IdentityDatabase) {}
  async findByProviderIdentity(provider: string, providerUserId: string) {
    const r = await this.db.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: provider as PrismaOAuthProvider,
          providerUserId,
        },
      },
    });
    return r ? OAuthAccountMapper.toDomain(r) : null;
  }
  async save(e: OAuthAccount) {
    const data = OAuthAccountMapper.toPersistence(e);
    await this.db.oAuthAccount.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaDeviceSessionRepository implements DeviceSessionRepository {
  constructor(private readonly db: IdentityDatabase) {}
  async findById(id: string) {
    const r = await this.db.deviceSession.findUnique({ where: { id } });
    return r ? DeviceSessionMapper.toDomain(r) : null;
  }
  async findByUserId(userId: string) {
    return (
      await this.db.deviceSession.findMany({
        where: { userId },
        orderBy: { lastActiveAt: "desc" },
      })
    ).map(DeviceSessionMapper.toDomain);
  }
  async findByUserAndDevice(userId: string, deviceId: string) {
    const r = await this.db.deviceSession.findUnique({
      where: { userId_deviceId: { userId, deviceId: deviceId.trim() } },
    });
    return r ? DeviceSessionMapper.toDomain(r) : null;
  }
  async save(e: DeviceSession) {
    const data = DeviceSessionMapper.toPersistence(e);
    await this.db.deviceSession.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: IdentityDatabase) {}
  async findByTokenHash(tokenHash: string) {
    const r = await this.db.refreshToken.findUnique({ where: { tokenHash } });
    return r ? RefreshTokenMapper.toDomain(r) : null;
  }
  async save(e: RefreshToken) {
    const data = RefreshTokenMapper.toPersistence(e);
    await this.db.refreshToken.upsert({
      where: { id: e.state.id },
      create: data,
      update: data,
    });
  }
}
export class PrismaIdentityUnitOfWork implements IdentityUnitOfWork {
  constructor(private readonly db: PrismaService) {}
  run<T>(
    work: (repositories: IdentityTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction((transaction) =>
      work({
        users: new PrismaUserRepository(transaction),
        sessions: new PrismaDeviceSessionRepository(transaction),
        refreshTokens: new PrismaRefreshTokenRepository(transaction),
      }),
    );
  }
}
