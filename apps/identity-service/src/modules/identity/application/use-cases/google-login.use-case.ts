import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IdentityUnitOfWork } from "../../../../application/repositories/identity.repositories";
import { IDENTITY_UNIT_OF_WORK } from "../../../../application/repositories/identity.repositories";
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
  constructor(
    @Inject(IDENTITY_UNIT_OF_WORK) private readonly unitOfWork: IdentityUnitOfWork,
    @Inject(OAUTH_IDENTITY_PROVIDER) private readonly google: OAuthIdentityProvider,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: { idToken: string; device: DeviceInput }): Promise<AuthResult> {
    let identity;
    try {
      identity = await this.google.verifyToken(input.idToken);
    } catch (error) {
      throw new IdentityApplicationError(
        IdentityErrorCode.OAUTH_TOKEN_INVALID,
        "Google token is invalid",
        401,
        error,
      );
    }
    if (!identity.emailVerified) {
      throw new IdentityApplicationError(
        IdentityErrorCode.OAUTH_TOKEN_INVALID,
        "Google email is not verified",
        401,
      );
    }

    const now = new Date();
    const generated = this.tokens.createRefreshToken();
    const { user, session } = await this.unitOfWork.run(
      async ({ users, accounts, sessions, refreshTokens }) => {
        let account = await accounts.findByProviderIdentity(
          OAuthProvider.GOOGLE,
          identity.providerUserId,
        );
        let accountToSave: OAuthAccount | null = null;
        let currentUser = account ? await users.findById(account.state.userId) : null;

        if (!account) {
          currentUser = currentUser ?? (await users.findByEmail(identity.email));
          if (!currentUser) {
            currentUser = User.create({
              id: randomUUID(),
              email: identity.email,
              displayName: identity.displayName,
              avatarUrl: identity.avatarUrl,
              emailVerifiedAt: now,
              createdAt: now,
            });
          } else if (!currentUser.state.emailVerifiedAt) {
            currentUser.verifyEmail(now);
          }
          account = OAuthAccount.create({
            id: randomUUID(),
            userId: currentUser.state.id,
            provider: OAuthProvider.GOOGLE,
            providerUserId: identity.providerUserId,
            providerEmail: identity.email,
            createdAt: now,
          });
          accountToSave = account;
        }

        if (!currentUser?.canAuthenticate()) {
          throw new IdentityApplicationError(
            IdentityErrorCode.INVALID_CREDENTIALS,
            "Unable to authenticate",
            401,
          );
        }
        let currentSession = await sessions.findByUserAndDevice(
          currentUser.state.id,
          input.device.deviceId,
        );
        if (currentSession) currentSession.resume(now);
        else {
          currentSession = DeviceSession.create({
            id: randomUUID(),
            userId: currentUser.state.id,
            ...input.device,
            createdAt: now,
          });
        }
        currentUser.recordLogin(now);
        const refresh = RefreshToken.create({
          id: randomUUID(),
          userId: currentUser.state.id,
          deviceSessionId: currentSession.state.id,
          tokenHash: generated.hash,
          tokenFamilyId: randomUUID(),
          expiresAt: new Date(
            now.getTime() +
              this.config.getOrThrow<number>("REFRESH_TOKEN_TTL_SECONDS") * 1000,
          ),
          createdAt: now,
        });
        await users.save(currentUser);
        if (accountToSave) await accounts.save(accountToSave);
        await sessions.save(currentSession);
        await refreshTokens.save(refresh);
        return { user: currentUser, session: currentSession };
      },
    );

    return {
      user: {
        id: user.state.id,
        email: user.state.email,
        displayName: user.state.displayName,
        avatarUrl: user.state.avatarUrl,
      },
      accessToken: await this.tokens.createAccessToken({
        sub: user.state.id,
        sessionId: session.state.id,
        tokenType: "access",
      }),
      refreshToken: generated.raw,
      session: {
        id: session.state.id,
        deviceId: session.state.deviceId,
        deviceName: session.state.deviceName,
        platform: session.state.platform,
      },
    };
  }
}
