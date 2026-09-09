import { ConfigService } from "@nestjs/config";
import type {
  IdentityTransactionRepositories,
  IdentityUnitOfWork,
} from "../../../../application/repositories/identity.repositories";
import { OAuthAccount } from "../../domain/entities/oauth-account.entity";
import { User } from "../../domain/entities/user.entity";
import { DevicePlatform, OAuthProvider } from "../../domain/enums/identity.enums";
import { IdentityErrorCode } from "../errors/identity.errors";
import type { OAuthIdentityProvider, TokenService } from "../ports/auth.ports";
import { GoogleLoginUseCase } from "./google-login.use-case";

describe("GoogleLoginUseCase", () => {
  const identity = {
    providerUserId: "google-1",
    email: "user@example.com",
    emailVerified: true,
    displayName: "User",
    avatarUrl: null,
  };
  const input = {
    idToken: "google-token",
    device: { deviceId: "phone-1", platform: DevicePlatform.ANDROID },
  };
  const repositories = {
    users: { findById: jest.fn(), findByEmail: jest.fn(), save: jest.fn() },
    accounts: { findByProviderIdentity: jest.fn(), save: jest.fn() },
    sessions: { findByUserAndDevice: jest.fn(), save: jest.fn() },
    refreshTokens: { save: jest.fn() },
  } as unknown as IdentityTransactionRepositories;
  const unitOfWork = {
    run: jest.fn((work: (value: IdentityTransactionRepositories) => Promise<unknown>) =>
      work(repositories),
    ),
  } as unknown as IdentityUnitOfWork;
  const google = {
    verifyToken: jest.fn().mockResolvedValue(identity),
  } as unknown as OAuthIdentityProvider;
  const tokens = {
    createRefreshToken: jest.fn().mockReturnValue({ raw: "raw-refresh", hash: "hash" }),
    createAccessToken: jest.fn().mockResolvedValue("access-token"),
  } as unknown as TokenService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue(3600),
  } as unknown as ConfigService;
  const build = () => new GoogleLoginUseCase(unitOfWork, google, tokens, config);

  beforeEach(() => {
    jest.clearAllMocks();
    (google.verifyToken as jest.Mock).mockResolvedValue(identity);
    (repositories.accounts.findByProviderIdentity as jest.Mock).mockResolvedValue(null);
    (repositories.users.findByEmail as jest.Mock).mockResolvedValue(null);
    (repositories.sessions.findByUserAndDevice as jest.Mock).mockResolvedValue(null);
  });

  it("creates a new user, account, session, and refresh token atomically", async () => {
    const result = await build().execute(input);

    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    expect(repositories.users.save).toHaveBeenCalledTimes(1);
    expect(repositories.accounts.save).toHaveBeenCalledTimes(1);
    expect(repositories.sessions.save).toHaveBeenCalledTimes(1);
    expect(repositories.refreshTokens.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ accessToken: "access-token", refreshToken: "raw-refresh" });
  });

  it("authenticates an existing linked Google account", async () => {
    const user = User.create({ id: "user-1", email: identity.email, displayName: "User" });
    const account = OAuthAccount.create({
      id: "account-1",
      userId: user.state.id,
      provider: OAuthProvider.GOOGLE,
      providerUserId: identity.providerUserId,
      providerEmail: identity.email,
    });
    (repositories.accounts.findByProviderIdentity as jest.Mock).mockResolvedValue(account);
    (repositories.users.findById as jest.Mock).mockResolvedValue(user);

    await expect(build().execute(input)).resolves.toMatchObject({
      user: { id: "user-1" },
    });
    expect(repositories.accounts.save).not.toHaveBeenCalled();
  });

  it("links an existing password user and marks the email verified", async () => {
    const user = User.create({ id: "user-1", email: identity.email, displayName: "User" });
    (repositories.users.findByEmail as jest.Mock).mockResolvedValue(user);

    await build().execute(input);

    expect(user.state.emailVerifiedAt).toBeInstanceOf(Date);
    expect(repositories.accounts.save).toHaveBeenCalledTimes(1);
    expect(repositories.users.save).toHaveBeenCalledWith(user);
  });

  it("rejects an invalid Google token before opening a transaction", async () => {
    const cause = new Error("Google key endpoint unavailable");
    (google.verifyToken as jest.Mock).mockRejectedValue(cause);

    await expect(build().execute(input)).rejects.toMatchObject({
      code: IdentityErrorCode.OAUTH_TOKEN_INVALID,
      statusCode: 401,
      cause,
    });
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("rejects an unverified Google email before opening a transaction", async () => {
    (google.verifyToken as jest.Mock).mockResolvedValue({ ...identity, emailVerified: false });

    await expect(build().execute(input)).rejects.toMatchObject({
      code: IdentityErrorCode.OAUTH_TOKEN_INVALID,
      message: "Google email is not verified",
    });
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });
});
