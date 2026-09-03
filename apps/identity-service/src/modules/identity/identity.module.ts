import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../../prisma.service";
import { PrismaDeviceSessionRepository, PrismaIdentityUnitOfWork, PrismaOAuthAccountRepository, PrismaRefreshTokenRepository, PrismaUserRepository } from "../../persistence/identity.repositories";
import { DEVICE_SESSION_REPOSITORY, IDENTITY_UNIT_OF_WORK, OAUTH_ACCOUNT_REPOSITORY, REFRESH_TOKEN_REPOSITORY, USER_REPOSITORY } from "../../application/repositories/identity.repositories";
import { PASSWORD_HASHER, TOKEN_SERVICE } from "./application/ports/auth.ports";
import { RegisterUserUseCase } from "./application/use-cases/register-user.use-case";
import { LoginUserUseCase } from "./application/use-cases/login-user.use-case";
import { RefreshAccessTokenUseCase } from "./application/use-cases/refresh-access-token.use-case";
import { Argon2PasswordHasher } from "./infrastructure/security/argon2-password-hasher";
import { JwtTokenService } from "./infrastructure/security/jwt-token.service";
import { AuthController } from "./presentation/auth.controller";
import { IdentityExceptionFilter } from "./presentation/identity-exception.filter";

const repository = (provide: symbol, useClass: new (db: PrismaService) => unknown) => ({ provide, useFactory: (db: PrismaService) => new useClass(db), inject: [PrismaService] });
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    RegisterUserUseCase,
    LoginUserUseCase,
    RefreshAccessTokenUseCase,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    repository(USER_REPOSITORY, PrismaUserRepository),
    repository(OAUTH_ACCOUNT_REPOSITORY, PrismaOAuthAccountRepository),
    repository(DEVICE_SESSION_REPOSITORY, PrismaDeviceSessionRepository),
    repository(REFRESH_TOKEN_REPOSITORY, PrismaRefreshTokenRepository),
    repository(IDENTITY_UNIT_OF_WORK, PrismaIdentityUnitOfWork),
    { provide: APP_FILTER, useClass: IdentityExceptionFilter },
  ],
  exports: [TOKEN_SERVICE],
})
export class IdentityModule {}
