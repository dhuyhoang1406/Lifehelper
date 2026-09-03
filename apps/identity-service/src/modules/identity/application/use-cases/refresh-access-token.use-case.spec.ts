import { ConfigService } from "@nestjs/config";
import type {
  DeviceSessionRepository,
  IdentityTransactionRepositories,
  IdentityUnitOfWork,
  RefreshTokenRepository,
} from "../../../../application/repositories/identity.repositories";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { RefreshToken } from "../../domain/entities/refresh-token.entity";
import { DevicePlatform } from "../../domain/enums/identity.enums";
import { IdentityErrorCode } from "../errors/identity.errors";
import type { TokenService } from "../ports/auth.ports";
import { RefreshAccessTokenUseCase } from "./refresh-access-token.use-case";

describe("RefreshAccessTokenUseCase", () => {
  const refreshTokens = {
    findByTokenHash: jest.fn(),
  } as unknown as RefreshTokenRepository;
  const sessions = {
    findById: jest.fn(),
    save: jest.fn(),
  } as unknown as DeviceSessionRepository;
  const transactional = {
    users: { save: jest.fn() },
    sessions: { save: jest.fn() },
    refreshTokens: { save: jest.fn() },
  } as unknown as IdentityTransactionRepositories;
  const unitOfWork = {
    run: jest.fn(
      (work: (repositories: IdentityTransactionRepositories) => Promise<unknown>) =>
        work(transactional),
    ),
  } as unknown as IdentityUnitOfWork;
  const tokens = {
    hashRefreshToken: jest.fn().mockReturnValue("current-hash"),
    createRefreshToken: jest.fn().mockReturnValue({
      raw: "replacement-raw",
      hash: "replacement-hash",
    }),
    createAccessToken: jest.fn().mockResolvedValue("new-access-token"),
  } as unknown as TokenService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue(3600),
  } as unknown as ConfigService;

  const createSession = () =>
    DeviceSession.create({
      id: "session-1",
      userId: "user-1",
      deviceId: "phone-1",
      platform: DevicePlatform.ANDROID,
    });
  const createToken = (expiresAt = new Date(Date.now() + 60_000)) =>
    RefreshToken.create({
      id: "token-1",
      userId: "user-1",
      deviceSessionId: "session-1",
      tokenHash: "current-hash",
      tokenFamilyId: "family-1",
      expiresAt,
    });
  const build = () =>
    new RefreshAccessTokenUseCase(
      refreshTokens,
      sessions,
      unitOfWork,
      tokens,
      config,
    );

  beforeEach(() => jest.clearAllMocks());

  it("rotates an active token atomically", async () => {
    const current = createToken();
    const session = createSession();
    (refreshTokens.findByTokenHash as jest.Mock).mockResolvedValue(current);
    (sessions.findById as jest.Mock).mockResolvedValue(session);

    await expect(build().execute("current-raw")).resolves.toEqual({
      accessToken: "new-access-token",
      refreshToken: "replacement-raw",
    });

    expect(tokens.hashRefreshToken).toHaveBeenCalledWith("current-raw");
    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    expect(transactional.refreshTokens.save).toHaveBeenCalledTimes(2);
    expect(transactional.refreshTokens.save).toHaveBeenNthCalledWith(1, current);
    expect(transactional.sessions.save).toHaveBeenCalledWith(session);
    expect(current.state.usedAt).toBeInstanceOf(Date);
    expect(current.state.replacedById).toBeTruthy();
  });

  it("rejects an unknown refresh token", async () => {
    (refreshTokens.findByTokenHash as jest.Mock).mockResolvedValue(null);

    await expect(build().execute("unknown")).rejects.toMatchObject({
      code: IdentityErrorCode.REFRESH_TOKEN_INVALID,
      statusCode: 401,
    });
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("rejects an expired token without treating it as replay", async () => {
    const expired = RefreshToken.restore({
      ...createToken().state,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const session = createSession();
    (refreshTokens.findByTokenHash as jest.Mock).mockResolvedValue(expired);
    (sessions.findById as jest.Mock).mockResolvedValue(session);

    await expect(build().execute("expired")).rejects.toMatchObject({
      code: IdentityErrorCode.REFRESH_TOKEN_EXPIRED,
      statusCode: 401,
    });
    expect(session.isActive()).toBe(true);
    expect(sessions.save).not.toHaveBeenCalled();
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("rejects a revoked session", async () => {
    const current = createToken();
    const session = createSession();
    session.revoke();
    (refreshTokens.findByTokenHash as jest.Mock).mockResolvedValue(current);
    (sessions.findById as jest.Mock).mockResolvedValue(session);

    await expect(build().execute("current-raw")).rejects.toMatchObject({
      code: IdentityErrorCode.SESSION_REVOKED,
      statusCode: 401,
    });
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("revokes the session when a spent token is reused", async () => {
    const current = createToken();
    current.use("previous-replacement");
    const session = createSession();
    (refreshTokens.findByTokenHash as jest.Mock).mockResolvedValue(current);
    (sessions.findById as jest.Mock).mockResolvedValue(session);

    await expect(build().execute("replayed")).rejects.toMatchObject({
      code: IdentityErrorCode.REFRESH_TOKEN_INVALID,
      message: "Refresh token reuse detected",
      statusCode: 401,
    });
    expect(session.isActive()).toBe(false);
    expect(sessions.save).toHaveBeenCalledWith(session);
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("revokes the session when a spent token is replayed after expiry", async () => {
    const current = createToken();
    current.use("previous-replacement");
    const expiredAndSpent = RefreshToken.restore({
      ...current.state,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const session = createSession();
    (refreshTokens.findByTokenHash as jest.Mock).mockResolvedValue(expiredAndSpent);
    (sessions.findById as jest.Mock).mockResolvedValue(session);

    await expect(build().execute("expired-replay")).rejects.toMatchObject({
      code: IdentityErrorCode.REFRESH_TOKEN_INVALID,
      message: "Refresh token reuse detected",
      statusCode: 401,
    });
    expect(session.isActive()).toBe(false);
    expect(sessions.save).toHaveBeenCalledWith(session);
  });
});
